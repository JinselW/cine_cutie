// Run: node --experimental-vm-modules --test test/orchestrator-gate.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { STEPS, dataKeyOf } from '../src/js/config.js';
import { ArtifactStore } from '../src/js/artifacts/artifactStore.js';
import { ArtifactStatus, createArtifact } from '../src/js/artifacts/artifactTypes.js';
import { ExecutionCheckpoint } from '../src/js/orchestrator/executionCheckpoint.js';
import { RunState } from '../src/js/orchestrator/runState.js';
import { CancellationToken } from '../src/js/orchestrator/cancellationToken.js';
import { QCVerdict, Severity } from '../src/js/agents/qcTypes.js';

async function harness(mode = 'auto') {
  const state = { mode, entities: {}, data: {}, currentStep: -1 };
  const calls = { runs: [], renders: [], updates: [], failures: [], merges: 0, cancelled: 0, animStops: 0 };
  const agents = new Map();
  let gate = { verdict: QCVerdict.PASS, issues: [] };
  let metadata = {};
  let status = ArtifactStatus.COMPLETE;
  let data = { title: 'Original', characters: [{}], episodes: [{}] };
  class Agent {
    async process() {
      calls.runs.push(true);
      return { artifacts: [createArtifact({ kind: 'script', stepId: 'script', data, status })], metadata };
    }
  }
  const render = (result, advance) => calls.renders.push({ result, advance });
  const exports = {
    STEPS, dataKeyOf, state, ArtifactStore, ArtifactStatus, createArtifact,
    ExecutionCheckpoint, RunState, CancellationToken, QCVerdict, Severity,
    t: key => key, sleep: async () => {}, isConfigured: () => true,
    registerAgent: (id, agent) => agents.set(id, agent), resolveAgent: id => agents.get(id),
    getIPComplianceAgent: () => ({ checkStepOutput: () => gate }),
    checkConsistency: () => ({ verdict: QCVerdict.PASS, issues: [] }),
    validateScript: value => !!value?.title, validateStoryboard: () => true,
    extractEntities: () => { calls.merges++; return { accepted: true }; },
    mergeEntities: (a, b) => ({ ...a, ...b }), buildConsistencyConstraints: () => '',
    updatePipeline: (...args) => calls.updates.push(args),
    showPipelineFailure: issues => calls.failures.push(issues),
    cancelAutoAdvance: () => calls.cancelled++,
    getGenAnim: () => ({ stop: () => calls.animStops++ }),
  };
  for (const name of ['ScriptAgent', 'StoryboardAgent', 'CharacterAgent', 'ReferenceAgent', 'VideoAgent', 'EditorAgent']) exports[name] = Agent;
  for (const name of ['renderScript', 'renderCharacterDesign', 'renderStoryboard', 'renderReferenceImages', 'renderVideoGeneration', 'renderPostProduction']) exports[name] = render;
  for (const name of ['showGenerating', 'addAgentMessage', 'setGenAnim', 'clearCurrentMessages', 'waitForResume', 'setPipelineControls', 'showCompletion', 'resetLog', 'logStepStart', 'logStepComplete', 'initObservability']) exports[name] = () => {};
  const context = vm.createContext({ setTimeout, console });
  const module = new vm.SourceTextModule(readFileSync(new URL('../src/js/orchestrator.js', import.meta.url), 'utf8'), { context });
  await module.link(() => new vm.SyntheticModule(Object.keys(exports), function () {
    for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
  }, { context }));
  await module.evaluate();
  const api = module.namespace;
  return { api, state, calls, orchestrator: api.getOrchestrator(), configure(options) {
    if ('gate' in options) gate = options.gate;
    if ('metadata' in options) metadata = options.metadata;
    if ('status' in options) status = options.status;
    if ('data' in options) data = options.data;
  } };
}

for (const mode of ['auto', 'interactive']) {
  for (const scenario of [
    { name: 'critical IP rejection', gate: { verdict: QCVerdict.FAIL, severity: Severity.CRITICAL, issues: ['IP BLOCK'] } },
    { name: 'high severity rejection', gate: { verdict: QCVerdict.FAIL, severity: Severity.HIGH, issues: ['Rejected'] } },
    { name: 'QC rejection', metadata: { verdict: QCVerdict.FAIL, consistencyIssues: ['QC failed'] } },
    { name: 'failed generation artifact', status: ArtifactStatus.FAILED },
    { name: 'invalid structure', data: {} },
    { name: 'missing data', data: null },
  ]) {
    test(`${mode}: ${scenario.name} stops before accepting the output`, async () => {
      const h = await harness(mode);
      h.configure(scenario);
      await h.api.startPipeline();
      assert.equal(h.orchestrator.artifactStore.getLatestByStep('script').status, ArtifactStatus.FAILED);
      assert.equal(h.orchestrator.runState.status, 'interrupted');
      assert.deepEqual(h.orchestrator.runState.completedSteps, []);
      assert.equal(h.orchestrator.checkpoint.has('script'), false);
      assert.equal(h.state.data.script, undefined);
      assert.equal(h.calls.merges, 0);
      assert.equal(h.calls.renders.length, 0);
      assert.equal(h.calls.failures.length, 1);
      assert.equal(h.calls.animStops, 1);
      assert.equal(h.calls.cancelled, 1);
      assert.equal(h.state.stepRunning, false);
      assert.equal(h.state.stopped, true);
      assert.equal(h.calls.updates.some(([, value]) => value === 'done'), false);
      await h.api.reviseStep('script', 'stale button');
      assert.equal(h.calls.runs.length, 1);
    });
  }
  for (const verdict of [QCVerdict.PASS, QCVerdict.CONDITIONAL_PASS]) {
    test(`${mode}: ${verdict} still accepts the step`, async () => {
      const h = await harness(mode);
      h.configure({ gate: { verdict, severity: Severity.MEDIUM, issues: ['warning'] } });
      await h.api.startPipeline();
      assert.equal(h.calls.failures.length, 0);
      assert.equal(h.calls.renders.length, 1);
      assert.equal(typeof h.calls.renders[0].advance, 'function');
      assert.deepEqual(h.orchestrator.runState.completedSteps, ['script']);
      assert.equal(h.orchestrator.checkpoint.has('script'), true);
      assert.equal(h.state.data.script.title, 'Original');
    });
  }
  test(`${mode}: rejected revision preserves accepted data and blocks stale advance`, async () => {
    const h = await harness(mode);
    await h.api.startPipeline();
    const before = h.orchestrator.checkpoint.restore('script');
    const oldAdvance = h.calls.renders[0].advance;
    h.configure({ data: { title: 'Rejected revision' }, gate: { verdict: QCVerdict.FAIL, severity: Severity.CRITICAL, issues: ['IP BLOCK'] } });
    await h.api.reviseStep('script', 'revise');
    assert.equal(h.state.data.script.title, 'Original');
    assert.deepEqual(h.orchestrator.checkpoint.restore('script'), before);
    assert.equal(h.orchestrator.artifactStore.getLatestByStep('script').status, ArtifactStatus.FAILED);
    assert.equal(h.calls.merges, 1);
    assert.equal(h.calls.renders.length, 1);
    assert.equal(h.calls.failures.length, 1);
    await oldAdvance();
    assert.equal(h.state.currentStep, 0);
    assert.equal(h.calls.runs.length, 2);
  });
}
