import { getActiveProvider } from '../providers/registry.js';
import { chat } from '../providers/llm.js';
import { addAgentMessage } from '../ui/render.js';
import { updateStepMetrics } from '../observability.js';
import { t } from '../i18n.js';
import { imageParts, videoParts } from '../utils/visionMedia.js';
import { checkConsistency } from './qcConsistency.js';
import { QCVerdict, Severity } from './qcTypes.js';

const CRITIQUE_SYSTEM = 'You are a film production quality reviewer. You evaluate the output of AI film agents for quality, coherence, and creativity. Reply ONLY with valid JSON. No markdown, no commentary, no code fences.';

const CRITERIA = {
  script: [
    'Story has a clear structure with episodes and segments',
    'Characters are visually distinctive with detailed appearance descriptions',
    'Settings are vivid and specific enough for image generation',
    'Story aligns with the user\'s input and genre',
  ],
  storyboard: [
    'Shots cover all segments from the script',
    'Shot prompts are detailed enough for image generation',
    'Camera angles and movements are varied and cinematic',
    'Shot durations create good pacing',
  ],
  characterDesign: [
    'Each character sheet shows the SAME character in front, back and side views with identical outfit, hairstyle and proportions',
    'Scene images are empty environment plates that match the written design spec and the chosen visual style',
    'Composition, lighting and detail are strong enough to anchor later shots',
    'Characters and scenes are clearly distinguishable from one another (no homogenization)',
  ],
  referenceImages: [
    'The frame set matches the chosen video mode (first frames only, first + last frames, or reference images) with no missing shot',
    'Character and location identity carries over from the step-2 design images (face, hairstyle, outfit, colors, environment)',
    'Each frame faithfully reflects its shot prompt (subject, action, framing) at video-input quality',
    'Consecutive frames read as one continuous action without jumps or near-duplicates',
  ],
  videoGeneration: [
    'Motion is natural and coherent across sampled frames (no warping/morphing)',
    'Subject and scene remain consistent with the reference image over time',
    'Camera movement matches the shot intent (pan/tilt/zoom/static, etc.)',
    'Visual quality and temporal stability are acceptable for the final edit',
  ],
  postProduction: [
    'The final video plays through coherently across the sampled frames',
    'Cut order and pacing follow the storyboard narrative',
    'Visual consistency is maintained across clips',
    'No obvious rendering artifacts, black frames, or broken segments',
  ],
};

export const SCORE_THRESHOLD = 7;

const MULTIMODAL_STEPS = new Set(['characterDesign', 'referenceImages', 'videoGeneration', 'postProduction']);

