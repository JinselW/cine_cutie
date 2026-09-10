import { BaseAgent } from './baseAgent.js';
import { reportScore } from './qcAgent.js';
import { DeliveryQCAgent } from './deliveryQCAgent.js';
import { getActiveProvider } from '../providers/registry.js';
import { chat, getConfig, isConfigured, parseJson } from '../providers/llm.js';
import { createArtifact, ArtifactKind, ArtifactStatus } from '../artifacts/artifactTypes.js';
import { QCVerdict } from './qcTypes.js';
import { reportPhase } from '../progressTracker.js';
import { buildFinalComplianceReport } from '../compliance/finalReport.js';
import { compileSoundPlan } from '../audio/soundPlan.js';
import { generateAudioOverlay } from '../audio/audioClient.js';

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

export function buildAudioTracks(soundPlan, clips, transitions = []) {
  if (!soundPlan?.shots?.length || !clips?.length) return [];
  const durations = clips.map(c => Math.max(0.1, Number(c.duration) || 5));
  const starts = [0];
  for (let i = 1; i < clips.length; i++) {
    const overlap = transitions[i - 1]?.type === 'crossfade'
      ? Math.max(0, Number(transitions[i - 1]?.duration) || 0) : 0;
    starts[i] = Math.max(starts[i - 1], starts[i - 1] + durations[i - 1] - overlap);
  }
  const tracks = [];
  for (let i = 0; i < clips.length && i < soundPlan.shots.length; i++) {
    const shot = soundPlan.shots[i];
    const offset = starts[i];
    const duration = durations[i];
    if (shot.dialogue || shot.narratorText) {
      tracks.push({
        type: 'tts',
        text: shot.dialogue || shot.narratorText,
        duration,
        voiceProfile: shot.voiceProfile,
        speakerId: shot.speakerId,
        offset,
      });
    }
    if (shot.ambiencePrompt || (shot.soundEffects && shot.soundEffects.length)) {
      tracks.push({
        type: 'sfx',
        prompt: [shot.ambiencePrompt, ...(shot.soundEffects || [])].filter(Boolean).join('; '),
        duration,
        offset,
      });
    }
  }
  return tracks;
}

export function buildSubtitleCues(storyboard, script, clips, transitions = []) {
  const shotInfo = new Map();
  for (let epIdx = 0; epIdx < (storyboard?.episodes || []).length; epIdx++) {
    const episode = storyboard.episodes[epIdx];
    for (let segIdx = 0; segIdx < (episode.segments || []).length; segIdx++) {
      for (const shot of (episode.segments[segIdx].shots || [])) {
        shotInfo.set(String(shot.shot_id), { shot, epIdx, segIdx, key: `${epIdx}-${segIdx}` });
      }
    }
  }
  const durations = clips.map(clip => Math.max(0.1, Number(clip.duration ?? shotInfo.get(String(clip.shot_id))?.shot?.duration ?? 5) || 5));
  const starts = [0];
  for (let index = 1; index < clips.length; index++) {
    const overlap = transitions[index - 1]?.type === 'crossfade'
      ? Math.max(0, Number(transitions[index - 1]?.duration) || 0) : 0;
    starts[index] = Math.max(starts[index - 1], starts[index - 1] + durations[index - 1] - overlap);
  }
  const cues = [];
  for (let index = 0; index < clips.length;) {
    const info = shotInfo.get(String(clips[index].shot_id));
    const explicit = info?.shot?.subtitle || info?.shot?.caption || info?.shot?.dialogue;
    if (explicit) {
      const end = starts[index + 1] ?? (starts[index] + durations[index]);
      cues.push({ start: starts[index], end, text: String(explicit).trim() });
      index++;
      continue;
    }
    const key = info?.key;
    let endIndex = index + 1;
    while (key && endIndex < clips.length && shotInfo.get(String(clips[endIndex].shot_id))?.key === key) endIndex++;
    const end = starts[endIndex] ?? (starts[endIndex - 1] + durations[endIndex - 1]);
    const text = info ? script?.episodes?.[info.epIdx]?.segments?.[info.segIdx]?.dialogue : '';
    if (String(text || '').trim()) cues.push({ start: starts[index], end, text: String(text).trim() });
    index = endIndex;
  }
  return cues;
}

export class EditorAgent extends BaseAgent {
  #qcAgent;

  constructor() {
    super({ name: 'Post-Production Artist', stepId: 'postProduction' });
    this.#qcAgent = new DeliveryQCAgent();
  }

  async run(ctx, _token) {
    reportPhase('rendering');
    let result = await this.#callProvider(ctx, _token);
    if (!this.#validateL1(result)) {
      result = { episodes: [], finalVideo: '', status: 'failed' };
    }

    const finalData = result;
    const hasFinal = !!finalData.finalVideo;

    if (result?.soundPlan) finalData.soundPlan = result.soundPlan;
    if (result?.audioResult) finalData.audioResult = result.audioResult;

    // Delivery QC combines deterministic media checks with multimodal creative review.
    reportPhase('validating');
    const crit = await this.#qcAgent.process({ data: finalData, entities: ctx.entities || {}, ...ctx });
    reportScore(crit.score, '🎬');

    finalData.qcBaseline = {
      ...(finalData.qcBaseline || {}),
      overallQuality: crit.score,
      narrativeFaithfulness: crit.creative?.llm?.scores?.criterion2 ?? null,
      visualConsistency: crit.creative?.llm?.scores?.criterion3 ?? null,
      deliveryVerdict: crit.verdict,
      deliveryChecks: crit.technical?.checks || [],
      repairPlan: crit.repairPlan || null,
      failureReasons: crit.issues || [],
    };
    finalData.complianceReport = await buildFinalComplianceReport({
      userInput: ctx.userInput,
      data: {
        script: ctx.script,
        characterDesign: ctx.characterDesign,
        storyboard: ctx.storyboard,
        referenceImages: ctx.referenceImages,
        videoClips: ctx.videoClips,
      },
      uploads: ctx.uploads,
      finalVideo: finalData.finalVideo,
      signal: _token?.signal,
    });

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
        qcBaseline: finalData.qcBaseline,
        complianceReport: finalData.complianceReport,
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

      const soundPlan = compileSoundPlan({
        storyboard: ctx.storyboard,
        script: ctx.script,
        characterDesign: ctx.characterDesign,
      });

      const audioTracks = buildAudioTracks(soundPlan, valid, transitions);
      let audioResult = null;
      if (audioTracks.length > 0) {
        audioResult = await generateAudioOverlay({ tracks: audioTracks, signal: token?.signal });
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
        subtitles: buildSubtitleCues(ctx.storyboard, ctx.script, valid, transitions),
        audioOverlay: audioResult?.mixedAudioPath ? { path: audioResult.mixedAudioPath } : null,
        signal: token?.signal,
      });
      return {
        episodes: (ctx.storyboard?.episodes || []).map(ep => ({ episode: ep.episode })),
        finalVideo: result.finalVideo,
        status: result.status,
        bgm: bgm?.enabled ? { enabled: true, path: bgm.path || '', volume: bgm.volume ?? 0.6 } : null,
        subtitles: result.subtitles || null,
        qcBaseline: result.qcBaseline || null,
        editPlan,
        soundPlan,
        audioResult,
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
