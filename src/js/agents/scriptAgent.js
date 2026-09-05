import { BaseAgent } from './baseAgent.js';
import { QCAgent, SCORE_THRESHOLD, reportScore, reportRetry, buildRetryFeedback } from './qcAgent.js';
import { RetryAgent } from './retryAgent.js';
import { chat, isConfigured, consumeStepMetrics } from '../providers/llm.js';
import { buildMessages } from '../providers/prompts.js';
import { listAllProviders } from '../providers/registry.js';
import { addAgentMessage } from '../ui/render.js';
import { t } from '../i18n.js';
import { createArtifact, ArtifactKind, ArtifactStatus } from '../artifacts/artifactTypes.js';

const MAX_RETRIES = 2;

function validateScript(data) {
  if (data == null) return false;
  return data.title
    && Array.isArray(data.characters) && data.characters.length >= 1
    && Array.isArray(data.episodes) && data.episodes.length >= 1;
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

export class ScriptAgent extends BaseAgent {
  #qcAgent;
  #retryAgent;

  constructor() {
    super({ name: 'Scriptwriter', stepId: 'script' });
    this.#qcAgent = new QCAgent({ stepId: 'script' });
    this.#retryAgent = new RetryAgent();
  }

  async #generate(messages, signal) {
    let raw;
    try {
      raw = await chat(messages, { signal });
    } catch {
      return null;
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
      } catch {
        return null;
      }
    }
    return parsed;
  }

  async run(ctx, token) {
    if (!isConfigured()) {
      return this.#fallback(ctx);
    }

    const messages = buildMessages('script', ctx);
    if (!messages) {
      return this.#fallback(ctx);
    }

    let currentMessages = messages;
    let currentResult = null;
    let bestResult = null;
    let bestScore = -1;
    let totalTokens = { prompt: 0, completion: 0 };
    let retries = 0;
    let fallbackUsed = false;
    const signal = token?.signal;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const generated = await this.#generate(currentMessages, signal);
      const metrics = consumeStepMetrics();
      totalTokens.prompt += metrics.tokens.prompt;
      totalTokens.completion += metrics.tokens.completion;

      if (!generated || !validateScript(generated)) {
        if (attempt < MAX_RETRIES) continue;
        break;
      }

      currentResult = generated;

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

    const finalResult = bestResult || currentResult;

    if (!finalResult) {
      const fb = this.#fallback(ctx);
      fallbackUsed = true;
      return fb;
    }

    return {
      artifacts: [createArtifact({
        kind: ArtifactKind.SCRIPT,
        stepId: 'script',
        data: finalResult,
        status: ArtifactStatus.COMPLETE,
      })],
      metadata: {
        tokens: totalTokens,
        retries,
        qualityScore: bestScore >= 0 ? bestScore : null,
        fallbackUsed,
      },
    };
  }

  async #fallback(ctx) {
    const tpl = getTemplateProvider();
    if (tpl) {
      const result = await tpl.generate({ step: 'script', genre: ctx.genre, context: ctx });
      addAgentMessage('⚠️', t('llm.fellBack', { reason: t('llm.errNetwork') }));
      return {
        artifacts: [createArtifact({
          kind: ArtifactKind.SCRIPT,
          stepId: 'script',
          data: result,
          status: ArtifactStatus.COMPLETE,
        })],
        metadata: { fallbackUsed: true, tokens: { prompt: 0, completion: 0 }, retries: 0, qualityScore: null },
      };
    }
    return { artifacts: [], metadata: { fallbackUsed: true, tokens: { prompt: 0, completion: 0 }, retries: 0, qualityScore: null } };
  }
}

export { validateScript };
