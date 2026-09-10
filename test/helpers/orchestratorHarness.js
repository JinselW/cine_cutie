// Shared VM harness that loads src/js/orchestrator.js with every browser and
// provider dependency stubbed, so orchestration rules can be tested in Node.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { STEPS, dataKeyOf, producerStepOfDataKey } from '../../src/js/config.js';
import { ArtifactStore } from '../../src/js/artifacts/artifactStore.js';
import { ArtifactStatus, StaleReasonCode, createArtifact } from '../../src/js/artifacts/artifactTypes.js';
import { ExecutionCheckpoint } from '../../src/js/orchestrator/executionCheckpoint.js';
import { RunState } from '../../src/js/orchestrator/runState.js';
import { CancellationToken } from '../../src/js/orchestrator/cancellationToken.js';
import { QCVerdict, Severity } from '../../src/js/agents/qcTypes.js';

export const STEP_DATA = {
  script: { title: 'Original', characters: [{ name: 'Ada' }], episodes: [{}] },
  characterDesign: { characters: [{ name: 'Ada' }], settings: [] },
  storyboard: { shots: [{ shot_id: 1 }] },
  referenceImages: { shots: [{ shot_id: 1, image: '/ref/1.png' }] },
  videoGeneration: { clips: [{ shot_id: 1, videoPath: '/clip/1.mp4' }] },
  postProduction: { finalVideo: '/final.mp4' },
};

// Containers built by VM-side code carry that realm's intrinsics, so deepStrictEqual
// against a host literal fails on prototype identity even when contents match.
export function host(value) {
  return structuredClone(value);
}

const PASS_GATE = { verdict: QCVerdict.PASS, issues: [] };
const AGENT_EXPORTS = ['PromptAgent', 'ScriptAgent', 'StoryboardAgent', 'CharacterAgent', 'ReferenceAgent', 'VideoAgent', 'EditorAgent'];
const RENDER_EXPORTS = ['renderScript', 'renderCharacterDesign', 'renderStoryboard', 'renderReferenceImages', 'renderVideoGeneration', 'renderPostProduction'];
const NOOP_EXPORTS = ['showGenerating', 'setGenAnim', 'clearCurrentMessages', 'waitForResume', 'setPipelineControls', 'showCompletion', 'resetLog', 'logStepStart', 'logStepComplete', 'initObservability'];

