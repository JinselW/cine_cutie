// Run: node --experimental-vm-modules --test test/orchestrator-rollback.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { ArtifactStatus, StaleReasonCode } from '../src/js/artifacts/artifactTypes.js';
import { QCVerdict, Severity } from '../src/js/agents/qcTypes.js';
import { createHarness, host, STEP_DATA } from './helpers/orchestratorHarness.js';

const REJECTED = { verdict: QCVerdict.FAIL, severity: Severity.HIGH, issues: ['rejected'] };

// Three adopted script versions: v1 and v2 superseded, v3 current.
async function threeScriptVersions() {
  const h = await createHarness();
  await h.runPipeline(1);
  const v1 = h.accepted('script');

  h.plan('script', [{ data: { ...STEP_DATA.script, title: 'Second' } }]);
  await h.api.reviseStep('script', 'rewrite');
  const v2 = h.accepted('script');

  h.plan('script', [{ data: { ...STEP_DATA.script, title: 'Third' } }]);
  await h.api.reviseStep('script', 'rewrite again');
  const v3 = h.accepted('script');

  return { h, v1, v2, v3 };
}

test('rolling back adopts a new version copied from the historical one', async () => {
  const { h, v1, v2, v3 } = await threeScriptVersions();

  const result = await h.api.rollbackToStep('script', { toArtifactId: v1.id });
  const v4 = h.accepted('script');

  assert.notEqual(v4.id, v1.id, 'the old record is never reactivated in place');
  assert.equal(v4.version, 4);
  assert.equal(v4.parentArtifactId, v3.id, 'the version chain continues from the current head');
  assert.equal(v4.replacesArtifactId, v3.id);
  assert.equal(v4.rootArtifactId, v1.id);
  assert.equal(v4.restoredFromArtifactId, v1.id, 'the record says which version was restored');
  assert.deepEqual(host(v4.data), v1.data);
  assert.deepEqual(host(v4.sourceArtifactIds), host(v1.sourceArtifactIds));
  assert.equal(v4.status, ArtifactStatus.COMPLETE);
  assert.equal(v4.provenance.agent, 'rollback');

  assert.equal(result.restoredFromArtifactId, v1.id);
  assert.equal(result.supersededArtifactId, v3.id);
  assert.equal(v3.status, ArtifactStatus.SUPERSEDED);
  assert.equal(v2.status, ArtifactStatus.SUPERSEDED);
  assert.equal(v1.status, ArtifactStatus.SUPERSEDED, 'history keeps the status it already had');

  assert.equal(h.state.data.script.title, 'Original');
  assert.deepEqual(h.orchestrator.checkpoint.restore('script'), { stepIndex: 0, acceptedArtifactId: v4.id });
  assert.deepEqual(h.orchestrator.runState.completedSteps, ['script']);
  assert.equal(h.store.validateGraph().ok, true);
});

test('rolling back invalidates every later step and resumes at the rolled-back one', async () => {
  const h = await createHarness();
  await h.runPipeline(1);
  const scriptV1 = h.accepted('script');

  h.plan('script', [{ data: { ...STEP_DATA.script, title: 'Second' } }]);
  await h.api.reviseStep('script', 'rewrite');
  const scriptV2 = h.accepted('script');
  await h.advance();
  await h.advance();
  await h.advance();
  const downstream = {
    characterDesign: h.accepted('characterDesign'),
    storyboard: h.accepted('storyboard'),
    referenceImages: h.accepted('referenceImages'),
  };
  for (const artifact of Object.values(downstream)) assert.ok(artifact);

  const result = await h.api.rollbackToStep('script', { toArtifactId: scriptV1.id });
  const restored = h.accepted('script');

  assert.deepEqual(host(result.staleStepIds).sort(), ['characterDesign', 'referenceImages', 'storyboard']);
  assert.deepEqual(host(result.resetStepIds),
    ['characterDesign', 'storyboard', 'referenceImages', 'videoGeneration', 'postProduction'],
    'every later step is reset so the run resumes at the rolled-back one');
  assert.equal(h.state.currentStep, 0);
  assert.deepEqual(h.orchestrator.runState.completedSteps, ['script']);

  for (const [stepId, artifact] of Object.entries(downstream)) {
    const stale = h.store.get(artifact.id);
    assert.equal(stale.status, ArtifactStatus.STALE, `${stepId} consumed the rolled-back version`);
    assert.equal(stale.staleReason.code, StaleReasonCode.UPSTREAM_ROLLED_BACK);
    assert.equal(stale.staleReason.sourceArtifactId, scriptV2.id);
    assert.equal(stale.staleReason.replacementArtifactId, restored.id);
    assert.equal(h.accepted(stepId), null);
    assert.equal(h.state.data[stepId], null);
    assert.equal(h.orchestrator.checkpoint.has(stepId), false);
  }
  assert.deepEqual(h.state.data.videoClips, null);
  assert.ok(h.calls.messages.some(m => m.text.includes('pipeline.downstreamInvalidated')));
});

test('a regenerated downstream step consumes the rolled-back version', async () => {
  const h = await createHarness();
  await h.runPipeline(1);
  const scriptV1 = h.accepted('script');
  h.plan('script', [{ data: { ...STEP_DATA.script, title: 'Second' } }]);
  await h.api.reviseStep('script', 'rewrite');
  await h.advance();
  const characterV1 = h.accepted('characterDesign');

  const result = await h.api.rollbackToStep('script', { toArtifactId: scriptV1.id });
  await h.advance();

  assert.equal(h.calls.runs.at(-1).stepId, 'characterDesign');
  const context = h.calls.contexts.at(-1).ctx;
  assert.equal(context.script.title, 'Original', 'the regenerated step sees the restored content');

  const characterV2 = h.accepted('characterDesign');
  assert.equal(characterV2.version, 2);
  assert.deepEqual(host(characterV2.sourceArtifactIds), [result.acceptedArtifact.id]);
  assert.equal(h.store.get(characterV1.id).status, ArtifactStatus.STALE);
  assert.deepEqual(h.orchestrator.runState.completedSteps, ['script', 'characterDesign']);
});

