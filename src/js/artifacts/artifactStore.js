import { ArtifactStatus } from './artifactTypes.js';

export class ArtifactStore {
  #artifacts = new Map();
  #byStep = new Map();

  commit(artifact, { provenance } = {}) {
    const existed = this.#artifacts.has(artifact.id);
    if (existed) {
      const existing = this.#artifacts.get(artifact.id);
      artifact.version = (existing.version ?? 1) + 1;
    }
    if (provenance) {
      artifact.provenance = { ...provenance };
    }
    artifact.updatedAt = Date.now();
    this.#artifacts.set(artifact.id, artifact);
    if (!this.#byStep.has(artifact.stepId)) {
      this.#byStep.set(artifact.stepId, []);
    }
    const stepIds = this.#byStep.get(artifact.stepId);
    if (!existed || !stepIds.includes(artifact.id)) {
      stepIds.push(artifact.id);
    }
    return artifact.id;
  }

  get(id) {
    return this.#artifacts.get(id) ?? null;
  }

  getByStep(stepId) {
    const ids = this.#byStep.get(stepId) ?? [];
    return ids.map(id => this.#artifacts.get(id)).filter(Boolean);
  }

  getLatestByStep(stepId) {
    const items = this.getByStep(stepId);
    return items.length > 0 ? items[items.length - 1] : null;
  }

  getLatestValidByStep(stepId) {
    const items = this.getByStep(stepId);
    const valid = items.filter(a =>
      a.status !== ArtifactStatus.STALE &&
      a.status !== ArtifactStatus.FAILED &&
      a.status !== ArtifactStatus.SUPERSEDED
    );
    return valid.length > 0 ? valid[valid.length - 1] : null;
  }

  updateStatus(id, status) {
    const artifact = this.#artifacts.get(id);
    if (!artifact) return false;
    if (artifact.status === ArtifactStatus.SUPERSEDED) return false;
    artifact.status = status;
    artifact.updatedAt = Date.now();
    return true;
  }

  supersede(id) {
    return this.updateStatus(id, ArtifactStatus.SUPERSEDED);
  }

  supersedeByStep(stepId) {
    const items = this.getByStep(stepId);
    for (const item of items) {
      this.updateStatus(item.id, ArtifactStatus.SUPERSEDED);
    }
  }

  invalidate(id, reason) {
    const artifact = this.#artifacts.get(id);
    if (!artifact) return false;
    artifact.status = ArtifactStatus.FAILED;
    artifact.invalidatedAt = Date.now();
    artifact.invalidationReason = reason ?? null;
    return true;
  }

  delete(id) {
    const artifact = this.#artifacts.get(id);
    if (!artifact) return false;
    this.#artifacts.delete(id);
    const stepIds = this.#byStep.get(artifact.stepId);
    if (stepIds) {
      const idx = stepIds.indexOf(id);
      if (idx >= 0) stepIds.splice(idx, 1);
    }
    return true;
  }

  clear() {
    this.#artifacts.clear();
    this.#byStep.clear();
  }

  listAll() {
    return [...this.#artifacts.values()];
  }

  markDownstreamStale(sourceArtifactId) {
    const affected = [];
    const frontier = [sourceArtifactId];
    const visited = new Set([sourceArtifactId]);

    while (frontier.length > 0) {
      const currentId = frontier.shift();
      for (const artifact of this.#artifacts.values()) {
        if (!artifact.sourceArtifactIds?.includes(currentId)) continue;
        if (visited.has(artifact.id)) continue;
        if (artifact.status === ArtifactStatus.SUPERSEDED || artifact.status === ArtifactStatus.FAILED) continue;
        artifact.status = ArtifactStatus.STALE;
        artifact.updatedAt = Date.now();
        affected.push(artifact.id);
        visited.add(artifact.id);
        frontier.push(artifact.id);
      }
    }
    return affected;
  }

  snapshot() {
    const result = {};
    for (const [key, artifact] of this.#artifacts) {
      result[key] = structuredClone(this.#sanitize(artifact));
    }
    return result;
  }

  restore(snap) {
    this.clear();
    if (!snap) return;
    for (const [id, artifact] of Object.entries(snap)) {
      this.commit(structuredClone(artifact));
    }
  }

  #sanitize(artifact) {
    const clone = structuredClone(artifact);
    clone.data = this.#sanitizeData(clone.data);
    return clone;
  }

  #sanitizeData(data) {
    if (data == null || typeof data !== 'object') return data;
    if (Array.isArray(data)) return data.map(item => this.#sanitizeData(item));

    const cleaned = {};
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === 'string' && this.#isBinaryString(value)) {
        cleaned[key] = '';
      } else {
        cleaned[key] = this.#sanitizeData(value);
      }
    }
    return cleaned;
  }

  #isBinaryString(str) {
    if (str.length < 100) return false;
    if (str.startsWith('data:') && str.includes(';base64,')) return true;
    return false;
  }
}
