import { BaseAgent } from './baseAgent.js';
import { QCAgent, reportScore } from './qcAgent.js';
import { getActiveProvider } from '../providers/registry.js';
import { chat, getConfig, isConfigured, parseJson } from '../providers/llm.js';
import { createArtifact, ArtifactKind, ArtifactStatus } from '../artifacts/artifactTypes.js';
import { QCVerdict } from './qcTypes.js';
import { reportPhase } from '../progressTracker.js';

const SCENE_TRANSITION = 0.5;
const FADE_IO = 0.5;

// Storyboard segments have no id, so key each shot by its episode/segment indices.
function buildSceneMap(storyboard) {
  const map = new Map();
  let epIdx = 0;
  for (const ep of (storyboard?.episodes || [])) {
    let segIdx = 0;
    for (const seg of (ep.segments || [])) {
      for (const shot of (seg.shots || [])) {
        if (shot.shot_id != null) map.set(String(shot.shot_id), `${epIdx}-${segIdx}`);
      }
      segIdx++;
    }
    epIdx++;
  }
  return map;
}

export class EditorAgent extends BaseAgent {
  #qcAgent;

  constructor() {
    super({ name: 'Post-Production Artist', stepId: 'postProduction' });
    this.#qcAgent = new QCAgent({ stepId: 'postProduction' });
  }

  async run(ctx, _token) {
    reportPhase('rendering');
    let result = await this.#callProvider(ctx, _token);
    if (!this.#validateL1(result)) {
      result = { episodes: [], finalVideo: '', status: 'failed' };
    }

    const finalData = result;
    const hasFinal = !!finalData.finalVideo;

    // Post-production concatenation is deterministic — a single unified QC decision,
    // no regeneration. qcAgent.process folds the consistency hard gate into the score.
    reportPhase('validating');
    const crit = await this.#qcAgent.process({ data: finalData, entities: ctx.entities || {}, ...ctx });
    reportScore(crit.score, '🎬');

    const sourceArtifactIds = ctx.sourceArtifactIds?.videoGeneration ? [ctx.sourceArtifactIds.videoGeneration] : [];

    return {
      artifacts: [createArtifact({
        kind: ArtifactKind.FINAL_VIDEO,
        stepId: 'postProduction',
        data: finalData,
        status: hasFinal ? ArtifactStatus.COMPLETE : ArtifactStatus.FAILED,
        sourceArtifactIds,
      })],
      metadata: {
        retries: 0,
        renderStatus: finalData.status || 'failed',
        qualityScore: crit.score,
        consistencyIssues: crit.consistency?.issues || [],
        qcBaseline: {
          ...(finalData.qcBaseline || {}),
          overallQuality: crit.score,
          narrativeFaithfulness: crit.llm?.scores?.criterion2 ?? null,
          visualConsistency: crit.llm?.scores?.criterion3 ?? null,
          failureReasons: [...(crit.consistency?.issues || []), ...(crit.llm?.issues || [])],
        },
        verdict: crit.verdict ?? (hasFinal ? null : QCVerdict.FAIL),
        feedbackSatisfied: crit.feedbackSatisfied ?? !ctx.feedback,
      },
    };
  }

