import { registerProvider } from './registry.js';
import { getConfig as getImageConfig } from './image.js';

const videoProvider = {
  id: 'video',
  name: 'DashScope Video Generation',
  capabilities: ['video'],

  async generate({ items, overrides = {}, signal } = {}) {
    const dsConfig = getImageConfig();
    if (!dsConfig.apiKey || !items?.length) {
      return items.map(item => ({
        id: item.id,
        videoPath: '',
        status: 'failed',
        error: !dsConfig.apiKey ? 'Not configured' : 'No items',
      }));
    }

    if (signal?.aborted) {
      return items.map(item => ({
        id: item.id, videoPath: '', status: 'failed', error: 'Cancelled',
      }));
    }

    const clips = items.map(item => {
      const overridePrompt = overrides.promptOverrides?.[item.id];
      const overrideRef = overrides.referenceOverrides?.[item.id];
      const overrideSeed = overrides.seed?.[item.id];

      return {
        id: item.id,
        prompt: overridePrompt || item.prompt,
        imageUrl: overrideRef || item.imageUrl,
        seed: overrideSeed ?? item.seed ?? 42,
      };
    }).filter(c => c.imageUrl);

    if (!clips.length) {
      return items.map(item => ({
        id: item.id,
        videoPath: '',
        status: 'skipped',
        error: 'No reference image URL',
      }));
    }

    try {
      const res = await fetch('/api/generate/video', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': dsConfig.apiKey,
        },
        signal,
        body: JSON.stringify({
          clips: clips.map(c => ({ prompt: c.prompt, imageUrl: c.imageUrl })),
          model: dsConfig.videoModel,
          duration: 5,
          resolution: '720P',
          seed: clips[0].seed,
          aspectRatio: '16:9',
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        return items.map(item => ({
          id: item.id,
          videoPath: '',
          status: 'failed',
          error: `HTTP ${res.status}: ${errText.substring(0, 100)}`,
        }));
      }

      const { taskId } = await res.json();
      const startTime = Date.now();
      const MAX_WAIT = 20 * 60 * 1000;

      for (let attempt = 0; attempt < 400; attempt++) {
        if (signal?.aborted) {
          return items.map(item => ({
            id: item.id, videoPath: '', status: 'failed', error: 'Cancelled',
          }));
        }
        if (Date.now() - startTime > MAX_WAIT) {
          return items.map(item => ({
            id: item.id,
            videoPath: '',
            status: 'failed',
            error: 'Timeout',
          }));
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
                error: r.status === 'ok' ? null : 'Generation failed',
              });
            }
          }

          return items.map(item => {
            const result = resultMap.get(item.id);
            if (result) return { id: item.id, ...result };
            const clip = clips.find(c => c.id === item.id);
            if (!clip) {
              return { id: item.id, videoPath: '', status: 'skipped', error: 'No reference image URL' };
            }
            return { id: item.id, videoPath: '', status: 'failed', error: 'Incomplete results' };
          });
        }
        if (taskData.status === 'failed') {
          return items.map(item => ({
            id: item.id,
            videoPath: '',
            status: 'failed',
            error: taskData.error || 'Generation failed',
          }));
        }
      }

      return items.map(item => ({
        id: item.id,
        videoPath: '',
        status: 'failed',
        error: 'Timeout',
      }));
    } catch (err) {
      return items.map(item => ({
        id: item.id,
        videoPath: '',
        status: 'failed',
        error: err.message,
      }));
    }
  },
};

registerProvider(videoProvider);
