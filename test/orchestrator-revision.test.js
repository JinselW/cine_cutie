// Run: node --experimental-vm-modules --test test/orchestrator-revision.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { ArtifactStatus, StaleReasonCode } from '../src/js/artifacts/artifactTypes.js';
import { QCVerdict, Severity } from '../src/js/agents/qcTypes.js';
import { createHarness, host, STEP_DATA } from './helpers/orchestratorHarness.js';

test('an adopted revision supersedes the previous version and invalidates everything downstream', async () => {
  const h = await createHarness();
  await h.runPipeline(4);
  const scriptV1 = h.accepted('script');
  const characterV1 = h.accepted('characterDesign');
  const boardV1 = h.accepted('storyboard');
  const referenceV1 = h.accepted('referenceImages');

  h.plan('script', [{ data: { ...STEP_DATA.script, title: 'Rewritten' } }]);
  await h.api.reviseStep('script', 'rewrite the ending');

  const scriptV2 = h.accepted('script');
  assert.equal(scriptV2.version, 2);
  assert.equal(scriptV2.parentArtifactId, scriptV1.id);
  assert.equal(scriptV2.replacesArtifactId, scriptV1.id);
  assert.equal(scriptV2.rootArtifactId, scriptV1.id);
  assert.equal(scriptV1.status, ArtifactStatus.SUPERSEDED);
  assert.equal(h.state.data.script.title, 'Rewritten');

  for (const stale of [characterV1, boardV1, referenceV1]) {
    assert.equal(stale.status, ArtifactStatus.STALE);
    assert.equal(stale.staleReason.code, StaleReasonCode.UPSTREAM_REPLACED);
    assert.equal(stale.staleReason.sourceArtifactId, scriptV1.id);
    assert.equal(stale.staleReason.replacementArtifactId, scriptV2.id);
  }
  assert.equal(h.state.data.characterDesign, null);
  assert.equal(h.state.data.storyboard, null);
  assert.equal(h.state.data.referenceImages, null);
  assert.equal(h.accepted('storyboard'), null, 'a stale result is no longer the adopted version');
  assert.equal(h.orchestrator.checkpoint.has('storyboard'), false);
  assert.deepEqual(h.orchestrator.runState.completedSteps, ['script']);
  assert.equal(h.state.currentStep, 0, 'the run resumes at the step before the first invalidated one');
  assert.ok(h.calls.messages.some(m => m.text.includes('pipeline.downstreamInvalidated')));
  assert.equal(h.calls.updates.some(([, status]) => status === 'done' && h.state.currentStep > 0), false);
});

test('regenerating an invalidated step consumes the new upstream version', async () => {
  const h = await createHarness();
  await h.runPipeline(4);
  h.plan('script', [{ data: { ...STEP_DATA.script, title: 'Rewritten' } }]);
  await h.api.reviseStep('script', 'rewrite');
  const scriptV2 = h.accepted('script');

  await h.advance();
  assert.equal(h.calls.runs.at(-1).stepId, 'characterDesign');
  const characterV2 = h.accepted('characterDesign');
  assert.equal(characterV2.version, 2);
  assert.deepEqual(host(characterV2.sourceArtifactIds), [scriptV2.id]);
  assert.equal(h.state.data.characterDesign.characters[0].name, 'Ada');
});

test('revising one branch leaves an independent branch adopted', async () => {
  const h = await createHarness();
  await h.runPipeline(3);
  const boardV1 = h.accepted('storyboard');
  const boardData = h.state.data.storyboard;

  h.plan('characterDesign', [{ data: { characters: [{ name: 'Redesigned' }], settings: [] } }]);
  await h.api.reviseStep('characterDesign', 'redesign the lead');

  assert.equal(h.accepted('characterDesign').version, 2);
  assert.equal(h.state.data.characterDesign.characters[0].name, 'Redesigned');
  assert.equal(boardV1.status, ArtifactStatus.COMPLETE, 'storyboard only consumes the script');
  assert.equal(h.accepted('storyboard').id, boardV1.id);
  assert.equal(h.state.data.storyboard, boardData);
  assert.equal(h.orchestrator.checkpoint.has('storyboard'), true);
  assert.deepEqual(h.orchestrator.runState.completedSteps, ['script', 'characterDesign', 'storyboard']);
  assert.equal(h.state.currentStep, 2);
});

