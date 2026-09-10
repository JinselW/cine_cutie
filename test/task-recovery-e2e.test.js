// Run: node --experimental-vm-modules --test test/task-recovery-e2e.test.js
//
// End-to-end crash-recovery tests:
//   submit task → kill process → restart → verify complete media result
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';
import { FileTaskStore } from '../server/task-store.js';
import { TaskController } from '../server/task-controller.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// ── Mock recovery helpers ───────────────────────────────────────────────────

function mockImageContext(mediaDir, { status = 'SUCCEEDED', url = 'https://mock.cdn/img.png' } = {}) {
  const downloaded = [];
  return {
    downloaded,
    ctx: {
      mediaDir,
      downloadFile: async (u, p) => { fs.writeFileSync(p, 'fake-png'); downloaded.push({ url: u, savePath: p }); },
      dashscopeApiKey: 'mock-key',
      pollTask: async () => ({ output: { task_status: status, results: [{ url }] } }),
      parseImageResultUrl: (d) => d?.output?.results?.[0]?.url ?? null,
    },
  };
}

function mockVideoContext(mediaDir, { provider = 'dashscope', status = 'SUCCEEDED', url = 'https://mock.cdn/vid.mp4' } = {}) {
  const downloaded = [];
  const ctx = {
    mediaDir,
    downloadFile: async (u, p) => { fs.writeFileSync(p, 'fake-mp4'); downloaded.push({ url: u, savePath: p }); },
  };
  if (provider === 'dashscope') {
    ctx.dashscopeApiKey = 'mock-key';
    ctx.pollTask = async () => ({ output: { task_status: status, video_url: url } });
  } else {
    ctx.arkApiKey = 'mock-key';
    ctx.pollArkTask = async () => ({ status: status.toLowerCase(), content: { video_url: url } });
    ctx.parseArkVideoUrl = (d) => d?.content?.video_url ?? null;
  }
  return { downloaded, ctx };
}

// ── Test 1: Image task crash → restart → full media recovery ────────────────

test('E2E: image task survives crash and recovers with downloaded media', async () => {
  const root = tmpDir('e2e-img-');
  const storeDir = path.join(root, 'tasks');
  const mediaDir = path.join(root, 'media');
  fs.mkdirSync(mediaDir, { recursive: true });

  // Phase 1 — "before crash": task is running with an upstream ID
  const store1 = new FileTaskStore(storeDir);
  await store1.init();
  const task = store1.createTask('image', { owner: 'user-a', total: 1 });
  store1.updateTask(task.id, {
    status: 'running',
    provider: 'dashscope',
    upstreamTaskId: 'ds-img-001',
    progress: 40,
  });
  await store1.close();

  // Phase 2 — "restart": new store + controller with mock recovery
  const { downloaded, ctx } = mockImageContext(mediaDir);
  const store2 = new FileTaskStore(storeDir);
  const controller = new TaskController({ store: store2, recoveryContext: ctx });
  await controller.init();

  // Phase 3 — verify complete result
  const recovered = store2.getTask(task.id);
  assert.equal(recovered.status, 'completed', 'task should be completed after recovery');
  assert.equal(recovered.progress, 100);
  assert.ok(recovered.result.recovered, 'result should be flagged as recovered');
  assert.ok(Array.isArray(recovered.result.images), 'result.images must exist for client consumption');
  assert.equal(recovered.result.images.length, 1);
  assert.equal(recovered.result.images[0].status, 'ok');
  assert.ok(recovered.result.images[0].path.startsWith('/api/media/'), 'path must be a media URL');

  // Verify the file actually landed on disk
  assert.equal(downloaded.length, 1, 'downloadFile should have been called once');
  assert.ok(fs.existsSync(downloaded[0].savePath), 'recovered image file must exist on disk');
  assert.equal(fs.readFileSync(downloaded[0].savePath, 'utf-8'), 'fake-png');

  // Verify recovery diagnostics
  const rr = controller.recoveryResults;
  assert.equal(rr.length, 1);
  assert.equal(rr[0].action, 'recovered_completed');
  assert.ok(rr[0].downloaded, 'recovery result should report downloaded filename');

  await controller.shutdown();
  fs.rmSync(root, { recursive: true, force: true });
});

