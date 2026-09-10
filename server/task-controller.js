import { EventEmitter } from 'events';
import path from 'path';
import { isTerminalStatus } from './task-store.js';

const DEFAULT_MAX_CONCURRENCY = 4;
const DEFAULT_PER_OWNER = 2;
const DEFAULT_RETENTION_MS = 3600000;

export class TaskController extends EventEmitter {
  #store;
  #workers = new Map();
  #waitingQueue = [];
  #runningCount = 0;
  #ownerRunning = new Map();
  #maxConcurrency;
  #perOwnerLimit;
  #retentionMs;
  #cleanupTimer = null;
  #recoveryResults = [];
  #initialized = false;
  #recoveryContext;

  constructor({
    store,
    maxConcurrency = DEFAULT_MAX_CONCURRENCY,
    perOwnerLimit = DEFAULT_PER_OWNER,
    retentionMs = DEFAULT_RETENTION_MS,
    recoveryContext = null,
  }) {
    super();
    this.#store = store;
    this.#maxConcurrency = maxConcurrency;
    this.#perOwnerLimit = perOwnerLimit;
    this.#retentionMs = retentionMs;
    this.#recoveryContext = recoveryContext;
  }

  get store() {
    return this.#store;
  }

  get waitingQueue() {
    return [...this.#waitingQueue];
  }

  get recoveryResults() {
    return [...this.#recoveryResults];
  }

  async init() {
    await this.#store.init();
    await this.#recover();
    this.#cleanupTimer = setInterval(() => this.runCleanup(), 10 * 60 * 1000);
    this.#initialized = true;
  }

  async shutdown() {
    if (this.#cleanupTimer) {
      clearInterval(this.#cleanupTimer);
      this.#cleanupTimer = null;
    }
    this.#workers.clear();
    this.#waitingQueue = [];
  }

  // ── Submission ───────────────────────────────────────────────────────────

  async submitTask({ type, requestHash, idempotencyKey, owner, total, requestSummary, worker }) {
    if (idempotencyKey) {
      const existing = this.#store.findByIdempotencyKey(idempotencyKey);
      if (existing) {
        const task = this.#store.getTask(existing.taskId);
        if (task) {
          if (existing.requestHash && requestHash && existing.requestHash !== requestHash) {
            return { status: 'conflict', existingTask: task };
          }
          return { status: 'duplicate', task };
        }
      }
    }

    const task = this.#store.createTask(type, {
      total,
      owner,
      idempotencyKey,
      requestSummary,
      _requestHash: requestHash,
    });

    if (idempotencyKey) {
      this.#store.registerIdempotency(idempotencyKey, task.id, requestHash);
    }

    if (worker) {
      this.#workers.set(task.id, worker);
      this.#tryPromote(task);
    }

    return { status: 'created', task };
  }

  // ── Scheduling ───────────────────────────────────────────────────────────

  #tryPromote(task) {
    const owner = task.owner || '_default';
    const ownerCount = this.#ownerRunning.get(owner) || 0;

    if (this.#runningCount >= this.#maxConcurrency) {
      this.#store.updateTask(task.id, { status: 'queued' });
      if (!this.#waitingQueue.includes(task.id)) {
        this.#waitingQueue.push(task.id);
      }
      return;
    }

    if (ownerCount >= this.#perOwnerLimit) {
      this.#store.updateTask(task.id, { status: 'queued' });
      if (!this.#waitingQueue.includes(task.id)) {
        this.#waitingQueue.push(task.id);
      }
      return;
    }

    this.#promoteToRunning(task.id);
  }

  #promoteToRunning(taskId) {
    this.#store.updateTask(taskId, { status: 'running' });
    this.#runningCount++;

    const owner = this.#store.getTask(taskId)?.owner || '_default';
    this.#ownerRunning.set(owner, (this.#ownerRunning.get(owner) || 0) + 1);

    const worker = this.#workers.get(taskId);
    if (worker) {
      const taskForWorker = this.#store.getTask(taskId);
      this.emit('task:promoted', taskId);
      Promise.resolve()
        .then(() => worker(taskForWorker))
        .catch(err => {
          const t = this.#store.getTask(taskId);
          if (t && !isTerminalStatus(t.status)) {
            this.#store.updateTask(taskId, { status: 'failed', error: err.message });
          }
        })
        .finally(() => this.#onTaskDone(taskId));
    }
  }

  #onTaskDone(taskId) {
    this.#runningCount = Math.max(0, this.#runningCount - 1);

    const task = this.#store.getTask(taskId);
    const owner = task?.owner || '_default';
    const cur = this.#ownerRunning.get(owner) || 0;
    if (cur > 0) this.#ownerRunning.set(owner, cur - 1);
    else this.#ownerRunning.delete(owner);

