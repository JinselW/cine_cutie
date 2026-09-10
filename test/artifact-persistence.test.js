// Run: node --experimental-vm-modules --test test/artifact-persistence.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { ArtifactStore } from '../src/js/artifacts/artifactStore.js';
import { ArtifactStatus, createArtifact } from '../src/js/artifacts/artifactTypes.js';
import { ExecutionCheckpoint } from '../src/js/orchestrator/executionCheckpoint.js';
import { RunState } from '../src/js/orchestrator/runState.js';
import {
  WORKFLOW_SCHEMA_VERSION,
  WorkflowSnapshotError,
  buildWorkflowSnapshot,
  clearPersistedWorkflow,
  loadPersistedWorkflow,
  normalizeWorkflowSnapshot,
  persistWorkflowSnapshot,
} from '../src/js/orchestrator/workflowSnapshot.js';
import { createHarness, host, STEP_DATA } from './helpers/orchestratorHarness.js';

const WORKFLOW_KEY = 'cine-cutie-workflow';
const LEGACY_CHECKPOINT_KEY = 'cine-cutie-checkpoint';
const LEGACY_RUNSTATE_KEY = 'cine-cutie-runstate';

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: key => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
}

// workflowSnapshot.js reaches for the browser global, and refusing a bad record
// is expected behaviour rather than a problem worth printing during a test run.
function withStorage(storage, body) {
  const previousStorage = globalThis.localStorage;
  const previousWarn = console.warn;
  globalThis.localStorage = storage;
  console.warn = () => {};
  try {
    return body();
  } finally {
    globalThis.localStorage = previousStorage;
    console.warn = previousWarn;
  }
}

function savedSession() {
  const store = new ArtifactStore();
  const checkpoint = new ExecutionCheckpoint();
  const runState = new RunState();
  runState.startPipeline();

  const scriptV1 = createArtifact({ kind: 'script', stepId: 'script', data: { title: 'First' }, status: ArtifactStatus.COMPLETE });
  store.commit(scriptV1);
  store.acceptArtifact(scriptV1.id);

  const scriptV2 = createArtifact({
    kind: 'script', stepId: 'script', data: { title: 'Second' },
    status: ArtifactStatus.COMPLETE, parentArtifactId: scriptV1.id,
  });
  store.commit(scriptV2);
  store.replaceAcceptedArtifact(scriptV2.id);

  const character = createArtifact({
    kind: 'characterDesign', stepId: 'characterDesign', data: { characters: [] },
    status: ArtifactStatus.COMPLETE, sourceArtifactIds: [scriptV2.id],
  });
  store.commit(character);
  store.acceptArtifact(character.id);

  for (const pair of [[0, scriptV2], [1, character]]) {
    checkpoint.save(pair[1].stepId, { stepIndex: pair[0], acceptedArtifactId: pair[1].id });
    runState.completeStep(pair[1].stepId);
  }
  runState.enterStep(2, 'storyboard');

  return { store, checkpoint, runState, scriptV1, scriptV2, character };
}

// Reloading must not hand the second orchestrator the same objects the first one
// is still mutating, so every snapshot under test goes through serialization.
function serialized(snapshot) {
  return JSON.parse(JSON.stringify(snapshot));
}

test('the saved record carries the artifact graph and the accepted pointers together', () => {
  const { store, checkpoint, runState, scriptV1, scriptV2, character } = savedSession();
  const snapshot = buildWorkflowSnapshot({ store, checkpoint, runState });

  assert.equal(snapshot.schemaVersion, WORKFLOW_SCHEMA_VERSION);
  assert.ok(snapshot.savedAt > 0);
  assert.deepEqual(Object.keys(snapshot.artifacts).sort(), [character.id, scriptV1.id, scriptV2.id].sort());
  assert.deepEqual(snapshot.acceptedByStep, { script: scriptV2.id, characterDesign: character.id });
  assert.equal(snapshot.artifacts[scriptV1.id].status, ArtifactStatus.SUPERSEDED,
    'history is persisted, not only the current version');
  assert.deepEqual(snapshot.checkpoint.script.data, { stepIndex: 0, acceptedArtifactId: scriptV2.id });
  assert.deepEqual(snapshot.checkpoint.characterDesign.data, { stepIndex: 1, acceptedArtifactId: character.id });
  assert.ok(snapshot.checkpoint.script.savedAt > 0);
  assert.deepEqual(snapshot.runState.completedSteps, ['script', 'characterDesign']);
});

