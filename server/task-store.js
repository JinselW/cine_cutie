import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';

const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'interrupted']);

export function isTerminalStatus(status) {
  return TERMINAL.has(status);
}

function generateTaskId() {
  const ts = Date.now().toString(36);
  const rand = randomBytes(3).toString('hex');
  return `task_${ts}_${rand}`;
}

function buildTask(type, metadata) {
  const now = Date.now();
  return {
    id: generateTaskId(),
    type,
    status: 'pending',
    progress: 0,
    total: 0,
    current: 0,
    requestSummary: null,
    createdAt: now,
    updatedAt: now,
    provider: null,
    promptId: null,
    upstreamTaskId: null,
    result: null,
    error: null,
    cancelled: false,
    retryCount: 0,
    owner: null,
    idempotencyKey: null,
    ...metadata,
  };
}

// ── InMemoryTaskStore ────────────────────────────────────────────────────────

export class InMemoryTaskStore {
  #tasks = new Map();
  #idempotency = new Map();

  async init() {}

  createTask(type, metadata = {}) {
    const task = buildTask(type, metadata);
    this.#tasks.set(task.id, structuredClone(task));
    if (task.idempotencyKey) {
      this.#idempotency.set(task.idempotencyKey, {
        taskId: task.id,
        requestHash: metadata._requestHash || null,
      });
    }
    return structuredClone(task);
  }

  getTask(id) {
    const t = this.#tasks.get(id);
    return t ? structuredClone(t) : null;
  }

  updateTask(id, patch) {
    const t = this.#tasks.get(id);
    if (!t) return null;
    Object.assign(t, patch, { updatedAt: Date.now() });
    this.#tasks.set(id, t);
    return structuredClone(t);
  }

  cancelTask(id) {
    const t = this.#tasks.get(id);
    if (!t) return null;
    if (isTerminalStatus(t.status)) return structuredClone(t);
    t.cancelled = true;
    t.status = 'cancelled';
    t.updatedAt = Date.now();
    this.#tasks.set(id, t);
    return structuredClone(t);
  }

  isTaskCancelled(id) {
    const t = this.#tasks.get(id);
    return !!t?.cancelled;
  }

  listTasks() {
    return [...this.#tasks.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  findByIdempotencyKey(key) {
    return this.#idempotency.get(key) || null;
  }

  registerIdempotency(key, taskId, requestHash) {
    this.#idempotency.set(key, { taskId, requestHash });
  }

  cleanup(maxAge) {
    const now = Date.now();
    let count = 0;
    for (const [id, t] of this.#tasks) {
      if (now - t.updatedAt > maxAge && isTerminalStatus(t.status)) {
        this.#tasks.delete(id);
        if (t.idempotencyKey) this.#idempotency.delete(t.idempotencyKey);
        count++;
      }
    }
    return count;
  }

  getTasksByStatus(status) {
    return [...this.#tasks.values()].filter(t => t.status === status);
  }

  countByStatus() {
    const counts = {};
    for (const t of this.#tasks.values()) {
      counts[t.status] = (counts[t.status] || 0) + 1;
    }
    return counts;
  }

  async getStorageHealth() {
    return { type: 'memory', ok: true };
  }

  async close() {
    this.#tasks.clear();
    this.#idempotency.clear();
  }
}

// ── FileTaskStore ────────────────────────────────────────────────────────────

export class FileTaskStore {
  #dir;
  #tasks = new Map();
  #idempotency = new Map();
  #idempotencyFile;
  #initialized = false;

  constructor(dir) {
    this.#dir = dir;
    this.#idempotencyFile = path.join(dir, '_idempotency.json');
  }

  async init() {
    fs.mkdirSync(this.#dir, { recursive: true });
    await this.#loadAll();
    this.#initialized = true;
  }

  async #loadAll() {
    this.#tasks.clear();
    this.#idempotency.clear();

    const files = fs.readdirSync(this.#dir).filter(f => f.endsWith('.json') && !f.startsWith('_'));
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(this.#dir, file), 'utf-8');
        const task = JSON.parse(raw);
        if (task?.id) this.#tasks.set(task.id, task);
      } catch {
        // corrupt file — skip, will be reported in health check
      }
    }

    try {
      if (fs.existsSync(this.#idempotencyFile)) {
        const raw = fs.readFileSync(this.#idempotencyFile, 'utf-8');
        const data = JSON.parse(raw);
        for (const [k, v] of Object.entries(data || {})) {
          this.#idempotency.set(k, v);
        }
      }
    } catch {
      // corrupt idempotency index — start fresh
    }
  }

  #writeTask(task) {
    const filePath = path.join(this.#dir, `${task.id}.json`);
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(task, null, 2), 'utf-8');
    fs.renameSync(tmp, filePath);
  }

  #deleteTaskFile(id) {
    try {
      fs.unlinkSync(path.join(this.#dir, `${id}.json`));
    } catch {}
  }

  #writeIdempotency() {
    const tmp = `${this.#idempotencyFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.#idempotency), null, 2), 'utf-8');
    fs.renameSync(tmp, this.#idempotencyFile);
  }

  createTask(type, metadata = {}) {
    const task = buildTask(type, metadata);
    this.#tasks.set(task.id, { ...task });
    this.#writeTask(task);
    if (task.idempotencyKey) {
      this.#idempotency.set(task.idempotencyKey, {
        taskId: task.id,
        requestHash: metadata._requestHash || null,
      });
      this.#writeIdempotency();
    }
    return { ...task };
  }

  getTask(id) {
    const t = this.#tasks.get(id);
    return t ? { ...t } : null;
  }

  updateTask(id, patch) {
    const t = this.#tasks.get(id);
    if (!t) return null;
    Object.assign(t, patch, { updatedAt: Date.now() });
    this.#tasks.set(id, t);
    this.#writeTask(t);
    return { ...t };
  }

  cancelTask(id) {
    const t = this.#tasks.get(id);
    if (!t) return null;
    if (isTerminalStatus(t.status)) return { ...t };
    t.cancelled = true;
    t.status = 'cancelled';
    t.updatedAt = Date.now();
    this.#tasks.set(id, t);
    this.#writeTask(t);
    return { ...t };
  }

  isTaskCancelled(id) {
    const t = this.#tasks.get(id);
    return !!t?.cancelled;
  }

  listTasks() {
    return [...this.#tasks.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  findByIdempotencyKey(key) {
    return this.#idempotency.get(key) || null;
  }

  registerIdempotency(key, taskId, requestHash) {
    this.#idempotency.set(key, { taskId, requestHash });
    this.#writeIdempotency();
  }

  cleanup(maxAge) {
    const now = Date.now();
    let count = 0;
    for (const [id, t] of this.#tasks) {
      if (now - t.updatedAt > maxAge && isTerminalStatus(t.status)) {
        this.#tasks.delete(id);
        this.#deleteTaskFile(id);
        if (t.idempotencyKey) this.#idempotency.delete(t.idempotencyKey);
        count++;
      }
    }
    if (count > 0) this.#writeIdempotency();
    return count;
  }

  getTasksByStatus(status) {
    return [...this.#tasks.values()].filter(t => t.status === status);
  }

  countByStatus() {
    const counts = {};
    for (const t of this.#tasks.values()) {
      counts[t.status] = (counts[t.status] || 0) + 1;
    }
    return counts;
  }

  async getStorageHealth() {
    try {
      const testFile = path.join(this.#dir, '.health_check');
      fs.writeFileSync(testFile, 'ok', 'utf-8');
      fs.unlinkSync(testFile);
      return { type: 'file', dir: this.#dir, ok: true, taskCount: this.#tasks.size };
    } catch (err) {
      return { type: 'file', dir: this.#dir, ok: false, error: err.message };
    }
  }

  async close() {
    this.#tasks.clear();
    this.#idempotency.clear();
  }
}
