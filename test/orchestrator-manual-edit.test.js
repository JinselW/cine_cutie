// Run: node --experimental-vm-modules --test test/orchestrator-manual-edit.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { ArtifactStatus, StaleReasonCode } from '../src/js/artifacts/artifactTypes.js';
import { createHarness, host } from './helpers/orchestratorHarness.js';

test('a manual edit commits a new revision that supersedes the previous version', async () => {
  const h = await createHarness();
  await h.runPipeline(4);
  const boardV1 = h.accepted('storyboard');
  const referenceV1 = h.accepted('referenceImages');

  const edited = structuredClone(h.state.data.storyboard);
  edited.shots[0].type = 'close-up';
  const res = await h.api.applyManualEdit('storyboard', edited);

  assert.ok(res.acceptedArtifact, 'a revision artifact is returned');
  const boardV2 = h.accepted('storyboard');
  assert.equal(boardV2.version, 2);
  assert.equal(boardV2.parentArtifactId, boardV1.id);
  assert.equal(boardV2.replacesArtifactId, boardV1.id);
  assert.equal(boardV2.rootArtifactId, boardV1.id);
  assert.equal(boardV1.status, ArtifactStatus.SUPERSEDED);
  assert.equal(res.supersededArtifactId, boardV1.id);
  assert.equal(h.state.data.storyboard.shots[0].type, 'close-up');

  // Downstream that consumed the old version becomes stale.
  assert.equal(referenceV1.status, ArtifactStatus.STALE);
  assert.equal(referenceV1.staleReason.code, StaleReasonCode.UPSTREAM_REPLACED);
  assert.equal(h.state.data.referenceImages, null);
  assert.equal(h.accepted('referenceImages'), null);
  assert.deepEqual(host(res.staleArtifactIds), [referenceV1.id]);
  assert.ok(host(res.staleStepIds).includes('referenceImages'));
});

test('a manual edit preserves upstream dependencies of the edited step', async () => {
  const h = await createHarness();
  await h.runPipeline(3);
  const storyboard = h.accepted('storyboard');
  assert.equal(storyboard.sourceArtifactIds.length, 1, 'storyboard depends only on script');

  const edited = structuredClone(h.state.data.storyboard);
  edited.shots[0].description = 'rewritten';
  await h.api.applyManualEdit('storyboard', edited);

  const boardV2 = h.accepted('storyboard');
  assert.deepEqual(host(boardV2.sourceArtifactIds), host(storyboard.sourceArtifactIds),
    'manual edit keeps the same upstream sources so the dependency graph stays intact');
  assert.equal(h.state.data.storyboard.shots[0].description, 'rewritten');
});

test('a manual edit that fails structural validation is rejected without side effects', async () => {
  const h = await createHarness();
  await h.runPipeline(2);
  const charV1 = h.accepted('characterDesign');

  const res = await h.api.applyManualEdit('characterDesign', {});
  assert.equal(res, null);
  assert.equal(h.accepted('characterDesign').id, charV1.id, 'the accepted version is unchanged');
  assert.equal(h.accepted('characterDesign').status, ArtifactStatus.COMPLETE);
  assert.equal(h.state.data.characterDesign.characters.length, 1);
});

test('a manual edit on an earlier completed step leaves script adopted', async () => {
  const h = await createHarness();
  await h.runPipeline(3);
  const scriptV1 = h.accepted('script');

  const edited = structuredClone(h.state.data.characterDesign);
  edited.characters[0].name = 'Renamed';
  await h.api.applyManualEdit('characterDesign', edited);

  assert.equal(h.accepted('script').id, scriptV1.id, 'script stays adopted');
  assert.equal(h.accepted('characterDesign').data.characters[0].name, 'Renamed');
  assert.equal(h.state.data.script.title, h.accepted('script').data.title);
});
