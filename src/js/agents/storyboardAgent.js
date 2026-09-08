import { BaseAgent } from './baseAgent.js';
import { QCAgent, SCORE_THRESHOLD, reportScore, reportRetry, buildRetryFeedback } from './qcAgent.js';
import { RetryAgent } from './retryAgent.js';
import { chat, isConfigured, consumeStepMetrics } from '../providers/llm.js';
import { buildMessages } from '../providers/prompts.js';
import { listAllProviders } from '../providers/registry.js';
import { addAgentMessage } from '../ui/render.js';
import { t } from '../i18n.js';
import { createArtifact, ArtifactKind, ArtifactStatus } from '../artifacts/artifactTypes.js';
import { reportPhase } from '../progressTracker.js';
import { CancellationTokenError } from '../orchestrator/cancellationToken.js';

const MAX_RETRIES = 2;

function validateStoryboard(data) {
  if (data == null) return false;
  return Array.isArray(data.episodes) && data.episodes.length >= 1
    && data.episodes[0].segments
    && data.episodes[0].segments[0]?.shots
    && data.episodes[0].segments[0].shots.length >= 1;
}

function capShotsByDuration(parsed, totalDuration) {
  if (!totalDuration) return parsed;
  const maxClips = Math.ceil(totalDuration / 5);
  let totalShots = 0;
  for (const ep of (parsed.episodes || [])) {
    for (const seg of (ep.segments || [])) {
      totalShots += (seg.shots || []).length;
    }
  }
  if (totalShots > maxClips) {
    let remaining = maxClips;
    outer: for (const ep of (parsed.episodes || [])) {
      for (const seg of (ep.segments || [])) {
        if (seg.shots && seg.shots.length > remaining) {
          seg.shots = seg.shots.slice(0, remaining);
        }
        remaining -= (seg.shots || []).length;
        if (remaining <= 0) {
          seg.shots = seg.shots || [];
          break outer;
        }
      }
    }
    for (const ep of (parsed.episodes || [])) {
      ep.segments = (ep.segments || []).filter(seg => (seg.shots || []).length > 0);
    }
    parsed.episodes = (parsed.episodes || []).filter(ep => (ep.segments || []).length > 0);
  }
  return parsed;
}

async function tryParseJson(raw) {
  let text = raw.trim();
  text = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
  try {
    return JSON.parse(text);
  } catch {
    const firstBrace = text.indexOf('{');
    const firstBracket = text.indexOf('[');
    let start = -1;
    let endChar;
    if (firstBrace >= 0 && (firstBracket < 0 || firstBrace < firstBracket)) {
      start = firstBrace;
      endChar = '}';
    } else if (firstBracket >= 0) {
      start = firstBracket;
      endChar = ']';
    }
    if (start >= 0) {
      const end = text.lastIndexOf(endChar);
      if (end > start) {
        try { return JSON.parse(text.substring(start, end + 1)); } catch {}
      }
    }
    return null;
  }
}

function getTemplateProvider() {
  return listAllProviders().find(p => p.id === 'template');
}

export class StoryboardAgent extends BaseAgent {
  #qcAgent;
  #retryAgent;

  constructor() {
    super({ name: 'Storyboard Artist', stepId: 'storyboard' });
    this.#qcAgent = new QCAgent({ stepId: 'storyboard' });
    this.#retryAgent = new RetryAgent();
  }