test('without an explicit target the newest non-adopted version is restored', async () => {
  const { h, v2 } = await threeScriptVersions();

  const result = await h.api.rollbackToStep('script');
  assert.equal(result.restoredFromArtifactId, v2.id);
  assert.equal(h.accepted('script').version, 4);
  assert.equal(h.state.data.script.title, 'Second');
});

test('a step with a single version has nothing to roll back to', async () => {
  const h = await createHarness();
  await h.runPipeline(1);
  const v1 = h.accepted('script');

  assert.equal(await h.api.rollbackToStep('script'), null);
  assert.equal(h.accepted('script').id, v1.id);
  assert.equal(h.store.getByStep('script').length, 1, 'no placeholder version is invented');
  assert.equal(h.state.currentStep, 0);
});

test('a target that is unknown, foreign or failed is refused', async () => {
  const { h, v1, v3 } = await threeScriptVersions();

  assert.equal(await h.api.rollbackToStep('script', { toArtifactId: 'no-such-artifact' }), null);
  assert.equal(await h.api.rollbackToStep('storyboard', { toArtifactId: v1.id }), null,
    'a version belonging to another step is not a target for this one');
  assert.equal(await h.api.rollbackToStep('noSuchStep'), null);

  h.plan('script', [{ data: { title: 'Broken' }, gate: REJECTED }]);
  await h.api.reviseStep('script', 'rewrite');
  const failed = h.store.getLatestByStep('script');
  assert.equal(failed.status, ArtifactStatus.FAILED);
  assert.equal(await h.api.rollbackToStep('script', { toArtifactId: failed.id }), null,
    'a version that never passed QC cannot become the adopted one');

  assert.equal(h.accepted('script').id, v3.id, 'every refused attempt left the session untouched');
  assert.equal(h.store.getByStep('script').length, 4);
});

test('rolling back a downstream step restores the upstream references it was built from', async () => {
  const h = await createHarness();
  await h.runPipeline(2);
  const scriptV1 = h.accepted('script');
  const characterV1 = h.accepted('characterDesign');
  assert.deepEqual(host(characterV1.sourceArtifactIds), [scriptV1.id]);

  h.plan('script', [{ data: { ...STEP_DATA.script, title: 'Second' } }]);
  await h.api.reviseStep('script', 'rewrite');
  const scriptV2 = h.accepted('script');
  assert.equal(characterV1.status, ArtifactStatus.STALE);

  h.state.stopped = false;
  h.plan('characterDesign', [{}]);
  await h.api.reviseStep('characterDesign', 'redo the designs');
  const characterV2 = h.accepted('characterDesign');
  assert.deepEqual(host(characterV2.sourceArtifactIds), [scriptV2.id]);

  const result = await h.api.rollbackToStep('characterDesign', { toArtifactId: characterV1.id });
  const characterV3 = h.accepted('characterDesign');
  assert.equal(characterV3.version, 3);
  assert.equal(characterV3.restoredFromArtifactId, characterV1.id);
  assert.equal(characterV3.parentArtifactId, characterV2.id);
  assert.deepEqual(host(characterV3.sourceArtifactIds), [scriptV1.id],
    'the restored version keeps its own provenance rather than the current upstream');
  assert.equal(result.supersededArtifactId, characterV2.id);
  assert.equal(characterV2.status, ArtifactStatus.SUPERSEDED);
  assert.deepEqual(host(result.staleStepIds), [], 'no adopted output downstream had consumed the replaced version');
  assert.deepEqual(host(result.resetStepIds), ['storyboard', 'referenceImages', 'videoGeneration', 'postProduction']);
  assert.equal(h.state.currentStep, 1);
  assert.deepEqual(h.orchestrator.runState.completedSteps, ['script', 'characterDesign']);
  assert.equal(h.accepted('script').id, scriptV2.id, 'rolling back one step does not touch another');
});

test('a rollback survives a page reload', async () => {
  const { h, v1, v3 } = await threeScriptVersions();
  await h.api.rollbackToStep('script', { toArtifactId: v1.id });
  const saved = JSON.parse(JSON.stringify(h.lastSnapshot()));

  const second = await createHarness();
  second.persistence.next = saved;
  second.api.restoreSession();

  const restored = second.accepted('script');
  assert.equal(restored.version, 4);
  assert.equal(restored.restoredFromArtifactId, v1.id);
  assert.equal(restored.parentArtifactId, v3.id);
  assert.deepEqual(host(restored.data), STEP_DATA.script);
  assert.equal(second.state.data.script.title, 'Original');
  assert.equal(second.store.get(v3.id).status, ArtifactStatus.SUPERSEDED);
  assert.equal(second.store.get(v1.id).status, ArtifactStatus.SUPERSEDED);
  assert.deepEqual(second.orchestrator.runState.completedSteps, ['script']);
  assert.deepEqual(second.orchestrator.checkpoint.restore('script'), { stepIndex: 0, acceptedArtifactId: restored.id });
  assert.equal(second.store.validateGraph().ok, true);
});
