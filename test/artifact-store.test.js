// Run: node --experimental-vm-modules --test test/artifact-store.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { ArtifactStore } from '../src/js/artifacts/artifactStore.js';
import { ArtifactStatus, StaleReasonCode, createArtifact } from '../src/js/artifacts/artifactTypes.js';

function complete(store, stepId, data, { sourceArtifactIds = [], kind = stepId, status = ArtifactStatus.COMPLETE } = {}) {
  const artifact = createArtifact({ kind, stepId, data, status, sourceArtifactIds });
  store.commit(artifact, { provenance: { agent: stepId } });
  return artifact;
}

function revisionOf(store, stepId, data, { sourceArtifactIds = [], status = ArtifactStatus.COMPLETE } = {}) {
  const artifact = store.createRevision(stepId, { kind: stepId, data, sourceArtifactIds, status });
  store.commit(artifact);
  return artifact;
}

test('first accepted artifact is version 1 and roots itself', () => {
  const store = new ArtifactStore();
  assert.equal(createArtifact({ kind: 'script', stepId: 'script', data: {} }).rootArtifactId, null, 'root is derived by the store, not the factory');
  const v1 = complete(store, 'script', { title: 'A' });
  assert.equal(v1.version, 1);
  assert.equal(v1.parentArtifactId, null);
  assert.equal(v1.rootArtifactId, v1.id);
  const change = store.replaceAcceptedArtifact(v1.id);
  assert.equal(change.supersededArtifact, null);
  assert.deepEqual(change.staleArtifactIds, []);
  assert.equal(store.getAcceptedByStep('script').id, v1.id);
});

test('accepted revision becomes version 2 and supersedes version 1', () => {
  const store = new ArtifactStore();
  const v1 = complete(store, 'script', { title: 'A' });
  store.replaceAcceptedArtifact(v1.id);
  const v2 = revisionOf(store, 'script', { title: 'B' });
  const change = store.replaceAcceptedArtifact(v2.id);

  assert.equal(v2.version, 2);
  assert.equal(v2.parentArtifactId, v1.id);
  assert.equal(v2.rootArtifactId, v1.id);
  assert.equal(v2.replacesArtifactId, v1.id);
  assert.equal(change.supersededArtifact.id, v1.id);
  assert.equal(store.get(v1.id).status, ArtifactStatus.SUPERSEDED);
  assert.ok(store.get(v1.id).supersededAt > 0);
  assert.equal(store.getAcceptedByStep('script').id, v2.id);
  assert.equal(store.getByStep('script').length, 2, 'history is preserved, never overwritten');
});

test('one step keeps exactly one accepted version across three revisions', () => {
  const store = new ArtifactStore();
  const versions = [];
  for (const title of ['A', 'B', 'C', 'D']) {
    const artifact = versions.length === 0
      ? complete(store, 'script', { title })
      : revisionOf(store, 'script', { title });
    store.replaceAcceptedArtifact(artifact.id);
    versions.push(artifact);
  }
  assert.deepEqual(versions.map(v => v.version), [1, 2, 3, 4]);
  assert.equal(store.getAcceptedByStep('script').id, versions[3].id);
  assert.deepEqual(store.snapshotAccepted(), { script: versions[3].id });
  assert.deepEqual(versions.slice(0, 3).map(v => store.get(v.id).status), [
    ArtifactStatus.SUPERSEDED, ArtifactStatus.SUPERSEDED, ArtifactStatus.SUPERSEDED,
  ]);
});

test('a failed revision never replaces the accepted version', () => {
  const store = new ArtifactStore();
  const v1 = complete(store, 'script', { title: 'A' });
  store.replaceAcceptedArtifact(v1.id);
  const v2 = revisionOf(store, 'script', { title: 'Broken' }, { status: ArtifactStatus.FAILED });

  assert.equal(v2.version, 2);
  assert.equal(store.replaceAcceptedArtifact(v2.id), null);
  assert.equal(store.getAcceptedByStep('script').id, v1.id);
  assert.equal(store.get(v1.id).status, ArtifactStatus.COMPLETE);
});

