// A checkpoint records where to resume and which artifact version was adopted.
// The artifact store is the single source of truth for the result payload, so a
// checkpoint never duplicates step data. Persistence lives in workflowSnapshot.js.
export class ExecutionCheckpoint {
  #checkpoints = new Map();

  save(stepId, { stepIndex, acceptedArtifactId }) {
    this.#checkpoints.set(stepId, {
      data: { stepIndex, acceptedArtifactId },
      savedAt: Date.now(),
    });
  }

  restore(stepId) {
    const entry = this.#checkpoints.get(stepId);
    if (!entry) return null;
    return structuredClone(entry.data);
  }

  has(stepId) {
    return this.#checkpoints.has(stepId);
  }

  clear(stepId) {
    if (stepId !== undefined) {
      this.#checkpoints.delete(stepId);
    } else {
      this.#checkpoints.clear();
    }
  }

  listCompleted() {
    return [...this.#checkpoints.keys()];
  }

  snapshot() {
    const result = {};
    for (const [key, entry] of this.#checkpoints) {
      result[key] = { data: structuredClone(entry.data), savedAt: entry.savedAt };
    }
    return result;
  }

  restoreSnapshot(snap) {
    this.#checkpoints.clear();
    if (!snap) return;
    for (const [key, entry] of Object.entries(snap)) {
      this.#checkpoints.set(key, {
        data: structuredClone(entry.data),
        savedAt: entry.savedAt ?? entry.timestamp ?? null,
      });
    }
  }
}
