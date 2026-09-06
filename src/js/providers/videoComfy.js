import { registerProvider } from './registry.js';
import { state } from '../state.js';
import { tierToMp } from '../utils/resolution.js';

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
      const overrideSeed = overrides.seed?.[item.id];
      return {
        id: item.id,
        prompt: overridePrompt || item.prompt,
        seed: overrideSeed ?? item.seed ?? Math.floor(Math.random() * 1e15),
      };
    });

    const hasUploads = uploads && (uploads.firstFrame || uploads.referenceImages?.length > 0);

    const body = {
      clips: clips.map(c => ({ prompt: c.prompt, seed: c.seed })),
      sshConfig: {
        host: sshConfig.host,
        port: sshConfig.port || 6078,
        user: sshConfig.user || 'Developer',
        comfyPort: sshConfig.comfyPort || 8188,
      },
      duration: 5,
      aspectRatio: state.aspectRatio || '16:9',
      megapixels: tierToMp(state.resolution),
      enableLightning: sshConfig.enableLightning || false,
    };

    if (hasUploads) {
      body.uploads = {
        referenceImages: (uploads.referenceImages || []).map(r => ({
          localPath: r.localPath,
          name: r.name,
        })),
      };
    }

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

      const { taskId } = await res.json();
      const startTime = Date.now();
      const MAX_WAIT = 20 * 60 * 1000;

      for (let attempt = 0; attempt < 400; attempt++) {
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
          taskData = await taskRes.json();
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
              });
            }
          }

          return items.map(item => {
            const result = resultMap.get(item.id);
            if (result) return { id: item.id, ...result };
            return { id: item.id, videoPath: '', status: 'failed', error: 'Incomplete results' };
          });
        }
        if (taskData.status === 'failed') {
          return items.map(item => ({
            id: item.id, videoPath: '', status: 'failed', error: taskData.error || 'Generation failed',
          }));
        }
      }

      return items.map(item => ({ id: item.id, videoPath: '', status: 'failed', error: 'Timeout' }));
    } catch (err) {
      return items.map(item => ({ id: item.id, videoPath: '', status: 'failed', error: err.message }));
    }
  },
};

registerProvider(comfyUIProvider);
