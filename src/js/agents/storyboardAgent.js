import { BaseAgent } from './baseAgent.js';
import { QCAgent, SCORE_THRESHOLD, reportScore, reportRetry, buildRetryFeedback } from './qcAgent.js';
import { RetryAgent } from './retryAgent.js';
import { chat, isConfigured, consumeStepMetrics } from '../providers/llm.js';
import { getConfig } from '../providers/image.js';
import { getVideoDurationRange } from '../providers/video.js';
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

function iterateShots(parsed) {
  const shots = [];
  for (const ep of (parsed.episodes || [])) {
    for (const seg of (ep.segments || [])) {
      for (const shot of (seg.shots || [])) shots.push(shot);
    }
  }
  return shots;
}

// The finished film is the sum of its clips, so the storyboard must honour the
// user's total duration instead of trusting the model to add up. Shot count is
// trimmed so every clip stays ≥ the model's minimum, then durations are rescaled
// toward the target and nudged to whole seconds within the model's tiers.
function reconcileStoryboardTiming(parsed, totalDuration) {
  if (!totalDuration || !Array.isArray(parsed.episodes)) return parsed;
  const { min: minClip, max: maxClip, fallback } = getVideoDurationRange(getConfig().videoModel);

  const maxShots = Math.max(1, Math.floor(totalDuration / minClip));
  if (iterateShots(parsed).length > maxShots) {
    let remaining = maxShots;
    outer: for (const ep of parsed.episodes) {
      for (const seg of (ep.segments || [])) {
        const shots = seg.shots || [];
        if (shots.length > remaining) seg.shots = shots.slice(0, remaining);
        remaining -= (seg.shots || []).length;
        if (remaining <= 0) break outer;
      }
    }
    for (const ep of parsed.episodes) {
      ep.segments = (ep.segments || []).filter(seg => (seg.shots || []).length > 0);
    }
    parsed.episodes = parsed.episodes.filter(ep => (ep.segments || []).length > 0);
  }

  const shots = iterateShots(parsed);
  if (!shots.length) return parsed;

  for (const s of shots) {
    const seconds = Math.round(Number(s.duration));
    s.duration = Number.isFinite(seconds) && seconds > 0
      ? Math.min(maxClip, Math.max(minClip, seconds)) : fallback;
  }

  const sum = shots.reduce((acc, s) => acc + s.duration, 0);
  if (sum > 0) {
    const scale = totalDuration / sum;
    for (const s of shots) {
      s.duration = Math.min(maxClip, Math.max(minClip, Math.round(s.duration * scale)));
    }
  }

  // Nudge whole seconds toward the target so rounding doesn't leave the film
  // short/long; stop early once no shot has headroom left within the tiers.
  let diff = totalDuration - shots.reduce((acc, s) => acc + s.duration, 0);
  while (diff !== 0) {
    const wantMore = diff > 0;
    const candidates = shots.filter(s => wantMore
      ? s.duration < maxClip
      : s.duration > minClip);
    if (!candidates.length) break;
    candidates.sort((a, b) => wantMore
      ? (maxClip - a.duration) - (maxClip - b.duration)
      : (a.duration - minClip) - (b.duration - minClip));
    const pick = candidates[candidates.length - 1];
    pick.duration += wantMore ? 1 : -1;
    diff += wantMore ? -1 : 1;
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

    const { min, max, fallback } = getVideoDurationRange(getConfig().videoModel);
    const messages = buildMessages('storyboard', { ...ctx, minClip: min, maxClip: max, nominalClip: fallback });
    if (!messages) {
      return this.#fallback(ctx, false);
    }

    let currentMessages = messages;
    let currentResult = null;
    let bestResult = null;
    let bestScore = -1;
    let bestCritique = null;
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
        bestCritique = critique;
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
      finalResult = reconcileStoryboardTiming({ ...finalResult }, ctx.totalDuration);
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
        verdict: bestCritique?.verdict ?? null,
        consistencyIssues: bestCritique?.issues || [],
        feedbackSatisfied: bestCritique?.feedbackSatisfied ?? !ctx.feedback,
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
        metadata: {
          fallbackUsed: true,
          tokens: { prompt: 0, completion: 0 },
          retries: 0,
          qualityScore: null,
          feedbackSatisfied: !ctx.feedback,
        },
      };
    }
    return { artifacts: [], metadata: { fallbackUsed: true, tokens: { prompt: 0, completion: 0 }, retries: 0, qualityScore: null } };
  }
}

export { validateStoryboard };
