import { state } from './state.js';

let active = null;
let source = () => ({});
let queue = Promise.resolve();
let timer;
let pending = null;
const inputKeys = ['userInput', 'promptDoc', 'genre', 'visualStyle', 'customStyle', 'totalDuration', 'aspectRatio', 'imageSize', 'resolution', 'mode', 'lang'];

export async function memoryRequest(path = '', options = {}) {
  const response = await fetch(`/api/memory${path}`, {
    ...options, headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(response.status === 404 ? '历史记录不存在（后端更新后请重启 npm run server）' : `历史保存服务不可用 (${response.status})`);
  return response.status === 204 ? null : response.json();
}

function notify(error = '') {
  window.dispatchEvent(new CustomEvent('memory-status', { detail: { error, id: active?.id } }));
}

export function configureMemory(snapshotSource) { source = snapshotSource; }

export async function beginMemory() {
  clearTimeout(timer);
  await queue;
  active = { id: null, input: structuredClone(Object.fromEntries(inputKeys.map(k => [k, state[k]]))),
    messages: [], status: 'running' };
  try {
    const result = await memoryRequest('', { method: 'POST', body: JSON.stringify({
      title: state.userInput.slice(0, 80) || state.promptDoc?.name || '未命名创作', snapshot: snapshot(),
    }) });
    active.id = result.id;
    notify();
  } catch (error) { notify(error.message); }
}

function snapshot() {
  if (active.frozen) return structuredClone(active.frozen);
  let settings = {};
  try { settings = JSON.parse(localStorage.getItem('cine-cutie-settings') || '{}'); } catch {}
  // Deliberately select only reproducibility settings; never serialize provider credentials.
  return structuredClone({ input: active.input, status: active.status, messages: active.messages,
    data: state.data, entities: state.entities, currentStep: state.currentStep,
    configuration: { models: settings.models, videoMode: settings.videoMode }, ...source() });
}

export function saveMemory(status) {
  if (!active) return Promise.resolve();
  if (status) active.status = status;
  clearTimeout(timer);
  const run = active;
  const payload = snapshot();
  if (status === 'stopped' || status === 'failed') run.frozen = payload;
  pending = { run, payload };
  queue = queue.then(async () => {
    try {
      if (!run.id) {
        const record = await memoryRequest('', { method: 'POST', body: JSON.stringify({ title: run.input.userInput.slice(0, 80) || '未命名创作', snapshot: payload }) });
        run.id = record.id;
      } else {
        await memoryRequest(`/${run.id}`, { method: 'PUT', body: JSON.stringify({ snapshot: payload }) });
      }
      if (pending?.payload === payload) pending = null;
      notify();
    } catch (error) { notify(error.message); }
  });
  return queue;
}

export function recordMemoryMessage(role, text, stepId = null) {
  if (!active || active.frozen) return;
  active.messages.push({ role, text, stepId, at: Date.now() });
  clearTimeout(timer);
  timer = setTimeout(() => saveMemory(), 500);
}

export function activeMemoryId() { return active?.id; }
export function attachMemory(id, snapshotInput) {
  active = { id, input: structuredClone(snapshotInput || {}), messages: [], status: 'running' };
}
export function retryMemorySave() { return saveMemory(); }
export function detachMemory(id) {
  if (active?.id === id) { clearTimeout(timer); active = null; pending = null; }
}

window.addEventListener('pagehide', () => {
  if (!active?.id) return;
  // Best effort only; stage saves are awaited during normal execution.
  fetch(`/api/memory/${active.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ snapshot: snapshot() }), keepalive: true }).catch(() => {});
});
