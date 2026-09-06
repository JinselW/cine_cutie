import { BaseAgent } from './baseAgent.js';
import { RetryAgent, ItemRetryStrategy } from './retryAgent.js';
import { QCAgent, SCORE_THRESHOLD, reportScore, reportRetry } from './qcAgent.js';
import { getActiveProvider } from '../providers/registry.js';
import { getConfig } from '../providers/llm.js';
import { createArtifact, ArtifactKind, ArtifactStatus, recordItemAttempt } from '../artifacts/artifactTypes.js';
import { addAgentMessage } from '../ui/render.js';
import { t } from '../i18n.js';

const MAX_ITEM_ATTEMPTS = 3;
const MAX_STAGE_RETRIES = 1;
// 参考生视频模型最多接受 5 张参考图
const MAX_REFERENCE_IMAGES = 5;
// 分镜没给建议时长时的兜底：5 秒是所有视频模型都接受的档位
const DEFAULT_CLIP_DURATION = 5;

function applyVisualRetryFeedback(items, critique) {
  const note = (critique.suggestions || []).join('; ');
  for (const item of items) {
    item.seed = (item.seed ?? 42) + 13;
    if (note) item.prompt = `${item.prompt}\n${note}`;
  }
}

const CAMERA_MOTION_MAP = Object.freeze({
  'pan-left': 'camera slowly pans left',
  'pan-right': 'camera slowly pans right',
  'tilt-up': 'camera slowly tilts up',
  'tilt-down': 'camera slowly tilts down',
  'zoom-in': 'camera slowly zooms in',
  'zoom-out': 'camera slowly zooms out',
  'dolly-in': 'camera dollies in',
  'dolly-out': 'camera dollies out',
  'static': 'static camera, subtle motion',
  'tracking': 'camera tracks the subject smoothly',
});

export class VideoAgent extends BaseAgent {
  #retryAgent;
  #qcAgent;

  constructor() {
    super({ name: 'Video Director', stepId: 'videoGeneration' });
    this.#retryAgent = new RetryAgent();
    this.#qcAgent = new QCAgent({ stepId: 'videoGeneration' });
  }

  async run(ctx, _token) {
    const hasUploads = ctx.uploads && (ctx.uploads.firstFrame || ctx.uploads.lastFrame || ctx.uploads.referenceImages?.length > 0);

    if (hasUploads) {
      return this.#runWithUploads(ctx, _token);
    }

    const refImages = ctx.referenceImages;
    if (!refImages?.shots?.length) return this.#emptyResult(ctx);

    const mode = this.#videoMode();
    const items = this.#buildItems(refImages, ctx, mode);
    if (!items.length) return this.#emptyResult(ctx);

    const artifact = createArtifact({
      kind: ArtifactKind.VIDEO_CLIP,
      stepId: 'videoGeneration',
      data: { mode, clips: [] },
      status: ArtifactStatus.GENERATING,
    });

    let bestData = null, bestCrit = null, bestScore = -Infinity;

    for (let attempt = 0; attempt <= MAX_STAGE_RETRIES; attempt++) {
      if (_token?.signal?.aborted) break;

      const results = await this.#generateItems(items, artifact, ctx, _token);
      const data = this.#assembleResult(results, refImages, mode);

      const crit = await this.#qcAgent.process({ data, entities: ctx.entities || {}, ...ctx });
      reportScore(crit.score, '🎥');
      if (crit.score > bestScore) { bestScore = crit.score; bestData = data; bestCrit = crit; }

      if (crit.score >= SCORE_THRESHOLD || attempt === MAX_STAGE_RETRIES) break;
      if (crit.source === 'structural') break;

      reportRetry(crit.score, attempt + 1, MAX_STAGE_RETRIES, '🎥');
      applyVisualRetryFeedback(items, crit);
    }

    const finalData = bestData || { mode, clips: [] };
    const complete = finalData.clips.filter(c => c.status === 'complete').length;

    artifact.data = finalData;
    artifact.status = complete > 0 ? ArtifactStatus.COMPLETE : ArtifactStatus.FAILED;

    return {
      artifacts: [artifact],
      metadata: {
        videoMode: mode,
        totalClips: finalData.clips.length,
        completeClips: complete,
        failedClips: finalData.clips.filter(c => c.status === 'failed').length,
        qualityScore: bestCrit?.score ?? 0,
        consistencyIssues: bestCrit?.consistency?.issues || [],
        verdict: bestCrit?.verdict ?? null,
      },
    };
  }

  async #runWithUploads(ctx, _token) {
    const uploads = ctx.uploads;
    const allStoryboardShots = this.#storyboardShots(ctx);

    const shotCount = Math.max(1, allStoryboardShots.length || Math.ceil((ctx.totalDuration || 30) / 5));
    const items = [];

