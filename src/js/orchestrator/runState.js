const STORAGE_KEY = 'cine-cutie-runstate';

export const RunStatus = Object.freeze({
  IDLE: 'idle',
  RUNNING: 'running',
  INTERRUPTED: 'interrupted',
  COMPLETED: 'completed',
});

export class RunState {
  #status = RunStatus.IDLE;
  #currentStepIndex = -1;
  #completedSteps = [];
  #startedAt = null;
  #updatedAt = null;

  get status() { return this.#status; }
  get currentStepIndex() { return this.#currentStepIndex; }
  get completedSteps() { return [...this.#completedSteps]; }
  get startedAt() { return this.#startedAt; }
  get updatedAt() { return this.#updatedAt; }

  get isInterrupted() { return this.#status === RunStatus.INTERRUPTED; }
  get isResumable() {
    return this.#status === RunStatus.INTERRUPTED && this.#completedSteps.length > 0;
  }

  startPipeline() {
    this.#status = RunStatus.RUNNING;
    this.#currentStepIndex = -1;
    this.#completedSteps = [];
    this.#startedAt = Date.now();
    this.#updatedAt = Date.now();
  }

  enterStep(stepIndex, stepId) {
    this.#currentStepIndex = stepIndex;
    this.#updatedAt = Date.now();
    void stepId;
  }

  completeStep(stepId) {
    if (!this.#completedSteps.includes(stepId)) {
      this.#completedSteps.push(stepId);
    }
    this.#updatedAt = Date.now();
  }

  markInterrupted() {
    if (this.#status === RunStatus.RUNNING) {
      this.#status = RunStatus.INTERRUPTED;
      this.#updatedAt = Date.now();
    }
  }

  markCompleted() {
    this.#status = RunStatus.COMPLETED;
    this.#updatedAt = Date.now();
  }

  reset() {
    this.#status = RunStatus.IDLE;
    this.#currentStepIndex = -1;
    this.#completedSteps = [];
    this.#startedAt = null;
    this.#updatedAt = null;
  }

  snapshot() {
    return {
      status: this.#status,
      currentStepIndex: this.#currentStepIndex,
      completedSteps: [...this.#completedSteps],
      startedAt: this.#startedAt,
      updatedAt: this.#updatedAt,
    };
  }

  restoreSnapshot(snap) {
    if (!snap) { this.reset(); return; }
    this.#status = snap.status || RunStatus.IDLE;
    this.#currentStepIndex = snap.currentStepIndex ?? -1;
    this.#completedSteps = [...(snap.completedSteps || [])];
    this.#startedAt = snap.startedAt || null;
    this.#updatedAt = snap.updatedAt || null;
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
      if (this.#status === RunStatus.RUNNING) {
        this.#status = RunStatus.INTERRUPTED;
      }
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