test('persisting writes one key and retires the two keys used before schema 2', () => {
  const { store, checkpoint, runState, scriptV2 } = savedSession();
  const snapshot = buildWorkflowSnapshot({ store, checkpoint, runState });
  const storage = createStorage({ [LEGACY_CHECKPOINT_KEY]: '{}', [LEGACY_RUNSTATE_KEY]: '{}' });

  assert.equal(withStorage(storage, () => persistWorkflowSnapshot(snapshot)), true);
  assert.deepEqual([...storage.values.keys()], [WORKFLOW_KEY]);
  assert.deepEqual(JSON.parse(storage.values.get(WORKFLOW_KEY)).acceptedByStep.script, scriptV2.id);
});

test('a stored record reloads as the same graph and is not flagged as legacy', () => {
  const { store, checkpoint, runState } = savedSession();
  const snapshot = serialized(buildWorkflowSnapshot({ store, checkpoint, runState }));
  const storage = createStorage();
  const loaded = withStorage(storage, () => {
    persistWorkflowSnapshot(snapshot);
    return loadPersistedWorkflow();
  });

  assert.deepEqual(loaded, { ...normalizeWorkflowSnapshot(snapshot), savedAt: loaded.savedAt });
  assert.equal(loaded.legacy, false);
  assert.deepEqual(loaded.acceptedByStep, snapshot.acceptedByStep);
  assert.deepEqual(Object.keys(loaded.artifacts).sort(), Object.keys(snapshot.artifacts).sort());
});

test('a quota error keeps the adopted payloads and drops only historical ones', () => {
  const { store, checkpoint, runState, scriptV1, scriptV2 } = savedSession();
  const snapshot = buildWorkflowSnapshot({ store, checkpoint, runState });
  const storage = createStorage();
  let writes = 0;
  storage.setItem = (key, value) => {
    if (++writes === 1) throw new Error('QuotaExceededError');
    storage.values.set(key, String(value));
  };

  assert.equal(withStorage(storage, () => persistWorkflowSnapshot(snapshot)), true);
  const stored = JSON.parse(storage.values.get(WORKFLOW_KEY));
  assert.deepEqual(stored.artifacts[scriptV2.id].data, { title: 'Second' }, 'the adopted version stays restorable');
  assert.equal(stored.artifacts[scriptV1.id].data, null);
  assert.equal(stored.artifacts[scriptV1.id].status, ArtifactStatus.SUPERSEDED,
    'lineage survives even when the payload had to be dropped');
});

test('a record saved by a newer build is refused instead of half-applied', () => {
  assert.throws(
    () => normalizeWorkflowSnapshot({ schemaVersion: WORKFLOW_SCHEMA_VERSION + 1 }),
    error => error instanceof WorkflowSnapshotError && /newer version/.test(error.message),
  );
  assert.throws(() => normalizeWorkflowSnapshot('nope'), WorkflowSnapshotError);
  assert.throws(() => normalizeWorkflowSnapshot({ schemaVersion: 0 }), WorkflowSnapshotError);

  const storage = createStorage({ [WORKFLOW_KEY]: JSON.stringify({ schemaVersion: 99 }) });
  assert.equal(withStorage(storage, () => loadPersistedWorkflow()), null);
});

test('an unreadable current record falls back to the two legacy keys', () => {
  const storage = createStorage({
    [WORKFLOW_KEY]: '{not json',
    [LEGACY_CHECKPOINT_KEY]: JSON.stringify({ script: { data: { stepIndex: 0, result: STEP_DATA.script }, timestamp: 10 } }),
    [LEGACY_RUNSTATE_KEY]: JSON.stringify({ status: 'interrupted', currentStepIndex: 0, completedSteps: ['script'] }),
  });

  const loaded = withStorage(storage, () => loadPersistedWorkflow());
  assert.equal(loaded.schemaVersion, WORKFLOW_SCHEMA_VERSION);
  assert.equal(loaded.legacy, true);
  assert.deepEqual(loaded.artifacts, {});
  assert.deepEqual(loaded.acceptedByStep, {});
  assert.deepEqual(loaded.checkpoint.script.data.result, STEP_DATA.script);
  assert.deepEqual(loaded.runState.completedSteps, ['script']);
});

