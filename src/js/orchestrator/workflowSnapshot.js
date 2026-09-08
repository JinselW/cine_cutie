import { state } from '../state.js';

const STORAGE_KEY = 'cine-cutie-workflow';
const LEGACY_CHECKPOINT_KEY = 'cine-cutie-checkpoint';
const LEGACY_RUNSTATE_KEY = 'cine-cutie-runstate';

export const WORKFLOW_SCHEMA_VERSION = 2;

export class WorkflowSnapshotError extends Error {}

export function buildWorkflowSnapshot({ store, checkpoint, runState }) {
  return {
    schemaVersion: WORKFLOW_SCHEMA_VERSION,
    savedAt: Date.now(),
    mode: state.mode,
    artifacts: store.snapshot(),
    acceptedByStep: store.snapshotAccepted(),
    checkpoint: checkpoint.snapshot(),
    runState: runState.snapshot(),
  };
}

export function normalizeWorkflowSnapshot(raw) {
  if (!raw || typeof raw !== 'object') throw new WorkflowSnapshotError('saved session is not an object');
  const version = raw.schemaVersion ?? 1;
  if (typeof version !== 'number' || version < 1) throw new WorkflowSnapshotError(`unreadable session schema version: ${version}`);
  if (version > WORKFLOW_SCHEMA_VERSION) {
    throw new WorkflowSnapshotError(`session was saved by a newer version (schema ${version}, this build supports ${WORKFLOW_SCHEMA_VERSION})`);
  }
  return {
    schemaVersion: WORKFLOW_SCHEMA_VERSION,
    savedAt: raw.savedAt ?? null,
    mode: raw.mode ?? 'auto',
    artifacts: raw.artifacts ?? {},
    acceptedByStep: raw.acceptedByStep ?? {},
    checkpoint: raw.checkpoint ?? {},
    runState: raw.runState ?? null,
    // Schema 1 sessions carry checkpoint results but no artifact graph.
    legacy: version < WORKFLOW_SCHEMA_VERSION,
  };
}

export function loadPersistedWorkflow() {
  const current = readKey(STORAGE_KEY);
  if (current) {
    try {
      return normalizeWorkflowSnapshot(JSON.parse(current));
    } catch (error) {
      console.warn('[workflow] discarded saved session:', error.message);
    }
  }
  const legacyCheckpoint = readKey(LEGACY_CHECKPOINT_KEY);
  const legacyRunState = readKey(LEGACY_RUNSTATE_KEY);
  if (!legacyCheckpoint && !legacyRunState) return null;
  try {
    return normalizeWorkflowSnapshot({
      schemaVersion: 1,
      checkpoint: legacyCheckpoint ? JSON.parse(legacyCheckpoint) : {},
      runState: legacyRunState ? JSON.parse(legacyRunState) : null,
    });
  } catch (error) {
    console.warn('[workflow] discarded legacy session:', error.message);
    return null;
  }
}

export function persistWorkflowSnapshot(snapshot) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch (error) {
    console.warn('[workflow] session too large, retrying without historical payloads:', error.message);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stripHistoricalPayloads(snapshot)));
    } catch (retryError) {
      console.warn('[workflow] could not persist session:', retryError.message);
      return false;
    }
  }
  // The unified record supersedes the two keys written before schema 2.
  removeKey(LEGACY_CHECKPOINT_KEY);
  removeKey(LEGACY_RUNSTATE_KEY);
  return true;
}

export function clearPersistedWorkflow() {
  removeKey(STORAGE_KEY);
  removeKey(LEGACY_CHECKPOINT_KEY);
  removeKey(LEGACY_RUNSTATE_KEY);
}

// Keeps every version's lineage but drops the payload of versions that are no
// longer adopted; the accepted artifacts still rebuild the full session state.
function stripHistoricalPayloads(snapshot) {
  const artifacts = {};
  for (const [id, artifact] of Object.entries(snapshot.artifacts ?? {})) {
    const accepted = Object.values(snapshot.acceptedByStep ?? {}).includes(id);
    artifacts[id] = accepted ? artifact : { ...artifact, data: null };
  }
  return { ...snapshot, artifacts };
}

function readKey(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function removeKey(key) {
  try {
    localStorage.removeItem(key);
  } catch {}
}
