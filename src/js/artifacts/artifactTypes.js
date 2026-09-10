export const ARTIFACT_SCHEMA_VERSION = 2;

export const ArtifactKind = Object.freeze({
  PROMPT_PACKAGE: 'promptPackage',
  SCRIPT: 'script',
  CHARACTER_DESIGN: 'characterDesign',
  STORYBOARD: 'storyboard',
  REFERENCE_IMAGE: 'referenceImage',
  VIDEO_CLIP: 'videoClip',
  FINAL_VIDEO: 'finalVideo',
  AUDIO: 'audio',
  METADATA: 'metadata',
});

export const ArtifactStatus = Object.freeze({
  PENDING: 'pending',
  GENERATING: 'generating',
  COMPLETE: 'complete',
  FAILED: 'failed',
  SUPERSEDED: 'superseded',
  STALE: 'stale',
});

export const StaleReasonCode = Object.freeze({
  UPSTREAM_REPLACED: 'UPSTREAM_REPLACED',
  UPSTREAM_ROLLED_BACK: 'UPSTREAM_ROLLED_BACK',
});

// Statuses that terminate an artifact's life: it can still be read as history,
// but it can never be accepted again nor consumed as a downstream input.
export const TERMINAL_ARTIFACT_STATUSES = Object.freeze([
  ArtifactStatus.FAILED,
  ArtifactStatus.SUPERSEDED,
  ArtifactStatus.STALE,
]);

let _counter = 0;

// Artifacts are immutable version records: revisions and rollbacks create a new
// artifact instead of overwriting an existing one. version/rootArtifactId are
// derived from parentArtifactId by ArtifactStore on commit.
export function createArtifact({
  kind,
  stepId,
  data,
  status = ArtifactStatus.PENDING,
  sourceArtifactIds = [],
  parentArtifactId = null,
  replacesArtifactId = null,
  restoredFromArtifactId = null,
}) {
  const now = Date.now();
  return {
    id: `${stepId}-${kind}-${now}-${++_counter}`,
    kind,
    stepId,
    data,
    status,
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
    version: 1,
    rootArtifactId: null,
    // Version evolution within one step. Distinct from sourceArtifactIds (business
    // inputs) and replacesArtifactId (the accepted version this one supersedes).
    parentArtifactId: parentArtifactId ?? null,
    replacesArtifactId: replacesArtifactId ?? null,
    restoredFromArtifactId: restoredFromArtifactId ?? null,
    acceptedAt: null,
    supersededAt: null,
    staleAt: null,
    staleReason: null,
    refs: {},
    provenance: null,
    sourceArtifactIds: [...sourceArtifactIds],
    itemLineage: {},
    metrics: null,
  };
}

export const ItemStatus = Object.freeze({
  PENDING: 'pending',
  COMPLETE: 'complete',
  FAILED: 'failed',
  SKIPPED: 'skipped',
});

export function recordItemAttempt(artifact, itemId, attemptData) {
  if (!artifact.itemLineage[itemId]) {
    artifact.itemLineage[itemId] = { itemId, attempts: [] };
  }
  artifact.itemLineage[itemId].attempts.push({
    attemptNumber: artifact.itemLineage[itemId].attempts.length + 1,
    timestamp: Date.now(),
    promptPackageId: attemptData.promptPackageId ?? null,
    promptPackageVersion: attemptData.promptPackageVersion ?? null,
    plannedMode: attemptData.plannedMode ?? null,
    executedMode: attemptData.executedMode ?? attemptData.videoMode ?? null,
    fallbackReason: attemptData.fallbackReason ?? null,
    provider: attemptData.provider ?? null,
    model: attemptData.model ?? null,
    modelVersion: attemptData.modelVersion ?? null,
    workflowId: attemptData.workflowId ?? null,
    workflowHash: attemptData.workflowHash ?? null,
    inputHash: attemptData.inputHash ?? null,
    outputHash: attemptData.outputHash ?? null,
    upstreamTaskId: attemptData.upstreamTaskId ?? null,
    seed: attemptData.seed ?? null,
    prompt: attemptData.prompt ?? null,
    referenceId: attemptData.referenceId ?? null,
    status: attemptData.status ?? null,
    error: attemptData.error ?? null,
  });
  artifact.updatedAt = Date.now();
}

export function getItemLineage(artifact, itemId) {
  return artifact.itemLineage[itemId] || null;
}
