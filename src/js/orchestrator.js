import { STEPS, dataKeyOf, producerStepOfDataKey } from './config.js';
import { configureMemory, beginMemory, attachMemory, saveMemory, recordMemoryMessage } from './memory.js';
import { state, resetState } from './state.js';
import { t } from './i18n.js';
import {
  updatePipeline, showGenerating, addAgentMessage, setGenAnim,
  clearCurrentMessages, waitForResume, getGenAnim, setPipelineControls, showPipelineFailure,
} from './ui/render.js';
import {
  renderScript, renderCharacterDesign, renderStoryboard,
  renderReferenceImages, renderVideoGeneration, renderPostProduction,
  cancelAutoAdvance, scheduleAutoAdvance, setPendingAdvance, clearPendingAdvance,
} from './ui/views.js';
import { showCompletion } from './navigation.js';
import { sleep } from './utils.js';
import { isConfigured } from './providers/llm.js';
import { resetLog, logStepStart, logStepComplete, initObservability } from './observability.js';
import { ScriptAgent } from './agents/scriptAgent.js';
import { StoryboardAgent } from './agents/storyboardAgent.js';
import { CharacterAgent } from './agents/characterAgent.js';
import { ReferenceAgent } from './agents/referenceAgent.js';
import { VideoAgent } from './agents/videoAgent.js';
import { EditorAgent } from './agents/editorAgent.js';
import { getIPComplianceAgent } from './agents/ipComplianceAgent.js';
import { ArtifactStore } from './artifacts/artifactStore.js';
import { ArtifactStatus, StaleReasonCode, createArtifact } from './artifacts/artifactTypes.js';
import { extractEntities, mergeEntities, buildConsistencyConstraints, checkConsistency } from './agents/qcConsistency.js';
import { QCVerdict, Severity } from './agents/qcTypes.js';
import { validateScript } from './agents/scriptAgent.js';
import { validateStoryboard } from './agents/storyboardAgent.js';
import { ExecutionCheckpoint } from './orchestrator/executionCheckpoint.js';
import { RunState } from './orchestrator/runState.js';
import { CancellationToken } from './orchestrator/cancellationToken.js';
import { registerAgent, resolveAgent } from './orchestrator/agentRegistry.js';
import {
  buildWorkflowSnapshot, clearPersistedWorkflow, loadPersistedWorkflow, persistWorkflowSnapshot,
} from './orchestrator/workflowSnapshot.js';
import { cancelAllBackendTasks } from './providers/activeTasks.js';
import { finishStage } from './progressTracker.js';

const RENDERERS = {
  script: (r, cb) => renderScript(r, cb),
  characterDesign: (r, cb) => renderCharacterDesign(r, cb),
  storyboard: (r, cb) => renderStoryboard(r, cb),
  referenceImages: (r, cb) => renderReferenceImages(r, cb),
  videoGeneration: (r, cb) => renderVideoGeneration(r, cb),
  postProduction: (r, cb) => renderPostProduction(r, cb),
};

const POST_VALIDATORS = {
  script: validateScript,
  storyboard: validateStoryboard,
  characterDesign: (d) => d && (Array.isArray(d.characters) || Array.isArray(d.settings)),
  referenceImages: (d) => d && Array.isArray(d.shots),
  videoGeneration: (d) => d && Array.isArray(d.clips),
  postProduction: (d) => d && typeof d === 'object' && 'finalVideo' in d,
};

// A historical version can be adopted again even though it is no longer current.
const ROLLBACKABLE_STATUSES = [ArtifactStatus.COMPLETE, ArtifactStatus.SUPERSEDED, ArtifactStatus.STALE];
const DEFAULT_ROLLBACK_STATUSES = [ArtifactStatus.COMPLETE, ArtifactStatus.SUPERSEDED];
const MAX_IP_REGENERATIONS = 2;

class StageGateError extends Error {
  constructor(gate) {
    super(gate.issues.join('; '));
    this.issues = gate.issues;
  }
}