  async #generate(messages, signal) {
    let raw;
    try {
      raw = await chat(messages, { signal });
    } catch (err) {
      return { result: null, error: err };
    }
    let parsed = await tryParseJson(raw);
    if (!parsed) {
      try {
        const repairMessages = [
          ...messages,
          { role: 'assistant', content: raw || '' },
          { role: 'user', content: 'Your last reply was not valid JSON. Please reply again with ONLY the JSON object/array. No markdown, no code fences, no commentary.' },
        ];
        const repairRaw = await chat(repairMessages, { signal });
        parsed = await tryParseJson(repairRaw);
      } catch (err) {
        return { result: null, error: err };
      }
    }
    return { result: parsed, error: null };
  }

  async run(ctx, token) {
    if (!isConfigured()) {
      return this.#fallback(ctx, false);
    }

    const messages = buildMessages('storyboard', ctx);
    if (!messages) {
      return this.#fallback(ctx, false);
    }

    let currentMessages = messages;
    let currentResult = null;
    let bestResult = null;
    let bestScore = -1;
    let totalTokens = { prompt: 0, completion: 0 };
    let retries = 0;
    let fallbackUsed = false;
    let lastError = null;
    const signal = token?.signal;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      reportPhase(attempt ? 'retrying' : 'generatingText', { attempt: attempt + 1 });
      const { result: generated, error } = await this.#generate(currentMessages, signal);
      if (error) lastError = error;
      const metrics = consumeStepMetrics();
      totalTokens.prompt += metrics.tokens.prompt;
      totalTokens.completion += metrics.tokens.completion;

      if (!generated || !validateStoryboard(generated)) {
        if (attempt < MAX_RETRIES) continue;
        break;
      }

      currentResult = generated;

      reportPhase('validating');
      const critique = await this.#qcAgent.process({ data: currentResult, ...ctx });
      if (!critique) break;

      reportScore(critique.score, '⭐');

      if (critique.score > bestScore) {
        bestScore = critique.score;
        bestResult = currentResult;
      }

      if (critique.score >= SCORE_THRESHOLD || attempt === MAX_RETRIES) break;

      reportRetry(critique.score, attempt + 1, MAX_RETRIES, '⭐');
      retries++;

      const feedback = buildRetryFeedback(critique);
      currentMessages = this.#retryAgent.buildRetryMessages(messages, currentResult, feedback);
    }

    let finalResult = bestResult || currentResult;

    if (!finalResult) {
      if (signal?.aborted) {
        throw new CancellationTokenError('Operation cancelled');
      }
      const fb = this.#fallback(ctx, true, lastError);
      fallbackUsed = true;
      return fb;
    }

    if (ctx.totalDuration) {
      finalResult = capShotsByDuration({ ...finalResult }, ctx.totalDuration);
    }

    const sourceArtifactIds = ctx.sourceArtifactIds?.script ? [ctx.sourceArtifactIds.script] : [];

    return {
      artifacts: [createArtifact({
        kind: ArtifactKind.STORYBOARD,
        stepId: 'storyboard',
        data: finalResult,
        status: ArtifactStatus.COMPLETE,
        sourceArtifactIds,
      })],
      metadata: {
        tokens: totalTokens,
        retries,
        qualityScore: bestScore >= 0 ? bestScore : null,
        fallbackUsed,
      },
    };
  }

  async #fallback(ctx, showMessage = true, error = null) {
    const tpl = getTemplateProvider();
    if (tpl) {
      const result = await tpl.generate({ step: 'storyboard', genre: ctx.genre, context: ctx });
      if (showMessage) {
        const reason = error?.i18nKey || 'llm.errNetwork';
        addAgentMessage('⚠️', t('llm.fellBack', { reason: t(reason) }));
      }
      const sourceArtifactIds = ctx.sourceArtifactIds?.script ? [ctx.sourceArtifactIds.script] : [];
      return {
        artifacts: [createArtifact({
          kind: ArtifactKind.STORYBOARD,
          stepId: 'storyboard',
          data: result,
          status: ArtifactStatus.COMPLETE,
          sourceArtifactIds,
        })],
        metadata: { fallbackUsed: true, tokens: { prompt: 0, completion: 0 }, retries: 0, qualityScore: null },
      };
    }
    return { artifacts: [], metadata: { fallbackUsed: true, tokens: { prompt: 0, completion: 0 }, retries: 0, qualityScore: null } };
  }
}

export { validateStoryboard };
