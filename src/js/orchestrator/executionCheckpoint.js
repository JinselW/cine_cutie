const STORAGE_KEY = 'cine-cutie-checkpoint';

export class ExecutionCheckpoint {
  #checkpoints = new Map();

  save(stepId, data) {
    this.#checkpoints.set(stepId, {
      data: structuredClone(data),
      timestamp: Date.now(),
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
      result[key] = { data: structuredClone(entry.data), timestamp: entry.timestamp };
    }
    return result;
  }

  restoreSnapshot(snap) {
    this.#checkpoints.clear();
    if (!snap) return;
    for (const [key, entry] of Object.entries(snap)) {
      this.#checkpoints.set(key, {
        data: structuredClone(entry.data),
        timestamp: entry.timestamp,
      });
    }
  }

  persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.snapshot()));
    } catch {}
  }

  loadPersisted() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      this.restoreSnapshot(JSON.parse(raw));
      return true;
    } catch {
      return false;
    }
  }

  clearPersisted() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
  }
}
