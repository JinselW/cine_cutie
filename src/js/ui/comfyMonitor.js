import { $, escapeHtml } from '../utils.js';
import { t } from '../i18n.js';

const monitors = new Map();
let latestTask = null;
let latestMetrics = null;

function getSshConfig() {
  try { return JSON.parse(localStorage.getItem('cine-cutie-comfy-ssh') || 'null'); } catch { return null; }
}

export function isComfySelected() {
  try {
    return JSON.parse(localStorage.getItem('cine-cutie-providers') || '{}').video === 'video-comfy';
  } catch { return false; }
}

function finite(value, fallback = 0) {
  return value !== null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function percent(used, total) {
  return total > 0 ? Math.min(100, Math.max(0, (used / total) * 100)) : 0;
}

function bytes(value) {
  const n = finite(value);
  if (n >= 1024 ** 4) return `${(n / 1024 ** 4).toFixed(1)} TB`;
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  return `${(n / 1024 ** 2).toFixed(0)} MB`;
}

function elapsed(timestamp) {
  if (!timestamp) return '—';
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function meter(label, value, detail) {
  const pct = Math.round(Math.min(100, Math.max(0, finite(value))));
  return `<div class="comfy-meter">
    <div class="comfy-meter-head"><span>${label}</span><span>${escapeHtml(detail)}</span></div>
    <div class="comfy-meter-track"><span style="width:${pct}%"></span></div>
  </div>`;
}

function render(target, data, showTaskProgress) {
  const gpu = data.system?.gpus?.[0];
  const memory = data.system?.memory;
  const disk = data.system?.disk;
  const queue = data.comfyui?.queue || {};
  const gpuMemory = gpu ? percent(gpu.memoryUsedMiB, gpu.memoryTotalMiB) : 0;
  const task = latestTask;
  const taskProgress = finite(task?.progress);
  const phaseKey = `monitor.phase.${task?.phase || 'waiting'}`;

  target.classList.remove('hidden');
  target.innerHTML = `
    <div class="comfy-monitor-head">
      <div><span class="comfy-live-dot"></span><strong>DGX Spark</strong> · ${escapeHtml(gpu?.name || t('monitor.connected'))}</div>
      <span class="comfy-monitor-time">${new Date(data.timestamp || Date.now()).toLocaleTimeString()}</span>
    </div>
    <div class="comfy-monitor-grid">
      <div class="comfy-stat"><span>${t('monitor.gpu')}</span><strong>${gpu ? `${finite(gpu.utilization)}%` : '—'}</strong><small>${gpu ? `${finite(gpu.temperatureC)}°C · ${finite(gpu.powerDrawW).toFixed(0)}W` : (data.system?.error || '—')}</small></div>
      <div class="comfy-stat"><span>${t('monitor.vram')}</span><strong>${gpu ? `${finite(gpu.memoryUsedMiB).toFixed(0)} / ${finite(gpu.memoryTotalMiB).toFixed(0)} MiB` : '—'}</strong><small>${Math.round(gpuMemory)}%</small></div>
      <div class="comfy-stat"><span>${t('monitor.memory')}</span><strong>${memory ? `${bytes(memory.usedBytes)} / ${bytes(memory.totalBytes)}` : '—'}</strong><small>${memory ? `${finite(memory.usedPercent)}%` : '—'}</small></div>
      <div class="comfy-stat"><span>${t('monitor.disk')}</span><strong>${disk ? `${bytes(disk.usedBytes)} / ${bytes(disk.totalBytes)}` : '—'}</strong><small>${disk ? `${finite(disk.usedPercent)}% · ${escapeHtml(disk.mount)}` : '—'}</small></div>
      <div class="comfy-stat"><span>${t('monitor.queue')}</span><strong>${finite(queue.running)} / ${finite(queue.pending)}</strong><small>${t('monitor.runningPending')}</small></div>
    </div>
    ${gpu ? meter(t('monitor.gpuLoad'), gpu.utilization, `${finite(gpu.utilization)}%`) : ''}
    ${gpu ? meter(t('monitor.vramLoad'), gpuMemory, `${Math.round(gpuMemory)}%`) : ''}
    ${memory ? meter(t('monitor.memoryLoad'), memory.usedPercent, `${finite(memory.usedPercent)}%`) : ''}
    ${disk ? meter(t('monitor.diskLoad'), disk.usedPercent, `${finite(disk.usedPercent)}%`) : ''}
    ${showTaskProgress ? `<div class="comfy-task-progress">
      <div class="comfy-task-line"><strong>${task ? t(phaseKey) : t('monitor.waiting')}</strong><span>${task?.current || 0}/${task?.total || 0} · ${elapsed(task?.clipStartedAt)}</span></div>
      ${meter(t('monitor.overall'), taskProgress, `${Math.round(taskProgress)}%`)}
      <div class="comfy-task-detail">${task?.workflowMode ? escapeHtml(task.workflowMode) : t('monitor.preparing')}</div>
    </div>` : ''}
  `;
}

async function refresh(targetId, showTaskProgress, force) {
  const target = $(`#${targetId}`);
  const cfg = getSshConfig();
  if (!target || (!force && !isComfySelected()) || !cfg?.host) {
    target?.classList.add('hidden');
    return;
  }
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 12000);
    let res;
    try {
      res = await fetch('/api/comfyui/monitor', {
        headers: { 'X-Ssh-Config': JSON.stringify(cfg) },
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.comfyui?.online) throw new Error(data.comfyui?.error || 'ComfyUI offline');
    latestMetrics = data;
    render(target, data, showTaskProgress);
  } catch {
    target.classList.add('hidden');
  }
}

export function startComfyMonitor(targetId, { showTaskProgress = false, force = false } = {}) {
  stopComfyMonitor(targetId);
  void refresh(targetId, showTaskProgress, force);
  const timer = setInterval(() => void refresh(targetId, showTaskProgress, force), 5000);
  monitors.set(targetId, { timer, showTaskProgress, force });
}

export function stopComfyMonitor(targetId) {
  const monitor = monitors.get(targetId);
  if (monitor?.timer) clearInterval(monitor.timer);
  monitors.delete(targetId);
  $(`#${targetId}`)?.classList.add('hidden');
}

if (typeof window !== 'undefined') {
  window.addEventListener('comfy-task-progress', event => {
    latestTask = event.detail || null;
    for (const [targetId, monitor] of monitors) {
      const target = $(`#${targetId}`);
      if (monitor.showTaskProgress && target && latestMetrics) render(target, latestMetrics, true);
    }
  });
}
