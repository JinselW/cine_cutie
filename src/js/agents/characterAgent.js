import { BaseAgent } from './baseAgent.js';
import { RetryAgent, ItemRetryStrategy } from './retryAgent.js';
import { QCAgent, SCORE_THRESHOLD, reportScore, reportRetry } from './qcAgent.js';
import { getActiveProvider, listAllProviders } from '../providers/registry.js';
import { chat, isConfigured, parseJson, consumeStepMetrics } from '../providers/llm.js';
import { buildMessages } from '../providers/prompts.js';
import { createArtifact, ArtifactKind, ArtifactStatus, recordItemAttempt } from '../artifacts/artifactTypes.js';
import { addAgentMessage } from '../ui/render.js';
import { t } from '../i18n.js';

const MAX_ITEM_ATTEMPTS = 3;
const MAX_STAGE_RETRIES = 1;
const SHEET_SUFFIX = '__sheet';
const FRONT_SUFFIX = '__front';
const JSON_REPAIR_PROMPT = 'Your last reply was not valid JSON. Please reply again with ONLY the JSON object. No markdown, no code fences, no commentary.';

function applyVisualRetryFeedback(items, critique) {
  const note = (critique.suggestions || []).join('; ');
  for (const item of items) {
    item.seed = (item.seed ?? 42) + 7;
    if (note) item.prompt = `${item.prompt}\n${note}`;
  }
}

function pickDesign(list, entity, index) {
  return list.find(d => d?.id && d.id === entity.id)
    || list.find(d => d?.name && entity.name && d.name === entity.name)
    || list[index]
    || {};
}

export class CharacterAgent extends BaseAgent {
  #retryAgent;
  #qcAgent;

  constructor() {
    super({ name: 'Character Designer', stepId: 'characterDesign' });
    this.#retryAgent = new RetryAgent();
    this.#qcAgent = new QCAgent({ stepId: 'characterDesign' });
  }

  async run(ctx, token) {
    const script = ctx.script;
    if (!script) return this.#emptyResult(ctx);

    const genre = ctx.genre || script.genre || 'cinematic';
    const designs = await this.#writeDesignSpecs(ctx, token);
    const tokens = consumeStepMetrics().tokens;
    if (token?.signal?.aborted) return this.#emptyResult(ctx);

    const entities = this.#mergeDesigns(script, designs);
    const items = this.#buildItems(entities, genre);
    const artifact = createArtifact({
      kind: ArtifactKind.CHARACTER_DESIGN,
      stepId: 'characterDesign',
      data: { characters: [], settings: [] },
      status: ArtifactStatus.GENERATING,
    });

    let bestData = null, bestCrit = null, bestScore = -Infinity;

    for (let attempt = 0; attempt <= MAX_STAGE_RETRIES; attempt++) {
      if (token?.signal?.aborted) break;

      const results = await this.#generateItems(items, artifact, ctx, token);
      const data = this.#assembleResult(results, entities);

      const crit = await this.#qcAgent.process({ data, entities: ctx.entities || {}, ...ctx });
      reportScore(crit.score, '🎨');
      if (crit.score > bestScore) { bestScore = crit.score; bestData = data; bestCrit = crit; }

      if (crit.score >= SCORE_THRESHOLD || attempt === MAX_STAGE_RETRIES) break;
      if (crit.source === 'structural') break;

      reportRetry(crit.score, attempt + 1, MAX_STAGE_RETRIES, '🎨');
      applyVisualRetryFeedback(items, crit);
    }

    const finalData = bestData || { characters: [], settings: [] };
    const hasContent = finalData.characters.some(c => c.imagePath || c.sheetPath)
      || finalData.settings.some(s => s.imagePath);

    artifact.data = finalData;
    artifact.status = hasContent ? ArtifactStatus.COMPLETE : ArtifactStatus.FAILED;

    return {
      artifacts: [artifact],
      metadata: {
        tokens,
        qualityScore: bestCrit?.score ?? 0,
        consistencyIssues: bestCrit?.consistency?.issues || [],
        verdict: bestCrit?.verdict ?? null,
      },
    };
  }

  async #writeDesignSpecs(ctx, token) {
    const signal = token?.signal;
    addAgentMessage('🎨', t('ui.charDesignWriting'));

    if (!isConfigured()) return this.#templateDesigns(ctx);

    const messages = buildMessages('characterDesign', ctx);
    if (!messages) return this.#templateDesigns(ctx);

    let raw = null;
    try {
      raw = await chat(messages, { signal });
    } catch {
      if (signal?.aborted) return null;
      addAgentMessage('⚠️', t('llm.fellBack', { reason: t('llm.errNetwork') }));
      return this.#templateDesigns(ctx);
    }

