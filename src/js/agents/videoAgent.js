import { PromptAgent } from './promptAgent.js';
import { BaseAgent } from './baseAgent.js';
import { RetryAgent, ItemRetryStrategy } from './retryAgent.js';
import { QCAgent, reportScore } from './qcAgent.js';
import { getActiveProvider } from '../providers/registry.js';
import { getConfig } from '../providers/llm.js';
import { getConfig as getImageConfig } from '../providers/image.js';
import { createArtifact, ArtifactKind, ArtifactStatus, recordItemAttempt } from '../artifacts/artifactTypes.js';
import { addAgentMessage } from '../ui/render.js';
import { t } from '../i18n.js';
import { reportPhase } from '../progressTracker.js';
import { buildVideoModeCandidates, isVideoModelUnavailableError } from '../videoModePlanning.js';
import { escapeHtml } from '../utils.js';
import { checkVisualMediaBatch } from '../compliance/visualCompliance.js';
import { QCVerdict } from './qcTypes.js';

const MAX_ITEM_ATTEMPTS = 3;
const BASE_SEED = 42;
// 参考生视频模型最多接受 5 张参考图
const MAX_REFERENCE_IMAGES = 5;

export class VideoAgent extends BaseAgent {
  #retryAgent;
  #qcAgent;

  #promptAgent;

  constructor({ promptAgent = new PromptAgent() } = {}) {
    super({ name: 'Video Director', stepId: 'videoGeneration' });
    this.#promptAgent = promptAgent;
    this.#retryAgent = new RetryAgent();
    this.#qcAgent = new QCAgent({ stepId: 'videoGeneration' });
  }

