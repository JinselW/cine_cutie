import { BaseAgent } from './baseAgent.js';
import { QCAgent, reportScore } from './qcAgent.js';
import { getActiveProvider } from '../providers/registry.js';
import { getConfig } from '../providers/llm.js';
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
      const valid = clips.filter(c => c.videoPath && c.status === 'complete');

      const transitions = [];
      for (let i = 1; i < valid.length; i++) {
        const prev = sceneMap.get(String(valid[i - 1].shot_id));
        const cur = sceneMap.get(String(valid[i].shot_id));
        const sceneChange = prev != null && cur != null && prev !== cur;
        transitions.push(sceneChange ? { type: 'crossfade', duration: SCENE_TRANSITION } : { type: 'cut', duration: 0 });
      }

      const items = valid.map(c => ({ id: c.shot_id, videoPath: c.videoPath, status: c.status }));
      const bgm = getConfig().bgm;
      const result = await provider.generate({
        items,
        transitions,
        fadeIn: FADE_IO > 0,
        fadeOut: FADE_IO > 0,
        bgm,
        signal: token?.signal,
      });
      return {
        episodes: (ctx.storyboard?.episodes || []).map(ep => ({ episode: ep.episode })),
        finalVideo: result.finalVideo,
        status: result.status,
        bgm: bgm?.enabled ? { enabled: true, path: bgm.path || '', volume: bgm.volume ?? 0.6 } : null,
        qcBaseline: result.qcBaseline || null,
      };
    } catch {
      return null;
    }
  }
}
