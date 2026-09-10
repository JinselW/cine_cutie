import { BaseAgent } from './baseAgent.js';
import { QCAgent, SCORE_THRESHOLD } from './qcAgent.js';
import { chat, parseJson, getConfig, peekTokenUsage, HEAVY_TEXT_TIMEOUT_MS } from '../providers/llm.js';
import { createArtifact, ArtifactKind, ArtifactStatus } from '../artifacts/artifactTypes.js';
import { compilePromptPackage } from '../prompts/promptCompiler.js';
import { validatePromptPackage } from '../prompts/promptSchema.js';
import { adaptPromptSpec } from '../prompts/providerAdapters.js';
import { escapeHtml } from '../utils.js';
import { addAgentMessage } from '../ui/render.js';
import { t } from '../i18n.js';

// This envelope is a formal nested artifact: it never enters adoptedByStep.
const safeContext = ctx => JSON.parse(JSON.stringify({ script: ctx.script, storyboard: ctx.storyboard,
  characterDesign: ctx.characterDesign, genre: ctx.genre, lang: ctx.lang, promptDoc: ctx.promptDoc, feedback: ctx.feedback }, (key, value) =>
  /path|url|apiKey/i.test(key) ? undefined : value));
// Provider and model choices never change what a prompt says, so they are excluded:
// switching a model must not invalidate an already adopted package.
export function promptFingerprint(ctx, config = {}) {
  return JSON.stringify({ sources: ['script', 'characterDesign', 'storyboard'].map(k => ctx.sourceArtifactIds?.[k] || null),
    context: safeContext({ ...ctx, feedback: undefined }), videoMode: config.videoMode, language: ctx.language });
}

// Prompt QC is a real gate. Keep "unavailable" distinct in provenance so an outage
// is diagnosable, but never mark an unevaluated or failed package as adopted.
export function promptQcGate(qc) {
  if (!qc || qc.score == null || qc.source === 'unavailable') return 'unavailable';
  if (qc.verdict === 'FAIL' || qc.score < SCORE_THRESHOLD || qc.feedbackSatisfied === false) return 'blocked';
  return 'passed';
}

function qcLogLine(gate, qc, version) {
  const issues = (qc?.issues || []).join('; ');
  if (gate === 'blocked') return t('promptAgent.qcBlocked', { issues });
  if (gate === 'unavailable') return t('promptAgent.qcUnavailable', { issues: issues || t('ui.unknown') });
  return t('promptAgent.qcPassed', { score: qc.score, version });
}

function apiErrorText(error) {
  return [error?.i18nKey || error?.message || 'unknown error', error?.detail].filter(Boolean).join(': ');
}

const DEGRADATION_KEYS = {
  'Image provider item contract does not support negative prompt': 'promptAgent.degradeImageNegative',
  'Provider item contract does not support negative prompt': 'promptAgent.degradeVideoNegative',
  'Provider does not support generated audio': 'promptAgent.degradeAudio',
};

// Degradations stay stored verbatim for QC provenance; only the feed is localized, and an
// unrecognized reason falls through so a new adapter can never hide a limitation.
export function describeDegradation(reason) {
  const text = String(reason || '');
  const fallback = text.match(/^Mode fallback: (.+) → (.+)$/);
  if (fallback) {
    return t('promptAgent.degradeMode', {
      from: t(`settings.videoMode.${fallback[1]}`), to: t(`settings.videoMode.${fallback[2]}`),
    });
  }
  const key = DEGRADATION_KEYS[text];
  return key ? t(key) : text;
}

const MAX_REJECTED_REVISIONS = 3;