    for (let i = 0; i < shotCount; i++) {
      const sbShot = allStoryboardShots[i];
      const prompt = sbShot?.description || sbShot?.prompt || `Scene ${i + 1}`;
      const camera = sbShot?.camera || '';
      const motion = CAMERA_MOTION_MAP[camera] || 'subtle natural motion';
      const videoPrompt = `${prompt}, ${motion}`;

      items.push({
        id: `upload_clip_${i}`,
        prompt: videoPrompt,
        imageUrl: uploads.firstFrame?.serverPath || uploads.referenceImages?.[0]?.serverPath || '',
        seed: 42,
        referenceId: 'uploads',
      });
    }

    const artifact = createArtifact({
      kind: ArtifactKind.VIDEO_CLIP,
      stepId: 'videoGeneration',
      data: { clips: [] },
      status: ArtifactStatus.GENERATING,
    });

    const assemble = (results) => {
      const resultById = new Map(results.map(r => [r.id, r]));
      return { clips: items.map(item => {
        const r = resultById.get(item.id);
        return {
          shot_id: item.id,
          videoPath: r?.videoPath || '',
          status: r?.status === 'complete' ? 'complete' : 'failed',
        };
      }) };
    };

    let bestData = null, bestCrit = null, bestScore = -Infinity;

    for (let attempt = 0; attempt <= MAX_STAGE_RETRIES; attempt++) {
      if (_token?.signal?.aborted) break;

      const results = await this.#generateItemsWithUploads(items, artifact, ctx, _token);
      const data = assemble(results);

      const crit = await this.#qcAgent.process({ data, entities: ctx.entities || {}, ...ctx });
      reportScore(crit.score, '🎥');
      if (crit.score > bestScore) { bestScore = crit.score; bestData = data; bestCrit = crit; }

      if (crit.score >= SCORE_THRESHOLD || attempt === MAX_STAGE_RETRIES) break;
      if (crit.source === 'structural') break;

      reportRetry(crit.score, attempt + 1, MAX_STAGE_RETRIES, '🎥');
      applyVisualRetryFeedback(items, crit);
    }

    const finalData = bestData || { clips: [] };
    const complete = finalData.clips.filter(c => c.status === 'complete').length;

    artifact.data = finalData;
    artifact.status = complete > 0 ? ArtifactStatus.COMPLETE : ArtifactStatus.FAILED;