export async function createHarness({ mode = 'auto' } = {}) {
  const state = {
    mode, lang: 'zh', entities: {}, currentStep: -1, userInput: 'a story', genre: 'cinematic', totalDuration: 30,
    data: { script: null, characterDesign: null, storyboard: null, referenceImages: null, videoClips: null, finalVideo: null },
  };
  const calls = {
    runs: [], contexts: [], renders: [], updates: [], failures: [], messages: [],
    extracts: 0, cancelled: 0, animStops: 0, memoryStatus: null,
  };
  const persistence = { snapshots: [], next: null };
  let pendingAdvance = null;
  const plans = new Map();
  const attempts = new Map();
  const gates = new Map();
  const agents = new Map();

  class HarnessAgent {
    async process(ctx) {
      const stepId = [...agents].find(([, agent]) => agent === this)[0];
      const attempt = attempts.get(stepId) ?? 0;
      attempts.set(stepId, attempt + 1);
      const plan = plans.get(stepId) ?? [];
      const config = plan.length > 0 ? { ...plan[Math.min(attempt, plan.length - 1)] } : {};
      gates.set(stepId, config.gate ?? PASS_GATE);
      calls.runs.push({ stepId, attempt, feedback: ctx.feedback ?? null });
      calls.contexts.push({ stepId, ctx });
      return {
        artifacts: [createArtifact({
          kind: stepId,
          stepId,
          data: 'data' in config ? config.data : structuredClone(STEP_DATA[stepId]),
          status: config.status ?? ArtifactStatus.COMPLETE,
        })],
        metadata: { feedbackSatisfied: true, ...(config.metadata ?? {}) },
      };
    }
  }

  const exports = {
    STEPS, dataKeyOf, producerStepOfDataKey,
    state,
    resetState: () => {
      state.currentStep = -1;
      state.entities = {};
      for (const key of Object.keys(state.data)) state.data[key] = null;
    },
    ArtifactStore, ArtifactStatus, StaleReasonCode, createArtifact,
    ExecutionCheckpoint, RunState, CancellationToken, QCVerdict, Severity,
    configureMemory: () => {}, beginMemory: async () => {}, attachMemory: () => {},
    saveMemory: async status => { if (status) calls.memoryStatus = status; },
    recordMemoryMessage: () => {},
    buildWorkflowSnapshot: ({ store, checkpoint, runState }) => ({
      schemaVersion: 2,
      artifacts: store.snapshot(),
      acceptedByStep: store.snapshotAccepted(),
      checkpoint: checkpoint.snapshot(),
      runState: runState.snapshot(),
    }),
    persistWorkflowSnapshot: snapshot => { persistence.snapshots.push(snapshot); return true; },
    loadPersistedWorkflow: () => persistence.next,
    clearPersistedWorkflow: () => { persistence.snapshots.length = 0; persistence.next = null; },
    t: (key, params) => (params ? `${key}:${Object.values(params).join('|')}` : key),
    sleep: async () => {}, isConfigured: () => true,
    cancelAllBackendTasks: async () => {},
    registerAgent: (id, agent) => agents.set(id, agent),
    resolveAgent: id => agents.get(id),
    getIPComplianceAgent: () => ({
      checkStepOutput: stepId => gates.get(stepId) ?? PASS_GATE,
      checkGeneratedOutput: stepId => gates.get(stepId) ?? PASS_GATE,
    }),
    checkConsistency: () => PASS_GATE,
    validateScript: value => !!value?.title,
    validateStoryboard: value => !!value?.shots,
    extractEntities: (stepId, data) => { calls.extracts++; return data ? { [stepId]: true } : null; },
    mergeEntities: (base, next) => ({ ...base, ...next }),
    buildConsistencyConstraints: () => '',
    updatePipeline: (...args) => calls.updates.push(args),
    showPipelineFailure: issues => calls.failures.push(issues),
    addAgentMessage: (icon, text) => calls.messages.push({ icon, text }),
    cancelAutoAdvance: () => calls.cancelled++,
    scheduleAutoAdvance: () => {},
    setPendingAdvance: fn => { pendingAdvance = fn; },
    getPendingAdvance: () => pendingAdvance,
    clearPendingAdvance: () => { pendingAdvance = null; },
    getGenAnim: () => ({ stop: () => calls.animStops++ }),
    finishStage: () => {},
  };
  for (const name of AGENT_EXPORTS) exports[name] = HarnessAgent;
  for (const name of RENDER_EXPORTS) exports[name] = (result, advance) => calls.renders.push({ result, advance });
  for (const name of NOOP_EXPORTS) exports[name] = () => {};

  const context = vm.createContext({ setTimeout, console, structuredClone });
  const module = new vm.SourceTextModule(
    readFileSync(new URL('../../src/js/orchestrator.js', import.meta.url), 'utf8'),
    { context },
  );
  await module.link(() => new vm.SyntheticModule(Object.keys(exports), function () {
    for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
  }, { context }));
  await module.evaluate();

  const api = module.namespace;
  const orchestrator = api.getOrchestrator();

  return {
    api, state, calls, persistence, orchestrator,
    store: orchestrator.artifactStore,
    // Queues per-attempt behaviour for a step: { data, status, metadata, gate }.
    plan(stepId, configs) {
      plans.set(stepId, configs);
      attempts.set(stepId, 0);
      return this;
    },
    async advance() {
      const last = calls.renders[calls.renders.length - 1];
      if (!last) throw new Error('nothing rendered to advance from');
      await last.advance();
    },
    async runPipeline(steps = STEPS.length) {
      await api.startPipeline();
      for (let i = 1; i < steps; i++) await this.advance();
    },
    accepted(stepId) {
      return orchestrator.artifactStore.getAcceptedByStep(stepId);
    },
    lastSnapshot() {
      return persistence.snapshots[persistence.snapshots.length - 1] ?? null;
    },
  };
}
