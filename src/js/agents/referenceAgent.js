import { BaseAgent } from './baseAgent.js';
import { RetryAgent, ItemRetryStrategy } from './retryAgent.js';
import { checkConsistency } from '../providers/consistency.js';
import { getActiveProvider } from '../providers/registry.js';
import { createArtifact, ArtifactKind, ArtifactStatus, recordItemAttempt } from '../artifacts/artifactTypes.js';
import { QCVerdict, Severity } from './qcTypes.js';
import { addAgentMessage } from '../ui/render.js';
import { t } from '../i18n.js';

const MAX_ITEM_ATTEMPTS = 3;

export class ReferenceAgent extends BaseAgent {
  #retryAgent;

  constructor() {
    super({ name: 'Image Director', stepId: 'referenceImages' });
    this.#retryAgent = new RetryAgent();
  }

  async run(ctx, _token) {
    const shots = this.#extractShots(ctx);
    if (!shots.length) return this.#emptyResult(ctx);

    const items = this.#buildItems(shots, ctx);
    const artifact = createArtifact({
      kind: ArtifactKind.REFERENCE_IMAGE,
      stepId: 'referenceImages',
      data: { shots: [] },
      status: ArtifactStatus.GENERATING,
    });

    const results = await this.#generateItems(items, artifact, ctx, _token);
    const data = this.#assembleResult(results, shots);

    const l2Check = checkConsistency('referenceImages', data, ctx.entities || {});
    const complete = data.shots.filter(s => s.status === 'complete' || s.imagePath).length;

    artifact.data = data;
    artifact.status = complete > 0 ? ArtifactStatus.COMPLETE : ArtifactStatus.FAILED;

    return {
      artifacts: [artifact],
      metadata: {
        totalShots: data.shots.length,
        completeShots: complete,
        qualityScore: l2Check.verdict === QCVerdict.PASS ? 10 : l2Check.verdict === QCVerdict.CONDITIONAL_PASS ? 7 : 5,
        consistencyIssues: l2Check.issues || [],
      },
    };
  }

  #extractShots(ctx) {
    const storyboard = ctx.storyboard;
    if (!storyboard) return [];

    const shots = [];
    for (const ep of (storyboard.episodes || [])) {
      for (const seg of (ep.segments || [])) {
        for (const shot of (seg.shots || [])) {
          shots.push(shot);
        }
      }
    }

    const maxClips = Math.ceil((ctx.totalDuration || 30) / 5);
    if (shots.length > maxClips) shots.length = maxClips;
    return shots;
  }

  #buildItems(shots, ctx) {
    const characters = ctx.characterDesign?.characters || [];
    const genre = ctx.genre;

    return shots.map(shot => ({
      id: shot.shot_id,
      prompt: this.#buildShotPrompt(shot, characters, genre),
      seed: 42,
    }));
  }

  #buildShotPrompt(shot, characters, genre) {
    const style = genre || 'cinematic';
    let base = shot.prompt || `${shot.description}, ${shot.type} shot`;

    if (characters?.length) {
      const shotText = base.toLowerCase();
      for (const c of characters) {
        const names = [c.name, c.enName].filter(Boolean).map(n => n.toLowerCase());
        if (names.some(n => n && shotText.includes(n)) && c.appearance) {
          base += `, ${c.appearance}`;
          break;
        }
      }
    }

    return `${style} style, ${base}, high quality, 4k`;
  }

  async #generateItems(items, artifact, ctx, token) {
    const provider = getActiveProvider('image');
    if (!provider) {
      return items.map(item => ({ id: item.id, status: 'failed', error: 'No provider' }));
    }

    const results = new Map();
    const pending = [...items];

    for (const item of items) {
      recordItemAttempt(artifact, item.id, {
        seed: item.seed,
        prompt: item.prompt,
        status: 'pending',
      });
    }

    addAgentMessage('🖼️', t('ui.refImagesGenerating', { current: 1, total: items.length }));

    for (let attempt = 0; attempt < MAX_ITEM_ATTEMPTS && pending.length > 0; attempt++) {
      const batch = pending.map(item => ({
        id: item.id,
        prompt: item.prompt,
        seed: item.seed,
      }));

      const providerResults = await provider.generate({ items: batch, overrides: {}, signal: token?.signal });

      const failedItems = [];
      for (const result of providerResults) {
        recordItemAttempt(artifact, result.id, {
          seed: batch.find(b => b.id === result.id)?.seed,
          prompt: batch.find(b => b.id === result.id)?.prompt,
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
        const plans = this.#retryAgent.planItemRetry(failedItems, lineage, {});

        for (const plan of plans) {
          if (plan.strategy === ItemRetryStrategy.GIVE_UP) continue;
          const item = pending.find(p => p.id === plan.itemId);
          if (!item) continue;

          if (plan.overrides.seed != null) item.seed = plan.overrides.seed;
          if (plan.overrides.promptOverrides?.[plan.itemId]) {
            item.prompt = plan.overrides.promptOverrides[plan.itemId];
          }
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

  #assembleResult(results, shots) {
    const shotResults = shots.map(shot => {
      const result = results.find(r => r.id === shot.shot_id) || {};
      return {
        shot_id: shot.shot_id,
        imagePath: result.path || '',
        imageUrl: result.imageUrl || '',
        prompt: result.prompt || shot.prompt || '',
        status: result.status || 'failed',
      };
    });

    return { shots: shotResults };
  }

  #emptyResult(ctx) {
    const shots = this.#extractShots(ctx);
    return {
      artifacts: [createArtifact({
        kind: ArtifactKind.REFERENCE_IMAGE,
        stepId: 'referenceImages',
        data: {
          shots: shots.map(sh => ({
            shot_id: sh.shot_id,
            imagePath: '',
            imageUrl: '',
            prompt: sh.prompt || '',
            status: 'pending',
          })),
        },
        status: ArtifactStatus.FAILED,
      })],
      metadata: { totalShots: shots.length, completeShots: 0, qualityScore: 0 },
    };
  }
}
