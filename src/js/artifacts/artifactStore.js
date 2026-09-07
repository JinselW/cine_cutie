import {
  ARTIFACT_SCHEMA_VERSION,
  ArtifactStatus,
  StaleReasonCode,
  TERMINAL_ARTIFACT_STATUSES,
  createArtifact,
} from './artifactTypes.js';

export class ArtifactStore {
  #artifacts = new Map();
  #byStep = new Map();
  #acceptedByStep = new Map();

  commit(artifact, { provenance } = {}) {
    if (provenance) {
      artifact.provenance = { ...provenance };
    }
    this.#assignLineage(artifact);
    artifact.updatedAt = Date.now();
    this.#index(artifact);
    return artifact.id;
  }

  // A revision always chains onto the highest existing version of the step so that
  // version numbers stay monotonic even when earlier revisions failed QC.
  createRevision(stepId, { kind, data, sourceArtifactIds = [], status = ArtifactStatus.PENDING, restoredFromArtifactId = null }) {
    return createArtifact({
      kind,
      stepId,
      data,
      status,
      sourceArtifactIds,
      parentArtifactId: this.lineageHeadId(stepId),
      restoredFromArtifactId,
    });
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

  lineageHead(stepId) {
    let head = null;
    for (const artifact of this.getByStep(stepId)) {
      if (!head || (artifact.version ?? 1) >= (head.version ?? 1)) head = artifact;
    }
    return head;
  }

  lineageHeadId(stepId) {
    return this.lineageHead(stepId)?.id ?? null;
  }

  // The single adopted output of a step. Downstream steps may only consume this.
  getAcceptedByStep(stepId) {
    const id = this.#acceptedByStep.get(stepId);
    if (!id) return null;
    const artifact = this.#artifacts.get(id);
    if (!artifact || artifact.status !== ArtifactStatus.COMPLETE) return null;
    return artifact;
  }

  acceptArtifact(id) {
    const artifact = this.#artifacts.get(id);
    if (!artifact || artifact.status !== ArtifactStatus.COMPLETE) return false;
    this.#acceptedByStep.set(artifact.stepId, artifact.id);
    artifact.acceptedAt = Date.now();
    artifact.updatedAt = artifact.acceptedAt;
    return true;
  }

  // Adopts nextId as the step's current version: the previous accepted version is
  // superseded and everything that consumed it becomes stale. A failed or in-flight
  // artifact never replaces the accepted version.
  replaceAcceptedArtifact(nextId, { reasonCode = StaleReasonCode.UPSTREAM_REPLACED } = {}) {
    const next = this.#artifacts.get(nextId);
    if (!next || next.status !== ArtifactStatus.COMPLETE) return null;

    const stepId = next.stepId;
    const previousId = this.#acceptedByStep.get(stepId) ?? null;
    const previous = previousId ? this.#artifacts.get(previousId) ?? null : null;

    if (previous && previous.id === next.id) {
      this.acceptArtifact(next.id);
      return { acceptedArtifact: next, supersededArtifact: null, staleArtifactIds: [] };
    }

    if (previous) {
      next.replacesArtifactId = next.replacesArtifactId ?? previous.id;
      this.supersede(previous.id);
      this.#acceptedByStep.delete(stepId);
    }
    this.acceptArtifact(next.id);

    const staleArtifactIds = previous
      ? this.invalidateDownstream(previous.id, {
        code: reasonCode,
        sourceArtifactId: previous.id,
        replacementArtifactId: next.id,
      })
      : [];

    return { acceptedArtifact: next, supersededArtifact: previous, staleArtifactIds };
  }

  updateStatus(id, status) {
    const artifact = this.#artifacts.get(id);
    if (!artifact) return false;
    if (artifact.status === ArtifactStatus.SUPERSEDED) return false;
    artifact.status = status;
    const now = Date.now();
    artifact.updatedAt = now;
    if (status === ArtifactStatus.SUPERSEDED) {
      artifact.supersededAt = now;
      if (this.#acceptedByStep.get(artifact.stepId) === artifact.id) this.#acceptedByStep.delete(artifact.stepId);
    }
    if (status === ArtifactStatus.STALE) {
      artifact.staleAt = now;
      if (this.#acceptedByStep.get(artifact.stepId) === artifact.id) this.#acceptedByStep.delete(artifact.stepId);
    }
    return true;
  }

  supersede(id) {
    return this.updateStatus(id, ArtifactStatus.SUPERSEDED);
  }

  getDependents(id, { recursive = true } = {}) {
    const dependents = [];
    const visited = new Set([id]);
    let frontier = [id];
    while (frontier.length > 0) {
      const next = [];
      for (const artifact of this.#artifacts.values()) {
        if (visited.has(artifact.id)) continue;
        if (!artifact.sourceArtifactIds?.some(sourceId => frontier.includes(sourceId))) continue;
        visited.add(artifact.id);
        dependents.push(artifact);
        if (recursive) next.push(artifact.id);
      }
      frontier = next;
    }
    return dependents;
  }

  // Everything that consumed sourceArtifactId stops being valid. FAILED and
  // SUPERSEDED artifacts stay untouched because they are already history.
  invalidateDownstream(sourceArtifactId, reason = null) {
    const affected = [];
    const detectedAt = Date.now();
    for (const artifact of this.getDependents(sourceArtifactId)) {
      if (TERMINAL_ARTIFACT_STATUSES.includes(artifact.status)) continue;
      artifact.status = ArtifactStatus.STALE;
      artifact.staleAt = detectedAt;
      artifact.updatedAt = detectedAt;
      artifact.staleReason = reason ? { ...reason, detectedAt } : null;
      if (this.#acceptedByStep.get(artifact.stepId) === artifact.id) this.#acceptedByStep.delete(artifact.stepId);
      affected.push(artifact.id);
    }
    return affected;
  }

  validateGraph() {
    const issues = [];
    for (const [stepId, id] of this.#acceptedByStep) {
      const artifact = this.#artifacts.get(id);
      if (!artifact) {
        issues.push({ code: 'ACCEPTED_MISSING', stepId, artifactId: id });
        continue;
      }
      if (artifact.stepId !== stepId) {
        issues.push({ code: 'ACCEPTED_STEP_MISMATCH', stepId, artifactId: id, actualStepId: artifact.stepId });
      }
      if (artifact.status !== ArtifactStatus.COMPLETE) {
        issues.push({ code: 'ACCEPTED_NOT_COMPLETE', stepId, artifactId: id, status: artifact.status });
      }
    }
    for (const artifact of this.#artifacts.values()) {
      if (artifact.parentArtifactId && !this.#artifacts.has(artifact.parentArtifactId)) {
        issues.push({ code: 'PARENT_MISSING', artifactId: artifact.id, parentArtifactId: artifact.parentArtifactId });
      }
      for (const sourceId of artifact.sourceArtifactIds ?? []) {
        if (sourceId === artifact.id) {
          issues.push({ code: 'SELF_DEPENDENCY', artifactId: artifact.id });
        } else if (!this.#artifacts.has(sourceId)) {
          issues.push({ code: 'SOURCE_MISSING', artifactId: artifact.id, sourceArtifactId: sourceId });
        }
      }
    }
    for (const cycle of this.#detectCycles()) {
      issues.push({ code: 'DEPENDENCY_CYCLE', artifactIds: cycle });
    }
    return { ok: issues.length === 0, issues };
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
    if (this.#acceptedByStep.get(artifact.stepId) === id) this.#acceptedByStep.delete(artifact.stepId);
    return true;
  }

  clear() {
    this.#artifacts.clear();
    this.#byStep.clear();
    this.#acceptedByStep.clear();
  }

  listAll() {
    return [...this.#artifacts.values()];
  }

  snapshot() {
    const result = {};
    for (const [key, artifact] of this.#artifacts) {
      result[key] = structuredClone(this.#sanitize(artifact));
    }
    return result;
  }

  snapshotAccepted() {
    return Object.fromEntries(this.#acceptedByStep);
  }

  restore(snap) {
    this.clear();
    if (!snap) return;
    for (const artifact of Object.values(snap)) {
      this.#index(this.#migrate(artifact));
    }
  }

  restoreAccepted(snap) {
    this.#acceptedByStep.clear();
    if (!snap) return;
    // Pointers are kept verbatim so validateGraph can report dangling acceptance
    // instead of silently dropping it; getAcceptedByStep resolves unknown ids to null.
    for (const [stepId, id] of Object.entries(snap)) {
      this.#acceptedByStep.set(stepId, id);
    }
  }

  #migrate(artifact) {
    const clone = structuredClone(artifact);
    clone.schemaVersion = ARTIFACT_SCHEMA_VERSION;
    clone.version = clone.version ?? 1;
    clone.parentArtifactId = clone.parentArtifactId ?? null;
    clone.rootArtifactId = clone.rootArtifactId ?? clone.parentArtifactId ?? clone.id;
    clone.replacesArtifactId = clone.replacesArtifactId ?? null;
    clone.restoredFromArtifactId = clone.restoredFromArtifactId ?? null;
    clone.acceptedAt = clone.acceptedAt ?? null;
    clone.supersededAt = clone.supersededAt ?? null;
    clone.staleAt = clone.staleAt ?? null;
    clone.staleReason = clone.staleReason ?? null;
    clone.sourceArtifactIds = [...(clone.sourceArtifactIds ?? [])];
    clone.itemLineage = clone.itemLineage ?? {};
    return this.#sanitize(clone);
  }

  #assignLineage(artifact) {
    artifact.schemaVersion = ARTIFACT_SCHEMA_VERSION;
    const parent = artifact.parentArtifactId ? this.#artifacts.get(artifact.parentArtifactId) ?? null : null;
    if (parent) {
      artifact.version = (parent.version ?? 1) + 1;
      artifact.rootArtifactId = parent.rootArtifactId ?? parent.id;
    } else {
      artifact.version = 1;
      artifact.rootArtifactId = artifact.id;
    }
  }

  #index(artifact) {
    this.#artifacts.set(artifact.id, artifact);
    if (!this.#byStep.has(artifact.stepId)) {
      this.#byStep.set(artifact.stepId, []);
    }
    const stepIds = this.#byStep.get(artifact.stepId);
    if (!stepIds.includes(artifact.id)) {
      stepIds.push(artifact.id);
    }
  }

  #detectCycles() {
    const cycles = [];
    const markers = new Map();
    const walk = (id, path) => {
      const marker = markers.get(id);
      if (marker === 'done') return;
      if (marker === 'visiting') {
        cycles.push([...path.slice(path.indexOf(id)), id]);
        return;
      }
      const artifact = this.#artifacts.get(id);
      if (!artifact) return;
      markers.set(id, 'visiting');
      for (const sourceId of artifact.sourceArtifactIds ?? []) walk(sourceId, [...path, id]);
      markers.set(id, 'done');
    };
    for (const id of this.#artifacts.keys()) walk(id, []);
    return cycles;
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