  async run(ctx, _token) {
    ctx = { ...ctx, triggeredBy: 'VideoAgent', signal: _token?.signal };
    if (!this.#storyboardShots(ctx).length && ctx.uploads) {
      ctx.storyboard = { episodes: [{ segments: [{ shots: Array.from({ length: Math.max(1, Math.ceil((ctx.totalDuration || 30) / 5)) }, (_, i) => ({ shot_id: 'upload_clip_' + i, duration: 5, description: ctx.userInput || 'Uploaded scene' })) }] }] };
    }
    // A stale package must never be reused, but it must not abort the step either: the
    // video stage cannot author prompts, so it rebuilds them deterministically and says so.
    const candidates = [ctx.promptPackage, ctx.referenceImages?.promptPackage].filter(Boolean);
    const reusable = candidates.find(candidate => this.#promptAgent.compatible(candidate, ctx));
    ctx.promptPackage = reusable ? structuredClone(reusable) : this.#promptAgent.migrateLegacy(ctx);
    addAgentMessage('✍️', escapeHtml(t(reusable || !candidates.length
      ? 'promptAgent.usingPackage' : 'promptAgent.videoPackageRebuilt', { version: ctx.promptPackage.version })), { key: 'prompt-status' });
    const hasUploads = ctx.uploads && (ctx.uploads.firstFrame || ctx.uploads.lastFrame || ctx.uploads.referenceImages?.length > 0);

    if (hasUploads) {
      return this.#runWithUploads(ctx, _token);
    }

    const refImages = ctx.referenceImages || { shots: ctx.promptPackage.data.shots.map(s => ({ shot_id: s.shotId, videoMode: s.mode })) };
    if (!refImages?.shots?.length) return this.#emptyResult(ctx);

    const mode = this.#videoMode();
    const items = this.#buildItems(refImages, ctx, mode);
    if (!items.length) return this.#emptyResult(ctx);

    const sourceArtifactIds = [
      ctx.sourceArtifactIds?.script,
      ctx.sourceArtifactIds?.storyboard,
      ctx.sourceArtifactIds?.referenceImages,
      ctx.sourceArtifactIds?.characterDesign,
    ].filter(Boolean);

    const artifact = createArtifact({
      kind: ArtifactKind.VIDEO_CLIP,
      stepId: 'videoGeneration',
      data: { mode, clips: [] },
      status: ArtifactStatus.GENERATING,
      sourceArtifactIds,
    });

    // The creative score on generated footage is advisory: it is reported so the
    // user can judge the take, but it never re-rolls the batch (that doubled the
    // cost of this step) and it never blocks delivery. Only IP compliance can.
    reportPhase('generatingVideos');
    const results = await this.#generateItems(items, artifact, ctx, _token);
    const finalData = this.#assembleResult(results, refImages, mode);
    finalData.promptPackage = structuredClone(ctx.promptPackage);

    reportPhase('validating');
    const crit = await this.#qcAgent.process({ data: finalData, entities: ctx.entities || {}, ...ctx });
    reportScore(crit.score, '🎥');

    const complete = finalData.clips.filter(c => c.status === 'complete').length;
    const fallbackClips = finalData.clips.filter(c => c.plannedVideoMode && c.plannedVideoMode !== c.videoMode).length;

    finalData.visualCompliance = await checkVisualMediaBatch(finalData.clips
      .filter(clip => clip.status === 'complete' && clip.videoPath)
      .map(clip => ({ id: clip.shot_id, mediaRef: clip.videoPath, type: 'video' })),
    { stage: 'videoGeneration', type: 'video', signal: _token?.signal });
    const visualBlocked = finalData.visualCompliance.verdict === QCVerdict.FAIL;

    artifact.data = { ...finalData, promptPackage: finalData.promptPackage || ctx.promptPackage };
    artifact.status = complete > 0 && !visualBlocked ? ArtifactStatus.COMPLETE : ArtifactStatus.FAILED;

    return {
      artifacts: [artifact],
      metadata: {
        videoMode: mode,
        totalClips: finalData.clips.length,
        completeClips: complete,
        failedClips: finalData.clips.filter(c => c.status === 'failed').length,
        fallbackClips,
        fallbackUsed: fallbackClips > 0,
        qualityScore: crit?.score ?? null,
        consistencyIssues: crit?.consistency?.issues || [],
        verdict: visualBlocked ? QCVerdict.FAIL : null,
        visualCompliance: finalData.visualCompliance,
        feedbackSatisfied: crit?.feedbackSatisfied ?? !ctx.feedback,
      },
    };
  }

  async #runWithUploads(ctx, _token) {
    const uploads = ctx.uploads;
    const allStoryboardShots = this.#storyboardShots(ctx);

    const shotCount = Math.max(1, allStoryboardShots.length || Math.ceil((ctx.totalDuration || 30) / 5));
    const items = [];

    for (let i = 0; i < shotCount; i++) {
      const spec = ctx.promptPackage.data.shots[i];
      if (!spec) continue;
      const adapted = this.#promptAgent.adaptForProvider({ promptPackage: ctx.promptPackage, shotId: spec.shotId, provider: getActiveProvider('video')?.id, executedMode: uploads.referenceImages?.length ? 'referenceImage' : uploads.lastFrame ? 'firstLastFrame' : 'firstFrame' });
      items.push({
        ...adapted,
        shotId: spec.shotId,
        id: `upload_clip_${i}`,
        prompt: adapted.prompt,
        imageUrl: uploads.firstFrame?.serverPath || uploads.referenceImages?.[0]?.serverPath || '',
        seed: BASE_SEED + (ctx.seedSalt || 0),
        referenceId: 'uploads',
      });
    }

    const sourceArtifactIds = [
      ctx.sourceArtifactIds?.script,
      ctx.sourceArtifactIds?.storyboard,
      ctx.sourceArtifactIds?.referenceImages,
      ctx.sourceArtifactIds?.characterDesign,
    ].filter(Boolean);

    const artifact = createArtifact({
      kind: ArtifactKind.VIDEO_CLIP,
      stepId: 'videoGeneration',
      data: { clips: [] },
      status: ArtifactStatus.GENERATING,
      sourceArtifactIds,
    });

    const assemble = (results) => {
      const resultById = new Map(results.map(r => [r.id, r]));
      return { clips: items.map(item => {
        const r = resultById.get(item.id);
        return {
          shot_id: item.id,
          promptShotId: item.shotId, plannedMode: item.plannedMode, executedMode: item.videoMode, fallbackReason: item.fallbackReason,
          videoPath: r?.videoPath || '',
          status: r?.status === 'complete' ? 'complete' : 'failed',
        };
      }) };
    };

    reportPhase('generatingVideos');
    const results = await this.#generateItemsWithUploads(items, artifact, ctx, _token);
    const finalData = assemble(results);
    finalData.promptPackage = structuredClone(ctx.promptPackage);

    reportPhase('validating');
    const crit = await this.#qcAgent.process({ data: finalData, entities: ctx.entities || {}, ...ctx });
    reportScore(crit.score, '🎥');

    const complete = finalData.clips.filter(c => c.status === 'complete').length;

    finalData.visualCompliance = await checkVisualMediaBatch(finalData.clips
      .filter(clip => clip.status === 'complete' && clip.videoPath)
      .map(clip => ({ id: clip.shot_id, mediaRef: clip.videoPath, type: 'video' })),
    { stage: 'videoGeneration', type: 'video', signal: _token?.signal });
    const visualBlocked = finalData.visualCompliance.verdict === QCVerdict.FAIL;

    artifact.data = { ...finalData, promptPackage: finalData.promptPackage || ctx.promptPackage };
    artifact.status = complete > 0 && !visualBlocked ? ArtifactStatus.COMPLETE : ArtifactStatus.FAILED;

    return {
      artifacts: [artifact],
      metadata: {
        totalClips: finalData.clips.length,
        completeClips: complete,
        failedClips: finalData.clips.filter(c => c.status === 'failed').length,
        qualityScore: crit?.score ?? null,
        consistencyIssues: crit?.consistency?.issues || [],
        verdict: visualBlocked ? QCVerdict.FAIL : null,
        visualCompliance: finalData.visualCompliance,
        feedbackSatisfied: crit?.feedbackSatisfied ?? !ctx.feedback,
      },
    };
  }

