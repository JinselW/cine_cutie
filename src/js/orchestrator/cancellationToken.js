const PAUSED = 'paused';
const RUNNING = 'running';
const CANCELLED = 'cancelled';

export class CancellationToken {
  #state = RUNNING;
  #abortController = new AbortController();
  #pausePromise = null;
  #pauseResolve = null;

  get signal() {
    return this.#abortController.signal;
  }

  get isCancelled() {
    return this.#state === CANCELLED;
  }

  get isPaused() {
    return this.#state === PAUSED;
  }

  get isRunning() {
    return this.#state === RUNNING;
  }

  cancel() {
    if (this.#state === CANCELLED) return;
    this.#state = CANCELLED;
    if (this.#pauseResolve) {
      this.#pauseResolve();
      this.#pauseResolve = null;
      this.#pausePromise = null;
    }
    this.#abortController.abort();
  }

  pause() {
    if (this.#state !== RUNNING) return;
    this.#state = PAUSED;
    this.#pausePromise = new Promise(resolve => {
      this.#pauseResolve = resolve;
    });
  }

  resume() {
    if (this.#state !== PAUSED) return;
    this.#state = RUNNING;
    if (this.#pauseResolve) {
      this.#pauseResolve();
      this.#pauseResolve = null;
      this.#pausePromise = null;
    }
  }

  async throwIfCancelled() {
    if (this.#state === CANCELLED) {
      throw new CancellationTokenError('Operation cancelled');
    }
  }

  async waitIfPaused() {
    if (this.#pausePromise) {
      await this.#pausePromise;
    }
    this.throwIfCancelled();
  }
}

export class CancellationTokenError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CancellationTokenError';
    this.cancelled = true;
  }
}