// A blocked revision must stay addressable and must never hand its version out twice, so
// the parent envelope keeps the highest rejected version plus the last few records.
function recordRejection(parent, rejected) {
  parent.nextVersion = Math.max(parent.nextVersion || 0, rejected.version);
  parent.rejectedRevisions = [...(parent.rejectedRevisions || []), rejected].slice(-MAX_REJECTED_REVISIONS);
  return rejected;
}
export class PromptAgent extends BaseAgent {
  constructor({ qcAgent = new QCAgent({ stepId: 'promptPackage' }), generate = chat, config = getConfig,
    log = (message, tone = null) => addAgentMessage('✍️', escapeHtml(message), { key: 'prompt-status', tone }) } = {}) {
    super({ name: 'Prompt Engineer', stepId: null });
    this.qcAgent = qcAgent; this.generate = generate; this.config = config;
    this.rawLog = log;
    // One card per step: every status line carries the capability limits seen so far, so the
    // notice can never stack next to — or be mistaken for — the review result it explains.
    this.log = (message, tone = null) => {
      this.lastStatus = { message, tone };
      this.rawLog(this.#withNotes(message), tone);
    };
    this.capabilityNotes = [];
    this.lastStatus = null;
  }
  #withNotes(message) {
    const notes = this.capabilityNotes.join('；');
    if (!notes) return message;
    const label = t('promptAgent.capabilityNotes', { notes });
    return message ? `${message}\n${label}` : label;
  }
  #noteCapability(reasons) {
    const fresh = reasons.filter(reason => !this.capabilityNotes.includes(reason));
    if (!fresh.length) return;
    this.capabilityNotes.push(...fresh);
    this.rawLog(this.lastStatus ? this.#withNotes(this.lastStatus.message) : this.#withNotes(''), this.lastStatus?.tone);
  }
  compatible(envelope, ctx) {
    return envelope?.adoptionStatus === 'adopted' && envelope.fingerprint === promptFingerprint(ctx, this.config())
      && validatePromptPackage(envelope.data, ctx).valid;
  }
  async run(ctx, token) {
    const envelope = await this.prepareShotPrompts({ ...ctx, signal: token?.signal });
    return { artifacts: [], metadata: { promptPackage: envelope } };
  }
  async prepareShotPrompts(ctx) {
    const old = ctx.promptPackage || ctx.referenceImages?.promptPackage;
    if (!ctx.feedback && this.compatible(old, ctx)) {
      this.log(t('promptAgent.usingPackage', { version: old.version }));
      return structuredClone(old);
    }
    const template = compilePromptPackage(ctx, null, this.config(), { legacy: true });
    this.log(t('promptAgent.preparing', { count: template.shots.length }));
    const before = peekTokenUsage();
    let response;
    try {
      response = await this.generate([{ role: 'system', content: 'You are the film Prompt Engineer. Return JSON with shots matching the provided template exactly. Create coherent opening/closing frames, visual, motion and audio prompts. Preserve IDs, durations, identity and continuity. Choose shot modes when videoMode is auto. Never include media paths. Respect user feedback; avoid IP, logos, watermarks and contradictory descriptions.' },
        { role: 'user', content: JSON.stringify({ context: safeContext(ctx), template }) }], { signal: ctx.signal, timeoutMs: HEAVY_TEXT_TIMEOUT_MS });
    } catch (error) {
      const usage = { prompt: peekTokenUsage().prompt - before.prompt, completion: peekTokenUsage().completion - before.completion };
      const reason = apiErrorText(error);
      const qc = { score: null, verdict: 'FAIL', source: 'generation', issues: [reason], suggestions: [] };
      const rejected = this.envelope(ctx, { schemaVersion: 1, shots: [] }, old, 'prepare', null, qc, usage, 'unavailable');
      if (old) recordRejection(old, rejected);
      error.promptPackage = rejected;
      this.log(t('promptAgent.prepareFailed', { reason }), 'danger');
      throw error;
    }
    const usage = { prompt: peekTokenUsage().prompt - before.prompt, completion: peekTokenUsage().completion - before.completion };
    let pkg;
    try {
      const draft = typeof response === 'string' ? parseJson(response) : response;
      pkg = compilePromptPackage(ctx, draft, this.config());
    } catch (error) {
      const qc = { score: null, verdict: 'FAIL', source: 'structural', issues: [error.message] };
      error.promptPackage = this.envelope(ctx, { schemaVersion: 1, shots: [] }, old, 'prepare', null, qc, usage, 'blocked');
      if (old) recordRejection(old, error.promptPackage);
      this.log(qcLogLine('blocked', qc), 'danger');
      throw error;
    }
    return this.save(ctx, pkg, old, 'prepare', null, usage);
  }
  migrateLegacy(ctx) {
    const pkg = compilePromptPackage(ctx, null, this.config(), { legacy: true });
    this.log(t('promptAgent.legacyMigrated'));
    return this.envelope(ctx, pkg, null, 'legacy', null, { score: null, source: 'structural-legacy' });
  }
  async reviseShotPrompt(ctx) {
    const old = ctx.promptPackage;
    if (!old || !validatePromptPackage(old.data, ctx).valid) throw new Error('Cannot revise invalid PromptPackage');
    const target = old.data.shots.find(s => s.shotId === ctx.shotId);
    if (!target) throw new Error(`Unknown shot: ${ctx.shotId}`);
    this.log(t('promptAgent.rewriteRequested', { shot: ctx.shotId }));
    const before = peekTokenUsage();
    let response;
    try {
      response = await this.generate([{ role: 'system', content: 'Revise ONLY this shot prompt spec. Return the complete shot as JSON. Preserve shotId, duration, mode and bindings. Correct the reported failure without changing adjacent shots. No media paths.' },
        { role: 'user', content: JSON.stringify({ shot: target, reason: ctx.reason, feedback: ctx.feedback, adjacentShots: old.data.shots.filter((s, i, a) => a[i - 1]?.shotId === target.shotId || a[i + 1]?.shotId === target.shotId), characterDesign: safeContext(ctx).characterDesign }) }], { signal: ctx.signal, timeoutMs: HEAVY_TEXT_TIMEOUT_MS });
    } catch (error) {
      const usage = { prompt: peekTokenUsage().prompt - before.prompt, completion: peekTokenUsage().completion - before.completion };
      const reason = apiErrorText(error);
      const qc = { score: null, verdict: 'FAIL', source: 'generation', issues: [reason], suggestions: [] };
      const rejected = this.envelope(ctx, structuredClone(old.data), old, 'revise', ctx.shotId, qc, usage, 'unavailable');
      recordRejection(old, rejected);
      error.promptPackage = rejected;
      this.log(t('promptAgent.reviseFailed', { shot: ctx.shotId, reason }), 'danger');
      throw error;
    }
    const usage = { prompt: peekTokenUsage().prompt - before.prompt, completion: peekTokenUsage().completion - before.completion };
    const index = old.data.shots.findIndex(s => s.shotId === target.shotId);
    let compiled;
    try {
      const revised = typeof response === 'string' ? parseJson(response) : response;
      if (revised?.shotId !== target.shotId) throw new Error('Revision changed shot ID');
      const draft = structuredClone(old.data);
      draft.shots[index] = { ...revised, shotId: target.shotId, duration: target.duration, mode: target.mode, bindings: target.bindings };
      compiled = compilePromptPackage(ctx, draft, { ...this.config(), videoMode: 'auto' });
    } catch (error) {
      const qc = { score: null, verdict: 'FAIL', source: 'structural', issues: [error.message], suggestions: [] };
      const rejected = this.envelope(ctx, structuredClone(old.data), old, 'revise', ctx.shotId, qc, usage, 'blocked');
      recordRejection(old, rejected);
      error.promptPackage = rejected;
      this.log(qcLogLine('blocked', qc), 'danger');
      throw error;
    }
    // Compilation of a revision must never alter other shots or global policy.
    const pkg = structuredClone(old.data);
    pkg.shots[index] = compiled.shots[index];
    // Existing input frames remain the instruction source during video retries.
    if (ctx.triggeredBy === 'VideoAgent') pkg.shots[index].image = structuredClone(target.image);
    const result = await this.save(ctx, pkg, old, 'revise', ctx.shotId, usage);
    this.log(t('promptAgent.revised', { shot: ctx.shotId, version: result.version, score: result.provenance.qc?.score }));
    return result;
  }
  async save(ctx, pkg, old, operation, shotId, usage) {
    const check = validatePromptPackage(pkg, ctx);
    if (check.valid) this.log(t('promptAgent.qcReviewing'));
    const qc = check.valid ? await this.qcAgent.process({ ...ctx, data: pkg })
      : { score: null, verdict: 'FAIL', source: 'structural', issues: check.errors, suggestions: [] };
    const gate = check.valid ? promptQcGate(qc) : 'blocked';
    const result = this.envelope(ctx, pkg, old, operation, shotId, qc, usage, gate);
    this.log(qcLogLine(gate, qc, result.version), gate === 'passed' ? null : 'danger');
    if (gate !== 'passed') {
      if (old) recordRejection(old, result);
      const issues = qc?.issues || (gate === 'unavailable' ? ['Prompt QC unavailable'] : []);
      const error = new Error('Prompt QC rejected package: ' + issues.join('; '));
      error.promptPackage = result; throw error;
    }
    return result;
  }
  envelope(ctx, pkg, old, operation, shotId, qc, usage = null, gate = null) {
    const adoption = gate || (operation === 'legacy' ? 'legacy' : promptQcGate(qc));
    const result = createArtifact({ kind: ArtifactKind.PROMPT_PACKAGE, stepId: 'referenceImages', data: pkg,
      status: operation === 'legacy' || adoption === 'passed' ? ArtifactStatus.COMPLETE : ArtifactStatus.FAILED, sourceArtifactIds: ['script', 'characterDesign', 'storyboard'].map(k => ctx.sourceArtifactIds?.[k]).filter(Boolean), parentArtifactId: old?.id });
    return { ...result, scope: 'auxiliary', artifactKey: 'promptPackage', version: Math.max(old?.version || 0, old?.nextVersion || 0) + 1,
      rootArtifactId: old?.rootArtifactId || old?.id || result.id,
      fingerprint: promptFingerprint(ctx, this.config()), adoptionStatus: operation === 'legacy' || adoption === 'passed' ? 'adopted' : 'rejected',
      provenance: { upstreamArtifactIds: Object.fromEntries(['script', 'characterDesign', 'storyboard'].map(k => [k, ctx.sourceArtifactIds?.[k] || null])), agent: this.name, operation, triggeredBy: ctx.triggeredBy || 'ReferenceAgent', reason: ctx.reason || ctx.feedback || 'Missing or incompatible package', shotIds: shotId ? [shotId] : pkg.shots.map(s => s.shotId), model: operation === 'legacy' ? null : this.config().models?.text, tokens: usage, qcGate: adoption, qc },
      history: old ? [...(old.history || []), { ...structuredClone(old), history: undefined }] : [], adaptations: [] };
  }
  adaptForProvider({ promptPackage, shotId, provider, executedMode, capabilities, media, frameRole, triggeredBy = 'VideoAgent' }) {
    const spec = promptPackage.data.shots.find(s => s.shotId === shotId);
    if (!spec) throw new Error(`Unknown shot: ${shotId}`);
    const request = adaptPromptSpec(spec, { provider, executedMode, capabilities, media, frameRole });
    const target = media || 'video';
    // Keyed by what the adapter produced, so re-adapting an unchanged spec is not recorded
    // or reported twice, while a new mode or prompt still appends a fresh record.
    const key = [shotId, provider || null, target, frameRole || null, JSON.stringify(request)].join('\u0000');
    if (promptPackage.adaptations.some(adaptation => adaptation.key === key)) return request;
    const notified = new Set(promptPackage.adaptations.flatMap(adaptation => (adaptation.degradations || []).map(degradation => `${adaptation.provider}|${adaptation.media}|${degradation}`)));
    promptPackage.adaptations.push({ key, operation: 'adapt', agent: this.name, triggeredBy, shotId, provider, media: target, frameRole, tokens: { prompt: 0, completion: 0 }, timestamp: Date.now(), ...request });
    const fresh = request.degradations.filter(degradation => !notified.has(`${provider}|${target}|${degradation}`));
    this.#noteCapability(fresh.map(describeDegradation));
    return request;
  }
}