    let parsed = parseJson(raw);
    if (!parsed) {
      try {
        const repairMessages = [
          ...messages,
          { role: 'assistant', content: raw || '' },
          { role: 'user', content: JSON_REPAIR_PROMPT },
        ];
        parsed = parseJson(await chat(repairMessages, { signal }));
      } catch {
        parsed = null;
      }
    }

    if (!parsed) {
      addAgentMessage('⚠️', t('llm.fellBack', { reason: t('llm.errParse') }));
      return this.#templateDesigns(ctx);
    }

    return parsed;
  }

  #templateDesigns(ctx) {
    const tpl = listAllProviders().find(p => p.id === 'template');
    if (!tpl) return null;
    return tpl.generate({ step: 'characterDesign', genre: ctx.genre, context: ctx });
  }

  #mergeDesigns(script, designs) {
    const designChars = Array.isArray(designs?.characters) ? designs.characters : [];
    const designSets = Array.isArray(designs?.settings) ? designs.settings : [];

    const characters = (script.characters || []).map((c, i) => {
      const d = pickDesign(designChars, c, i);
      return {
        ...c,
        design: d.design || c.desc || '',
        visualTag: d.visualTag || c.appearance || c.desc || '',
        palette: Array.isArray(d.palette) ? d.palette : [],
      };
    });

    const settings = (script.settings || []).map((s, i) => {
      const d = pickDesign(designSets, s, i);
      return {
        ...s,
        design: d.design || s.desc || '',
        visualTag: d.visualTag || s.desc || '',
        palette: Array.isArray(d.palette) ? d.palette : [],
      };
    });

    return { characters, settings };
  }

  #buildItems(entities, genre) {
    const items = [];

    for (const char of entities.characters) {
      items.push({
        id: `${char.id}${SHEET_SUFFIX}`,
        prompt: this.#buildSheetPrompt(char, genre),
        seed: 42,
      });
      items.push({
        id: `${char.id}${FRONT_SUFFIX}`,
        prompt: this.#buildFrontPrompt(char, genre),
        seed: 42,
      });
    }

    for (const setting of entities.settings) {
      items.push({
        id: setting.id,
        prompt: this.#buildSettingPrompt(setting, genre),
        seed: 42,
      });
    }

    return items;
  }

  #buildSheetPrompt(character, genre) {
    const tag = character.visualTag || character.appearance || character.desc || '';
    return `Character model sheet of ${character.name}: the SAME character shown three times side by side in one image — front view, back view, side profile view — identical outfit, identical hairstyle, identical body proportions in all three views, full body, neutral standing pose, plain light grey background, ${tag}, ${genre} style, character reference sheet, even studio lighting, high quality, 4k`;
  }

  #buildFrontPrompt(character, genre) {
    const tag = character.visualTag || character.appearance || character.desc || '';
    return `Character portrait of ${character.name}, front view, full body, neutral standing pose, plain background, ${tag}, ${genre} style, detailed face and costume, studio lighting, high quality, 4k`;
  }

  #buildSettingPrompt(setting, genre) {
    const tag = setting.visualTag || setting.desc || '';
    return `Scene environment of ${setting.name}, ${tag}, ${genre} style, wide angle establishing shot, atmospheric lighting, cinematic composition, empty environment without people, high quality, 4k`;
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

  #assembleResult(results, entities) {
    const byId = new Map(results.map(r => [r.id, r]));

    const characters = entities.characters.map(char => {
      const sheet = byId.get(`${char.id}${SHEET_SUFFIX}`) || {};
      const front = byId.get(`${char.id}${FRONT_SUFFIX}`) || {};
      return {
        id: char.id,
        name: char.name,
        enName: char.enName || '',
        desc: char.desc,
        appearance: char.appearance || '',
        design: char.design || '',
        visualTag: char.visualTag || '',
        palette: char.palette || [],
        sheetPath: sheet.path || '',
        sheetUrl: sheet.imageUrl || '',
        imagePath: front.path || '',
        imageUrl: front.imageUrl || '',
      };
    });

    const settings = entities.settings.map(setting => {
      const result = byId.get(setting.id) || {};
      return {
        id: setting.id,
        name: setting.name,
        desc: setting.desc,
        design: setting.design || '',
        visualTag: setting.visualTag || '',
        palette: setting.palette || [],
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
            design: '', visualTag: c.appearance || '', palette: [],
            sheetPath: '', sheetUrl: '', imagePath: '', imageUrl: '',
          })),
          settings: (script?.settings || []).map(s => ({
            id: s.id, name: s.name, desc: s.desc,
            design: '', visualTag: s.desc || '', palette: [],
            imagePath: '', imageUrl: '',
          })),
        },
        status: ArtifactStatus.FAILED,
      })],
      metadata: { qualityScore: 0 },
    };
  }
}