  #validateL1(result) {
    return result && typeof result === 'object' && 'finalVideo' in result;
  }

  async #callProvider(ctx, token) {
    const provider = getActiveProvider('render');
    if (!provider) return null;
    try {
      const clips = (ctx.videoClips?.clips || []);
      const sceneMap = buildSceneMap(ctx.storyboard);
      let valid = clips.filter(c => c.videoPath && c.status === 'complete');
      const editPlan = await this.#buildRevisionPlan(ctx, valid, token?.signal);
      if (editPlan.excludedShotIds.length) {
        const excluded = new Set(editPlan.excludedShotIds.map(String));
        valid = valid.filter(c => !excluded.has(String(c.shot_id)));
      }
      if (editPlan.clipOrder.length) {
        const order = new Map(editPlan.clipOrder.map((id, index) => [String(id), index]));
        valid.sort((a, b) => (order.get(String(a.shot_id)) ?? Number.MAX_SAFE_INTEGER)
          - (order.get(String(b.shot_id)) ?? Number.MAX_SAFE_INTEGER));
      }

      const transitions = [];
      for (let i = 1; i < valid.length; i++) {
        const prev = sceneMap.get(String(valid[i - 1].shot_id));
        const cur = sceneMap.get(String(valid[i].shot_id));
        const sceneChange = prev != null && cur != null && prev !== cur;
        const wantsCrossfade = editPlan.transitionStyle === 'crossfade'
          || (editPlan.transitionStyle === 'auto' && sceneChange);
        transitions.push(wantsCrossfade
          ? { type: 'crossfade', duration: editPlan.transitionDuration }
          : { type: 'cut', duration: 0 });
      }

      const items = valid.map(c => ({ id: c.shot_id, videoPath: c.videoPath, status: c.status }));
      const configuredBgm = getConfig().bgm || {};
      const bgm = {
        ...configuredBgm,
        enabled: editPlan.bgmEnabled ?? configuredBgm.enabled,
        volume: editPlan.bgmVolume ?? configuredBgm.volume,
      };
      const result = await provider.generate({
        items,
        transitions,
        fadeIn: editPlan.fadeIn,
        fadeOut: editPlan.fadeOut,
        bgm,
        signal: token?.signal,
      });
      return {
        episodes: (ctx.storyboard?.episodes || []).map(ep => ({ episode: ep.episode })),
        finalVideo: result.finalVideo,
        status: result.status,
        bgm: bgm?.enabled ? { enabled: true, path: bgm.path || '', volume: bgm.volume ?? 0.6 } : null,
        qcBaseline: result.qcBaseline || null,
        editPlan,
      };
    } catch {
      return null;
    }
  }

  async #buildRevisionPlan(ctx, clips, signal) {
    const defaults = {
      transitionStyle: 'auto',
      transitionDuration: SCENE_TRANSITION,
      fadeIn: FADE_IO > 0,
      fadeOut: FADE_IO > 0,
      bgmEnabled: getConfig().bgm?.enabled ?? false,
      bgmVolume: getConfig().bgm?.volume ?? 0.6,
      clipOrder: [],
      excludedShotIds: [],
    };
    if (!ctx.feedback || !isConfigured()) return defaults;

    const availableIds = clips.map(c => String(c.shot_id));
    const messages = [
      {
        role: 'system',
        content: 'You convert user feedback into a safe executable video edit plan. Reply only with valid JSON. Preserve unspecified settings.',
      },
      {
        role: 'user',
        content: `USER REVISION REQUIREMENT (must be satisfied): ${ctx.feedback}\n\nAvailable shot ids in current order: ${JSON.stringify(availableIds)}\nCurrent settings: ${JSON.stringify(defaults)}\n\nReturn {"transitionStyle":"auto|cut|crossfade","transitionDuration":0-2,"fadeIn":boolean,"fadeOut":boolean,"bgmEnabled":boolean,"bgmVolume":0-1,"clipOrder":["existing shot id"],"excludedShotIds":["existing shot id"]}. Only reorder or exclude ids that exist.`,
      },
    ];

    try {
      const parsed = parseJson(await chat(messages, { signal }));
      if (!parsed) return defaults;
      const allowedIds = new Set(availableIds);
      const transitionStyle = ['auto', 'cut', 'crossfade'].includes(parsed.transitionStyle)
        ? parsed.transitionStyle : defaults.transitionStyle;
      const numberInRange = (value, min, max, fallback) => {
        const number = Number(value);
        return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
      };
      return {
        transitionStyle,
        transitionDuration: numberInRange(parsed.transitionDuration, 0, 2, defaults.transitionDuration),
        fadeIn: typeof parsed.fadeIn === 'boolean' ? parsed.fadeIn : defaults.fadeIn,
        fadeOut: typeof parsed.fadeOut === 'boolean' ? parsed.fadeOut : defaults.fadeOut,
        bgmEnabled: typeof parsed.bgmEnabled === 'boolean' ? parsed.bgmEnabled : defaults.bgmEnabled,
        bgmVolume: numberInRange(parsed.bgmVolume, 0, 1, defaults.bgmVolume),
        clipOrder: Array.isArray(parsed.clipOrder)
          ? [...new Set(parsed.clipOrder.map(String).filter(id => allowedIds.has(id)))] : [],
        excludedShotIds: Array.isArray(parsed.excludedShotIds)
          ? [...new Set(parsed.excludedShotIds.map(String).filter(id => allowedIds.has(id)))] : [],
      };
    } catch {
      return defaults;
    }
  }
}
