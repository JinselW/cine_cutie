import { PromptAgent } from './promptAgent.js';
import { BaseAgent } from './baseAgent.js';
import { RetryAgent, ItemRetryStrategy } from './retryAgent.js';
import { QCAgent, SCORE_THRESHOLD, reportScore, reportRetry } from './qcAgent.js';
import { getActiveProvider } from '../providers/registry.js';
import { getConfig } from '../providers/llm.js';
import { createArtifact, ArtifactKind, ArtifactStatus, recordItemAttempt } from '../artifacts/artifactTypes.js';
import { addAgentMessage } from '../ui/render.js';
import { t } from '../i18n.js';
import { reportPhase } from '../progressTracker.js';
import { checkVisualMediaBatch } from '../compliance/visualCompliance.js';
import { QCVerdict } from './qcTypes.js';

const MAX_ITEM_ATTEMPTS = 3;
const MAX_STAGE_RETRIES = 1;
const MAX_REFS = 4;
const LAST_FRAME_SUFFIX = '__last_frame';

export const FrameRole = Object.freeze({
  FIRST: 'first_frame',
  LAST: 'last_frame',
  REFERENCE: 'reference_image',
});

export class ReferenceAgent extends BaseAgent {
  #retryAgent;
  #qcAgent;

  #promptAgent;

  constructor({ promptAgent = new PromptAgent() } = {}) {
    super({ name: 'Image Director', stepId: 'referenceImages' });
    this.#promptAgent = promptAgent;
    this.#retryAgent = new RetryAgent();
    this.#qcAgent = new QCAgent({ stepId: 'referenceImages' });
  }

  async run(ctx, _token) {
    const mode = this.#videoMode();
    const pairs = this.#extractShots(ctx);
    if (!pairs.length) return this.#emptyResult(ctx, mode);

    ctx = { ...ctx, triggeredBy: 'ReferenceAgent', signal: _token?.signal };
    try {
      ctx.promptPackage = await this.#promptAgent.prepareShotPrompts(ctx);
    } catch (error) {
      if (!error.promptPackage) throw error;
      return { artifacts: [createArtifact({ kind: ArtifactKind.REFERENCE_IMAGE, stepId: 'referenceImages',
        status: ArtifactStatus.FAILED, sourceArtifactIds: error.promptPackage.sourceArtifactIds,
        data: { mode, shots: [], extraFrames: [], promptPackage: error.promptPackage } })],
        metadata: { qualityScore: error.promptPackage.provenance.qc?.score ?? 0, verdict: 'FAIL' } };
    }
    addAgentMessage('✍️', t('promptAgent.imageUsingPackage', { version: ctx.promptPackage.version }));
    const shotModes = ctx.promptPackage.data.shots.map(s => ({ mode: s.mode, reason: s.modeReason }));
    const items = this.#buildItems(pairs, ctx);
    const sourceArtifactIds = [
      ctx.sourceArtifactIds?.script,
      ctx.sourceArtifactIds?.storyboard,
      ctx.sourceArtifactIds?.characterDesign,
    ].filter(Boolean);
    const artifact = createArtifact({
      kind: ArtifactKind.REFERENCE_IMAGE,
      stepId: 'referenceImages',
      data: { mode, shots: [], extraFrames: [] },
      status: ArtifactStatus.GENERATING,
      sourceArtifactIds,
    });

    let bestData = null, bestCrit = null, bestScore = -Infinity;

    for (let attempt = 0; attempt <= MAX_STAGE_RETRIES; attempt++) {
      if (_token?.signal?.aborted) break;

      reportPhase(attempt ? 'retrying' : 'generatingImages', { attempt: attempt + 1 });
      const results = await this.#generateItems(items, artifact, ctx, _token);
      const data = this.#assembleResult(results, pairs, mode, items, shotModes);

      data.promptPackage = structuredClone(ctx.promptPackage);
      reportPhase('validating');
      const crit = await this.#qcAgent.process({ data, entities: ctx.entities || {}, ...ctx });
      reportScore(crit.score, '🖼️');
      if (crit.score > bestScore) { bestScore = crit.score; bestData = data; bestCrit = crit; }

      if (crit.score >= SCORE_THRESHOLD || attempt === MAX_STAGE_RETRIES) break;
      if (crit.source === 'structural') break;

      reportRetry(crit.score, attempt + 1, MAX_STAGE_RETRIES, '🖼️');
      for (const item of items) item.seed += 7;
    }

    const finalData = bestData || { mode, shots: [], extraFrames: [] };
    const complete = finalData.shots.filter(s => s.status === 'complete' || s.imagePath).length;

    const visualItems = [...(finalData.shots || []), ...(finalData.extraFrames || [])]
      .map(item => ({ id: item.shot_id || item.id, mediaRef: item.imagePath || item.imageUrl }))
      .filter(item => item.mediaRef);
    finalData.visualCompliance = await checkVisualMediaBatch(visualItems, { stage: 'referenceImages', type: 'image', signal: _token?.signal });
    const visualBlocked = finalData.visualCompliance.verdict === QCVerdict.FAIL;

    artifact.data = { ...finalData, promptPackage: finalData.promptPackage || ctx.promptPackage };
    const comfyTextFallback = complete === 0 && getActiveProvider('video')?.id === 'video-comfy';
    artifact.status = (complete > 0 || comfyTextFallback) && !visualBlocked ? ArtifactStatus.COMPLETE : ArtifactStatus.FAILED;

    return {
      artifacts: [artifact],
      metadata: {
        videoMode: mode,
        totalShots: finalData.shots.length,
        completeShots: complete,
        totalFrames: items.length,
        qualityScore: bestCrit?.score ?? 0,
        consistencyIssues: bestCrit?.consistency?.issues || [],
        verdict: visualBlocked ? QCVerdict.FAIL : bestCrit?.verdict ?? null,
        visualCompliance: finalData.visualCompliance,
        feedbackSatisfied: bestCrit?.feedbackSatisfied ?? !ctx.feedback,
        comfyTextFallback,
      },
    };
  }

