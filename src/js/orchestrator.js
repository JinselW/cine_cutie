import { STEPS, dataKeyOf } from './config.js';
import { state } from './state.js';
import { t } from './i18n.js';
import {
  updatePipeline, showGenerating, addAgentMessage, setGenAnim,
  clearCurrentMessages, waitForResume, getGenAnim, setPipelineControls,
} from './ui/render.js';
import {
  renderScript, renderCharacterDesign, renderStoryboard,
  renderReferenceImages, renderVideoGeneration, renderPostProduction,
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
import { ArtifactStatus, createArtifact } from './artifacts/artifactTypes.js';
import { extractEntities, mergeEntities, buildConsistencyConstraints, checkConsistency } from './agents/qcConsistency.js';
import { QCVerdict, Severity } from './agents/qcTypes.js';
import { validateScript } from './agents/scriptAgent.js';
import { validateStoryboard } from './agents/storyboardAgent.js';
import { ExecutionCheckpoint } from './orchestrator/executionCheckpoint.js';
import { RunState, RunStatus } from './orchestrator/runState.js';
import { CancellationToken } from './orchestrator/cancellationToken.js';
import { registerAgent, resolveAgent } from './orchestrator/agentRegistry.js';

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
    this.#checkpoint.clearPersisted();
    this.#runState.startPipeline();
    this.#token = new CancellationToken();
    resetLog();
    await this.#advanceStep();
  }

  async #advanceStep() {
    state.currentStep++;
    if (state.currentStep >= STEPS.length) {
      state.viewingStep = null;
      this.#runState.markCompleted();
      this.#runState.persist();
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
    let result;
    try {
      [result] = await Promise.all([
        this.#runMigratedStep(step),
        sleep(delay),
      ]);
    } catch (err) {
      if (!state.stopped) throw err;
      this.#runState.markInterrupted();
      this.#runState.persist();
      this.#checkpoint.persist();
      return;
    }

    await waitForResume();
    if (state.stopped) {
      this.#runState.markInterrupted();
      this.#runState.persist();
      this.#checkpoint.persist();
      return;
    }

    const currentAnim = getGenAnim();
    if (currentAnim) currentAnim.stop();
    setGenAnim(null);
    state.stepRunning = false;

    const dataKey = dataKeyOf(step);
    state.data[dataKey] = result;
    updatePipeline(state.currentStep, 'done');

    this.#checkpoint.save(step.id, { stepIndex: state.currentStep, dataKey, result });
    this.#runState.completeStep(step.id);
    this.#runState.persist();
    this.#checkpoint.persist();

    if (state.viewingStep !== null) {
      if (state.mode === 'auto') {
        setTimeout(() => this.#advanceStep(), 2000);
      }
      return;
    }

    const onAdvance = () => this.#advanceStep();
    this.#renderStep(step.id, result, onAdvance);
  }

  async #runMigratedStep(step) {
    const agent = resolveAgent(step.id);
    const agentName = step.agent || 'Agent';
    logStepStart(step.id, agentName);

    try {
      const ctx = this.#buildContext(step);
      const result = await agent.process(ctx, this.#token);

      const data = result.artifacts?.[0]?.data ?? null;
      const metadata = result.metadata ?? {};

      const gateResult = this.#postGate(step.id, data, metadata);

      if (result.artifacts?.[0]) {
        const artifact = result.artifacts[0];
        if (gateResult.verdict === QCVerdict.FAIL && gateResult.severity >= Severity.HIGH) {
          artifact.status = ArtifactStatus.FAILED;
        }
        artifact.metrics = {
          tokens: metadata.tokens || { prompt: 0, completion: 0 },
          qualityScore: metadata.qualityScore ?? null,
          retries: metadata.retries ?? 0,
          fallbackUsed: metadata.fallbackUsed ?? false,
        };
        this.#store.commit(artifact, {
          provenance: { agent: agentName },
        });
      }

      const committedArtifact = result.artifacts?.[0];
      if (committedArtifact && committedArtifact.status !== ArtifactStatus.STALE) {
        const newEntities = extractEntities(step.id, data);
        if (newEntities) {
          state.entities = mergeEntities(state.entities, newEntities);
        }
      }

      return data;
    } finally {
      logStepComplete();
    }
  }

  #buildContext(step) {
    const keys = step.contextKeys || [];
    const d = state.data;
    const constraints = buildConsistencyConstraints(state.entities);

    const ctx = {
      userInput: state.userInput,
      genre: state.genre,
      uploads: state.uploads,
      totalDuration: state.totalDuration,
      constraints,
      entities: state.entities || {},
    };
    for (const key of keys) {
      if (d[key] != null) ctx[key] = d[key];
    }
    return ctx;
  }

  #postGate(stepId, data, metadata) {
    const validator = POST_VALIDATORS[stepId];
    if (validator && data != null) {
      const valid = validator(data);
      if (!valid) {
        addAgentMessage('⚠️', `Post-gate: ${stepId} output failed structural validation`);
        return { verdict: QCVerdict.FAIL, issues: ['Structural validation failed'], severity: Severity.HIGH };
      }
    }

    if (data == null) {
      return { verdict: QCVerdict.FAIL, issues: ['No data produced'], severity: Severity.CRITICAL };
    }

    const consistencyResult = checkConsistency(stepId, data, state.entities || {});

    if (consistencyResult.verdict === QCVerdict.FAIL) {
      addAgentMessage('⚠️', `Post-gate: ${stepId} consistency check failed — ${consistencyResult.issues.join('; ')}`);
    } else if (consistencyResult.verdict === QCVerdict.CONDITIONAL_PASS) {
      addAgentMessage('⚠️', `Post-gate: ${stepId} consistency warnings — ${consistencyResult.issues.join('; ')}`);
    }

    const ipResult = getIPComplianceAgent().checkStepOutput(stepId, data);
    if (ipResult.verdict === QCVerdict.FAIL) {
      addAgentMessage('🛑', `IP Compliance: ${ipResult.issues.join('; ')}`);
      return ipResult;
    }
    if (ipResult.verdict === QCVerdict.CONDITIONAL_PASS) {
      addAgentMessage('⚠️', `IP Compliance: ${ipResult.issues.join('; ')}`);
      if (consistencyResult.verdict === QCVerdict.PASS) {
        return ipResult;
      }
    }

    return consistencyResult;
  }

  #renderStep(stepId, result, onAdvance) {
    const fn = RENDERERS[stepId];
    if (fn) fn(result, onAdvance);
  }

  async reviseStep(stepId, feedback) {
    const stepIndex = STEPS.findIndex(s => s.id === stepId);
    if (stepIndex < 0) return;

    updatePipeline(stepIndex, 'active');
    const step = STEPS[stepIndex];
    clearCurrentMessages();
    const stepLabel = t(step.labelKey);
    addAgentMessage(step.icon, t('ui.receivedFeedback', { step: stepLabel, feedback }));

    showGenerating(stepIndex);
    state.stepRunning = true;

    const delay = isConfigured() ? 0 : (2500 + Math.random() * 1500);
    let result;
    try {
      [result] = await Promise.all([
        this.#runMigratedRevision(step, feedback),
        sleep(delay),
      ]);
    } catch (err) {
      if (!state.stopped) throw err;
      return;
    }

    await waitForResume();
    if (state.stopped) return;

    const currentAnim = getGenAnim();
    if (currentAnim) currentAnim.stop();
    setGenAnim(null);
    state.stepRunning = false;

    state.data[dataKeyOf(step)] = result;
    updatePipeline(stepIndex, 'done');

    addAgentMessage(step.icon, t('ui.revisionComplete'));

    const onAdvance = () => this.#advanceStep();
    this.#renderStep(stepId, result, onAdvance);
  }

  async #runMigratedRevision(step, feedback) {
    const agent = resolveAgent(step.id);
    const agentName = step.agent || 'Agent';
    logStepStart(step.id, agentName);

    try {
      const ctx = this.#buildContext(step);
      ctx.feedback = feedback;
      ctx.previousResult = state.data[dataKeyOf(step)];

      const result = await agent.process(ctx, this.#token);
      const data = result.artifacts?.[0]?.data ?? null;
      const metadata = result.metadata ?? {};

      const gateResult = this.#postGate(step.id, data, metadata);

      if (result.artifacts?.[0]) {
        const artifact = result.artifacts[0];
        if (gateResult.verdict === QCVerdict.FAIL && gateResult.severity >= Severity.HIGH) {
          artifact.status = ArtifactStatus.FAILED;
        }
        artifact.metrics = {
          tokens: metadata.tokens || { prompt: 0, completion: 0 },
          qualityScore: metadata.qualityScore ?? null,
          retries: metadata.retries ?? 0,
          fallbackUsed: metadata.fallbackUsed ?? false,
        };
        this.#store.commit(artifact, {
          provenance: { agent: agentName, revision: true },
        });
        this.#store.markDownstreamStale(artifact.id);
      }

      const committedArtifact = result.artifacts?.[0];
      if (committedArtifact && committedArtifact.status !== ArtifactStatus.STALE) {
        const newEntities = extractEntities(step.id, data);
        if (newEntities) {
          state.entities = mergeEntities(state.entities, newEntities);
        }
      }

      this.#checkpoint.save(step.id, { stepIndex: STEPS.findIndex(s => s.id === step.id), dataKey: dataKeyOf(step), result: data });
      this.#checkpoint.persist();

      return data;
    } finally {
      logStepComplete();
    }
  }

  async rollbackToStep(stepId) {
    const stepIndex = STEPS.findIndex(s => s.id === stepId);
    if (stepIndex < 0) return;

    const validArtifact = this.#store.getLatestValidByStep(stepId);
    if (validArtifact) {
      const newArtifact = createArtifact({
        kind: validArtifact.kind,
        stepId: validArtifact.stepId,
        data: structuredClone(validArtifact.data),
        status: ArtifactStatus.COMPLETE,
        sourceArtifactIds: [validArtifact.id],
      });
      this.#store.commit(newArtifact, { provenance: { agent: 'rollback' } });
      this.#store.markDownstreamStale(newArtifact.id);
    }

    const step = STEPS[stepIndex];
    const dataKey = dataKeyOf(step);
    const checkpointData = this.#checkpoint.restore(stepId);
    if (checkpointData?.result != null) {
      state.data[dataKey] = checkpointData.result;
    }

    for (let i = stepIndex + 1; i < STEPS.length; i++) {
      const laterStep = STEPS[i];
      const laterKey = dataKeyOf(laterStep);
      state.data[laterKey] = null;
      this.#checkpoint.clear(laterStep.id);
    }

    state.currentStep = stepIndex;
    this.#runState.persist();
    this.#checkpoint.persist();
  }

  restoreSession() {
    const hasCheckpoint = this.#checkpoint.loadPersisted();
    const hasRunState = this.#runState.loadPersisted();

    if (!hasCheckpoint && !hasRunState) return false;

    for (const stepId of this.#runState.completedSteps) {
      const cpData = this.#checkpoint.restore(stepId);
      if (cpData) {
        const step = STEPS.find(s => s.id === stepId);
        if (step) {
          state.data[dataKeyOf(step)] = cpData.result;
        }
      }
    }

    if (this.#runState.currentStepIndex >= 0 && this.#runState.currentStepIndex < STEPS.length) {
      state.currentStep = this.#runState.currentStepIndex;
    }

    return this.#runState.isInterrupted;
  }

  pausePipeline() {
    this.#token?.pause();
    state.paused = true;
  }

  resumePipeline() {
    this.#token?.resume();
    state.paused = false;
  }

  stopPipeline() {
    this.#token?.cancel();
    state.stopped = true;
    this.#runState.markInterrupted();
    this.#runState.persist();
    this.#checkpoint.persist();
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

export async function rollbackToStep(stepId) {
  return getOrchestrator().rollbackToStep(stepId);
}

export function restoreSession() {
  return getOrchestrator().restoreSession();
}

export function pausePipeline() {
  getOrchestrator().pausePipeline();
}

export function resumePipeline() {
  getOrchestrator().resumePipeline();
}

export function stopPipeline() {
  getOrchestrator().stopPipeline();
}

setPipelineControls({ pause: pausePipeline, resume: resumePipeline, stop: stopPipeline });