// Running a step without an adopted upstream version would produce an artifact
// whose dependencies cannot be recorded, so the step is refused instead.
class MissingUpstreamError extends StageGateError {
  constructor(stepId, missingKeys) {
    super({ issues: [t('pipeline.missingUpstream', { stepId, dataKeys: missingKeys.join(', ') })] });
    this.name = 'MissingUpstreamError';
    this.stepId = stepId;
    this.missingKeys = missingKeys;
  }
}

function mergeSourceIds(agentSourceIds, ctx) {
  const ids = [...(agentSourceIds ?? [])];
  for (const id of Object.values(ctx?.sourceArtifactIds ?? {})) {
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

function stepIndexOf(stepId) {
  return STEPS.findIndex(step => step.id === stepId);
}

class Orchestrator {
  #store = new ArtifactStore();
  #checkpoint = new ExecutionCheckpoint();
  #runState = new RunState();
  #token = null;

  constructor() {
    registerAgent('script', new ScriptAgent());
    registerAgent('storyboard', new StoryboardAgent());
    registerAgent('characterDesign', new CharacterAgent());
    registerAgent('referenceImages', new ReferenceAgent());
    registerAgent('videoGeneration', new VideoAgent());
    registerAgent('postProduction', new EditorAgent());
    initObservability(this.#store);
    configureMemory(() => ({
      artifacts: this.#store.snapshot(),
      acceptedByStep: this.#store.snapshotAccepted(),
      checkpoint: this.#checkpoint.snapshot(),
      runState: this.#runState.snapshot(),
    }));
  }

  get artifactStore() {
    return this.#store;
  }

  get checkpoint() {
    return this.#checkpoint;
  }

  get runState() {
    return this.#runState;
  }

  async startPipeline() {
    state.currentStep = -1;
    state.viewingStep = null;
    state.stopped = false;
    state.paused = false;
    this.#store.clear();
    this.#checkpoint.clear();
    clearPersistedWorkflow();
    this.#runState.startPipeline();
    this.#token = new CancellationToken();
    resetLog();
    for (const key of Object.keys(state.data)) state.data[key] = null;
    state.entities = {};
    await beginMemory();
    try { await this.#advanceStep(); }
    catch (error) {
      recordMemoryMessage('system', error.message);
      await saveMemory('failed');
      throw error;
    }
  }

  async #advanceStep() {
    cancelAutoAdvance();
    clearPendingAdvance();
    if (state.stopped) return;
    state.currentStep++;
    if (state.currentStep >= STEPS.length) {
      state.viewingStep = null;
      this.#runState.markCompleted();
      this.#persistWorkflow();
      await saveMemory('completed');
      showCompletion();
      return;
    }
    this.#runState.enterStep(state.currentStep, STEPS[state.currentStep].id);
    await this.#executeStage(STEPS[state.currentStep]);
  }

  async #executeStage(step) {
    clearCurrentMessages();
    updatePipeline(state.currentStep, 'active');
    showGenerating(state.currentStep);
    state.stepRunning = true;

    const delay = isConfigured() ? 0 : (3000 + Math.random() * 2000);
    let data;
    try {
      [data] = await Promise.all([
        this.#runAgentStep(step),
        sleep(delay),
      ]);
    } catch (err) {
      if (err instanceof StageGateError) {
        await this.#failStage(step, err);
        return;
      }
      if (!state.stopped) {
        recordMemoryMessage('system', err.message, step.id);
        await saveMemory('failed');
        throw err;
      }
      this.#runState.markInterrupted();
      this.#persistWorkflow();
      return;
    }

    await waitForResume();
    if (state.stopped) {
      this.#runState.markInterrupted();
      this.#persistWorkflow();
      return;
    }

    finishStage();
    const currentAnim = getGenAnim();
    if (currentAnim) currentAnim.stop();
    setGenAnim(null);
    state.stepRunning = false;

    updatePipeline(state.currentStep, 'done');
    this.#persistWorkflow();

    await saveMemory('running');

    const onAdvance = () => this.#advanceStep();
    setPendingAdvance(onAdvance);

    if (state.viewingStep !== null) {
      if (state.mode === 'auto') {
        scheduleAutoAdvance(2000, onAdvance);
      }
      return;
    }

    this.#renderStep(step.id, data, onAdvance);
  }

  // Generation and revision share one path: build context from adopted upstream
  // versions, run the agent, gate the output, then adopt or reject it atomically.
  async #runAgentStep(step, feedback = null) {
    const agent = resolveAgent(step.id);
    const agentName = step.agent || 'Agent';
    logStepStart(step.id, agentName);

    try {
      const ctx = this.#buildContext(step);
      if (feedback != null) {
        ctx.feedback = feedback;
        ctx.previousResult = this.#store.getAcceptedByStep(step.id)?.data ?? null;
      }

      for (let ipAttempt = 0; ; ipAttempt++) {
        const result = await agent.process(ctx, this.#token);
        await this.#token.throwIfCancelled();
        const artifact = result.artifacts?.[0] ?? null;
        const data = artifact?.data ?? null;
        const metadata = result.metadata ?? {};
        let gateResult = this.#postGate(step.id, data, metadata, artifact?.status, {
          feedbackRequired: Boolean(ctx.feedback?.trim?.()),
        });
        const retryIp = gateResult.requiresRegeneration === true && ipAttempt < MAX_IP_REGENERATIONS;

        if (retryIp) {
          this.#commitResult(step, artifact, { gateResult, metadata, agentName, revision: true, ctx });
          addAgentMessage('🔄', t('pipeline.ipRegenerating', { current: ipAttempt + 1, max: MAX_IP_REGENERATIONS }));
          ctx.feedback = [ctx.feedback, gateResult.regenerationPrompt]
            .filter(Boolean)
            .join('\n\nADDITIONAL REQUIRED CORRECTION:\n');
          ctx.previousResult = data;
          continue;
        }

        // Generated text must not kill an otherwise viable movie run. If the
        // producing agent cannot remove the reference after bounded rewrites,
        // retain a prominent warning and let the user revise that step later.
        if (gateResult.requiresRegeneration === true) {
          gateResult = {
            ...gateResult,
            verdict: QCVerdict.CONDITIONAL_PASS,
            severity: Severity.HIGH,
            issues: gateResult.issues.map(issue => `${issue} (${t('pipeline.ipRetryExhausted')})`),
            requiresRegeneration: false,
          };
          addAgentMessage('⚠️', t('pipeline.ipRetryExhausted'));
        }

        metadata.retries = (metadata.retries ?? 0) + ipAttempt;
        this.#commitResult(step, artifact, { gateResult, metadata, agentName, revision: feedback != null || ipAttempt > 0, ctx });

        if (gateResult.verdict === QCVerdict.FAIL) throw new StageGateError(gateResult);
        return data;
      }
    } finally {
      logStepComplete();
    }
  }

  // Adopts a generated artifact or records it as failed. Only adoption supersedes
  // the previous version, invalidates downstream steps and moves the checkpoint.
  #commitResult(step, artifact, { gateResult, metadata, agentName, revision, ctx }) {
    if (!artifact) return null;
    const stepIndex = stepIndexOf(step.id);
    const failed = gateResult.verdict === QCVerdict.FAIL;

    artifact.status = failed ? ArtifactStatus.FAILED : ArtifactStatus.COMPLETE;
    artifact.metrics = {
      tokens: metadata.tokens || { prompt: 0, completion: 0 },
      qualityScore: metadata.qualityScore ?? null,
      retries: metadata.retries ?? 0,
      fallbackUsed: metadata.fallbackUsed ?? false,
    };
    artifact.sourceArtifactIds = mergeSourceIds(artifact.sourceArtifactIds, ctx);
    artifact.parentArtifactId = artifact.parentArtifactId ?? this.#store.lineageHeadId(step.id);
    this.#store.commit(artifact, { provenance: { agent: agentName, revision } });

    if (failed) {
      this.#persistWorkflow();
      return { accepted: false, artifact, staleStepIds: [] };
    }

    const change = this.#store.replaceAcceptedArtifact(artifact.id);
    state.data[dataKeyOf(step)] = artifact.data;
    this.#rebuildEntities();
    this.#checkpoint.save(step.id, { stepIndex, acceptedArtifactId: artifact.id });
    this.#runState.completeStep(step.id);
    const staleStepIds = this.#invalidateStaleSteps(change?.staleArtifactIds ?? []);
    this.#persistWorkflow();

    return { accepted: true, artifact, change, staleStepIds };
  }

  #buildContext(step) {
    const ctx = {
      userInput: state.userInput,
      promptDoc: state.promptDoc?.text || '',
      genre: state.genre,
      totalDuration: state.totalDuration,
      constraints: buildConsistencyConstraints(state.entities),
      entities: state.entities || {},
      sourceArtifactIds: {},
    };

    const missing = [];
    for (const dataKey of step.contextKeys || []) {
      const artifact = this.#store.getAcceptedByStep(producerStepOfDataKey(dataKey));
      if (!artifact) {
        missing.push(dataKey);
        continue;
      }
      ctx[dataKey] = artifact.data;
      ctx.sourceArtifactIds[dataKey] = artifact.id;
    }
    if (missing.length > 0) throw new MissingUpstreamError(step.id, missing);

    return ctx;
  }

  // Steps that consumed the replaced version stop being valid results: their data,
  // checkpoint and completed flag are dropped so they cannot be shown or resumed.
  #invalidateStaleSteps(staleArtifactIds) {
    const staleStepIds = [...new Set(
      staleArtifactIds.map(id => this.#store.get(id)?.stepId).filter(Boolean),
    )];
    if (staleStepIds.length === 0) return [];

    for (const stepId of staleStepIds) {
      const step = STEPS.find(candidate => candidate.id === stepId);
      if (!step) continue;
      state.data[dataKeyOf(step)] = null;
      this.#checkpoint.clear(stepId);
      this.#runState.reopenStep(stepId);
    }

    const firstStaleIndex = Math.min(...staleStepIds.map(stepIndexOf));
    state.currentStep = firstStaleIndex - 1;
    if (state.viewingStep !== null && state.viewingStep > state.currentStep) state.viewingStep = null;

    this.#rebuildEntities();
    addAgentMessage('🔗', t('pipeline.downstreamInvalidated', {
      steps: staleStepIds.map(stepId => t(STEPS.find(candidate => candidate.id === stepId)?.labelKey || stepId)).join(', '),
    }));
    this.#refreshPipeline();
    return staleStepIds;
  }

  // Entities are always derived from the adopted versions so superseded or stale
  // outputs stop influencing consistency constraints.
  #rebuildEntities() {
    let entities = {};
    for (const step of STEPS) {
      const accepted = this.#store.getAcceptedByStep(step.id);
      if (!accepted) continue;
      const extracted = extractEntities(step.id, accepted.data);
      if (extracted) entities = mergeEntities(entities, extracted);
    }
    state.entities = entities;
  }

  #refreshPipeline() {
    if (state.currentStep < 0) return;
    const lastIndex = Math.min(state.currentStep, STEPS.length - 1);
    let doneUpTo = -1;
    for (let i = 0; i <= lastIndex; i++) {
      if (!this.#store.getAcceptedByStep(STEPS[i].id)) break;
      doneUpTo = i;
    }
    if (doneUpTo >= lastIndex) updatePipeline(state.currentStep, 'done');
    else updatePipeline(doneUpTo + 1, 'idle');
  }

  async #failStage(step, error) {
    cancelAutoAdvance();
    recordMemoryMessage('system', error.message, step.id);
    await this.stopPipeline('failed');
    const anim = getGenAnim();
    if (anim) anim.stop();
    setGenAnim(null);
    state.stepRunning = false;
    state.paused = false;
    state.viewingStep = null;
    updatePipeline(STEPS.findIndex(s => s.id === step.id), 'failed');
    showPipelineFailure(error.issues);
  }

  #postGate(stepId, data, metadata, artifactStatus, { feedbackRequired = false } = {}) {
    const validator = POST_VALIDATORS[stepId];
    if (validator && data != null) {
      const valid = validator(data);
      if (!valid) {
        addAgentMessage('⚠️', t('pipeline.postGateStructural', { stepId }));
        return { verdict: QCVerdict.FAIL, issues: [t('pipeline.structuralFailed')], severity: Severity.HIGH };
      }
    }

    if (data == null) {
      return { verdict: QCVerdict.FAIL, issues: [t('pipeline.noDataProduced')], severity: Severity.CRITICAL };
    }

    if (feedbackRequired && metadata.feedbackSatisfied !== true) {
      return {
        verdict: QCVerdict.FAIL,
        issues: [t('pipeline.feedbackNotSatisfied')],
        severity: Severity.HIGH,
      };
    }

    if (metadata.verdict === QCVerdict.FAIL || artifactStatus === ArtifactStatus.FAILED) {
      return {
        verdict: QCVerdict.FAIL,
        issues: metadata.consistencyIssues?.length ? metadata.consistencyIssues : [t('ui.stageOutputFailed')],
        severity: Severity.HIGH,
      };
    }

    const consistencyResult = checkConsistency(stepId, data, state.entities || {});

    if (consistencyResult.verdict === QCVerdict.FAIL) {
      addAgentMessage('⚠️', t('pipeline.consistencyFailed', { stepId, issues: consistencyResult.issues.join('; ') }));
    } else if (consistencyResult.verdict === QCVerdict.CONDITIONAL_PASS) {
      addAgentMessage('⚠️', t('pipeline.consistencyWarnings', { stepId, issues: consistencyResult.issues.join('; ') }));
    }

    // IP is checked at the prompt boundary and once more on the generated
    // script. Later production stages are evaluated for output quality only;
    // rescanning derived prompts and media metadata creates duplicate and
    // misleading IP failures after the creative direction is already approved.
    if (stepId === 'script') {
      const complianceAgent = getIPComplianceAgent();
      const ipResult = complianceAgent.checkGeneratedOutput
        ? complianceAgent.checkGeneratedOutput(stepId, data)
        : complianceAgent.checkStepOutput(stepId, data);
      if (ipResult.verdict === QCVerdict.FAIL) {
        addAgentMessage('🛑', t('pipeline.ipCompliance', { issues: ipResult.issues.join('; ') }));
        return ipResult;
      }
      if (ipResult.verdict === QCVerdict.CONDITIONAL_PASS) {
        addAgentMessage('⚠️', t('pipeline.ipCompliance', { issues: ipResult.issues.join('; ') }));
        if (consistencyResult.verdict === QCVerdict.PASS) {
          return ipResult;
        }
      }
    }

    return consistencyResult;
  }

  #renderStep(stepId, result, onAdvance) {
    const fn = RENDERERS[stepId];
    if (fn) fn(result, onAdvance);
  }

  async reviseStep(stepId, feedback) {
    if (state.stopped) return;
    const stepIndex = STEPS.findIndex(s => s.id === stepId);
    if (stepIndex < 0) return;
    // A restored session has no live token, and a previous failed run may have
    // cancelled its token. A user-initiated revision is a fresh operation.
    if (!this.#token || this.#token.isCancelled) this.#token = new CancellationToken();
    recordMemoryMessage('user', feedback, stepId);

    updatePipeline(stepIndex, 'active');
    const step = STEPS[stepIndex];
    clearCurrentMessages();
    const stepLabel = t(step.labelKey);
    addAgentMessage(step.icon, t('ui.receivedFeedback', { step: stepLabel, feedback }));

    showGenerating(stepIndex);
    state.stepRunning = true;

    const delay = isConfigured() ? 0 : (2500 + Math.random() * 1500);
    let data;
    try {
      [data] = await Promise.all([
        this.#runAgentStep(step, feedback),
        sleep(delay),
      ]);
    } catch (err) {
      if (err instanceof StageGateError) {
        await this.#failStage(step, err);
        return;
      }
      if (!state.stopped) {
        recordMemoryMessage('system', err.message, stepId);
        await saveMemory('failed');
        throw err;
      }
      return;
    }

    await waitForResume();
    if (state.stopped) return;

    finishStage();
    const currentAnim = getGenAnim();
    if (currentAnim) currentAnim.stop();
    setGenAnim(null);
    state.stepRunning = false;

    await saveMemory();
    this.#refreshPipeline();

    addAgentMessage(step.icon, t('ui.revisionComplete'));

    const onAdvance = () => this.#advanceStep();
    this.#renderStep(stepId, data, onAdvance);
  }

  // Rolling back adopts a new version copied from a historical one, so version
  // numbers keep growing instead of reactivating an old artifact in place.
  async rollbackToStep(stepId, { toArtifactId = null } = {}) {
    const stepIndex = STEPS.findIndex(s => s.id === stepId);
    if (stepIndex < 0) return null;
    const step = STEPS[stepIndex];

    const target = this.#resolveRollbackTarget(stepId, toArtifactId);
    if (!target) return null;

    const revision = this.#store.createRevision(stepId, {
      kind: target.kind || step.artifactKind,
      data: structuredClone(target.data),
      sourceArtifactIds: [...(target.sourceArtifactIds ?? [])],
      status: ArtifactStatus.COMPLETE,
      restoredFromArtifactId: target.id,
    });
    this.#store.commit(revision, { provenance: { agent: 'rollback', revision: true } });
    const change = this.#store.replaceAcceptedArtifact(revision.id, { reasonCode: StaleReasonCode.UPSTREAM_ROLLED_BACK });

    state.data[dataKeyOf(step)] = revision.data;
    this.#rebuildEntities();
    this.#checkpoint.save(stepId, { stepIndex, acceptedArtifactId: revision.id });
    this.#runState.completeStep(stepId);

    // Two separate facts: which adopted outputs went stale because they consumed
    // the replaced version, and which later steps were reset so the run resumes here.
    const staleStepIds = this.#invalidateStaleSteps(change?.staleArtifactIds ?? []);
    const resetStepIds = [];
    for (let i = stepIndex + 1; i < STEPS.length; i++) {
      const laterStep = STEPS[i];
      state.data[dataKeyOf(laterStep)] = null;
      this.#checkpoint.clear(laterStep.id);
      this.#runState.reopenStep(laterStep.id);
      resetStepIds.push(laterStep.id);
    }

    state.currentStep = stepIndex;
    this.#rebuildEntities();
    this.#refreshPipeline();
    this.#persistWorkflow();
    await saveMemory();

    return {
      acceptedArtifact: revision,
      restoredFromArtifactId: target.id,
      supersededArtifactId: change?.supersededArtifact?.id ?? null,
      staleArtifactIds: change?.staleArtifactIds ?? [],
      staleStepIds,
      resetStepIds,
    };
  }

  #resolveRollbackTarget(stepId, toArtifactId) {
    if (toArtifactId) {
      const artifact = this.#store.get(toArtifactId);
      if (!artifact || artifact.stepId !== stepId) return null;
      return ROLLBACKABLE_STATUSES.includes(artifact.status) ? artifact : null;
    }
    const acceptedId = this.#store.getAcceptedByStep(stepId)?.id ?? null;
    const candidates = this.#store.getByStep(stepId)
      .filter(artifact => artifact.id !== acceptedId && DEFAULT_ROLLBACK_STATUSES.includes(artifact.status));
    return candidates.length > 0 ? candidates[candidates.length - 1] : null;
  }

  restoreSession() {
    const snapshot = loadPersistedWorkflow();
    if (!snapshot) return false;

    this.#store.restore(snapshot.artifacts);
    this.#store.restoreAccepted(snapshot.acceptedByStep);
    this.#checkpoint.restoreSnapshot(snapshot.checkpoint);
    this.#runState.restoreSnapshot(snapshot.runState);
    const migrated = this.#migrateLegacyCheckpoints();

    for (const key of Object.keys(state.data)) state.data[key] = null;
    for (const step of STEPS) {
      const accepted = this.#store.getAcceptedByStep(step.id);
      if (accepted) state.data[dataKeyOf(step)] = accepted.data;
    }
    this.#rebuildEntities();

    for (const stepId of this.#runState.completedSteps) {
      if (!this.#store.getAcceptedByStep(stepId)) this.#runState.reopenStep(stepId);
    }

    const graph = this.#store.validateGraph();
    if (!graph.ok) console.warn('[workflow] restored artifact graph has issues:', graph.issues);

    if (this.#runState.currentStepIndex >= 0 && this.#runState.currentStepIndex < STEPS.length) {
      state.currentStep = this.#runState.currentStepIndex;
    }
    this.#refreshPipeline();
    if (migrated) this.#persistWorkflow();

    return this.#runState.isInterrupted;
  }

  // Schema 1 sessions kept the step result inside the checkpoint and had no
  // artifact graph; rebuild one so a restored session has real dependencies.
  #migrateLegacyCheckpoints() {
    const pending = this.#checkpoint.listCompleted()
      .map(stepId => ({ stepId, entry: this.#checkpoint.restore(stepId) }))
      .filter(({ entry }) => entry && !entry.acceptedArtifactId && entry.result != null)
      .sort((a, b) => stepIndexOf(a.stepId) - stepIndexOf(b.stepId));
    if (pending.length === 0) return false;

    for (const { stepId, entry } of pending) {
      const step = STEPS.find(candidate => candidate.id === stepId);
      if (!step) continue;
      let artifact = this.#store.getByStep(stepId).find(candidate => candidate.status === ArtifactStatus.COMPLETE) ?? null;
      if (!artifact) {
        artifact = createArtifact({
          kind: step.artifactKind,
          stepId,
          data: entry.result,
          status: ArtifactStatus.COMPLETE,
        });
        this.#store.commit(artifact, { provenance: { agent: 'migration', revision: false } });
      }
      if (!artifact.sourceArtifactIds?.length) {
        artifact.sourceArtifactIds = (step.contextKeys || [])
          .map(dataKey => this.#store.getAcceptedByStep(producerStepOfDataKey(dataKey))?.id)
          .filter(Boolean);
      }
      this.#store.acceptArtifact(artifact.id);
      this.#checkpoint.save(stepId, {
        stepIndex: entry.stepIndex ?? stepIndexOf(stepId),
        acceptedArtifactId: artifact.id,
      });
    }
    return true;
  }

  async resumeFromMemory(snapshot, memoryId) {
    this.#store.clear();
    this.#checkpoint.clear();
    this.#runState.reset();
    clearPersistedWorkflow();
    this.#token = null;
    resetState();

    this.#store.restore(snapshot.artifacts);
    this.#store.restoreAccepted(snapshot.acceptedByStep);
    this.#checkpoint.restoreSnapshot(snapshot.checkpoint);
    this.#runState.restoreSnapshot(snapshot.runState);

    const input = snapshot.input || {};
    for (const key of Object.keys(state.data)) state.data[key] = null;
    for (const step of STEPS) {
      const accepted = this.#store.getAcceptedByStep(step.id);
      if (accepted) state.data[dataKeyOf(step)] = accepted.data;
    }
    this.#rebuildEntities();

    state.userInput = input.userInput || '';
    state.genre = input.genre || 'cinematic';
    state.visualStyle = input.visualStyle || 'cinematic';
    state.customStyle = input.customStyle || '';
    state.totalDuration = input.totalDuration || 30;
    state.aspectRatio = input.aspectRatio || '16:9';
    state.imageSize = input.imageSize || '1280*720';
    state.resolution = input.resolution || '720P';
    state.mode = input.mode || 'auto';
    if (input.lang) state.lang = input.lang;
    state.stopped = false;
    state.paused = false;
    state.stepRunning = false;
    state.viewingStep = null;

    attachMemory(memoryId, input);
    this.#token = new CancellationToken();

    const wasInterrupted = this.#runState.isInterrupted;
    const stepIndex = this.#runState.currentStepIndex;

    if (wasInterrupted && stepIndex >= 0 && stepIndex < STEPS.length) {
      state.currentStep = stepIndex;
    } else {
      let lastCompleted = -1;
      for (let i = STEPS.length - 1; i >= 0; i--) {
        if (this.#store.getAcceptedByStep(STEPS[i].id)) { lastCompleted = i; break; }
      }
      state.currentStep = lastCompleted >= 0 ? lastCompleted : 0;
    }

    this.#refreshPipeline();
    this.#persistWorkflow();

    if (wasInterrupted && stepIndex >= 0 && stepIndex < STEPS.length) {
      await this.continuePipeline();
    }

    return { wasInterrupted, currentStep: state.currentStep };
  }

  async continuePipeline() {
    if (state.currentStep < 0 || state.currentStep >= STEPS.length) return;
    state.stopped = false;
    state.paused = false;
    state.stepRunning = false;
    this.#token = new CancellationToken();
    this.#runState.markRunning();
    this.#persistWorkflow();
    await this.#executeStage(STEPS[state.currentStep]);
  }

  clearSession() {
    this.#store.clear();
    this.#checkpoint.clear();
    this.#runState.reset();
    clearPersistedWorkflow();
    this.#token = null;
    resetState();
  }

  pausePipeline() {
    this.#token?.pause();
    state.paused = true;
    saveMemory('paused');
  }

  resumePipeline() {
    this.#token?.resume();
    state.paused = false;
    saveMemory('running');
  }

  async stopPipeline(status = 'stopped') {
    cancelAutoAdvance();
    clearPendingAdvance();
    this.#token?.cancel();
    await cancelAllBackendTasks();
    state.stopped = true;
    this.#runState.markInterrupted();
    this.#persistWorkflow();
    return saveMemory(status);
  }

  #persistWorkflow() {
    return persistWorkflowSnapshot(buildWorkflowSnapshot({
      store: this.#store,
      checkpoint: this.#checkpoint,
      runState: this.#runState,
    }));
  }
}

let _orchestrator = null;

export function getOrchestrator() {
  if (!_orchestrator) {
    _orchestrator = new Orchestrator();
  }
  return _orchestrator;
}

export async function startPipeline() {
  return getOrchestrator().startPipeline();
}

export async function reviseStep(stepId, feedback) {
  return getOrchestrator().reviseStep(stepId, feedback);
}

export async function rollbackToStep(stepId, options) {
  return getOrchestrator().rollbackToStep(stepId, options);
}

export function restoreSession() {
  return getOrchestrator().restoreSession();
}

export async function continuePipeline() {
  return getOrchestrator().continuePipeline();
}

export function clearSession() {
  return getOrchestrator().clearSession();
}

export function pausePipeline() {
  getOrchestrator().pausePipeline();
}

export function resumePipeline() {
  getOrchestrator().resumePipeline();
}

export async function stopPipeline() {
  return getOrchestrator().stopPipeline();
}

export async function resumeFromHistory(snapshot, memoryId) {
  return getOrchestrator().resumeFromMemory(snapshot, memoryId);
}

setPipelineControls({ pause: pausePipeline, resume: resumePipeline, stop: stopPipeline });