// ── Test 2: Video task crash → restart → full media recovery (DashScope) ────

test('E2E: video task (dashscope) recovers with downloaded clip', async () => {
  const root = tmpDir('e2e-vid-ds-');
  const storeDir = path.join(root, 'tasks');
  const mediaDir = path.join(root, 'media');
  fs.mkdirSync(mediaDir, { recursive: true });

  const store1 = new FileTaskStore(storeDir);
  await store1.init();
  const task = store1.createTask('video', { owner: 'user-b', total: 1 });
  store1.updateTask(task.id, {
    status: 'running',
    provider: 'dashscope',
    upstreamTaskId: 'ds-vid-002',
    progress: 60,
  });
  await store1.close();

  const { downloaded, ctx } = mockVideoContext(mediaDir, { provider: 'dashscope' });
  const store2 = new FileTaskStore(storeDir);
  const controller = new TaskController({ store: store2, recoveryContext: ctx });
  await controller.init();

  const recovered = store2.getTask(task.id);
  assert.equal(recovered.status, 'completed');
  assert.ok(Array.isArray(recovered.result.clips), 'result.clips must exist');
  assert.equal(recovered.result.clips[0].status, 'ok');
  assert.ok(recovered.result.clips[0].path.startsWith('/api/media/'));
  assert.equal(downloaded.length, 1);
  assert.ok(fs.existsSync(downloaded[0].savePath));

  await controller.shutdown();
  fs.rmSync(root, { recursive: true, force: true });
});

// ── Test 3: Video task crash → restart → full media recovery (Ark) ──────────

test('E2E: video task (ark) recovers with downloaded clip', async () => {
  const root = tmpDir('e2e-vid-ark-');
  const storeDir = path.join(root, 'tasks');
  const mediaDir = path.join(root, 'media');
  fs.mkdirSync(mediaDir, { recursive: true });

  const store1 = new FileTaskStore(storeDir);
  await store1.init();
  const task = store1.createTask('video', { owner: 'user-c', total: 1 });
  store1.updateTask(task.id, {
    status: 'running',
    provider: 'ark',
    upstreamTaskId: 'ark-vid-003',
    progress: 30,
  });
  await store1.close();

  const { downloaded, ctx } = mockVideoContext(mediaDir, { provider: 'ark' });
  const store2 = new FileTaskStore(storeDir);
  const controller = new TaskController({ store: store2, recoveryContext: ctx });
  await controller.init();

  const recovered = store2.getTask(task.id);
  assert.equal(recovered.status, 'completed');
  assert.ok(Array.isArray(recovered.result.clips));
  assert.equal(recovered.result.clips[0].status, 'ok');
  assert.equal(downloaded.length, 1);
  assert.ok(fs.existsSync(downloaded[0].savePath));

  await controller.shutdown();
  fs.rmSync(root, { recursive: true, force: true });
});

// ── Test 4: Upstream still running → interrupted, not stuck ─────────────────

test('E2E: upstream still running after crash → interrupted (not stuck pending)', async () => {
  const root = tmpDir('e2e-running-');
  const storeDir = path.join(root, 'tasks');
  const mediaDir = path.join(root, 'media');
  fs.mkdirSync(mediaDir, { recursive: true });

  const store1 = new FileTaskStore(storeDir);
  await store1.init();
  const task = store1.createTask('image', { total: 1 });
  store1.updateTask(task.id, {
    status: 'running',
    provider: 'dashscope',
    upstreamTaskId: 'ds-still-running',
  });
  await store1.close();

  const { ctx } = mockImageContext(mediaDir, { status: 'RUNNING' });
  const store2 = new FileTaskStore(storeDir);
  const controller = new TaskController({ store: store2, recoveryContext: ctx });
  await controller.init();

  const recovered = store2.getTask(task.id);
  assert.equal(recovered.status, 'interrupted', 'should be interrupted, not stuck');
  assert.ok(recovered.error, 'should have an error message');

  await controller.shutdown();
  fs.rmSync(root, { recursive: true, force: true });
});

// ── Test 5: Upstream failed → task failed with error ────────────────────────

