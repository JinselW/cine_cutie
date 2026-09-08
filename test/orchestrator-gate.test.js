// Run: node --experimental-vm-modules --test test/orchestrator-gate.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { ArtifactStatus } from '../src/js/artifacts/artifactTypes.js';
import { QCVerdict, Severity } from '../src/js/agents/qcTypes.js';
import { createHarness, STEP_DATA } from './helpers/orchestratorHarness.js';

const REJECT_SCENARIOS = [
  { name: 'critical IP rejection', config: { gate: { verdict: QCVerdict.FAIL, severity: Severity.CRITICAL, issues: ['IP BLOCK'] } } },
  { name: 'high severity rejection', config: { gate: { verdict: QCVerdict.FAIL, severity: Severity.HIGH, issues: ['Rejected'] } } },
  { name: 'QC rejection', config: { metadata: { verdict: QCVerdict.FAIL, consistencyIssues: ['QC failed'] } } },
  { name: 'failed generation artifact', config: { status: ArtifactStatus.FAILED } },
  { name: 'invalid structure', config: { data: {} } },
  { name: 'missing data', config: { data: null } },
];

for (const mode of ['auto', 'interactive']) {
  test(`${mode}: generated IP block is automatically regenerated without stopping`, async () => {
    const h = await createHarness({ mode });
    h.plan('script', [
      { gate: { verdict: QCVerdict.FAIL, severity: Severity.CRITICAL, issues: ['IP BLOCK'], requiresRegeneration: true, regenerationPrompt: 'Use original characters' } },
      { gate: { verdict: QCVerdict.PASS, issues: [] } },
    ]);
    await h.api.startPipeline();

    assert.equal(h.calls.runs.length, 2);
    assert.equal(h.calls.runs[1].feedback, 'Use original characters');
    assert.equal(h.store.getLatestByStep('script').status, ArtifactStatus.COMPLETE);
    assert.ok(h.accepted('script'));
    assert.equal(h.calls.failures.length, 0);
    assert.notEqual(h.orchestrator.runState.status, 'interrupted');
  });

  test(`${mode}: exhausted generated IP rewrites continue with a warning`, async () => {
    const h = await createHarness({ mode });
    const blocked = { verdict: QCVerdict.FAIL, severity: Severity.CRITICAL, issues: ['IP BLOCK'], requiresRegeneration: true, regenerationPrompt: 'Rewrite' };
    h.plan('script', [{ gate: blocked }, { gate: blocked }, { gate: blocked }]);
    await h.api.startPipeline();

    assert.equal(h.calls.runs.length, 3);
    assert.ok(h.accepted('script'));
    assert.equal(h.calls.failures.length, 0);
    assert.notEqual(h.orchestrator.runState.status, 'interrupted');
  });

  for (const scenario of REJECT_SCENARIOS) {
    test(`${mode}: ${scenario.name} stops before accepting the output`, async () => {
      const h = await createHarness({ mode });
      h.plan('script', [scenario.config]);
      await h.api.startPipeline();

      assert.equal(h.store.getLatestByStep('script').status, ArtifactStatus.FAILED);
      assert.equal(h.accepted('script'), null, 'a rejected output is never adopted');
      assert.equal(h.orchestrator.runState.status, 'interrupted');
      assert.equal(h.calls.memoryStatus, 'failed');
      assert.deepEqual(h.orchestrator.runState.completedSteps, []);
      assert.equal(h.orchestrator.checkpoint.has('script'), false);
      assert.equal(h.state.data.script, null);
      assert.equal(h.calls.extracts, 0);
      assert.equal(h.calls.renders.length, 0);
      assert.equal(h.calls.failures.length, 1);
      assert.equal(h.calls.animStops, 1);
      assert.ok(h.calls.cancelled >= 1);
      assert.equal(h.state.stepRunning, false);
      assert.equal(h.state.stopped, true);
      assert.equal(h.calls.updates.some(([, value]) => value === 'done'), false);

      await h.api.reviseStep('script', 'stale button');
      assert.equal(h.calls.runs.length, 1, 'a stopped pipeline ignores revision requests');
    });
  }

  for (const verdict of [QCVerdict.PASS, QCVerdict.CONDITIONAL_PASS]) {
    test(`${mode}: ${verdict} still accepts the step`, async () => {
      const h = await createHarness({ mode });
      h.plan('script', [{ gate: { verdict, severity: Severity.MEDIUM, issues: ['warning'] } }]);
      await h.api.startPipeline();

      assert.equal(h.calls.failures.length, 0);
      assert.equal(h.calls.renders.length, 1);
      assert.equal(typeof h.calls.renders[0].advance, 'function');
      assert.deepEqual(h.orchestrator.runState.completedSteps, ['script']);
      assert.equal(h.orchestrator.checkpoint.has('script'), true);
      assert.equal(h.state.data.script.title, STEP_DATA.script.title);
      assert.deepEqual(h.orchestrator.checkpoint.restore('script'), {
        stepIndex: 0,
        acceptedArtifactId: h.accepted('script').id,
      });
    });
  }

  test(`${mode}: rejected revision preserves accepted data and blocks stale advance`, async () => {
    const h = await createHarness({ mode });
    await h.api.startPipeline();
    const before = h.orchestrator.checkpoint.restore('script');
    const acceptedBefore = h.accepted('script');
    const extractsBefore = h.calls.extracts;
    const oldAdvance = h.calls.renders[0].advance;

    h.plan('script', [{ data: { title: 'Rejected revision' }, gate: { verdict: QCVerdict.FAIL, severity: Severity.CRITICAL, issues: ['IP BLOCK'] } }]);
    h.calls.runs.length = 0;
    await h.api.reviseStep('script', 'revise');

    assert.equal(h.state.data.script.title, STEP_DATA.script.title);
    assert.deepEqual(h.orchestrator.checkpoint.restore('script'), before);
    assert.equal(h.accepted('script').id, acceptedBefore.id);
    assert.equal(acceptedBefore.status, ArtifactStatus.COMPLETE, 'a rejected revision does not supersede the adopted version');
    assert.equal(h.store.getLatestByStep('script').status, ArtifactStatus.FAILED);
    assert.equal(h.calls.extracts, extractsBefore, 'entities are only rebuilt from an adopted version');
    assert.deepEqual(h.state.entities, { script: true });
    assert.equal(h.calls.renders.length, 1);
    assert.equal(h.calls.failures.length, 1);
    assert.equal(h.calls.runs.length, 1);

    await oldAdvance();
    assert.equal(h.state.currentStep, 0);
    assert.equal(h.calls.runs.length, 1, 'a stopped pipeline does not advance into the next step');
  });
}

test('an IP retry during a user revision preserves both the user feedback and the IP correction', async () => {
  const h = await createHarness();
  await h.api.startPipeline();
  h.plan('script', [
    {
      gate: {
        verdict: QCVerdict.FAIL,
        severity: Severity.CRITICAL,
        issues: ['IP BLOCK'],
        requiresRegeneration: true,
        regenerationPrompt: 'Replace the protected character with an original one',
      },
    },
    { gate: { verdict: QCVerdict.PASS, issues: [] } },
  ]);

  await h.api.reviseStep('script', 'make the protagonist wear a red coat');

  assert.match(h.calls.runs.at(-1).feedback, /make the protagonist wear a red coat/);
  assert.match(h.calls.runs.at(-1).feedback, /Replace the protected character with an original one/);
});