test('version numbers stay monotonic after a failed revision', () => {
  const store = new ArtifactStore();
  const v1 = complete(store, 'script', { title: 'A' });
  store.replaceAcceptedArtifact(v1.id);
  const failed = revisionOf(store, 'script', { title: 'Broken' }, { status: ArtifactStatus.FAILED });
  const v3 = revisionOf(store, 'script', { title: 'C' });

  assert.equal(failed.version, 2);
  assert.equal(v3.version, 3);
  assert.equal(v3.parentArtifactId, failed.id, 'chains onto the lineage head, not the accepted version');
  store.replaceAcceptedArtifact(v3.id);
  assert.equal(v3.replacesArtifactId, v1.id);
  assert.equal(store.getAcceptedByStep('script').id, v3.id);
});

test('pending and generating artifacts cannot be accepted or consumed', () => {
  const store = new ArtifactStore();
  for (const status of [ArtifactStatus.PENDING, ArtifactStatus.GENERATING]) {
    const artifact = complete(store, 'script', { title: status }, { status });
    assert.equal(store.replaceAcceptedArtifact(artifact.id), null);
    assert.equal(store.acceptArtifact(artifact.id), false);
    assert.equal(store.getAcceptedByStep('script'), null);
  }
});

test('an accepted artifact that turns stale stops being resolvable', () => {
  const store = new ArtifactStore();
  const script = complete(store, 'script', { title: 'A' });
  store.replaceAcceptedArtifact(script.id);
  const board = complete(store, 'storyboard', { shots: [] }, { sourceArtifactIds: [script.id] });
  store.replaceAcceptedArtifact(board.id);

  const scriptV2 = revisionOf(store, 'script', { title: 'B' });
  const change = store.replaceAcceptedArtifact(scriptV2.id);

  assert.deepEqual(change.staleArtifactIds, [board.id]);
  assert.equal(store.get(board.id).status, ArtifactStatus.STALE);
  assert.deepEqual(store.get(board.id).staleReason, {
    code: StaleReasonCode.UPSTREAM_REPLACED,
    sourceArtifactId: script.id,
    replacementArtifactId: scriptV2.id,
    detectedAt: store.get(board.id).staleReason.detectedAt,
  });
  assert.equal(store.getAcceptedByStep('storyboard'), null, 'stale output is no longer the adopted version');
});

test('replacing an upstream version invalidates the whole downstream chain', () => {
  const store = new ArtifactStore();
  const script = complete(store, 'script', { title: 'A' });
  store.replaceAcceptedArtifact(script.id);
  const character = complete(store, 'characterDesign', { characters: [] }, { sourceArtifactIds: [script.id] });
  const board = complete(store, 'storyboard', { shots: [] }, { sourceArtifactIds: [script.id] });
  const reference = complete(store, 'referenceImages', { shots: [] }, { sourceArtifactIds: [board.id, character.id] });
  const video = complete(store, 'videoGeneration', { clips: [] }, { sourceArtifactIds: [reference.id] });
  const final = complete(store, 'postProduction', { finalVideo: 'v.mp4' }, { sourceArtifactIds: [video.id] });
  for (const artifact of [character, board, reference, video, final]) store.replaceAcceptedArtifact(artifact.id);

  const scriptV2 = revisionOf(store, 'script', { title: 'B' });
  const change = store.replaceAcceptedArtifact(scriptV2.id);

  assert.deepEqual(new Set(change.staleArtifactIds), new Set([character.id, board.id, reference.id, video.id, final.id]));
  assert.deepEqual(store.snapshotAccepted(), { script: scriptV2.id });
});

