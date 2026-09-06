import { BaseAgent } from './baseAgent.js';
import { RetryAgent, ItemRetryStrategy } from './retryAgent.js';
import { QCAgent, SCORE_THRESHOLD, reportScore, reportRetry } from './qcAgent.js';
import { getActiveProvider } from '../providers/registry.js';
import { createArtifact, ArtifactKind, ArtifactStatus, recordItemAttempt } from '../artifacts/artifactTypes.js';
import { addAgentMessage } from '../ui/render.js';
import { t } from '../i18n.js';

const MAX_ITEM_ATTEMPTS = 3;
const MAX_STAGE_RETRIES = 1;

function applyVisualRetryFeedback(items, critique) {
  const note = (critique.suggestions || []).join('; ');
  for (const item of items) {
    item.seed = (item.seed ?? 42) + 7;
    if (note) item.prompt = `${item.prompt}\n${note}`;
  }
}

export class CharacterAgent extends BaseAgent {
  #retryAgent;
  #qcAgent;

  constructor() {
    super({ name: 'Character Designer', stepId: 'characterDesign' });
    this.#retryAgent = new RetryAgent();
    this.#qcAgent = new QCAgent({ stepId: 'characterDesign' });
  }

  async run(ctx, _token) {
    const script = ctx.script;
    if (!script) return this.#emptyResult(ctx);

    const items = this.#buildItems(script, ctx.genre);
    const artifact = createArtifact({
      kind: ArtifactKind.CHARACTER_DESIGN,
      stepId: 'characterDesign',
      data: { characters: [], settings: [] },
      status: ArtifactStatus.GENERATING,
    });

    let bestData = null, bestCrit = null, bestScore = -Infinity;

    for (let attempt = 0; attempt <= MAX_STAGE_RETRIES; attempt++) {
      if (_token?.signal?.aborted) break;

      const results = await this.#generateItems(items, artifact, ctx, _token);
      const data = this.#assembleResult(results, script);

      const crit = await this.#qcAgent.process({ data, entities: ctx.entities || {}, ...ctx });
      reportScore(crit.score, '🎨');
      if (crit.score > bestScore) { bestScore = crit.score; bestData = data; bestCrit = crit; }

      if (crit.score >= SCORE_THRESHOLD || attempt === MAX_STAGE_RETRIES) break;
      if (crit.source === 'structural') break;

      reportRetry(crit.score, attempt + 1, MAX_STAGE_RETRIES, '🎨');
      applyVisualRetryFeedback(items, crit);
    }

    const finalData = bestData || { characters: [], settings: [] };
    const hasContent = finalData.characters.some(c => c.imagePath) || finalData.settings.some(s => s.imagePath);

    artifact.data = finalData;
    artifact.status = hasContent ? ArtifactStatus.COMPLETE : ArtifactStatus.FAILED;

    return {
      artifacts: [artifact],
      metadata: {
        qualityScore: bestCrit?.score ?? 0,
        consistencyIssues: bestCrit?.consistency?.issues || [],
        verdict: bestCrit?.verdict ?? null,
      },
    };
  }

  #buildItems(script, genre) {
    const items = [];
    for (const char of (script.characters || [])) {
      items.push({
        id: char.id,
        type: 'character',
        prompt: this.#buildCharacterPrompt(char, script, genre),
        seed: 42,
      });
    }
    for (const setting of (script.settings || [])) {
      items.push({
        id: setting.id,
        type: 'setting',
        prompt: this.#buildSettingPrompt(setting, script, genre),
        seed: 42,
      });
    }
    return items;
  }

  #buildCharacterPrompt(character, script, genre) {
    const style = genre || script?.genre || 'cinematic';
    return `Character portrait of ${character.name}, ${character.appearance || character.desc || ''}, ${style} style, detailed face and costume, studio lighting, high quality, 4k`;
  }

  #buildSettingPrompt(setting, script, genre) {
    const style = genre || script?.genre || 'cinematic';
    return `Scene environment of ${setting.name}, ${setting.desc || ''}, ${style} style, wide angle establishing shot, atmospheric lighting, cinematic composition, high quality, 4k`;
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

    addAgentMessage('🎨', t('ui.charDesignGenerating', { total: items.length }));

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

  #assembleResult(results, script) {
    const characters = (script.characters || []).map(char => {
      const result = results.find(r => r.id === char.id) || {};
      return {
        id: char.id,
        name: char.name,
        enName: char.enName || '',
        desc: char.desc,
        appearance: char.appearance || '',
        imagePath: result.path || '',
        imageUrl: result.imageUrl || '',
      };
    });

    const settings = (script.settings || []).map(setting => {
      const result = results.find(r => r.id === setting.id) || {};
      return {
        id: setting.id,
        name: setting.name,
        desc: setting.desc,
        imagePath: result.path || '',
        imageUrl: result.imageUrl || '',
      };
    });

    return { characters, settings };
  }

  #emptyResult(ctx) {
    const script = ctx.script;
    return {
      artifacts: [createArtifact({
        kind: ArtifactKind.CHARACTER_DESIGN,
        stepId: 'characterDesign',
        data: {
          characters: (script?.characters || []).map(c => ({
            id: c.id, name: c.name, enName: c.enName || '', desc: c.desc, appearance: c.appearance || '',
            imagePath: '', imageUrl: '',
          })),
          settings: (script?.settings || []).map(s => ({
            id: s.id, name: s.name, desc: s.desc,
            imagePath: '', imageUrl: '',
          })),
        },
        status: ArtifactStatus.FAILED,
      })],
      metadata: { qualityScore: 0 },
    };
  }
}