test('clearing removes the current record and both legacy keys', () => {
  const storage = createStorage({ [WORKFLOW_KEY]: '{}', [LEGACY_CHECKPOINT_KEY]: '{}', [LEGACY_RUNSTATE_KEY]: '{}' });
  withStorage(storage, () => clearPersistedWorkflow());
  assert.equal(storage.values.size, 0);
});

test('restoring a session rebuilds state, entities and the resume point from adopted versions', async () => {
  const first = await createHarness();
  await first.runPipeline(4);
  const saved = serialized(first.lastSnapshot());

  const second = await createHarness();
  second.persistence.next = saved;
  second.api.restoreSession();

  assert.deepEqual(second.state.data, {
    script: STEP_DATA.script,
    characterDesign: STEP_DATA.characterDesign,
    storyboard: STEP_DATA.storyboard,
    referenceImages: STEP_DATA.referenceImages,
    videoClips: null,
    finalVideo: null,
  });
  assert.deepEqual(second.state.entities, { script: true, characterDesign: true, storyboard: true, referenceImages: true });
  assert.deepEqual(second.orchestrator.runState.completedSteps,
    ['script', 'characterDesign', 'storyboard', 'referenceImages']);
  assert.deepEqual(second.orchestrator.checkpoint.restore('storyboard'),
    { stepIndex: 2, acceptedArtifactId: saved.acceptedByStep.storyboard });
  assert.equal(second.state.currentStep, saved.runState.currentStepIndex);
  assert.equal(second.accepted('script').id, saved.acceptedByStep.script);
  assert.equal(second.store.validateGraph().ok, true);
});

test('a restored session keeps the creative inputs it was started with', async () => {
  const first = await createHarness();
  Object.assign(first.state, { totalDuration: 5, genre: 'romance', userInput: 'a girl at the tide line' });
  await first.runPipeline(4);
  const saved = serialized(first.lastSnapshot());

  const second = await createHarness();
  second.persistence.next = saved;
  second.api.restoreSession();

  assert.equal(second.state.totalDuration, 5, 'delivery QC must judge the cut against the requested length');
  assert.equal(second.state.genre, 'romance');
  assert.equal(second.state.userInput, 'a girl at the tide line');
});

test('a session saved before inputs were persisted does not clobber current state', async () => {
  const first = await createHarness();
  await first.runPipeline(2);
  const saved = serialized({ ...first.lastSnapshot(), input: undefined });

  const second = await createHarness();
  second.state.totalDuration = 12;
  second.persistence.next = saved;
  second.api.restoreSession();

  assert.equal(second.state.totalDuration, 12);
});

test('dependency traversal is identical after a reload', async () => {
  const first = await createHarness();
  await first.runPipeline(4);
  const saved = serialized(first.lastSnapshot());

  const second = await createHarness();
  second.persistence.next = saved;
  second.api.restoreSession();
  second.plan('script', [{ data: { ...STEP_DATA.script, title: 'Rewritten' } }]);
  await second.api.reviseStep('script', 'rewrite');

  const scriptV2 = second.accepted('script');
  assert.equal(scriptV2.version, 2, 'the reloaded lineage keeps counting from the stored version');
  assert.equal(scriptV2.parentArtifactId, saved.acceptedByStep.script);
  assert.equal(scriptV2.rootArtifactId, saved.acceptedByStep.script);
  assert.equal(second.store.get(saved.acceptedByStep.script).status, ArtifactStatus.SUPERSEDED);

  for (const stepId of ['characterDesign', 'storyboard', 'referenceImages']) {
    const stale = second.store.get(saved.acceptedByStep[stepId]);
    assert.equal(stale.status, ArtifactStatus.STALE, `${stepId} consumed the replaced version`);
    assert.equal(stale.staleReason.code, 'UPSTREAM_REPLACED');
    assert.equal(stale.staleReason.sourceArtifactId, saved.acceptedByStep.script);
    assert.equal(stale.staleReason.replacementArtifactId, scriptV2.id);
    assert.equal(second.accepted(stepId), null);
    assert.equal(second.state.data[stepId], null);
    assert.equal(second.orchestrator.checkpoint.has(stepId), false);
  }
  assert.deepEqual(second.orchestrator.runState.completedSteps, ['script']);
  assert.equal(second.state.currentStep, 0);

  assert.equal(first.store.get(saved.acceptedByStep.storyboard).status, ArtifactStatus.COMPLETE,
    'the reload produced copies, so the saved session is not mutated from afar');
});

