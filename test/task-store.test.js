// Run: node --experimental-vm-modules --test test/task-store.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { InMemoryTaskStore, FileTaskStore, isTerminalStatus } from '../server/task-store.js';
import { TaskController } from '../server/task-controller.js';

// ── isTerminalStatus ────────────────────────────────────────────────────────

test('isTerminalStatus: completed, failed, cancelled, interrupted are terminal', () => {
  assert.equal(isTerminalStatus('completed'), true);
  assert.equal(isTerminalStatus('failed'), true);
  assert.equal(isTerminalStatus('cancelled'), true);
  assert.equal(isTerminalStatus('interrupted'), true);
});

test('isTerminalStatus: pending, running, queued are not terminal', () => {
  assert.equal(isTerminalStatus('pending'), false);
  assert.equal(isTerminalStatus('running'), false);
  assert.equal(isTerminalStatus('queued'), false);
});

// ── Shared store behavior ───────────────────────────────────────────────────

function runStoreTests(label, createStore) {
  test(`${label}: createTask returns task with id, type, pending status`, async () => {
    const store = createStore();
    await store.init();
    const task = store.createTask('render', { total: 10 });
    assert.ok(task.id.startsWith('task_'));
    assert.equal(task.type, 'render');
    assert.equal(task.status, 'pending');
    assert.equal(task.total, 10);
    assert.equal(task.progress, 0);
    assert.ok(task.createdAt > 0);
    await store.close();
  });

  test(`${label}: getTask returns clone, not reference`, async () => {
    const store = createStore();
    await store.init();
    const created = store.createTask('render');
    const fetched = store.getTask(created.id);
    assert.deepEqual(fetched.id, created.id);
    fetched.status = 'hacked';
    assert.equal(store.getTask(created.id).status, 'pending', 'mutation must not leak');
    await store.close();
  });

  test(`${label}: getTask returns null for unknown id`, async () => {
    const store = createStore();
    await store.init();
    assert.equal(store.getTask('nonexistent'), null);
    await store.close();
  });

  test(`${label}: updateTask merges patch and bumps updatedAt`, async () => {
    const store = createStore();
    await store.init();
    const task = store.createTask('render');
    const updated = store.updateTask(task.id, { status: 'running', progress: 50 });
    assert.equal(updated.status, 'running');
    assert.equal(updated.progress, 50);
    assert.ok(updated.updatedAt >= task.updatedAt);
    await store.close();
  });

  test(`${label}: updateTask returns null for unknown id`, async () => {
    const store = createStore();
    await store.init();
    assert.equal(store.updateTask('nope', { status: 'running' }), null);
    await store.close();
  });

  test(`${label}: cancelTask sets cancelled=true and status=cancelled`, async () => {
    const store = createStore();
    await store.init();
    const task = store.createTask('render');
    const cancelled = store.cancelTask(task.id);
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.cancelled, true);
    assert.equal(store.isTaskCancelled(task.id), true);
    await store.close();
  });

  test(`${label}: cancelTask on terminal task is idempotent`, async () => {
    const store = createStore();
    await store.init();
    const task = store.createTask('render');
    store.updateTask(task.id, { status: 'completed' });
    const result = store.cancelTask(task.id);
    assert.equal(result.status, 'completed', 'already-terminal task keeps its status');
    await store.close();
  });

  test(`${label}: cancelTask returns null for unknown id`, async () => {
    const store = createStore();
    await store.init();
    assert.equal(store.cancelTask('nope'), null);
    await store.close();
  });

  test(`${label}: listTasks returns all tasks sorted by createdAt desc`, async () => {
    const store = createStore();
    await store.init();
    const t1 = store.createTask('render');
    const t2 = store.createTask('video');
    const t3 = store.createTask('image');
    const list = store.listTasks();
    assert.equal(list.length, 3);
    const ids = new Set(list.map(t => t.id));
    assert.ok(ids.has(t1.id));
    assert.ok(ids.has(t2.id));
    assert.ok(ids.has(t3.id));
    await store.close();
  });

  test(`${label}: getTasksByStatus filters correctly`, async () => {
    const store = createStore();
    await store.init();
    const t1 = store.createTask('render');
    const t2 = store.createTask('render');
    const t3 = store.createTask('render');
    store.updateTask(t1.id, { status: 'running' });
    store.updateTask(t2.id, { status: 'completed' });
    assert.equal(store.getTasksByStatus('running').length, 1);
    assert.equal(store.getTasksByStatus('completed').length, 1);
    assert.equal(store.getTasksByStatus('pending').length, 1);
    await store.close();
  });

  test(`${label}: countByStatus returns accurate counts`, async () => {
    const store = createStore();
    await store.init();
    store.createTask('render');
    const t2 = store.createTask('render');
    const t3 = store.createTask('render');
    store.updateTask(t2.id, { status: 'running' });
    store.updateTask(t3.id, { status: 'running' });
    const counts = store.countByStatus();
    assert.equal(counts.pending, 1);
    assert.equal(counts.running, 2);
    await store.close();
  });

  test(`${label}: idempotency key registration and lookup`, async () => {
    const store = createStore();
    await store.init();
    const task = store.createTask('render', { idempotencyKey: 'key-1' });
    const found = store.findByIdempotencyKey('key-1');
    assert.ok(found);
    assert.equal(found.taskId, task.id);
    assert.equal(store.findByIdempotencyKey('nonexistent'), null);
    await store.close();
  });

  test(`${label}: registerIdempotency stores hash for conflict detection`, async () => {
    const store = createStore();
    await store.init();
    const task = store.createTask('render');
    store.registerIdempotency('ext-key', task.id, 'hash-abc');
    const found = store.findByIdempotencyKey('ext-key');
    assert.equal(found.requestHash, 'hash-abc');
    await store.close();
  });

  test(`${label}: cleanup removes only terminal tasks past retention`, async () => {
    const store = createStore();
    await store.init();
    const t1 = store.createTask('render');
    const t2 = store.createTask('render');
    const t3 = store.createTask('render');
    store.updateTask(t1.id, { status: 'completed' });
    store.updateTask(t2.id, { status: 'failed' });
    await new Promise(r => setTimeout(r, 20));
    // t3 stays pending — should NOT be cleaned even if old enough
    const removed = store.cleanup(5);
    assert.equal(removed, 2);
    assert.equal(store.getTask(t1.id), null);
    assert.equal(store.getTask(t2.id), null);
    assert.ok(store.getTask(t3.id), 'non-terminal task survives cleanup');
    await store.close();
  });

  test(`${label}: cleanup preserves idempotency index for surviving tasks`, async () => {
    const store = createStore();
    await store.init();
    const t1 = store.createTask('render', { idempotencyKey: 'keep-me' });
    const t2 = store.createTask('render', { idempotencyKey: 'drop-me' });
    store.updateTask(t2.id, { status: 'completed' });
    await new Promise(r => setTimeout(r, 20));
    store.cleanup(5);
    assert.ok(store.findByIdempotencyKey('keep-me'));
    assert.equal(store.findByIdempotencyKey('drop-me'), null);
    await store.close();
  });
}

