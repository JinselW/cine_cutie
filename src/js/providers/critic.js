import { t } from '../i18n.js';
import { addAgentMessage } from '../ui/render.js';
import { updateStepMetrics } from '../observability.js';

const CRITIQUE_SYSTEM = `You are a film production quality reviewer. You evaluate the output of AI film agents for quality, coherence, and creativity. Reply ONLY with valid JSON. No markdown, no commentary, no code fences.`;

const CRITERIA = {
  script: [
    'Story has a clear structure with episodes and segments',
    'Characters are visually distinctive with detailed appearance descriptions',
    'Settings are vivid and specific enough for image generation',
    'Story aligns with the user\'s input and genre'
  ],
  storyboard: [
    'Shots cover all segments from the script',
    'Shot prompts are detailed enough for image generation',
    'Camera angles and movements are varied and cinematic',
    'Shot durations create good pacing'
  ]
};

const SCORE_THRESHOLD = 7;
const MAX_RETRIES = 2;

function buildCritiquePrompt(stepId, data, context) {
  const criteria = CRITERIA[stepId] || CRITERIA.script;
  const dataStr = typeof data === 'string' ? data : JSON.stringify(data, null, 2);

  let contextStr = '';
  if (context.script?.title) {
    contextStr += `\nSCRIPT: "${context.script.title}" (${context.script.genre})`;
  }
  if (context.storyboard?.episodes) {
    const shotCount = context.storyboard.episodes.reduce((n, ep) =>
      n + ep.segments.reduce((m, seg) => m + (seg.shots?.length || 0), 0), 0);
    contextStr += `\nSTORYBOARD: ${context.storyboard.episodes.length} episodes, ${shotCount} shots`;
  }

  return [
    { role: 'system', content: CRITIQUE_SYSTEM },
    { role: 'user', content: `Evaluate the following ${stepId} output for a short film production.

RATE ON THESE CRITERIA (1-10 each):
${criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}
${contextStr}

OUTPUT TO EVALUATE:
${dataStr.substring(0, 3000)}

OUTPUT JSON SCHEMA:
{
  "scores": {
    ${criteria.map((c, i) => `"criterion${i + 1}": number // ${c}`).join(',\n    ')}
  },
  "overallScore": number,
  "issues": ["string — specific issue 1", "string — specific issue 2"],
  "suggestions": ["string — improvement suggestion 1", "string — improvement suggestion 2"]
}

Requirements:
- Each criterion score: 1-10
- overallScore: average of all criterion scores, rounded to 1 decimal
- issues: 1-3 specific problems (only if score < 8)
- suggestions: 1-3 actionable improvements (only if score < 8)` }
  ];
}

function parseCritiqueResponse(raw) {
  let text = raw.trim().replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
  try {
    return JSON.parse(text);
  } catch {
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try { return JSON.parse(text.substring(firstBrace, lastBrace + 1)); } catch {}
    }
    return null;
  }
}

export async function critiqueOutput(stepId, data, context, callChatFn) {
  if (stepId !== 'script' && stepId !== 'storyboard') return null;

  const messages = buildCritiquePrompt(stepId, data, context);

  let raw;
  try {
    raw = await callChatFn(messages);
  } catch {
    return null;
  }

  const parsed = parseCritiqueResponse(raw);
  if (!parsed || typeof parsed.overallScore !== 'number') return null;

  return {
    score: Math.round(parsed.overallScore * 10) / 10,
    issues: Array.isArray(parsed.issues) ? parsed.issues : [],
    suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : []
  };
}

export function shouldRetry(critiqueResult) {
  if (!critiqueResult) return false;
  return critiqueResult.score < SCORE_THRESHOLD;
}

export function buildRetryFeedback(critiqueResult) {
  if (!critiqueResult) return '';
  const parts = ['The previous output scored below quality threshold.'];
  if (critiqueResult.issues.length > 0) {
    parts.push('Issues found:');
    critiqueResult.issues.forEach(issue => parts.push(`- ${issue}`));
  }
  if (critiqueResult.suggestions.length > 0) {
    parts.push('Suggestions for improvement:');
    critiqueResult.suggestions.forEach(s => parts.push(`- ${s}`));
  }
  parts.push('Please regenerate the output addressing all issues.');
  return parts.join('\n');
}

export function reportScore(stepId, score, agentIcon) {
  const scoreColor = score >= 8 ? '#00e5a0' : score >= 7 ? 'var(--gold)' : 'var(--rose)';
  const scoreText = t('critique.scoreDisplay', { score: score.toFixed(1) });
  addAgentMessage(agentIcon, `<span style="color:${scoreColor}">${scoreText}</span>`);
  updateStepMetrics({ qualityScore: score });
}

export function reportRetry(stepId, score, retryNum, agentIcon) {
  addAgentMessage(agentIcon, t('critique.retrying', { score: score.toFixed(1), retry: retryNum, max: MAX_RETRIES }));
}

export { SCORE_THRESHOLD, MAX_RETRIES };