function buildCritiqueMessages(stepId, data, context) {
  const criteria = CRITERIA[stepId] || CRITERIA.script;
  const dataStr = typeof data === 'string' ? data : JSON.stringify(data, null, 2);

  let contextStr = '';
  if (context.script?.title) {
    contextStr += `\nSCRIPT: "${context.script.title}" (${context.script.genre})`;
  }
  if (context.storyboard?.episodes) {
    const shotCount = context.storyboard.episodes.reduce((n, ep) =>
      n + (ep.segments || []).reduce((m, seg) => m + (seg.shots?.length || 0), 0), 0);
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
- suggestions: 1-3 actionable improvements (only if score < 8)` },
  ];
}

function truncate(s, n) {
  const str = String(s || '');
  return str.length > n ? `${str.slice(0, n)}…` : str;
}

function mediaDigest(stepId, data) {
  if (stepId === 'characterDesign') {
    const chars = data?.characters || [];
    const sets = data?.settings || [];
    const lines = chars.map(c => `- character "${c.name}": ${truncate(c.visualTag || c.appearance || c.desc, 120)} ${c.sheetPath || c.sheetUrl ? '[three-view sheet]' : '[NO sheet]'} ${c.imagePath || c.imageUrl ? '[front portrait]' : '[NO front portrait]'}`);
    lines.push(...sets.map(s => `- setting "${s.name}": ${truncate(s.visualTag || s.desc, 120)} ${s.imagePath || s.imageUrl ? '[has image]' : '[NO image]'}`));
    return `CHARACTER/SETTING DESIGNS (${chars.length} characters, ${sets.length} settings):\n${lines.join('\n')}`;
  }
  if (stepId === 'referenceImages') {
    const shots = data?.shots || [];
    const extras = data?.extraFrames || [];
    const complete = shots.filter(s => s.status === 'complete' || s.imagePath).length;
    const lines = shots.map((s, i) => `- shot ${s.shot_id || i}: [${s.status}] role=${s.role || 'first_frame'} lastFrame=${s.lastFrameFrom || '-'} ${truncate(s.prompt, 120)}`);
    lines.push(...extras.map(f => `- extra frame ${f.shot_id || ''}: [${f.status}] role=${f.role || 'last_frame'} ${truncate(f.prompt, 120)}`));
    return `FRAMES (mode=${data?.mode || 'firstFrame'}, ${complete}/${shots.length} shot frames, ${extras.length} extra closing frame(s)):\n${lines.join('\n')}`;
  }
  if (stepId === 'videoGeneration') {
    const clips = data?.clips || [];
    const complete = clips.filter(c => c.status === 'complete').length;
    const failed = clips.filter(c => c.status === 'failed').length;
    const skipped = clips.filter(c => c.status === 'skipped').length;
    return `VIDEO CLIPS (mode=${data?.mode || 'firstFrame'}, ${complete} complete, ${failed} failed, ${skipped} skipped of ${clips.length}); frames sampled from up to 3 completed clips are attached.`;
  }
  if (stepId === 'postProduction') {
    return `FINAL VIDEO: ${data?.finalVideo ? 'produced' : 'MISSING'}; frames sampled from the final render are attached.`;
  }
  return '';
}

// Returns multimodal messages, or null when no visual media could be attached
// (so the caller falls back to the structural score instead of a fake visual critique).
async function buildMediaCritiqueMessages(stepId, data, context) {
  const criteria = CRITERIA[stepId] || CRITERIA.characterDesign;
  const anchors = stepId === 'referenceImages' && context?.characterDesign
    ? await imageParts(context.characterDesign, 'characterDesign', { maxImages: 2 })
    : [];
  const generated = (stepId === 'videoGeneration' || stepId === 'postProduction')
    ? await videoParts(data, stepId)
    : await imageParts(data, stepId, { maxImages: 6 - anchors.length });
  const parts = [...anchors, ...generated];
  if (!parts.length) return null;

  const anchorNote = anchors.length
    ? `\n\nThe FIRST ${anchors.length} attached image${anchors.length === 1 ? '' : 's'} are the approved character / scene designs — treat them as the identity anchor. Every image after them is this step's output.`
    : '';

  const text = `Evaluate the following ${stepId} visual output for a short film production. The attached image${parts.length === 1 ? '' : 's'} (for video stages, frames sampled over time) are the ACTUAL generated output — judge their real visual quality, not just the text below.${anchorNote}

RATE ON THESE CRITERIA (1-10 each):
${criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

TEXTUAL SUMMARY (context only):
${mediaDigest(stepId, data)}

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
- suggestions: 1-3 actionable improvements (only if score < 8)`;

  return [
    { role: 'system', content: CRITIQUE_SYSTEM },
    { role: 'user', content: [{ type: 'text', text }, ...parts] },
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

function structuralScoreOf(verdict) {
  return verdict === QCVerdict.PASS ? 10 : verdict === QCVerdict.CONDITIONAL_PASS ? 7 : 5;
}

// Unified QC decision: the deterministic consistency check is a HARD GATE, and the
// final score is the LOWER of the LLM score and the structural score. This removes the
// "LLM says 8.2 pass but consistency is FAIL" dual-truth problem.
function combineVerdict(consistency, llm) {
  const structuralScore = structuralScoreOf(consistency.verdict);
  const llmScore = llm?.score ?? null;
  const score = llmScore != null ? Math.min(llmScore, structuralScore) : structuralScore;

  let verdict;
  if (consistency.verdict === QCVerdict.FAIL) {
    verdict = QCVerdict.FAIL;
  } else if (consistency.verdict === QCVerdict.CONDITIONAL_PASS) {
    verdict = QCVerdict.CONDITIONAL_PASS;
  } else {
    verdict = llmScore != null
      ? (llmScore >= SCORE_THRESHOLD ? QCVerdict.PASS : QCVerdict.CONDITIONAL_PASS)
      : QCVerdict.PASS;
  }

  let severity;
  if (consistency.verdict !== QCVerdict.PASS) {
    severity = consistency.severity ?? (verdict === QCVerdict.FAIL ? Severity.HIGH : Severity.MEDIUM);
  } else {
    severity = score >= SCORE_THRESHOLD ? null : score >= 5 ? Severity.MEDIUM : Severity.HIGH;
  }

  const issues = [...(consistency.issues || []), ...(llm?.issues || [])];
  const suggestions = llm?.suggestions || [];
  const source = llmScore != null
    ? (consistency.verdict !== QCVerdict.PASS ? 'llm+structural' : 'llm')
    : 'structural';

  return { score, verdict, severity, issues, suggestions, source, consistency, llm };
}

export class QCAgent {
  constructor({ stepId }) {
    this.name = 'QCAgent';
    this.stepId = stepId;
  }

  async process(ctx) {
    const consistency = checkConsistency(this.stepId, ctx.data, ctx.entities || {});
    const llm = await this.#runLLM(ctx);
    const isMultimodal = MULTIMODAL_STEPS.has(this.stepId);

    // Text steps keep their existing semantics: no LLM critique → no score → null.
    if (!isMultimodal && !llm) return null;

    // Media steps always yield at least the deterministic structural result.
    return combineVerdict(consistency, llm);
  }

  async #runLLM(ctx) {
    const provider = getActiveProvider('text');
    if (!provider) return null;

    const messages = MULTIMODAL_STEPS.has(this.stepId)
      ? await buildMediaCritiqueMessages(this.stepId, ctx.data, ctx)
      : buildCritiqueMessages(this.stepId, ctx.data, ctx);
    if (!messages) return null;

    let raw;
    try {
      raw = await chat(messages);
    } catch {
      return null;
    }

    const parsed = parseCritiqueResponse(raw);
    if (!parsed || typeof parsed.overallScore !== 'number') return null;

    return {
      score: Math.round(parsed.overallScore * 10) / 10,
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
    };
  }
}

export function reportScore(score, agentIcon) {
  const scoreColor = score >= 8 ? '#00e5a0' : score >= 7 ? 'var(--gold)' : 'var(--rose)';
  const scoreText = t('critique.scoreDisplay', { score: score.toFixed(1) });
  addAgentMessage(agentIcon, `<span style="color:${scoreColor}">${scoreText}</span>`);
  updateStepMetrics({ qualityScore: score });
}

export function reportRetry(score, retryNum, maxRetries, agentIcon) {
  addAgentMessage(agentIcon, t('critique.retrying', { score: score.toFixed(1), retry: retryNum, max: maxRetries }));
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
