import { BaseAgent } from './baseAgent.js';
import { RetryAgent, ItemRetryStrategy } from './retryAgent.js';
import { checkConsistency } from '../providers/consistency.js';
import { getActiveProvider } from '../providers/registry.js';
import { createArtifact, ArtifactKind, ArtifactStatus, recordItemAttempt } from '../artifacts/artifactTypes.js';
import { QCVerdict, Severity } from './qcTypes.js';
import { addAgentMessage } from '../ui/render.js';
import { t } from '../i18n.js';

const MAX_ITEM_ATTEMPTS = 3;

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

  constructor() {
    super({ name: 'Video Director', stepId: 'videoGeneration' });
    this.#retryAgent = new RetryAgent();
  }

  async run(ctx, _token) {
    const hasUploads = ctx.uploads && (ctx.uploads.firstFrame || ctx.uploads.lastFrame || ctx.uploads.referenceImages?.length > 0);

    if (hasUploads) {
      return this.#runWithUploads(ctx, _token);
    }

    const refImages = ctx.referenceImages;
    if (!refImages?.shots?.length) return this.#emptyResult(ctx);

    const items = this.#buildItems(refImages, ctx);
    if (!items.length) return this.#emptyResult(ctx);

    const artifact = createArtifact({
      kind: ArtifactKind.VIDEO_CLIP,
      stepId: 'videoGeneration',
      data: { clips: [] },
      status: ArtifactStatus.GENERATING,
    });

    const results = await this.#generateItems(items, artifact, ctx, _token);
    const data = this.#assembleResult(results, refImages);

    const l2Check = checkConsistency('videoGeneration', data, ctx.entities || {});
    const complete = data.clips.filter(c => c.status === 'complete').length;

    artifact.data = data;
    artifact.status = complete > 0 ? ArtifactStatus.COMPLETE : ArtifactStatus.FAILED;

    return {
      artifacts: [artifact],
      metadata: {
        totalClips: data.clips.length,
        completeClips: complete,
        failedClips: data.clips.filter(c => c.status === 'failed').length,
        qualityScore: l2Check.verdict === QCVerdict.PASS ? 10 : l2Check.verdict === QCVerdict.CONDITIONAL_PASS ? 7 : 5,
        consistencyIssues: l2Check.issues || [],
      },
    };
  }

  async #runWithUploads(ctx, _token) {
    const uploads = ctx.uploads;
    const storyboard = ctx.storyboard;
    const script = ctx.script;

    const allStoryboardShots = [];
    if (storyboard?.episodes) {
      for (const ep of storyboard.episodes) {
        for (const seg of (ep.segments || [])) {
          for (const shot of (seg.shots || [])) allStoryboardShots.push(shot);
        }
      }
    }

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

    const results = await this.#generateItemsWithUploads(items, artifact, ctx, _token);
    const resultById = new Map(results.map(r => [r.id, r]));
    const data = { clips: items.map(item => {
      const r = resultById.get(item.id);
      return {
        shot_id: item.id,
        videoPath: r?.videoPath || '',
        status: r?.status === 'complete' ? 'complete' : 'failed',
      };
    }) };

    const complete = data.clips.filter(c => c.status === 'complete').length;
    artifact.data = data;
    artifact.status = complete > 0 ? ArtifactStatus.COMPLETE : ArtifactStatus.FAILED;

    return {
      artifacts: [artifact],
      metadata: {
        totalClips: data.clips.length,
        completeClips: complete,
        failedClips: data.clips.filter(c => c.status === 'failed').length,
        qualityScore: complete > 0 ? 8 : 5,
        consistencyIssues: [],
      },
    };
  }

  #buildItems(refImages, ctx) {
    const characters = ctx.characterDesign?.characters || [];
    const storyboard = ctx.storyboard;
    const allStoryboardShots = [];
    if (storyboard?.episodes) {
      for (const ep of storyboard.episodes) {
        for (const seg of (ep.segments || [])) {
          for (const shot of (seg.shots || [])) allStoryboardShots.push(shot);
        }
      }
    }

    const items = [];
    for (let i = 0; i < refImages.shots.length; i++) {
      const shot = refImages.shots[i];
      if (!shot.imagePath || !shot.imageUrl) continue;

      const shotText = ((shot.prompt || '') + ' ' + (shot.description || '')).toLowerCase();
      let matchedChar = null;
      for (const c of characters) {
        if (!c.imageUrl) continue;
        const names = [c.name, c.enName].filter(Boolean).map(n => n.toLowerCase());
        if (names.some(n => n && shotText.includes(n))) {
          matchedChar = c;
          break;
        }
      }

      const imageUrl = matchedChar?.imageUrl || shot.imageUrl;
      const sbShot = allStoryboardShots[i];
      const videoPrompt = this.#buildVideoPrompt(shot, sbShot);

      items.push({
        id: shot.shot_id,
        prompt: videoPrompt,
        imageUrl,
        seed: 42,
        referenceId: imageUrl,
      });
    }
    return items;
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
        imageUrl: item.imageUrl,
        seed: item.seed,
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

  #assembleResult(results, refImages) {
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

    return { clips };
  }

  #emptyResult(ctx) {
    const clips = (ctx.referenceImages?.shots || []).map(sh => ({
      shot_id: sh.shot_id,
      videoPath: '',
      status: 'pending',
    }));
    return {
      artifacts: [createArtifact({
        kind: ArtifactKind.VIDEO_CLIP,
        stepId: 'videoGeneration',
        data: { clips },
        status: ArtifactStatus.FAILED,
      })],
      metadata: { totalClips: clips.length, completeClips: 0, qualityScore: 0 },
    };
  }
}
