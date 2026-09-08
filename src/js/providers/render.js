import { registerProvider } from './registry.js';
import { registerBackendTask, unregisterBackendTask } from './activeTasks.js';
import { reportPercentProgress } from '../progressTracker.js';

const renderProvider = {
  id: 'render',
  name: 'FFmpeg Render',
  capabilities: ['render'],

  async generate({ items, transitions, fadeIn, fadeOut, bgm, signal } = {}) {
    const validPaths = (items || [])
      .filter(item => item.videoPath && item.status === 'complete')
      .map(item => item.videoPath);

    if (!validPaths.length) {
      return { finalVideo: '', status: 'no-clips', error: 'No valid video clips' };
    }

    if (signal?.aborted) {
      return { finalVideo: '', status: 'failed', error: 'Cancelled' };
    }

    const body = { videoPaths: validPaths };
    if (Array.isArray(transitions) && transitions.length === validPaths.length - 1) {
      body.transitions = transitions;
    }
    if (fadeIn) body.fadeIn = true;
    if (fadeOut) body.fadeOut = true;
    if (bgm?.enabled && typeof bgm.path === 'string' && bgm.path) {
      const v = Number(bgm.volume);
      body.bgm = bgm.path;
      body.bgmEnabled = true;
      body.bgmVolume = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.6;
    }

    let taskId = null;
    try {
      const res = await fetch('/api/render/final', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        return { finalVideo: '', status: 'failed', error: `HTTP ${res.status}: ${errText.substring(0, 100)}` };
      }

      ({ taskId } = await res.json());
      registerBackendTask(taskId);
      const startTime = Date.now();
      const MAX_WAIT = 6 * 60 * 1000;

      for (let attempt = 0; attempt < 120; attempt++) {
        if (signal?.aborted) {
          return { finalVideo: '', status: 'failed', error: 'Cancelled' };
        }
        if (Date.now() - startTime > MAX_WAIT) {
          return { finalVideo: '', status: 'failed', error: 'Timeout' };
        }
        await new Promise(r => setTimeout(r, 3000));

        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), 30000);
        if (signal) {
          if (signal.aborted) { ctrl.abort(); clearTimeout(tid); break; }
          signal.addEventListener('abort', () => ctrl.abort(), { once: true });
        }
        let taskData;
        try {
          const taskRes = await fetch(`/api/task/${taskId}`, { signal: ctrl.signal });
          clearTimeout(tid);
          if (!taskRes.ok) {
            return { finalVideo: '', status: 'failed', error: 'Task not found or server restarted' };
          }
          taskData = await taskRes.json();
          if (taskData.phase === 'rendering' || taskData.status === 'completed') {
            reportPercentProgress('rendering', taskData.progress);
          }
        } catch {
          clearTimeout(tid);
          if (signal?.aborted) break;
          continue;
        }

        if (taskData.status === 'completed') {
          const finalPath = taskData.result?.path || '';
          return { finalVideo: finalPath, status: finalPath ? 'complete' : 'failed', error: finalPath ? null : 'No output' };
        }
        if (taskData.status === 'failed' || taskData.status === 'cancelled') {
          return { finalVideo: '', status: 'failed', error: taskData.status === 'cancelled' ? 'Cancelled' : (taskData.error || 'Render failed') };
        }
      }

      return { finalVideo: '', status: 'failed', error: 'Timeout' };
    } catch (err) {
      return { finalVideo: '', status: 'failed', error: err.message };
    } finally {
      unregisterBackendTask(taskId);
    }
  },
};

registerProvider(renderProvider);