test('an unrelated branch is untouched by upstream invalidation', () => {
  const store = new ArtifactStore();
  const script = complete(store, 'script', { title: 'A' });
  store.replaceAcceptedArtifact(script.id);
  const board = complete(store, 'storyboard', { shots: [] }, { sourceArtifactIds: [script.id] });
  store.replaceAcceptedArtifact(board.id);
  const audio = complete(store, 'audio', { track: 'a.mp3' });
  store.replaceAcceptedArtifact(audio.id);

  const boardV2 = revisionOf(store, 'storyboard', { shots: [1] }, { sourceArtifactIds: [script.id] });
  assert.deepEqual(store.replaceAcceptedArtifact(boardV2.id).staleArtifactIds, []);
  assert.equal(store.get(script.id).status, ArtifactStatus.COMPLETE, 'a downstream revision never invalidates its upstream');
  assert.equal(store.getAcceptedByStep('script').id, script.id);

  const scriptV2 = revisionOf(store, 'script', { title: 'B' });
  const change = store.replaceAcceptedArtifact(scriptV2.id);
  assert.deepEqual(change.staleArtifactIds, [boardV2.id], 'only the branch that consumed script v1 is invalidated');
  assert.equal(store.get(boardV2.id).status, ArtifactStatus.STALE);
  assert.equal(store.get(board.id).status, ArtifactStatus.SUPERSEDED, 'superseded history is not rewritten as stale');
  assert.equal(store.get(audio.id).status, ArtifactStatus.COMPLETE);
  assert.equal(store.getAcceptedByStep('audio').id, audio.id);
  assert.equal(store.getAcceptedByStep('storyboard'), null);
});

test('an artifact with several inputs goes stale when only one is replaced', () => {
  const store = new ArtifactStore();
  const script = complete(store, 'script', { title: 'A' });
  const design = complete(store, 'characterDesign', { characters: [] });
  store.replaceAcceptedArtifact(script.id);
  store.replaceAcceptedArtifact(design.id);
  const board = complete(store, 'storyboard', { shots: [] }, { sourceArtifactIds: [script.id, design.id] });
  store.replaceAcceptedArtifact(board.id);

  const designV2 = revisionOf(store, 'characterDesign', { characters: [{}] });
  const change = store.replaceAcceptedArtifact(designV2.id);

  assert.deepEqual(change.staleArtifactIds, [board.id]);
  assert.equal(store.get(script.id).status, ArtifactStatus.COMPLETE);
});

test('terminal artifacts are left alone but still traversed', () => {
  const store = new ArtifactStore();
  const script = complete(store, 'script', { title: 'A' });
  store.replaceAcceptedArtifact(script.id);
  const failedDraft = complete(store, 'storyboard', { shots: [] }, { sourceArtifactIds: [script.id], status: ArtifactStatus.FAILED });
  const board = complete(store, 'storyboard', { shots: [1] }, { sourceArtifactIds: [script.id] });
  store.replaceAcceptedArtifact(board.id);
  const reference = complete(store, 'referenceImages', { shots: [] }, { sourceArtifactIds: [board.id] });
  store.replaceAcceptedArtifact(reference.id);

  const scriptV2 = revisionOf(store, 'script', { title: 'B' });
  const change = store.replaceAcceptedArtifact(scriptV2.id);

  assert.deepEqual(change.staleArtifactIds, [board.id, reference.id]);
  assert.equal(store.get(failedDraft.id).status, ArtifactStatus.FAILED);
  assert.equal(store.get(failedDraft.id).staleReason, null);
});

test('getDependents supports shallow and recursive traversal', () => {
  const store = new ArtifactStore();
  const script = complete(store, 'script', { title: 'A' });
  const board = complete(store, 'storyboard', { shots: [] }, { sourceArtifactIds: [script.id] });
  const reference = complete(store, 'referenceImages', { shots: [] }, { sourceArtifactIds: [board.id] });

  assert.deepEqual(store.getDependents(script.id, { recursive: false }).map(a => a.id), [board.id]);
  assert.deepEqual(store.getDependents(script.id).map(a => a.id), [board.id, reference.id]);
  assert.deepEqual(store.getDependents(reference.id), []);
});