  #videoMode() {
    const mode = getConfig().videoMode;
    if (mode === 'auto') return 'auto';
    return mode === 'firstLastFrame' || mode === 'referenceImage' ? mode : 'firstFrame';
  }

  #extractShots(ctx) {
    const storyboard = ctx.storyboard;
    if (!storyboard) return [];

    const scriptEpisodes = ctx.script?.episodes || [];
    const pairs = [];

    (storyboard.episodes || []).forEach((ep, epIndex) => {
      const scriptEp = scriptEpisodes.find(e => e.episode === ep.episode) || scriptEpisodes[epIndex];
      (ep.segments || []).forEach((seg, segIndex) => {
        const scriptSeg = scriptEp?.segments?.[segIndex];
        for (const shot of (seg.shots || [])) {
          pairs.push({
            shot,
            beat: {
              episodeTitle: scriptEp?.title || '',
              episodeSummary: scriptEp?.summary || '',
              segmentTitle: scriptSeg?.title || '',
              segmentDescription: scriptSeg?.description || '',
            },
          });
        }
      });
    });

    return pairs;
  }

  #buildItems(pairs, ctx) {
    const items = [];
    pairs.forEach((pair, index) => {
      const spec = ctx.promptPackage.data.shots.find(s => s.shotId === pair.shot.shot_id);
      const roles = spec.mode === 'firstLastFrame' ? [FrameRole.FIRST, FrameRole.LAST]
        : [spec.mode === 'referenceImage' ? FrameRole.REFERENCE : FrameRole.FIRST];
      for (const role of roles) {
        const item = { id: spec.shotId + (role === FrameRole.LAST ? LAST_FRAME_SUFFIX : ''), shotId: spec.shotId, role, index, shotMode: spec.mode, seed: 42 };
        this.#refreshItem(item, ctx);
        items.push(item);
      }
    });
    return items;
  }

  #refreshItem(item, ctx) {
    const spec = ctx.promptPackage.data.shots.find(s => s.shotId === item.shotId);
    const adapted = this.#promptAgent.adaptForProvider({ promptPackage: ctx.promptPackage, shotId: spec.shotId, provider: getActiveProvider('image')?.id, media: 'image', frameRole: item.role, triggeredBy: 'ReferenceAgent' });
    item.prompt = adapted.prompt;
    item.fallbackReason = adapted.fallbackReason;
    item.refs = spec.bindings.referenceAssetIds.map(id => {
      const entityId = id.replace(/\.(sheet|plate)$/, '');
      const entity = [...(ctx.characterDesign?.characters || []), ...(ctx.characterDesign?.settings || [])].find(e => e.id === entityId);
      return entity?.imagePath || entity?.sheetPath;
    }).filter(path => typeof path === 'string' && path.startsWith('/api/media/')).slice(0, MAX_REFS);
  }

  async #generateItems(items, artifact, ctx, token) {
    const provider = getActiveProvider('image');
    if (!provider) {
      return items.map(item => ({ id: item.id, status: 'failed', error: 'No provider' }));
    }

    const results = new Map();
    const pending = [...items];

    addAgentMessage('🖼️', t('ui.refImagesGenerating', { current: 1, total: items.length }), { key: 'activity-status' });

    for (let attempt = 0; attempt < MAX_ITEM_ATTEMPTS && pending.length > 0; attempt++) {
      const batch = pending.map(item => ({
        id: item.id,
        prompt: item.prompt,
        seed: item.seed,
        refs: item.refs,
      }));

      const providerResults = await provider.generate({ items: batch, overrides: {}, signal: token?.signal });

      const failedItems = [];
      for (const result of providerResults) {
        const source = batch.find(b => b.id === result.id);
        recordItemAttempt(artifact, result.id, {
          ...(result.trace || {}),
          promptPackageId: ctx.promptPackage.id, promptPackageVersion: ctx.promptPackage.version,
          plannedMode: ctx.promptPackage.data.shots.find(s => s.shotId === (pending.find(i => i.id === result.id)?.shotId || result.id))?.mode,
          executedMode: pending.find(i => i.id === result.id)?.videoMode || pending.find(i => i.id === result.id)?.shotMode,
          fallbackReason: pending.find(i => i.id === result.id)?.fallbackReason,
          seed: source?.seed,
          prompt: source?.prompt,
          referenceId: source?.refs?.[0] || null,
          status: result.status,
          error: result.error,
        });

        if (result.status === 'complete') {
          results.set(result.id, result);
          const idx = pending.findIndex(p => p.id === result.id);
          if (idx >= 0) pending.splice(idx, 1);
        } else {
          failedItems.push({ itemId: result.id, error: result.error });
        }
      }

      if (failedItems.length > 0 && attempt < MAX_ITEM_ATTEMPTS - 1) {
        const lineage = {};
        for (const item of items) {
          lineage[item.id] = artifact.itemLineage[item.id];
        }
        const plans = this.#retryAgent.planItemRetry(failedItems, lineage, { feedback: ctx.feedback, availableReferences: [...new Set(items.flatMap(i => i.refs))].map(id => ({ id })) });

        for (const plan of plans) {
          if (plan.strategy === ItemRetryStrategy.GIVE_UP) continue;
          const item = pending.find(p => p.id === plan.itemId);
          if (!item) continue;

          if (plan.overrides.seed != null) item.seed = plan.overrides.seed;
          if (plan.strategy === ItemRetryStrategy.REWRITE_PROMPT) {
            try { ctx.promptPackage = await this.#promptAgent.reviseShotPrompt({ ...ctx, shotId: item.shotId, reason: failedItems.find(f => f.itemId === plan.itemId)?.error }); }
            catch (error) { if (!error.promptPackage) throw error; }
            for (const sibling of items.filter(i => i.shotId === item.shotId)) {
              this.#refreshItem(sibling, ctx);
              results.delete(sibling.id);
              if (!pending.includes(sibling)) pending.push(sibling);
            }
          }
          if (plan.overrides.referenceOverrides?.[plan.itemId]) item.refs = [plan.overrides.referenceOverrides[plan.itemId]];
        }
      }
    }

    for (const item of pending) {
      if (!results.has(item.id)) {
        results.set(item.id, { id: item.id, path: '', imageUrl: '', status: 'failed', error: 'Max retries exceeded' });
      }
    }

    return [...results.values()];
  }

  #assembleResult(results, pairs, mode, items, shotModes) {
    const byId = new Map(results.map(r => [r.id, r]));
    const refsById = new Map((items || []).map(it => [it.id, it.refs || []]));

    const shots = pairs.map((pair, i) => {
      const shotMode = shotModes ? shotModes[i].mode
        : (mode === 'referenceImage' ? 'referenceImage' : mode === 'firstLastFrame' ? 'firstLastFrame' : 'firstFrame');
      const role = shotMode === 'referenceImage' ? FrameRole.REFERENCE : FrameRole.FIRST;
      const result = byId.get(pair.shot.shot_id) || {};

      const shot = {
        shot_id: pair.shot.shot_id,
        plannedMode: shotMode, executedMode: shotMode, fallbackReason: items.find(item => item.id === pair.shot.shot_id)?.fallbackReason || null,
        videoMode: shotMode,
        videoModeReason: shotModes?.[i]?.reason || '',
        role,
        imagePath: result.path || '',
        imageUrl: result.imageUrl || '',
        prompt: items.find(item => item.id === pair.shot.shot_id)?.prompt || '',
        refs: refsById.get(pair.shot.shot_id) || [],
        status: result.status || 'failed',
      };

      if (shotMode === 'firstLastFrame') {
        const lastId = `${pair.shot.shot_id}${LAST_FRAME_SUFFIX}`;
        const lastResult = byId.get(lastId) || {};
        shot.lastFramePath = lastResult.path || '';
        shot.lastFrameUrl = lastResult.imageUrl || '';
      }

      return shot;
    });

    return { mode, shots, extraFrames: [] };
  }

  #emptyResult(ctx, mode) {
    const pairs = this.#extractShots(ctx);
    const role = mode === 'referenceImage' ? FrameRole.REFERENCE : FrameRole.FIRST;
    const sourceArtifactIds = [
      ctx.sourceArtifactIds?.script,
      ctx.sourceArtifactIds?.storyboard,
      ctx.sourceArtifactIds?.characterDesign,
    ].filter(Boolean);
    return {
      artifacts: [createArtifact({
        kind: ArtifactKind.REFERENCE_IMAGE,
        stepId: 'referenceImages',
        data: {
          mode,
          shots: pairs.map(p => ({
            shot_id: p.shot.shot_id,
            videoMode: mode === 'auto' ? 'firstFrame' : mode,
            role,
            imagePath: '',
            imageUrl: '',
            prompt: p.shot.prompt || '',
            status: 'pending',
          })),
          extraFrames: [],
        },
        status: ArtifactStatus.FAILED,
        sourceArtifactIds,
      })],
      metadata: { videoMode: mode, totalShots: pairs.length, completeShots: 0, totalFrames: pairs.length, qualityScore: 0 },
    };
  }
}