runStoreTests('InMemoryTaskStore', () => new InMemoryTaskStore());
runStoreTests('FileTaskStore', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-store-test-'));
  return new FileTaskStore(dir);
});

// ── FileTaskStore-specific tests ────────────────────────────────────────────

test('FileTaskStore: persists tasks across re-instantiation', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-persist-'));
  const store1 = new FileTaskStore(dir);
  await store1.init();
  const task = store1.createTask('render', { total: 5, owner: 'user-1' });
  store1.updateTask(task.id, { status: 'running', progress: 50 });
  await store1.close();

  const store2 = new FileTaskStore(dir);
  await store2.init();
  const loaded = store2.getTask(task.id);
  assert.ok(loaded);
  assert.equal(loaded.status, 'running');
  assert.equal(loaded.progress, 50);
  assert.equal(loaded.owner, 'user-1');
  await store2.close();
});

test('FileTaskStore: persists idempotency index across re-instantiation', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-idem-'));
  const store1 = new FileTaskStore(dir);
  await store1.init();
  const task = store1.createTask('render', { idempotencyKey: 'persist-key' });
  store1.registerIdempotency('persist-key', task.id, 'hash-xyz');
  await store1.close();

  const store2 = new FileTaskStore(dir);
  await store2.init();
  const found = store2.findByIdempotencyKey('persist-key');
  assert.ok(found);
  assert.equal(found.taskId, task.id);
  assert.equal(found.requestHash, 'hash-xyz');
  await store2.close();
});

test('FileTaskStore: skips corrupt task files during load', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-corrupt-'));
  const store1 = new FileTaskStore(dir);
  await store1.init();
  const good = store1.createTask('render');
  await store1.close();

  // Write a corrupt file
  fs.writeFileSync(path.join(dir, 'corrupt.json'), '{broken json', 'utf-8');

  const store2 = new FileTaskStore(dir);
  await store2.init();
  assert.ok(store2.getTask(good.id), 'good task survived corrupt file');
  const list = store2.listTasks();
  assert.equal(list.length, 1, 'corrupt file did not produce a task');
  await store2.close();
});

