import { BaseAgent } from './baseAgent.js';
import { RetryAgent, ItemRetryStrategy } from './retryAgent.js';
import { QCAgent, SCORE_THRESHOLD, reportScore, reportRetry } from './qcAgent.js';
import { getActiveProvider } from '../providers/registry.js';
import { getConfig } from '../providers/llm.js';
import { STYLE_HINTS } from '../providers/prompts.js';
import { createArtifact, ArtifactKind, ArtifactStatus, recordItemAttempt } from '../artifacts/artifactTypes.js';
import { addAgentMessage } from '../ui/render.js';
import { t } from '../i18n.js';

const MAX_ITEM_ATTEMPTS = 3;
const MAX_STAGE_RETRIES = 1;
const MAX_REFS = 4;
const LAST_FRAME_SUFFIX = '__last_frame';

export const FrameRole = Object.freeze({
  FIRST: 'first_frame',
  LAST: 'last_frame',
  REFERENCE: 'reference_image',
});

function applyVisualRetryFeedback(items, critique) {
  const note = (critique.suggestions || []).join('; ');
  for (const item of items) {
    item.seed = (item.seed ?? 42) + 7;
    if (note) item.prompt = `${item.prompt}\n${note}`;
  }
}

export class ReferenceAgent extends BaseAgent {
  #retryAgent;
  #qcAgent;

  constructor() {
    super({ name: 'Image Director', stepId: 'referenceImages' });
    this.#retryAgent = new RetryAgent();
    this.#qcAgent = new QCAgent({ stepId: 'referenceImages' });
  }

  async run(ctx, _token) {
    const mode = this.#videoMode();
    const pairs = this.#extractShots(ctx);
    if (!pairs.length) return this.#emptyResult(ctx, mode);

    const items = this.#buildItems(pairs, ctx, mode);
    const artifact = createArtifact({
      kind: ArtifactKind.REFERENCE_IMAGE,
      stepId: 'referenceImages',
      data: { mode, shots: [], extraFrames: [] },
      status: ArtifactStatus.GENERATING,
    });

    let bestData = null, bestCrit = null, bestScore = -Infinity;

    for (let attempt = 0; attempt <= MAX_STAGE_RETRIES; attempt++) {
      if (_token?.signal?.aborted) break;

      const results = await this.#generateItems(items, artifact, ctx, _token);
      const data = this.#assembleResult(results, pairs, mode, items);

      const crit = await this.#qcAgent.process({ data, entities: ctx.entities || {}, ...ctx });
      reportScore(crit.score, '🖼️');
      if (crit.score > bestScore) { bestScore = crit.score; bestData = data; bestCrit = crit; }

      if (crit.score >= SCORE_THRESHOLD || attempt === MAX_STAGE_RETRIES) break;
      if (crit.source === 'structural') break;

      reportRetry(crit.score, attempt + 1, MAX_STAGE_RETRIES, '🖼️');
      applyVisualRetryFeedback(items, crit);
    }

    const finalData = bestData || { mode, shots: [], extraFrames: [] };
    const complete = finalData.shots.filter(s => s.status === 'complete' || s.imagePath).length;

    artifact.data = finalData;
    artifact.status = complete > 0 ? ArtifactStatus.COMPLETE : ArtifactStatus.FAILED;

    return {
      artifacts: [artifact],
      metadata: {
        videoMode: mode,
        totalShots: finalData.shots.length,
        completeShots: complete,
        totalFrames: items.length,
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

    const maxClips = Math.ceil((ctx.totalDuration || 30) / 5);
    if (pairs.length > maxClips) pairs.length = maxClips;
    return pairs;
  }

  #buildItems(pairs, ctx, mode) {
    const role = mode === 'referenceImage' ? FrameRole.REFERENCE : FrameRole.FIRST;
    const items = pairs.map((pair, index) => ({
      id: pair.shot.shot_id,
      role,
      index,
      ...this.#frameSpec(pair, ctx, role),
    }));

    if (mode === 'firstLastFrame') {
      const lastIndex = pairs.length - 1;
      items.push({
        id: `${pairs[lastIndex].shot.shot_id}${LAST_FRAME_SUFFIX}`,
        role: FrameRole.LAST,
        index: lastIndex,
        ...this.#frameSpec(pairs[lastIndex], ctx, FrameRole.LAST),
      });
    }

    return items;
  }

  #frameSpec(pair, ctx, role) {
    const genre = ctx.genre || ctx.script?.genre;
    const styleHint = STYLE_HINTS[genre] || genre || 'cinematic film look';
    const matched = this.#matchEntities(pair, ctx);
    const refs = this.#collectRefs(matched);
    return {
      prompt: this.#buildFramePrompt(pair, matched, { styleHint, refs, role }),
      refs,
      seed: 42,
    };
  }

  #matchEntities(pair, ctx) {
    const design = ctx.characterDesign || {};
    const characters = design.characters || [];
    const settings = design.settings || [];
    const corpus = [
      pair.shot.prompt, pair.shot.description,
      pair.beat.segmentTitle, pair.beat.segmentDescription, pair.beat.episodeSummary,
    ].join(' ').toLowerCase();

    const hit = entity => [entity.name, entity.enName]
      .filter(Boolean)
      .some(n => String(n).toLowerCase().length > 1 && corpus.includes(String(n).toLowerCase()));

