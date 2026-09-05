export const ArtifactKind = Object.freeze({
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

let _counter = 0;

export function createArtifact({ kind, stepId, data, status = ArtifactStatus.PENDING, sourceArtifactIds = [] }) {
  return {
    id: `${stepId}-${kind}-${Date.now()}-${++_counter}`,
    kind,
    stepId,
    data,
    status,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    version: 1,
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