test('E2E: upstream failed after crash → task marked failed', async () => {
  const root = tmpDir('e2e-failed-');
  const storeDir = path.join(root, 'tasks');
  const mediaDir = path.join(root, 'media');
  fs.mkdirSync(mediaDir, { recursive: true });

  const store1 = new FileTaskStore(storeDir);
  await store1.init();
  const task = store1.createTask('video', { total: 1 });
  store1.updateTask(task.id, {
    status: 'running',
    provider: 'dashscope',
    upstreamTaskId: 'ds-failed-001',
  });
  await store1.close();

  const { ctx } = mockVideoContext(mediaDir, { status: 'FAILED' });
  const store2 = new FileTaskStore(storeDir);
  const controller = new TaskController({ store: store2, recoveryContext: ctx });
  await controller.init();

  const recovered = store2.getTask(task.id);
  assert.equal(recovered.status, 'failed');
  assert.ok(recovered.error.includes('failed') || recovered.error.includes('FAILED'));

  await controller.shutdown();
  fs.rmSync(root, { recursive: true, force: true });
});

// ── Test 6: Queued task (no worker) → interrupted on restart ────────────────

test('E2E: queued task without worker → interrupted on restart', async () => {
  const root = tmpDir('e2e-queued-');
  const storeDir = path.join(root, 'tasks');
  fs.mkdirSync(storeDir, { recursive: true });

  const store1 = new FileTaskStore(storeDir);
  await store1.init();
  const task = store1.createTask('render', { owner: 'user-d' });
  store1.updateTask(task.id, { status: 'queued' });
  await store1.close();

  const store2 = new FileTaskStore(storeDir);
  const controller = new TaskController({ store: store2 });
  await controller.init();

  const recovered = store2.getTask(task.id);
  assert.equal(recovered.status, 'interrupted', 'queued tasks must not stay pending forever');
  assert.ok(recovered.error.includes('Server restarted'));

  await controller.shutdown();
  fs.rmSync(root, { recursive: true, force: true });
});

// ── Test 7: Real child-process kill → restart → recovery ────────────────────