    const matchedChars = characters.filter(hit);
    const matchedSettings = settings.filter(hit);
    return {
      characters: (matchedChars.length ? matchedChars : characters.length === 1 ? characters : []).slice(0, 2),
      settings: (matchedSettings.length ? matchedSettings : settings.length === 1 ? settings : []).slice(0, 1),
    };
  }

  #collectRefs({ characters, settings }) {
    const refs = [];
    for (const c of characters) refs.push(c.imagePath || c.sheetPath);
    for (const s of settings) refs.push(s.imagePath);
    return [...new Set(refs.filter(r => typeof r === 'string' && r.startsWith('/api/media/')))].slice(0, MAX_REFS);
  }

  #buildFramePrompt(pair, matched, { styleHint, refs, role }) {
    const shot = pair.shot;
    const base = shot.prompt || `${shot.description || pair.beat.segmentDescription || 'Scene'}, ${shot.type || 'medium'} shot`;

    const parts = [styleHint, base];
    for (const entity of [...matched.characters, ...matched.settings]) {
      if (entity.visualTag) parts.push(entity.visualTag);
    }
    if (pair.beat.segmentTitle) parts.push(`story beat: ${pair.beat.segmentTitle}`);
    if (role === FrameRole.LAST) {
      parts.push('the action has settled into its final composition, closing frame of this shot');
    } else if (role === FrameRole.REFERENCE) {
      parts.push('clean composition that locks the identity of the character and the setting');
    }
    parts.push('high quality, 4k');

    let prompt = parts.join(', ');
    if (refs.length) prompt = `${this.#identityClause(refs, matched)} Now render: ${prompt}`;
    return prompt;
  }

  #identityClause(refs, matched) {
    const lookup = new Map();
    for (const c of matched.characters) lookup.set(c.imagePath || c.sheetPath, `the character ${c.enName || c.name}`);
    for (const s of matched.settings) lookup.set(s.imagePath, `the location ${s.name}`);

    const labels = refs.map((ref, i) => `image ${i + 1} = ${lookup.get(ref) || 'visual reference'}`);
    return (
      `REFERENCE FIDELITY (${labels.join('; ')}). `
      + 'Reproduce exactly the face, hairstyle, outfit, colors and proportions of the referenced character, '
      + 'and the layout, materials and lighting of the referenced location. Do not invent extra characters or change costumes.'
    );
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
        referenceId: item.refs?.[0] || null,
        status: 'pending',
      });
    }

    addAgentMessage('🖼️', t('ui.refImagesGenerating', { current: 1, total: items.length }));

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

  #assembleResult(results, pairs, mode, items) {
    const byId = new Map(results.map(r => [r.id, r]));
    const refsById = new Map((items || []).map(it => [it.id, it.refs || []]));
    const role = mode === 'referenceImage' ? FrameRole.REFERENCE : FrameRole.FIRST;
    const closingId = pairs.length ? `${pairs[pairs.length - 1].shot.shot_id}${LAST_FRAME_SUFFIX}` : '';
    const closing = byId.get(closingId) || {};

    const shots = pairs.map((pair, i) => {
      const result = byId.get(pair.shot.shot_id) || {};
      const shot = {
        shot_id: pair.shot.shot_id,
        role,
        imagePath: result.path || '',
        imageUrl: result.imageUrl || '',
        prompt: result.prompt || pair.shot.prompt || '',
        refs: refsById.get(pair.shot.shot_id) || [],
        status: result.status || 'failed',
      };

      if (mode === 'firstLastFrame') {
        const next = pairs[i + 1];
        if (next) {
          const nextResult = byId.get(next.shot.shot_id) || {};
          shot.lastFramePath = nextResult.path || '';
          shot.lastFrameUrl = nextResult.imageUrl || '';
          shot.lastFrameFrom = next.shot.shot_id;
        } else {
          shot.lastFramePath = closing.path || '';
          shot.lastFrameUrl = closing.imageUrl || '';
          shot.lastFrameFrom = 'generated';
        }
      }

      return shot;
    });

    const extraFrames = mode === 'firstLastFrame' && pairs.length
      ? [{
        id: closingId,
        shot_id: pairs[pairs.length - 1].shot.shot_id,
        role: FrameRole.LAST,
        imagePath: closing.path || '',
        imageUrl: closing.imageUrl || '',
        prompt: closing.prompt || '',
        refs: refsById.get(closingId) || [],
        status: closing.status || 'failed',
      }]
      : [];

    return { mode, shots, extraFrames };
  }

  #emptyResult(ctx, mode) {
    const pairs = this.#extractShots(ctx);
    const role = mode === 'referenceImage' ? FrameRole.REFERENCE : FrameRole.FIRST;
    return {
      artifacts: [createArtifact({
        kind: ArtifactKind.REFERENCE_IMAGE,
        stepId: 'referenceImages',
        data: {
          mode,
          shots: pairs.map(p => ({
            shot_id: p.shot.shot_id,
            role,
            imagePath: '',
            imageUrl: '',
            prompt: p.shot.prompt || '',
            status: 'pending',
          })),
          extraFrames: [],
        },
        status: ArtifactStatus.FAILED,
      })],
      metadata: { videoMode: mode, totalShots: pairs.length, completeShots: 0, totalFrames: pairs.length, qualityScore: 0 },
    };
  }
}