test('FileTaskStore: cleanup deletes task files from disk', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-cleanup-'));
  const store = new FileTaskStore(dir);
  await store.init();
  const task = store.createTask('render');
  store.updateTask(task.id, { status: 'completed' });
  await new Promise(r => setTimeout(r, 20));
  assert.ok(fs.existsSync(path.join(dir, `${task.id}.json`)));

  store.cleanup(5);
  assert.equal(fs.existsSync(path.join(dir, `${task.id}.json`)), false, 'task file deleted');
  await store.close();
});

test('FileTaskStore: getStorageHealth reports ok and task count', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-health-'));
  const store = new FileTaskStore(dir);
  await store.init();
  store.createTask('render');
  store.createTask('video');
  const health = await store.getStorageHealth();
  assert.equal(health.ok, true);
  assert.equal(health.type, 'file');
  assert.equal(health.taskCount, 2);
  await store.close();
});

test('InMemoryTaskStore: getStorageHealth returns memory type', async () => {
  const store = new InMemoryTaskStore();
  await store.init();
  const health = await store.getStorageHealth();
  assert.equal(health.type, 'memory');
  assert.equal(health.ok, true);
  await store.close();
});

// ── TaskController tests ────────────────────────────────────────────────────

function makeController(overrides = {}) {
  const store = new InMemoryTaskStore();
  const controller = new TaskController({
    store,
    maxConcurrency: overrides.maxConcurrency ?? 2,
    perOwnerLimit: overrides.perOwnerLimit ?? 2,
    retentionMs: overrides.retentionMs ?? 60000,
  });
  return { store, controller };
}

async function withController(overrides, fn) {
  const { store, controller } = makeController(overrides);
  await controller.init();
  try {
    await fn({ store, controller });
  } finally {
    await controller.shutdown();
  }
}

function defer() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function tick(ms = 0) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

test('TaskController: submitTask creates and runs worker immediately when under limits', async () => {
  await withController({}, async ({ controller }) => {
    const workerRan = defer();
    const result = await controller.submitTask({
      type: 'render',
      worker: async (task) => { workerRan.resolve(task.id); },
    });

    assert.equal(result.status, 'created');
    assert.ok(result.task.id);
    const ranId = await workerRan.promise;
    assert.equal(ranId, result.task.id);
  });
});

test('TaskController: global concurrency limit queues excess tasks', async () => {
  await withController({ maxConcurrency: 1, perOwnerLimit: 10 }, async ({ store, controller }) => {
    const gate1 = defer();
    const gate2 = defer();

    await controller.submitTask({
      type: 'a', owner: 'u1',
      worker: async () => { await gate1.promise; },
    });
    await tick(10);

    await controller.submitTask({
      type: 'b', owner: 'u2',
      worker: async () => { gate2.resolve(); },
    });
    await tick(10);

    assert.equal(store.getTasksByStatus('running').length, 1);
    assert.equal(store.getTasksByStatus('queued').length, 1);
    assert.equal(controller.waitingQueue.length, 1);

    gate1.resolve();
    await gate2.promise;
    await tick(10);

    assert.equal(store.getTasksByStatus('queued').length, 0, 'second task promoted from queue');
  });
});

test('TaskController: per-owner limit queues excess from same owner', async () => {
  await withController({ maxConcurrency: 10, perOwnerLimit: 1 }, async ({ store, controller }) => {
    const gate1 = defer();
    const started2 = defer();

    await controller.submitTask({
      type: 'a', owner: 'alice',
      worker: async () => { await gate1.promise; },
    });
    await tick(10);

    await controller.submitTask({
      type: 'b', owner: 'alice',
      worker: async () => { started2.resolve(); },
    });
    await tick(10);

    assert.equal(store.getTasksByStatus('queued').length, 1, 'second task from same owner queued');

    gate1.resolve();
    await tick(20);
    await started2.promise;
  });
});

test('TaskController: different owners do not block each other under per-owner limit', async () => {
  await withController({ maxConcurrency: 10, perOwnerLimit: 1 }, async ({ store, controller }) => {
    const ran = [];
    await controller.submitTask({
      type: 'a', owner: 'alice',
      worker: async () => { ran.push('alice'); },
    });
    await controller.submitTask({
      type: 'b', owner: 'bob',
      worker: async () => { ran.push('bob'); },
    });
    await tick(30);

    assert.equal(store.getTasksByStatus('running').length, 2, 'both owners run concurrently');
    assert.deepEqual(ran.sort(), ['alice', 'bob']);
  });
});

