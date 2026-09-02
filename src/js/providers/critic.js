import { t } from '../i18n.js';
import { addAgentMessage } from '../ui/render.js';
import { updateStepMetrics } from '../observability.js';

const CRITIQUE_SYSTEM = `You are a film production quality reviewer. You evaluate the output of AI film agents for quality, coherence, and creativity. Reply ONLY with valid JSON. No markdown, no commentary, no code fences.`;

const CRITERIA = {
  planning: [
    'Theme is specific and compelling (not generic)',
    'Creative direction is actionable and visually evocative',
    'Key elements are concrete and distinct from each other',
    'Visual references are real films that match the tone'
  ],
  screenplay: [
    'Story has a clear beginning, middle, and end',
    'Characters have distinct voices in dialogue',
    'Scene descriptions are vivid and cinematic',
    'Story aligns with the creative direction'
  ],
  characters: [
    'Each character has a distinct role and personality',
    'Character descriptions are vivid and visual',
    'Characters serve the story well',
    'Character names and emojis are memorable'
  ],
  visualDesign: [
    'Color palette is harmonious and genre-appropriate',
    'Visual style is distinctive and cohesive',
    'Lighting and camera style complement the story mood',
    'Color roles are clearly defined'
  ],
  storyboard: [
    'Scenes cover the full story arc',
    'Each scene has a distinct visual identity',
    'Scene descriptions are cinematic and specific',
    'Scene flow creates visual rhythm'
  ],
  shotGen: [
    'Camera angles are varied and appropriate',
    'Compositions follow cinematography principles',
    'Quality scores are realistic and well-distributed',
    'Shots serve the storytelling'
  ],
  shotCuration: [
    'Best takes are selected based on clear criteria',
    'Rejection reasons are specific',
    'Selections create visual consistency across scenes',
    'Reasons reference specific composition details'
  ],
  editing: [
    'Clip durations match scene complexity',
    'Transitions are varied and appropriate',
    'Pacing description matches the edit choices',
    'Total duration is correctly calculated'
  ],
  audio: [
    'Music direction matches the film tone',
    'Scene audio choices support the narrative',
    'SFX are specific and cinematic',
    'Mix notes are technically sound'
  ],
  postProduction: [
    'Color grading complements the visual design',
    'VFX choices enhance without overwhelming',
    'Output format is professional',
    'Final mix description is technically complete'
  ]
};

const SCORE_THRESHOLD = 7;
const MAX_RETRIES = 2;

function buildCritiquePrompt(stepId, data, context) {
  const criteria = CRITERIA[stepId] || CRITERIA.screenplay;
  const dataStr = typeof data === 'string' ? data : JSON.stringify(data, null, 2);

  let contextStr = '';
  if (context.planning) {
    contextStr += `\nCREATIVE DIRECTION: Theme="${context.planning.theme}", Tone="${context.planning.tone}"`;
  }
  if (context.screenplay?.title) {
    contextStr += `\nSCREENPLAY: "${context.screenplay.title}" (${context.screenplay.genre})`;
  }
  if (context.storyboard) {
    contextStr += `\nSTORYBOARD: ${context.storyboard.length} scenes`;
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
  if (stepId === 'final' || stepId === 'planning') return null;

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