    this.#workers.delete(taskId);
    this.#drainQueue();
  }

  #drainQueue() {
    const remaining = [];
    for (const taskId of this.#waitingQueue) {
      const task = this.#store.getTask(taskId);
      if (!task || isTerminalStatus(task.status)) continue;
      if (task.status !== 'queued') continue;

      const owner = task.owner || '_default';
      const ownerCount = this.#ownerRunning.get(owner) || 0;

      if (this.#runningCount >= this.#maxConcurrency) {
        remaining.push(taskId);
        continue;
      }
      if (ownerCount >= this.#perOwnerLimit) {
        remaining.push(taskId);
        continue;
      }

      this.#promoteToRunning(taskId);
    }
    this.#waitingQueue = remaining;
  }

  // ── Cancellation ─────────────────────────────────────────────────────────

  async cancelTask(taskId) {
    const queueIdx = this.#waitingQueue.indexOf(taskId);
    if (queueIdx !== -1) {
      this.#waitingQueue.splice(queueIdx, 1);
      this.#workers.delete(taskId);
      const task = this.#store.cancelTask(taskId);
      this.emit('task:cancelled', taskId);
      return task;
    }

    const task = this.#store.cancelTask(taskId);
    if (task) this.emit('task:cancelled', taskId);
    return task;
  }

  // ── Recovery ─────────────────────────────────────────────────────────────

  async #recover() {
    this.#recoveryResults = [];

    const running = [
      ...this.#store.getTasksByStatus('running'),
      ...this.#store.getTasksByStatus('queued'),
    ];

    for (const task of running) {
      if (task.promptId) {
        const result = await this.#recoverComfyTask(task);
        this.#recoveryResults.push(result);
      } else if (task.upstreamTaskId) {
        const result = await this.#recoverCloudTask(task);
        this.#recoveryResults.push(result);
      } else if (task.status === 'running') {
        this.#store.updateTask(task.id, {
          status: 'interrupted',
          error: 'Server restarted during task execution',
        });
        this.#recoveryResults.push({
          taskId: task.id,
          action: 'marked_interrupt',
          reason: 'no_external_id',
        });
      } else {
        this.#store.updateTask(task.id, {
          status: 'interrupted',
          error: 'Server restarted before task could execute',
        });
        this.#recoveryResults.push({ taskId: task.id, action: 'marked_interrupt', reason: 'queued_no_worker' });
      }
    }
  }

  async #recoverComfyTask(task) {
    try {
      const { getPromptSnapshot } = await import('./comfyui.js');
      const { ensureTunnel } = await import('./ssh-tunnel.js');

      const password = process.env.COMFY_SSH_PASSWORD;
      if (!password) {
        this.#store.updateTask(task.id, {
          status: 'interrupted',
          error: 'Cannot recover: no SSH credentials',
        });
        return { taskId: task.id, action: 'marked_interrupt', reason: 'no_ssh_config' };
      }

      const sshConfig = {
        host: process.env.COMFY_SSH_HOST,
        port: Number(process.env.COMFY_SSH_PORT) || 6078,
        user: process.env.COMFY_SSH_USER || 'Developer',
        password,
        comfyPort: Number(process.env.COMFY_SSH_COMFY_PORT) || 8188,
      };

      if (!sshConfig.host) {
        this.#store.updateTask(task.id, {
          status: 'interrupted',
          error: 'Cannot recover: no SSH host',
        });
        return { taskId: task.id, action: 'marked_interrupt', reason: 'no_ssh_host' };
      }

      try {
        await ensureTunnel(sshConfig);
      } catch (err) {
        this.#store.updateTask(task.id, {
          status: 'interrupted',
          error: `Cannot recover: SSH tunnel failed: ${err.message}`,
        });
        return { taskId: task.id, action: 'marked_interrupt', reason: 'tunnel_failed' };
      }

      const snapshot = await getPromptSnapshot(sshConfig, task.promptId);

      if (snapshot.completed && snapshot.status === 'success') {
        const ctx = this.#recoveryContext;
        const clips = [];

        if (ctx?.mediaDir && snapshot.outputs?.length) {
          const { downloadOutput } = await import('./comfyui.js');
          for (let i = 0; i < snapshot.outputs.length; i++) {
            try {
              const downloaded = await downloadOutput(sshConfig, snapshot.outputs[i], ctx.mediaDir);
              clips.push({ index: i, status: 'ok', path: `/api/media/${downloaded.localName}` });
            } catch (dlErr) {
              clips.push({ index: i, status: 'error', error: `Download failed: ${dlErr.message}` });
            }
          }
        }

        this.#store.updateTask(task.id, {
          status: 'completed',
          progress: 100,
          result: { clips, total: clips.length, success: clips.filter(c => c.status === 'ok').length, recovered: true, promptId: task.promptId },
        });
        return { taskId: task.id, action: 'recovered_completed', promptId: task.promptId, downloaded: clips.length };
      }

      if (snapshot.completed && snapshot.status === 'error') {
        this.#store.updateTask(task.id, {
          status: 'failed',
          error: `ComfyUI task failed: ${snapshot.messages?.join(', ') || 'unknown'}`,
        });
        return { taskId: task.id, action: 'recovered_failed', promptId: task.promptId };
      }

      if (snapshot.running || snapshot.pending) {
        this.#store.updateTask(task.id, {
          status: 'interrupted',
          error: 'ComfyUI task still running after restart',
        });
        return { taskId: task.id, action: 'marked_interrupt', promptId: task.promptId, stillRunning: true };
      }

      this.#store.updateTask(task.id, {
        status: 'interrupted',
        error: 'ComfyUI task not found in queue or history',
      });
      return { taskId: task.id, action: 'marked_interrupt', promptId: task.promptId, notFound: true };
    } catch (err) {
      this.#store.updateTask(task.id, {
        status: 'interrupted',
        error: `Recovery failed: ${err.message}`,
      });
      return { taskId: task.id, action: 'recovery_error', error: err.message };
    }
  }

  async #recoverCloudTask(task) {
    try {
      const provider = task.provider;
      const ctx = this.#recoveryContext;
      let pollResult = null;
      let mediaUrl = null;

      if (provider === 'ark') {
        const pollFn = ctx?.pollArkTask || (await import('./ark.js')).pollArkTask;
        const parseFn = ctx?.parseArkVideoUrl || (await import('./ark.js')).parseArkVideoUrl;
        const apiKey = ctx?.arkApiKey || process.env.ARK_API_KEY;
        if (!apiKey) {
          this.#store.updateTask(task.id, { status: 'interrupted', error: 'Cannot recover: no ARK_API_KEY' });
          return { taskId: task.id, action: 'marked_interrupt', reason: 'no_api_key' };
        }
        pollResult = await pollFn(task.upstreamTaskId, apiKey);
        const s = (pollResult.status || '').toLowerCase();
        if (s === 'succeeded') {
          mediaUrl = parseFn(pollResult);
        } else if (s === 'failed' || s === 'cancelled') {
          this.#store.updateTask(task.id, { status: 'failed', error: `Upstream task ${s}` });
          return { taskId: task.id, action: 'recovered_failed', upstreamTaskId: task.upstreamTaskId };
        }
      } else if (provider === 'dashscope') {
        const pollFn = ctx?.pollTask || (await import('./dashscope.js')).pollTask;
        const parseFn = ctx?.parseImageResultUrl || (await import('./dashscope.js')).parseImageResultUrl;
        const apiKey = ctx?.dashscopeApiKey || process.env.DASHSCOPE_API_KEY;
        if (!apiKey) {
          this.#store.updateTask(task.id, { status: 'interrupted', error: 'Cannot recover: no DASHSCOPE_API_KEY' });
          return { taskId: task.id, action: 'marked_interrupt', reason: 'no_api_key' };
        }
        pollResult = await pollFn(task.upstreamTaskId, apiKey);
        const s = pollResult.output?.task_status;
        if (s === 'SUCCEEDED') {
          mediaUrl = task.type === 'image'
            ? parseFn(pollResult)
            : pollResult.output?.video_url;
        } else if (s === 'FAILED') {
          this.#store.updateTask(task.id, { status: 'failed', error: `Upstream task failed: ${pollResult.output?.message || ''}` });
          return { taskId: task.id, action: 'recovered_failed', upstreamTaskId: task.upstreamTaskId };
        }
      }

      if (!mediaUrl || !ctx?.mediaDir || !ctx?.downloadFile) {
        this.#store.updateTask(task.id, { status: 'interrupted', error: 'Cloud task still running or recovery context unavailable' });
        return { taskId: task.id, action: 'marked_interrupt', upstreamTaskId: task.upstreamTaskId };
      }

      const ext = task.type === 'image' ? '.png' : '.mp4';
      const filename = `recovered_${task.id}${ext}`;
      const savePath = path.join(ctx.mediaDir, filename);
      await ctx.downloadFile(mediaUrl, savePath);

      const mediaPath = `/api/media/${filename}`;
      const result = task.type === 'image'
        ? { images: [{ index: 0, status: 'ok', path: mediaPath, imageUrl: mediaUrl }], total: 1, success: 1, recovered: true }
        : { clips: [{ index: 0, status: 'ok', path: mediaPath }], total: 1, success: 1, recovered: true };

      this.#store.updateTask(task.id, { status: 'completed', progress: 100, result });
      return { taskId: task.id, action: 'recovered_completed', upstreamTaskId: task.upstreamTaskId, downloaded: filename };
    } catch (err) {
      this.#store.updateTask(task.id, { status: 'interrupted', error: `Recovery failed: ${err.message}` });
      return { taskId: task.id, action: 'recovery_error', error: err.message };
    }
  }

  // ── Cleanup ──────────────────────────────────────────────────────────────

  runCleanup(maxAge) {
    return this.#store.cleanup(maxAge || this.#retentionMs);
  }

  // ── Health & Diagnostics ─────────────────────────────────────────────────

  async getHealth() {
    const counts = this.#store.countByStatus();
    const storage = await this.#store.getStorageHealth();

    return {
      queue: {
        waiting: this.#waitingQueue.length,
        running: this.#runningCount,
        maxConcurrency: this.#maxConcurrency,
        perOwnerLimit: this.#perOwnerLimit,
      },
      tasks: counts,
      storage,
      recovery: {
        lastResults: this.#recoveryResults,
      },
    };
  }
}