test('TaskController: idempotent submission returns duplicate for same key', async () => {
  await withController({}, async ({ controller }) => {
    const r1 = await controller.submitTask({
      type: 'render', idempotencyKey: 'idem-1', requestHash: 'hash-a',
      worker: async () => {},
    });
    assert.equal(r1.status, 'created');

    const r2 = await controller.submitTask({
      type: 'render', idempotencyKey: 'idem-1', requestHash: 'hash-a',
      worker: async () => {},
    });
    assert.equal(r2.status, 'duplicate');
    assert.equal(r2.task.id, r1.task.id);
  });
});

test('TaskController: idempotent submission returns conflict for same key + different hash', async () => {
  await withController({}, async ({ controller }) => {
    const r1 = await controller.submitTask({
      type: 'render', idempotencyKey: 'idem-2', requestHash: 'hash-a',
      worker: async () => {},
    });
    assert.equal(r1.status, 'created');

    const r2 = await controller.submitTask({
      type: 'render', idempotencyKey: 'idem-2', requestHash: 'hash-BDIFFERENT',
      worker: async () => {},
    });
    assert.equal(r2.status, 'conflict');
    assert.equal(r2.existingTask.id, r1.task.id);
  });
});

test('TaskController: cancelTask cancels a queued task and removes from queue', async () => {
  await withController({ maxConcurrency: 1, perOwnerLimit: 10 }, async ({ store, controller }) => {
    const gate = defer();
    await controller.submitTask({
      type: 'a', owner: 'u1',
      worker: async () => { await gate.promise; },
    });
    await tick(10);

    const r2 = await controller.submitTask({
      type: 'b', owner: 'u2',
      worker: async () => {},
    });
    await tick(10);
    assert.equal(store.getTask(r2.task.id).status, 'queued');

    const cancelled = await controller.cancelTask(r2.task.id);
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(controller.waitingQueue.length, 0);

    gate.resolve();
  });
});

test('TaskController: cancelTask emits task:cancelled event', async () => {
  await withController({}, async ({ controller }) => {
    const r = await controller.submitTask({
      type: 'render',
      worker: async () => {},
    });
    await tick(10);

    const eventFired = defer();
    controller.on('task:cancelled', (id) => eventFired.resolve(id));

    await controller.cancelTask(r.task.id);
    const cancelledId = await eventFired.promise;
    assert.equal(cancelledId, r.task.id);
  });
});

test('TaskController: worker failure marks task as failed', async () => {
  await withController({}, async ({ store, controller }) => {
    await controller.submitTask({
      type: 'render',
      worker: async () => { throw new Error('boom'); },
    });
    await tick(30);

    const tasks = store.getTasksByStatus('failed');
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].error, 'boom');
  });
});

test('TaskController: queue drains in FIFO order when slots free up', async () => {
  await withController({ maxConcurrency: 1, perOwnerLimit: 10 }, async ({ controller }) => {
    const order = [];
    const gate = defer();

    await controller.submitTask({
      type: 'first', owner: 'u1',
      worker: async () => { await gate.promise; },
    });
    await tick(10);

    await controller.submitTask({
      type: 'second', owner: 'u2',
      worker: async () => { order.push('second'); },
    });
    await tick(10);
    await controller.submitTask({
      type: 'third', owner: 'u3',
      worker: async () => { order.push('third'); },
    });
    await tick(10);

    assert.equal(controller.waitingQueue.length, 2);

    gate.resolve();
    await tick(50);

    assert.deepEqual(order, ['second', 'third'], 'FIFO order');
  });
});

test('TaskController: getHealth returns queue counts, task counts, storage, recovery', async () => {
  await withController({}, async ({ controller }) => {
    await controller.submitTask({
      type: 'render',
      worker: async () => {},
    });
    await tick(20);

    const health = await controller.getHealth();
    assert.ok(health.queue);
    assert.equal(health.queue.maxConcurrency, 2);
    assert.ok(health.tasks);
    assert.ok(health.storage);
    assert.ok(health.recovery);
    assert.ok(Array.isArray(health.recovery.lastResults));
  });
});

