import { registerProvider } from './registry.js';
import { state } from '../state.js';
import { tierToMp } from '../utils/resolution.js';
import { registerBackendTask, unregisterBackendTask } from './activeTasks.js';
import { reportBatchProgress } from '../progressTracker.js';
import { selectComfyWorkflow } from './comfyWorkflowMode.js';

const DEFAULT_CLIP_DURATION = 5;

function getSshConfig() {
  try {
    const saved = localStorage.getItem('cine-cutie-comfy-ssh');
    if (saved) return JSON.parse(saved);
  } catch {}
  return null;
}

const comfyUIProvider = {
  id: 'video-comfy',
  name: 'ComfyUI (DGX Spark / H3)',
  capabilities: ['video'],

  async generate({ items, uploads, overrides = {}, signal } = {}) {
    const sshConfig = getSshConfig();
    if (!sshConfig?.host) {
      return items.map(item => ({
        id: item.id,
        videoPath: '',
        status: 'failed',
        error: 'ComfyUI SSH not configured — open Settings to set up DGX Spark connection',
      }));
    }

    if (!items?.length) {
      return items.map(item => ({ id: item.id, videoPath: '', status: 'failed', error: 'No items' }));
    }

    if (signal?.aborted) {
      return items.map(item => ({ id: item.id, videoPath: '', status: 'failed', error: 'Cancelled' }));
    }

    const clips = items.map(item => {
      const overridePrompt = overrides.promptOverrides?.[item.id];
      const overrideReference = overrides.referenceOverrides?.[item.id];
      const overrideSeed = overrides.seed?.[item.id];
      const source = overrideReference
        ? { ...item, imagePath: '', imageUrl: overrideReference, referenceImages: item.referenceImages?.length ? [overrideReference] : [] }
        : item;
      const workflow = selectComfyWorkflow(source, uploads);
      return {
        id: item.id,
        prompt: overridePrompt || item.prompt,
        duration: item.duration ?? DEFAULT_CLIP_DURATION,
        seed: overrideSeed ?? item.seed ?? Math.floor(Math.random() * 1e15),
        mode: workflow.mode,
        images: workflow.images,
      };
    });

    const body = {
      clips: clips.map(c => ({
        prompt: c.prompt,
        duration: c.duration,
        seed: c.seed,
        mode: c.mode,
        images: c.images,
      })),
      sshConfig: {
        host: sshConfig.host,
        port: sshConfig.port || 6078,
        user: sshConfig.user || 'Developer',
        password: sshConfig.password || '',
        comfyPort: sshConfig.comfyPort || 8188,
      },
      aspectRatio: state.aspectRatio || '16:9',
      megapixels: tierToMp(state.resolution),
      enableLightning: sshConfig.enableLightning || false,
    };

    let taskId = null;
    try {
      const res = await fetch('/api/generate/video-comfy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        return items.map(item => ({
          id: item.id,
          videoPath: '',
          status: 'failed',
          error: `HTTP ${res.status}: ${errText.substring(0, 200)}`,
        }));
      }

      ({ taskId } = await res.json());
      registerBackendTask(taskId);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('comfy-task-progress', {
          detail: { id: taskId, status: 'running', phase: 'connecting', progress: 0, current: 0, total: clips.length },
        }));
      }
      const startTime = Date.now();
      // The server allows one 10-minute ComfyUI attempt per clip. Keep a small
      // transfer/polling margin without waiting through obsolete backend retries.
      const MAX_WAIT = Math.max(20 * 60 * 1000, clips.length * 11 * 60 * 1000);
      const maxPollAttempts = Math.ceil(MAX_WAIT / 5000);

      for (let attempt = 0; attempt < maxPollAttempts; attempt++) {
        if (signal?.aborted) {
          return items.map(item => ({ id: item.id, videoPath: '', status: 'failed', error: 'Cancelled' }));
        }
        if (Date.now() - startTime > MAX_WAIT) {
          return items.map(item => ({ id: item.id, videoPath: '', status: 'failed', error: 'Timeout' }));
        }
        await new Promise(r => setTimeout(r, 5000));

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
            return items.map(item => ({
              id: item.id, videoPath: '', status: 'failed', error: 'Task not found or server restarted',
            }));
          }
          taskData = await taskRes.json();
          reportBatchProgress('generatingVideos', taskData);
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('comfy-task-progress', { detail: taskData }));
          }
        } catch {
          clearTimeout(tid);
          if (signal?.aborted) break;
          continue;
        }

        if (taskData.status === 'completed') {
          const results = taskData.result?.clips || [];
          const resultMap = new Map();
          for (const r of results) {
            const clipId = clips[r.index]?.id;
            if (clipId) {
              resultMap.set(clipId, {
                videoPath: r.path || '',
                status: r.status === 'ok' ? 'complete' : 'failed',
                error: r.status === 'ok' ? null : r.error || 'Generation failed',
                trace: r.trace || null,
              });
            }
          }

          return items.map(item => {
            const result = resultMap.get(item.id);
            if (result) return { id: item.id, ...result };
            return { id: item.id, videoPath: '', status: 'failed', error: 'Incomplete results' };
          });
        }
        if (taskData.status === 'failed' || taskData.status === 'cancelled') {
          return items.map(item => ({
            id: item.id, videoPath: '', status: 'failed', error: taskData.status === 'cancelled' ? 'Cancelled' : (taskData.error || 'Generation failed'),
          }));
        }
      }

      return items.map(item => ({ id: item.id, videoPath: '', status: 'failed', error: 'Timeout' }));
    } catch (err) {
      return items.map(item => ({ id: item.id, videoPath: '', status: 'failed', error: err.message }));
    } finally {
      unregisterBackendTask(taskId);
    }
  },
};

registerProvider(comfyUIProvider);
