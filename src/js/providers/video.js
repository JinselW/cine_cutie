import { registerProvider } from './registry.js';
import { getConfig as getImageConfig } from './image.js';
import { getConfig } from './llm.js';
import { state } from '../state.js';
import { dsVideoResolution } from '../utils/resolution.js';

// wan2.7-r2v 最多接受 5 张参考图
const MAX_REFERENCE_IMAGES = 5;
// 条目没带时长时的兜底；服务端会按所选模型支持的档位再夹一次
const DEFAULT_CLIP_DURATION = 5;

function effectiveVideoMode(uploads) {
  if (uploads?.referenceImages?.length > 0) return 'referenceImage';
  const mode = getConfig().videoMode;
  return mode === 'firstLastFrame' || mode === 'referenceImage' ? mode : 'firstFrame';
}

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
    const mode = effectiveVideoMode(uploads);

    const clips = items.map(item => {
      const overridePrompt = overrides.promptOverrides?.[item.id];
      const overrideRef = overrides.referenceOverrides?.[item.id];
      const overrideSeed = overrides.seed?.[item.id];

      return {
        id: item.id,
        prompt: overridePrompt || item.prompt,
        // 服务端优先用本地文件（远端 URL 24h 后失效），换参考图时必须丢掉旧本地路径
        imagePath: overrideRef ? '' : (item.imagePath || ''),
        imageUrl: overrideRef || item.imageUrl || '',
        lastFramePath: item.lastFramePath || '',
        lastFrameUrl: item.lastFrameUrl || '',
        referenceImages: (item.referenceImages || []).slice(0, MAX_REFERENCE_IMAGES),
        duration: item.duration ?? DEFAULT_CLIP_DURATION,
        seed: overrideSeed ?? item.seed ?? 42,
      };
    });

    const isUsable = c => (mode === 'referenceImage'
      ? c.referenceImages.length > 0
      : !!(c.imagePath || c.imageUrl));
    const sentClips = hasUploads ? clips : clips.filter(isUsable);

    if (!hasUploads && !sentClips.length) {
      return items.map(item => ({
        id: item.id,
        videoPath: '',
        status: 'skipped',
        error: mode === 'referenceImage' ? 'No reference image' : 'No first frame image',
      }));
    }

    const chosenModel = mode === 'referenceImage' ? dsConfig.refVideoModel : dsConfig.videoModel;
    const dsRes = dsVideoResolution(state.resolution || '720P', chosenModel);

    const bodyPayload = hasUploads
      ? {
          clips: clips.map(c => ({ prompt: c.prompt, duration: c.duration, seed: c.seed })),
          uploads: {
            firstFrame: uploads.firstFrame ? { localPath: uploads.firstFrame.localPath, name: uploads.firstFrame.name } : null,
            lastFrame: uploads.lastFrame ? { localPath: uploads.lastFrame.localPath, name: uploads.lastFrame.name } : null,
            referenceImages: (uploads.referenceImages || []).map(r => ({ localPath: r.localPath, name: r.name })),
          },
          model: chosenModel,
          mode,
          duration: DEFAULT_CLIP_DURATION,
          resolution: dsRes,
          seed: clips[0].seed,
        }
      : {
          clips: sentClips.map(c => ({
            prompt: c.prompt,
            imagePath: c.imagePath,
            imageUrl: c.imageUrl,
            lastFramePath: c.lastFramePath,
            lastFrameUrl: c.lastFrameUrl,
            referenceImages: c.referenceImages,
            duration: c.duration,
            seed: c.seed,
          })),
          model: chosenModel,
          mode,
          duration: DEFAULT_CLIP_DURATION,
          resolution: dsRes,
          seed: sentClips[0]?.seed ?? 42,
        };

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
              return {
                id: item.id,
                videoPath: '',
                status: 'skipped',
                error: mode === 'referenceImage' ? 'No reference image' : 'No first frame image',
              };
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