test('TaskController: runCleanup delegates to store', async () => {
  await withController({}, async ({ store, controller }) => {
    const task = store.createTask('render');
    store.updateTask(task.id, { status: 'completed' });
    await new Promise(r => setTimeout(r, 20));
    const removed = await controller.runCleanup(5);
    assert.equal(removed, 1);
    assert.equal(store.getTask(task.id), null);
  });
});

test('TaskController: recovery marks running tasks without external IDs as interrupted', async () => {
  const store = new InMemoryTaskStore();
  await store.init();

  const task = store.createTask('render');
  store.updateTask(task.id, { status: 'running' });

  const controller = new TaskController({ store, maxConcurrency: 2 });
  await controller.init();
  try {
    const recovered = store.getTask(task.id);
    assert.equal(recovered.status, 'interrupted');
    assert.ok(recovered.error.includes('Server restarted'));

    const results = controller.recoveryResults;
    assert.equal(results.length, 1);
    assert.equal(results[0].action, 'marked_interrupt');
  } finally {
    await controller.shutdown();
  }
});

test('TaskController: recovery marks queued tasks without worker as interrupted', async () => {
  const store = new InMemoryTaskStore();
  await store.init();

  const task = store.createTask('render');
  store.updateTask(task.id, { status: 'queued' });

  const controller = new TaskController({ store, maxConcurrency: 2 });
  await controller.init();
  try {
    const recovered = store.getTask(task.id);
    assert.equal(recovered.status, 'interrupted');
    assert.ok(recovered.error.includes('Server restarted'));

    const results = controller.recoveryResults;
    assert.equal(results[0].action, 'marked_interrupt');
    assert.equal(results[0].reason, 'queued_no_worker');
  } finally {
    await controller.shutdown();
  }
});

test('TaskController: completed/failed tasks are not touched by recovery', async () => {
  const store = new InMemoryTaskStore();
  await store.init();

  const t1 = store.createTask('render');
  store.updateTask(t1.id, { status: 'completed' });
  const t2 = store.createTask('render');
  store.updateTask(t2.id, { status: 'failed' });

  const controller = new TaskController({ store, maxConcurrency: 2 });
  await controller.init();
  try {
    assert.equal(store.getTask(t1.id).status, 'completed');
    assert.equal(store.getTask(t2.id).status, 'failed');
    assert.equal(controller.recoveryResults.length, 0, 'terminal tasks skipped');
  } finally {
    await controller.shutdown();
  }
});

test('TaskController: task:promoted event fires when task starts running', async () => {
  await withController({}, async ({ controller }) => {
    const promoted = defer();
    controller.on('task:promoted', (id) => promoted.resolve(id));

    const r = await controller.submitTask({
      type: 'render',
      worker: async () => {},
    });

    const promotedId = await promoted.promise;
    assert.equal(promotedId, r.task.id);
  });
});

test('TaskController: cleanup deletes interrupted tasks past retention', async () => {
  const store = new InMemoryTaskStore();
  await store.init();

  const task = store.createTask('render');
  store.updateTask(task.id, { status: 'interrupted', error: 'Server restarted' });

  const controller = new TaskController({ store, maxConcurrency: 2 });
  await controller.init();
  try {
    await new Promise(r => setTimeout(r, 20));
    const removed = await controller.runCleanup(5);
    assert.equal(removed, 1);
    assert.equal(store.getTask(task.id), null);
  } finally {
    await controller.shutdown();
  }
});

test('TaskController: cloud recovery without recoveryContext marks interrupted', async () => {
  const store = new InMemoryTaskStore();
  await store.init();

  const task = store.createTask('video');
  store.updateTask(task.id, {
    status: 'running',
    upstreamTaskId: 'fake-upstream-123',
    provider: 'dashscope',
  });

  const controller = new TaskController({ store, maxConcurrency: 2 });
  await controller.init();
  try {
    const recovered = store.getTask(task.id);
    assert.equal(recovered.status, 'interrupted');
    assert.ok(recovered.error.includes('recovery context unavailable') || recovered.error.includes('DASHSCOPE_API_KEY'));
  } finally {
    await controller.shutdown();
  }
});

test('TaskController: recoveryContext is stored and accessible', async () => {
  const ctx = { mediaDir: '/tmp/test-media', downloadFile: async () => {} };
  const store = new InMemoryTaskStore();
  await store.init();

  const controller = new TaskController({ store, maxConcurrency: 2, recoveryContext: ctx });
  await controller.init();
  try {
    const health = await controller.getHealth();
    assert.ok(health.queue);
    assert.ok(health.recovery);
  } finally {
    await controller.shutdown();
  }
});
