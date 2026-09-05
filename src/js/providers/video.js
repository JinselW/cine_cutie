import { registerProvider } from './registry.js';
import { getConfig as getImageConfig } from './image.js';

const videoProvider = {
  id: 'video',
  name: 'DashScope Video Generation',
  capabilities: ['video'],

  async generate({ items, uploads, overrides = {}, signal } = {}) {
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

    const hasUploads = uploads && (uploads.firstFrame || uploads.lastFrame || uploads.referenceImages?.length > 0);

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
    });

    if (!hasUploads) {
      const filtered = clips.filter(c => c.imageUrl);
      if (!filtered.length) {
        return items.map(item => ({
          id: item.id,
          videoPath: '',
          status: 'skipped',
          error: 'No reference image URL',
        }));
      }
    }

    const hasRefImages = uploads?.referenceImages?.length > 0;
    const chosenModel = hasRefImages ? dsConfig.refVideoModel : dsConfig.videoModel;

    const bodyPayload = hasUploads
      ? {
          clips: clips.map(c => ({ prompt: c.prompt })),
          uploads: {
            firstFrame: uploads.firstFrame ? { localPath: uploads.firstFrame.localPath, name: uploads.firstFrame.name } : null,
            lastFrame: uploads.lastFrame ? { localPath: uploads.lastFrame.localPath, name: uploads.lastFrame.name } : null,
            referenceImages: (uploads.referenceImages || []).map(r => ({ localPath: r.localPath, name: r.name })),
          },
          model: chosenModel,
          duration: 5,
          resolution: '720P',
          seed: clips[0].seed,
          aspectRatio: '16:9',
        }
      : {
          clips: clips.filter(c => c.imageUrl).map(c => ({ prompt: c.prompt, imageUrl: c.imageUrl })),
          model: chosenModel,
          duration: 5,
          resolution: '720P',
          seed: clips[0].seed,
          aspectRatio: '16:9',
        };

    const sentClips = hasUploads ? clips : clips.filter(c => c.imageUrl);

    try {
      const res = await fetch('/api/generate/video', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': dsConfig.apiKey,
        },
        signal,
        body: JSON.stringify(bodyPayload),
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
            const clipId = sentClips[r.index]?.id;
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
            const clip = sentClips.find(c => c.id === item.id);
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