    return {
      artifacts: [artifact],
      metadata: {
        totalClips: finalData.clips.length,
        completeClips: complete,
        failedClips: finalData.clips.filter(c => c.status === 'failed').length,
        qualityScore: bestCrit?.score ?? 0,
        consistencyIssues: bestCrit?.consistency?.issues || [],
        verdict: bestCrit?.verdict ?? null,
      },
    };
  }

  #videoMode() {
    const mode = getConfig().videoMode;
    return mode === 'firstLastFrame' || mode === 'referenceImage' ? mode : 'firstFrame';
  }

  #storyboardShots(ctx) {
    const shots = [];
    for (const ep of (ctx.storyboard?.episodes || [])) {
      for (const seg of (ep.segments || [])) {
        for (const shot of (seg.shots || [])) shots.push(shot);
      }
    }
    return shots;
  }

  #buildItems(refImages, ctx, mode) {
    const characters = ctx.characterDesign?.characters || [];
    const sbShots = this.#storyboardShots(ctx);
    const sbById = new Map(sbShots.map(s => [s.shot_id, s]));
    const shots = refImages.shots || [];
    const items = [];

    for (let i = 0; i < shots.length; i++) {
      const shot = shots[i];
      const matchedChar = this.#matchCharacter(shot, characters);
      const sbShot = sbById.get(shot.shot_id) || sbShots[i];
      const base = {
        id: shot.shot_id,
        prompt: this.#buildVideoPrompt(shot, sbShot),
        duration: this.#clipDuration(sbShot),
        seed: 42,
      };

      if (mode === 'referenceImage') {
        const referenceImages = this.#referenceListFor(shot, matchedChar);
        if (!referenceImages.length) continue;
        items.push({ ...base, referenceImages, referenceId: referenceImages[0] });
        continue;
      }

      const first = this.#firstFrameFor(shot, matchedChar);
      if (!first) continue;

      if (mode === 'firstLastFrame') {
        const last = this.#lastFrameFor(shot, shots, i, refImages.extraFrames);
        items.push({
          ...base,
          imagePath: first.path,
          imageUrl: first.url,
          lastFramePath: last.path,
          lastFrameUrl: last.url,
          referenceId: first.path || first.url,
        });
        continue;
      }

      items.push({
        ...base,
        imagePath: first.path,
        imageUrl: first.url,
        referenceId: first.path || first.url,
      });
    }
    return items;
  }

  // 分镜给的是建议秒数；服务端还会按所选模型支持的档位再夹一次
  #clipDuration(sbShot) {
    const seconds = Math.round(Number(sbShot?.duration));
    return Number.isFinite(seconds) && seconds > 0 ? seconds : DEFAULT_CLIP_DURATION;
  }

  #matchCharacter(shot, characters) {
    const shotText = ((shot.prompt || '') + ' ' + (shot.description || '')).toLowerCase();
    for (const c of characters) {
      if (!c.imageUrl && !c.imagePath) continue;
      const names = [c.name, c.enName].filter(Boolean).map(n => String(n).toLowerCase());
      if (names.some(n => n.length > 1 && shotText.includes(n))) return c;
    }
    return null;
  }

  // 步骤4的帧图已按定妆图做过图生图，优先用它当首帧；帧图缺失时才退回角色正面图
  #firstFrameFor(shot, matchedChar) {
    if (shot.imagePath || shot.imageUrl) {
      return { path: shot.imagePath || '', url: shot.imageUrl || '' };
    }
    if (matchedChar?.imagePath || matchedChar?.imageUrl) {
      return { path: matchedChar.imagePath || '', url: matchedChar.imageUrl || '' };
    }
    return null;
  }

  // 设置可能在步骤4之后被改过：步骤4没记尾帧时按"复用下一镜首帧"现算，末镜退回独立收尾帧
  #lastFrameFor(shot, shots, index, extraFrames) {
    if (shot.lastFramePath || shot.lastFrameUrl) {
      return { path: shot.lastFramePath || '', url: shot.lastFrameUrl || '' };
    }
    const next = shots[index + 1];
    if (next?.imagePath || next?.imageUrl) {
      return { path: next.imagePath || '', url: next.imageUrl || '' };
    }
    const closing = (extraFrames || []).find(f => f.shot_id === shot.shot_id && f.role === 'last_frame');
    return { path: closing?.imagePath || '', url: closing?.imageUrl || '' };
  }

  #referenceListFor(shot, matchedChar) {
    const candidates = [shot.imagePath, ...(shot.refs || []), matchedChar?.imagePath];
    const refs = candidates.filter(r => typeof r === 'string' && r.startsWith('/api/media/'));
    return [...new Set(refs)].slice(0, MAX_REFERENCE_IMAGES);
  }

  #buildVideoPrompt(shot, storyboardShot) {
    const base = shot.prompt || `Scene of ${shot.shot_id}`;
    const camera = storyboardShot?.camera || '';
    const motion = CAMERA_MOTION_MAP[camera] || 'subtle natural motion';
    return `${base}, ${motion}`;
  }

  async #generateItems(items, artifact, ctx, token) {
    const provider = getActiveProvider('video');
    if (!provider) {
      return items.map(item => ({ id: item.id, status: 'failed', error: 'No provider' }));
    }

    const results = new Map();
    const pending = [...items];

    for (const item of items) {
      recordItemAttempt(artifact, item.id, {
        seed: item.seed,
        prompt: item.prompt,
        referenceId: item.referenceId,
        status: 'pending',
      });
    }

    addAgentMessage('🎥', t('ui.videoGenGenerating', { current: 1, total: items.length }));

    for (let attempt = 0; attempt < MAX_ITEM_ATTEMPTS && pending.length > 0; attempt++) {
      const batch = pending.map(item => ({
        id: item.id,
        prompt: item.prompt,
        duration: item.duration,
        seed: item.seed,
        imagePath: item.imagePath,
        imageUrl: item.imageUrl,
        lastFramePath: item.lastFramePath,
        lastFrameUrl: item.lastFrameUrl,
        referenceImages: item.referenceImages,
      }));

      const providerResults = await provider.generate({ items: batch, overrides: {}, signal: token?.signal });

      const failedItems = [];
      for (const result of providerResults) {
        recordItemAttempt(artifact, result.id, {
          seed: batch.find(b => b.id === result.id)?.seed,
          prompt: batch.find(b => b.id === result.id)?.prompt,
          referenceId: batch.find(b => b.id === result.id)?.imageUrl,
          status: result.status,
          error: result.error,
        });

        if (result.status === 'complete') {
          results.set(result.id, result);
          const idx = pending.findIndex(p => p.id === result.id);
          if (idx >= 0) pending.splice(idx, 1);
        } else if (result.status !== 'skipped') {
          failedItems.push({ itemId: result.id, error: result.error });
        }
      }

      if (failedItems.length > 0 && attempt < MAX_ITEM_ATTEMPTS - 1) {
        const lineage = {};
        for (const item of items) {
          lineage[item.id] = artifact.itemLineage[item.id];
        }

        const availableReferences = this.#getAvailableReferences(ctx);
        const plans = this.#retryAgent.planItemRetry(failedItems, lineage, { availableReferences });

        for (const plan of plans) {
          if (plan.strategy === ItemRetryStrategy.GIVE_UP) continue;
          const item = pending.find(p => p.id === plan.itemId);
          if (!item) continue;

          if (plan.overrides.seed != null) item.seed = plan.overrides.seed;
          if (plan.overrides.promptOverrides?.[plan.itemId]) {
            item.prompt = plan.overrides.promptOverrides[plan.itemId];
          }
          if (plan.overrides.referenceOverrides?.[plan.itemId]) {
            item.imageUrl = plan.overrides.referenceOverrides[plan.itemId];
            item.imagePath = '';
            item.referenceId = plan.overrides.referenceOverrides[plan.itemId];
          }
        }
      }
    }

    for (const item of pending) {
      if (!results.has(item.id)) {
        results.set(item.id, { id: item.id, videoPath: '', status: 'failed', error: 'Max retries exceeded' });
      }
    }

    return [...results.values()];
  }

  async #generateItemsWithUploads(items, artifact, ctx, token) {
    const provider = getActiveProvider('video');
    if (!provider) {
      return items.map(item => ({ id: item.id, status: 'failed', error: 'No provider' }));
    }

    const results = new Map();
    const pending = [...items];

    for (const item of items) {
      recordItemAttempt(artifact, item.id, {
        seed: item.seed,
        prompt: item.prompt,
        referenceId: item.referenceId,
        status: 'pending',
      });
    }

    addAgentMessage('🎥', t('ui.videoGenGenerating', { current: 1, total: items.length }));

    for (let attempt = 0; attempt < MAX_ITEM_ATTEMPTS && pending.length > 0; attempt++) {
      const batch = pending.map(item => ({
        id: item.id,
        prompt: item.prompt,
        imageUrl: item.imageUrl,
        seed: item.seed,
      }));

      const providerResults = await provider.generate({
        items: batch,
        uploads: ctx.uploads,
        overrides: {},
        signal: token?.signal,
      });

      for (const result of providerResults) {
        const src = batch.find(b => b.id === result.id);
        recordItemAttempt(artifact, result.id, {
          seed: src?.seed,
          prompt: src?.prompt,
          referenceId: src?.imageUrl,
          status: result.status,
          error: result.error,
        });

        if (result.status === 'complete') {
          results.set(result.id, result);
          const idx = pending.findIndex(p => p.id === result.id);
          if (idx >= 0) pending.splice(idx, 1);
        } else if (result.status !== 'skipped' && attempt < MAX_ITEM_ATTEMPTS - 1) {
          const item = pending.find(p => p.id === result.id);
          if (item) item.seed = (item.seed ?? 42) + 13 * (attempt + 1) + 1;
        }
      }
    }

    for (const item of pending) {
      if (!results.has(item.id)) {
        results.set(item.id, { id: item.id, videoPath: '', status: 'failed', error: 'Max retries exceeded' });
      }
    }

    return [...results.values()];
  }

  #getAvailableReferences(ctx) {
    const refs = [];
    const charDesign = ctx.characterDesign;
    if (charDesign?.characters) {
      for (const c of charDesign.characters) {
        if (c.imageUrl) refs.push({ id: c.imageUrl, type: 'character', name: c.name });
      }
    }
    const refImages = ctx.referenceImages;
    if (refImages?.shots) {
      for (const s of refImages.shots) {
        if (s.imageUrl) refs.push({ id: s.imageUrl, type: 'shot', name: s.shot_id });
      }
    }
    return refs;
  }

  #assembleResult(results, refImages, mode) {
    const clips = refImages.shots.map(shot => {
      const result = results.find(r => r.id === shot.shot_id);
      if (result) {
        return {
          shot_id: shot.shot_id,
          videoPath: result.videoPath || '',
          status: result.status === 'complete' ? 'complete' : 'failed',
        };
      }
      if (!shot.imagePath || !shot.imageUrl) {
        return { shot_id: shot.shot_id, videoPath: '', status: 'skipped' };
      }
      return { shot_id: shot.shot_id, videoPath: '', status: 'failed' };
    });

    return { mode, clips };
  }

  #emptyResult(ctx) {
    const mode = this.#videoMode();
    const clips = (ctx.referenceImages?.shots || []).map(sh => ({
      shot_id: sh.shot_id,
      videoPath: '',
      status: 'pending',
    }));
    return {
      artifacts: [createArtifact({
        kind: ArtifactKind.VIDEO_CLIP,
        stepId: 'videoGeneration',
        data: { mode, clips },
        status: ArtifactStatus.FAILED,
      })],
      metadata: { videoMode: mode, totalClips: clips.length, completeClips: 0, qualityScore: 0 },
    };
  }
}