test('E2E: real process kill → restart → task recovered from disk', async () => {
  const root = tmpDir('e2e-proc-');
  const storeDir = path.join(root, 'tasks');
  const mediaDir = path.join(root, 'media');
  fs.mkdirSync(mediaDir, { recursive: true });
  fs.mkdirSync(storeDir, { recursive: true });

  const storeUrl = pathToFileURL(path.resolve(__dirname, '../server/task-store.js')).href;

  // Child script: creates a task, sets it to running, then hangs forever
  const childScript = path.join(root, 'child.mjs');
  fs.writeFileSync(childScript, `
import { FileTaskStore } from '${storeUrl}';
const store = new FileTaskStore(${JSON.stringify(storeDir)});
await store.init();
const task = store.createTask('image', { owner: 'proc-test', total: 1 });
store.updateTask(task.id, {
  status: 'running',
  provider: 'dashscope',
  upstreamTaskId: 'ds-proc-001',
  progress: 50,
});
process.send({ taskId: task.id });
await new Promise(() => {});
`);

  // Phase 1: spawn child, wait for task ID, then kill
  const child = spawn(process.execPath, [childScript], {
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
  });

  let stderr = '';
  child.stderr.on('data', d => { stderr += d.toString(); });

  const taskId = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Child did not report task in 10s. stderr: ${stderr}`));
    }, 10000);
    child.on('message', (msg) => { clearTimeout(timeout); resolve(msg.taskId); });
    child.on('error', (err) => { clearTimeout(timeout); reject(err); });
  });

  // Kill the child (simulates crash)
  child.kill('SIGKILL');
  await new Promise(resolve => child.on('exit', resolve));

  // Verify task file persisted on disk
  const taskFile = path.join(storeDir, `${taskId}.json`);
  assert.ok(fs.existsSync(taskFile), 'task file must survive process kill');
  const onDisk = JSON.parse(fs.readFileSync(taskFile, 'utf-8'));
  assert.equal(onDisk.status, 'running');
  assert.equal(onDisk.upstreamTaskId, 'ds-proc-001');

  // Phase 2: "restart" — new controller reads from same directory
  const { downloaded, ctx } = mockImageContext(mediaDir);
  const store2 = new FileTaskStore(storeDir);
  const controller = new TaskController({ store: store2, recoveryContext: ctx });
  await controller.init();

  // Phase 3: verify full recovery
  const recovered = store2.getTask(taskId);
  assert.equal(recovered.status, 'completed', 'task must complete after restart');
  assert.equal(recovered.progress, 100);
  assert.ok(recovered.result.recovered);
  assert.ok(Array.isArray(recovered.result.images));
  assert.equal(recovered.result.images[0].status, 'ok');
  assert.ok(recovered.result.images[0].path.startsWith('/api/media/'));
  assert.equal(downloaded.length, 1);
  assert.ok(fs.existsSync(downloaded[0].savePath), 'media file must exist after recovery');

  await controller.shutdown();
  fs.rmSync(root, { recursive: true, force: true });
});

// ── Test 8: Multiple tasks — mixed recovery outcomes ────────────────────────

test('E2E: mixed batch — one recovers, one interrupted, one already completed', async () => {
  const root = tmpDir('e2e-mixed-');
  const storeDir = path.join(root, 'tasks');
  const mediaDir = path.join(root, 'media');
  fs.mkdirSync(mediaDir, { recursive: true });

  const store1 = new FileTaskStore(storeDir);
  await store1.init();

  // Task A: running with upstream → will recover
  const taskA = store1.createTask('image', { total: 1 });
  store1.updateTask(taskA.id, { status: 'running', provider: 'dashscope', upstreamTaskId: 'ds-a' });

  // Task B: running without upstream → will be interrupted
  const taskB = store1.createTask('render', { total: 1 });
  store1.updateTask(taskB.id, { status: 'running', progress: 70 });

  // Task C: already completed → untouched
  const taskC = store1.createTask('video', { total: 1 });
  store1.updateTask(taskC.id, { status: 'completed', progress: 100, result: { clips: [] } });

  await store1.close();

  const { ctx } = mockImageContext(mediaDir);
  const store2 = new FileTaskStore(storeDir);
  const controller = new TaskController({ store: store2, recoveryContext: ctx });
  await controller.init();

  assert.equal(store2.getTask(taskA.id).status, 'completed', 'A: recovered');
  assert.equal(store2.getTask(taskB.id).status, 'interrupted', 'B: interrupted (no upstream)');
  assert.equal(store2.getTask(taskC.id).status, 'completed', 'C: untouched');
  assert.deepEqual(store2.getTask(taskC.id).result, { clips: [] }, 'C: result preserved');

  const rr = controller.recoveryResults;
  assert.equal(rr.length, 2, 'only A and B should have recovery results');

  await controller.shutdown();
  fs.rmSync(root, { recursive: true, force: true });
});

// ── Test 9: Idempotency key survives crash and blocks duplicate ─────────────

test('E2E: idempotency key persists across crash and rejects duplicate', async () => {
  const root = tmpDir('e2e-idem-');
  const storeDir = path.join(root, 'tasks');
  fs.mkdirSync(storeDir, { recursive: true });

  const store1 = new FileTaskStore(storeDir);
  await store1.init();
  const task = store1.createTask('image', { idempotencyKey: 'idem-crash-001', total: 1 });
  store1.updateTask(task.id, { status: 'running', provider: 'dashscope', upstreamTaskId: 'ds-idem' });
  await store1.close();

  const { ctx } = mockImageContext(path.join(root, 'media'));
  fs.mkdirSync(path.join(root, 'media'), { recursive: true });
  const store2 = new FileTaskStore(storeDir);
  const controller = new TaskController({ store: store2, recoveryContext: ctx });
  await controller.init();

  // Same idempotency key → duplicate
  const dup = await controller.submitTask({
    type: 'image',
    idempotencyKey: 'idem-crash-001',
    requestHash: null,
    worker: async () => {},
  });
  assert.equal(dup.status, 'duplicate');
  assert.equal(dup.task.id, task.id);

  await controller.shutdown();
  fs.rmSync(root, { recursive: true, force: true });
});
