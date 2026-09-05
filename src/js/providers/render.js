import { registerProvider } from './registry.js';

const renderProvider = {
  id: 'render',
  name: 'FFmpeg Render',
  capabilities: ['render'],

  async generate({ items, signal } = {}) {
    const validPaths = (items || [])
      .filter(item => item.videoPath && item.status === 'complete')
      .map(item => item.videoPath);

    if (!validPaths.length) {
      return { finalVideo: '', status: 'no-clips', error: 'No valid video clips' };
    }

    if (signal?.aborted) {
      return { finalVideo: '', status: 'failed', error: 'Cancelled' };
    }

    try {
      const res = await fetch('/api/render/final', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({ videoPaths: validPaths }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        return { finalVideo: '', status: 'failed', error: `HTTP ${res.status}: ${errText.substring(0, 100)}` };
      }

      const { taskId } = await res.json();
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
          taskData = await taskRes.json();
        } catch {
          clearTimeout(tid);
          if (signal?.aborted) break;
          continue;
        }

        if (taskData.status === 'completed') {
          const finalPath = taskData.result?.path || '';
          return { finalVideo: finalPath, status: finalPath ? 'complete' : 'failed', error: finalPath ? null : 'No output' };
        }
        if (taskData.status === 'failed') {
          return { finalVideo: '', status: 'failed', error: taskData.error || 'Render failed' };
        }
      }

      return { finalVideo: '', status: 'failed', error: 'Timeout' };
    } catch (err) {
      return { finalVideo: '', status: 'failed', error: err.message };
    }
  },
};

registerProvider(renderProvider);