test('a checkpoint whose adopted artifact is gone or unusable is not restored as a result', async () => {
  const first = await createHarness();
  await first.runPipeline(1);
  const saved = serialized(first.lastSnapshot());
  const scriptId = saved.acceptedByStep.script;

  const cases = {
    missing: snapshot => { delete snapshot.artifacts[scriptId]; },
    failed: snapshot => { snapshot.artifacts[scriptId].status = ArtifactStatus.FAILED; },
    stale: snapshot => { snapshot.artifacts[scriptId].status = ArtifactStatus.STALE; },
  };

  for (const [label, tamper] of Object.entries(cases)) {
    const broken = serialized(saved);
    tamper(broken);
    const h = await createHarness();
    h.persistence.next = broken;
    const warn = console.warn;
    console.warn = () => {};
    try {
      h.api.restoreSession();
    } finally {
      console.warn = warn;
    }

    assert.equal(h.accepted('script'), null, `${label}: nothing is adopted for the step`);
    assert.equal(h.state.data.script, null, `${label}: the page has no result to show`);
    assert.deepEqual(h.orchestrator.runState.completedSteps, [], `${label}: the step is not resumable as complete`);
    assert.deepEqual(h.orchestrator.checkpoint.restore('script'), { stepIndex: 0, acceptedArtifactId: scriptId },
      `${label}: the dangling pointer is kept so the problem stays diagnosable`);
    assert.equal(h.store.validateGraph().ok, false, `${label}: the broken record is reported, not hidden`);
  }
});

test('a schema-1 session is migrated into a real artifact graph and written back', async () => {
  const legacy = {
    schemaVersion: 1,
    savedAt: 2000,
    artifacts: {},
    acceptedByStep: {},
    checkpoint: {
      script: { data: { stepIndex: 0, dataKey: 'script', result: STEP_DATA.script }, timestamp: 1000 },
      characterDesign: { data: { stepIndex: 1, dataKey: 'characterDesign', result: STEP_DATA.characterDesign }, timestamp: 2000 },
    },
    runState: {
      status: 'interrupted', currentStepIndex: 1,
      completedSteps: ['script', 'characterDesign'], startedAt: 500, updatedAt: 2000,
    },
  };

  const h = await createHarness();
  h.persistence.next = legacy;
  assert.equal(h.api.restoreSession(), true, 'an interrupted run is offered for resume');

  const script = h.accepted('script');
  const character = h.accepted('characterDesign');
  assert.ok(script && character);
  assert.deepEqual(script.data, STEP_DATA.script);
  assert.equal(script.version, 1);
  assert.equal(script.provenance.agent, 'migration');
  assert.deepEqual(host(character.sourceArtifactIds), [script.id],
    'migration derives the dependency edge the legacy record never stored');
  assert.deepEqual(h.orchestrator.checkpoint.restore('characterDesign'),
    { stepIndex: 1, acceptedArtifactId: character.id });
  assert.deepEqual(h.state.data.script, STEP_DATA.script);
  assert.deepEqual(h.orchestrator.runState.completedSteps, ['script', 'characterDesign']);
  assert.equal(h.state.currentStep, 1);
  assert.equal(h.store.validateGraph().ok, true);
  assert.deepEqual(h.lastSnapshot().acceptedByStep, { script: script.id, characterDesign: character.id });
});

test('clearing a session empties the store and the persisted record', async () => {
  const h = await createHarness();
  await h.runPipeline(2);
  h.api.clearSession();

  assert.deepEqual(h.store.listAll(), []);
  assert.deepEqual(h.store.snapshotAccepted(), {});
  assert.deepEqual(h.orchestrator.checkpoint.listCompleted(), []);
  assert.deepEqual(h.state.data, {
    script: null, characterDesign: null, storyboard: null,
    referenceImages: null, videoClips: null, finalVideo: null,
  });
  assert.equal(h.persistence.next, null);
  assert.equal(h.persistence.snapshots.length, 0);
});