test('validateGraph reports cycles, dangling references and bad acceptance', () => {
  const store = new ArtifactStore();
  const script = complete(store, 'script', { title: 'A' });
  store.replaceAcceptedArtifact(script.id);
  const board = complete(store, 'storyboard', { shots: [] }, { sourceArtifactIds: [script.id, 'ghost'] });
  assert.deepEqual(store.validateGraph().issues, [{ code: 'SOURCE_MISSING', artifactId: board.id, sourceArtifactId: 'ghost' }]);

  script.sourceArtifactIds = [board.id];
  const cyclic = store.validateGraph();
  assert.equal(cyclic.ok, false);
  assert.deepEqual(cyclic.issues.map(issue => issue.code).sort(), ['DEPENDENCY_CYCLE', 'SOURCE_MISSING']);
  assert.deepEqual(cyclic.issues.find(issue => issue.code === 'DEPENDENCY_CYCLE').artifactIds, [script.id, board.id, script.id]);

  const broken = new ArtifactStore();
  const failed = complete(broken, 'script', { title: 'A' }, { status: ArtifactStatus.FAILED });
  broken.restoreAccepted({ script: failed.id, storyboard: 'storyboard-ghost' });
  assert.deepEqual(broken.validateGraph().issues, [
    { code: 'ACCEPTED_NOT_COMPLETE', stepId: 'script', artifactId: failed.id, status: ArtifactStatus.FAILED },
    { code: 'ACCEPTED_MISSING', stepId: 'storyboard', artifactId: 'storyboard-ghost' },
  ]);
  assert.equal(broken.getAcceptedByStep('storyboard'), null);
  assert.equal(broken.getAcceptedByStep('script'), null);
});

test('snapshot round-trip preserves versions, lineage and acceptance', () => {
  const store = new ArtifactStore();
  const script = complete(store, 'script', { title: 'A' });
  store.replaceAcceptedArtifact(script.id);
  const scriptV2 = revisionOf(store, 'script', { title: 'B' });
  store.replaceAcceptedArtifact(scriptV2.id);
  const board = complete(store, 'storyboard', { shots: [] }, { sourceArtifactIds: [scriptV2.id] });
  store.replaceAcceptedArtifact(board.id);

  const restored = new ArtifactStore();
  restored.restore(store.snapshot());
  restored.restoreAccepted(store.snapshotAccepted());

  assert.equal(restored.get(scriptV2.id).version, 2);
  assert.equal(restored.get(scriptV2.id).parentArtifactId, script.id);
  assert.equal(restored.get(scriptV2.id).rootArtifactId, script.id);
  assert.equal(restored.getAcceptedByStep('script').id, scriptV2.id);
  assert.equal(restored.getAcceptedByStep('storyboard').id, board.id);
  assert.deepEqual(restored.validateGraph(), { ok: true, issues: [] });

  const scriptV3 = restored.createRevision('script', { kind: 'script', data: { title: 'C' }, status: ArtifactStatus.COMPLETE });
  restored.commit(scriptV3);
  assert.equal(scriptV3.version, 3, 'version numbering continues after a reload');
});

test('restore migrates schema v1 artifacts without lineage fields', () => {
  const legacy = {
    'script-1': { id: 'script-1', kind: 'script', stepId: 'script', data: { title: 'A' }, status: ArtifactStatus.COMPLETE, sourceArtifactIds: [] },
    'storyboard-1': { id: 'storyboard-1', kind: 'storyboard', stepId: 'storyboard', data: { shots: [] }, status: ArtifactStatus.COMPLETE, sourceArtifactIds: ['script-1'] },
  };
  const store = new ArtifactStore();
  store.restore(legacy);

  assert.equal(store.get('script-1').version, 1);
  assert.equal(store.get('script-1').rootArtifactId, 'script-1');
  assert.equal(store.get('script-1').schemaVersion, 2);
  assert.equal(store.get('script-1').staleReason, null);
  assert.deepEqual(store.validateGraph(), { ok: true, issues: [] });
  assert.deepEqual(store.getDependents('script-1').map(a => a.id), ['storyboard-1']);
});

test('snapshot strips base64 payloads but keeps lineage metadata', () => {
  const store = new ArtifactStore();
  const artifact = complete(store, 'referenceImages', {
    shots: [{ shot_id: 1, image: `data:image/png;base64,${'A'.repeat(200)}` }],
  });
  const snap = store.snapshot();
  assert.equal(snap[artifact.id].data.shots[0].image, '');
  assert.equal(snap[artifact.id].version, 1);
});

test('deleting an accepted artifact clears the acceptance pointer', () => {
  const store = new ArtifactStore();
  const script = complete(store, 'script', { title: 'A' });
  store.replaceAcceptedArtifact(script.id);
  assert.equal(store.delete(script.id), true);
  assert.equal(store.getAcceptedByStep('script'), null);
  assert.deepEqual(store.snapshotAccepted(), {});
  store.clear();
  assert.deepEqual(store.listAll(), []);
});