test('a rejected revision leaves downstream results valid and resumable', async () => {
  const h = await createHarness();
  await h.runPipeline(3);
  const scriptV1 = h.accepted('script');
  const boardV1 = h.accepted('storyboard');

  h.plan('script', [{ data: { title: 'Broken rewrite' }, gate: { verdict: QCVerdict.FAIL, severity: Severity.HIGH, issues: ['rejected'] } }]);
  await h.api.reviseStep('script', 'rewrite');

  assert.equal(h.accepted('script').id, scriptV1.id);
  assert.equal(scriptV1.version, 1);
  assert.equal(boardV1.status, ArtifactStatus.COMPLETE);
  assert.equal(h.state.data.script, scriptV1.data);
  assert.notEqual(h.state.data.storyboard, null);
  assert.deepEqual(h.orchestrator.runState.completedSteps, ['script', 'characterDesign', 'storyboard']);
  assert.equal(h.state.currentStep, 2);
  assert.equal(h.orchestrator.checkpoint.restore('script').acceptedArtifactId, scriptV1.id);
});

test('a revision that cannot verify the user feedback is rejected and preserves the adopted version', async () => {
  const h = await createHarness();
  await h.api.startPipeline();
  const scriptV1 = h.accepted('script');

  h.plan('script', [{
    data: { ...STEP_DATA.script, title: 'Visually unchanged' },
    metadata: { feedbackSatisfied: false },
  }]);
  await h.api.reviseStep('script', 'make the protagonist wear a red coat');

  assert.equal(h.accepted('script').id, scriptV1.id);
  assert.equal(h.state.data.script, scriptV1.data);
  assert.equal(h.store.getByStep('script').at(-1).status, ArtifactStatus.FAILED);
  assert.ok(h.calls.failures.flat().some(issue => issue.includes('pipeline.feedbackNotSatisfied')));
});

test('a failed revision does not consume a version number from the adopted lineage', async () => {
  const h = await createHarness();
  await h.api.startPipeline();
  const scriptV1 = h.accepted('script');

  h.plan('script', [
    { data: { title: 'Broken' }, gate: { verdict: QCVerdict.FAIL, severity: Severity.HIGH, issues: ['rejected'] } },
    { data: { title: 'Fixed' } },
  ]);
  h.state.stopped = false;
  await h.api.reviseStep('script', 'first attempt');
  h.state.stopped = false;
  await h.api.reviseStep('script', 'second attempt');

  const versions = h.store.getByStep('script').map(artifact => [artifact.version, artifact.status]);
  assert.deepEqual(versions, [
    [1, ArtifactStatus.SUPERSEDED],
    [2, ArtifactStatus.FAILED],
    [3, ArtifactStatus.COMPLETE],
  ]);
  assert.equal(h.accepted('script').version, 3);
  assert.equal(h.accepted('script').replacesArtifactId, scriptV1.id);
  assert.equal(h.state.data.script.title, 'Fixed');
});

test('a stale downstream step cannot be shown or resumed as a valid result', async () => {
  const h = await createHarness();
  await h.runPipeline(4);
  h.plan('script', [{ data: { ...STEP_DATA.script, title: 'Rewritten' } }]);
  await h.api.reviseStep('script', 'rewrite');

  const lastRender = h.calls.renders.at(-1);
  assert.equal(lastRender.result.title, 'Rewritten', 'the revised step is what gets rendered');
  for (const stepId of ['characterDesign', 'storyboard', 'referenceImages']) {
    assert.equal(h.orchestrator.checkpoint.has(stepId), false);
    assert.equal(h.accepted(stepId), null);
  }
  const snapshot = h.lastSnapshot();
  assert.deepEqual(snapshot.acceptedByStep, { script: h.accepted('script').id });
  assert.deepEqual(Object.keys(snapshot.checkpoint), ['script']);
});