  #videoMode() {
    const mode = getConfig().videoMode;
    if (mode === 'auto') return 'auto';
    return mode === 'firstLastFrame' || mode === 'referenceImage' ? mode : 'firstFrame';
  }

  #dashScopeConfig() {
    try { return getImageConfig(); } catch { return {}; }
  }

  #modeHasModel(mode) {
    if (getActiveProvider('video')?.id === 'video-comfy') return true;
    const cfg = this.#dashScopeConfig();
    if ((!cfg?.apiKey && !cfg?.arkApiKey) || mode === 'textToVideo') return false;
    if (mode === 'referenceImage') return Boolean(cfg.refVideoModel);
    if (mode === 'firstLastFrame') return Boolean(cfg.lastFrameVideoModel);
    return Boolean(cfg.videoModel);
  }

  #setNextMode(item, ctx) {
    if (!Array.isArray(item.modeCandidates)) return false;
    const nextIndex = (item.modeIndex || 0) + 1;
    if (nextIndex >= item.modeCandidates.length) return false;
    const previousMode = item.videoMode;
    item.modeIndex = nextIndex;
    item.videoMode = item.modeCandidates[nextIndex];
    item.referenceId = item.videoMode === 'referenceImage'
      ? item.referenceImages?.[0] || null
      : item.imagePath || item.imageUrl || null;
    this.#reportModeFallback(item.id, previousMode, item.videoMode);
    this.#adaptItem(item, ctx);
    return true;
  }

  #reportModeFallback(shotId, from, to) {
    addAgentMessage('↪️', t('ui.videoModeFallback', {
      shot: escapeHtml(String(shotId)),
      from: t(`settings.videoMode.${from}`),
      to: t(`settings.videoMode.${to}`),
    }), { key: `mode-fallback-${shotId}` });
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
    const shots = refImages.shots || [];
    const items = [];
    const allowsTextFallback = getActiveProvider('video')?.id === 'video-comfy';

    for (let i = 0; i < shots.length; i++) {
      const shot = shots[i];
      const spec = ctx.promptPackage.data.shots.find(s => s.shotId === shot.shot_id);
      if (!spec) continue;
      const preferredMode = spec.mode;
      const matchedChar = characters.find(c => spec.bindings.characterIds.includes(c.id));
      const first = this.#firstFrameFor(shot, matchedChar);
      const referenceImages = this.#referenceListFor(shot, matchedChar);
      const usableMedia = value => {
        if (!value) return '';
        if (!allowsTextFallback) return value;
        return typeof value === 'string' && value.startsWith('/api/media/') ? value : '';
      };
      const assets = {
        imagePath: usableMedia(first?.path),
        imageUrl: usableMedia(first?.url),
        lastFramePath: usableMedia(shot.lastFramePath),
        lastFrameUrl: usableMedia(shot.lastFrameUrl),
        referenceImages,
      };
      let modeCandidates = buildVideoModeCandidates(preferredMode, assets, { allowText: allowsTextFallback });
      if (mode !== 'auto' && !allowsTextFallback) modeCandidates = modeCandidates.filter(candidate => candidate === preferredMode);
      modeCandidates = modeCandidates.filter(candidate => this.#modeHasModel(candidate));
      if (!modeCandidates.length) continue;
      const shotMode = modeCandidates[0];
      if (shotMode !== preferredMode) this.#reportModeFallback(shot.shot_id, preferredMode, shotMode);
      const base = {
        id: shot.shot_id,
        ...this.#promptAgent.adaptForProvider({ promptPackage: ctx.promptPackage, shotId: spec.shotId, provider: getActiveProvider('video')?.id, executedMode: shotMode }),
        duration: spec.duration,
        seed: BASE_SEED + (ctx.seedSalt || 0),
        plannedVideoMode: preferredMode,
        videoMode: shotMode,
        videoModeReason: shot.videoModeReason || '',
        modeCandidates,
        modeIndex: 0,
        ...assets,
      };
      items.push({ ...base, referenceId: shotMode === 'referenceImage' ? referenceImages[0] : (first?.path || first?.url || null) });
    }
    return items;
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

  #referenceListFor(shot, matchedChar) {
    const candidates = [
      shot.imagePath, shot.imageUrl, ...(shot.refs || []),
      matchedChar?.imagePath, matchedChar?.imageUrl,
    ];
    const localOnly = getActiveProvider('video')?.id === 'video-comfy';
    const refs = candidates.filter(r => typeof r === 'string'
      && (r.startsWith('/api/media/') || (!localOnly && /^https?:\/\//i.test(r))));
    return [...new Set(refs)].slice(0, MAX_REFERENCE_IMAGES);
  }

  #adaptItem(item, ctx) {
    Object.assign(item, this.#promptAgent.adaptForProvider({ promptPackage: ctx.promptPackage,
      shotId: item.shotId || item.id, provider: getActiveProvider('video')?.id, executedMode: item.videoMode }));
  }

  async #generateItems(items, artifact, ctx, token) {
    const provider = getActiveProvider('video');
    if (!provider) {
      return items.map(item => ({ id: item.id, status: 'failed', error: 'No provider' }));
    }

    const results = new Map();
    const pending = [...items];

    const maxAttempts = Math.max(MAX_ITEM_ATTEMPTS, ...items.map(item => item.modeCandidates?.length || 1));
    for (let attempt = 0; attempt < maxAttempts && pending.length > 0; attempt++) {
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
        videoMode: item.videoMode,
      }));

      const providerResults = await provider.generate({ items: batch, overrides: {}, signal: token?.signal });

      const failedItems = [];
      for (const result of providerResults) {
        recordItemAttempt(artifact, result.id, {
          ...(result.trace || {}),
          promptPackageId: ctx.promptPackage.id, promptPackageVersion: ctx.promptPackage.version,
          plannedMode: ctx.promptPackage.data.shots.find(s => s.shotId === (pending.find(i => i.id === result.id)?.shotId || result.id))?.mode,
          executedMode: pending.find(i => i.id === result.id)?.videoMode || pending.find(i => i.id === result.id)?.shotMode,
          fallbackReason: pending.find(i => i.id === result.id)?.fallbackReason,
          seed: batch.find(b => b.id === result.id)?.seed,
          prompt: batch.find(b => b.id === result.id)?.prompt,
          videoMode: batch.find(b => b.id === result.id)?.videoMode,
          referenceId: pending.find(b => b.id === result.id)?.referenceId
            || batch.find(b => b.id === result.id)?.imageUrl,
          status: result.status,
          error: result.error,
        });

        if (result.status === 'complete') {
          const idx = pending.findIndex(p => p.id === result.id);
          const item = idx >= 0 ? pending[idx] : null;
          results.set(result.id, {
            ...result,
            plannedMode: item?.plannedMode, executedMode: item?.videoMode, fallbackReason: item?.fallbackReason,
            plannedVideoMode: item?.plannedVideoMode,
            videoMode: item?.videoMode,
          });
          if (idx >= 0) pending.splice(idx, 1);
        } else {
          const item = pending.find(p => p.id === result.id);
          const canChangeMode = getConfig().videoMode === 'auto' || provider.id === 'video-comfy';
          const shouldChangeMode = result.status === 'skipped' || isVideoModelUnavailableError(result.error);
          if (!(canChangeMode && shouldChangeMode && item && this.#setNextMode(item, ctx)) && result.status !== 'skipped') {
            failedItems.push({ itemId: result.id, error: result.error });
          }
        }
      }

      if (failedItems.length > 0 && attempt < maxAttempts - 1) {
        const lineage = {};
        for (const item of items) {
          lineage[item.id] = artifact.itemLineage[item.id];
        }

        const availableReferences = this.#getAvailableReferences(ctx);
        const plans = this.#retryAgent.planItemRetry(failedItems, lineage, {
          availableReferences,
          feedback: ctx.feedback,
        });

        for (const plan of plans) {
          if (plan.strategy === ItemRetryStrategy.GIVE_UP) continue;
          const item = pending.find(p => p.id === plan.itemId);
          if (!item) continue;

          if (plan.overrides.seed != null) item.seed = plan.overrides.seed;
          if (plan.strategy === ItemRetryStrategy.REWRITE_PROMPT) {
            try { ctx.promptPackage = await this.#promptAgent.reviseShotPrompt({ ...ctx, shotId: item.id, reason: failedItems.find(f => f.itemId === item.id)?.error }); }
            catch (error) { if (!error.promptPackage) throw error; }
            this.#adaptItem(item, ctx);
          }
          if (plan.overrides.referenceOverrides?.[plan.itemId]) {
            item.imageUrl = plan.overrides.referenceOverrides[plan.itemId];
            item.imagePath = '';
            item.referenceImages = [plan.overrides.referenceOverrides[plan.itemId]];
            item.referenceId = plan.overrides.referenceOverrides[plan.itemId];
          }
        }
      }
    }

    for (const item of pending) {
      if (!results.has(item.id)) {
        results.set(item.id, {
          id: item.id,
          videoPath: '',
          status: 'failed',
          error: 'Max retries exceeded',
          plannedMode: item.plannedMode, executedMode: item.videoMode, fallbackReason: item.fallbackReason,
          plannedVideoMode: item.plannedVideoMode,
          videoMode: item.videoMode,
        });
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

    for (let attempt = 0; attempt < MAX_ITEM_ATTEMPTS && pending.length > 0; attempt++) {
      const batch = pending.map(item => ({
        id: item.id,
        prompt: item.prompt,
        duration: item.duration,
        videoMode: item.videoMode,
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
          ...(result.trace || {}),
          promptPackageId: ctx.promptPackage.id, promptPackageVersion: ctx.promptPackage.version,
          plannedMode: ctx.promptPackage.data.shots.find(s => s.shotId === (pending.find(i => i.id === result.id)?.shotId || result.id))?.mode,
          executedMode: pending.find(i => i.id === result.id)?.videoMode || pending.find(i => i.id === result.id)?.shotMode,
          fallbackReason: pending.find(i => i.id === result.id)?.fallbackReason,
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
          if (item) {
            const [plan] = this.#retryAgent.planItemRetry([{ itemId: item.id, error: result.error }], artifact.itemLineage, { feedback: ctx.feedback });
            if (plan.strategy === ItemRetryStrategy.REWRITE_PROMPT) {
              try { ctx.promptPackage = await this.#promptAgent.reviseShotPrompt({ ...ctx, shotId: item.shotId, reason: result.error }); }
              catch (error) { if (!error.promptPackage) throw error; }
              this.#adaptItem(item, ctx);
            }
            if (plan.overrides.seed != null) item.seed = plan.overrides.seed;
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
          plannedMode: result.plannedMode, executedMode: result.executedMode, fallbackReason: result.fallbackReason,
          plannedVideoMode: result.plannedVideoMode || shot.videoMode || 'firstFrame',
          videoMode: result.videoMode || shot.videoMode || 'firstFrame',
          videoModeReason: shot.videoModeReason || '',
          videoPath: result.videoPath || '',
          status: result.status === 'complete' ? 'complete' : result.status === 'skipped' ? 'skipped' : 'failed',
        };
      }
      if (!shot.imagePath && !shot.imageUrl) {
        return { shot_id: shot.shot_id, plannedMode: shot.videoMode || 'firstFrame', executedMode: null, fallbackReason: 'No usable input media or configured model', plannedVideoMode: shot.videoMode || 'firstFrame', videoMode: shot.videoMode || 'firstFrame', videoPath: '', status: 'skipped' };
      }
      return { shot_id: shot.shot_id, plannedVideoMode: shot.videoMode || 'firstFrame', videoMode: shot.videoMode || 'firstFrame', videoPath: '', status: 'failed' };
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
    const sourceArtifactIds = [
      ctx.sourceArtifactIds?.script,
      ctx.sourceArtifactIds?.storyboard,
      ctx.sourceArtifactIds?.referenceImages,
      ctx.sourceArtifactIds?.characterDesign,
    ].filter(Boolean);
    return {
      artifacts: [createArtifact({
        kind: ArtifactKind.VIDEO_CLIP,
        stepId: 'videoGeneration',
        data: { mode, clips, promptPackage: ctx.promptPackage },
        status: ArtifactStatus.FAILED,
        sourceArtifactIds,
      })],
      metadata: { videoMode: mode, totalClips: clips.length, completeClips: 0, qualityScore: 0 },
    };
  }
}
