import { registerProvider } from './registry.js';
import { getConfig as getImageConfig } from './image.js';
import { getConfig } from './llm.js';
import { state } from '../state.js';
import { dsVideoResolution } from '../utils/resolution.js';
import { registerBackendTask, unregisterBackendTask } from './activeTasks.js';
import { reportBatchProgress, reportPhase } from '../progressTracker.js';
import { videoClipPayloadForMode } from '../videoModePlanning.js';

// wan2.7-r2v 最多接受 5 张参考图
const MAX_REFERENCE_IMAGES = 5;
// 条目没带时长时的兜底；服务端会按所选模型支持的档位再夹一次
const DEFAULT_CLIP_DURATION = 5;

function effectiveVideoMode(uploads) {
  if (uploads?.referenceImages?.length > 0) return 'referenceImage';
  const mode = getConfig().videoMode;
  if (mode === 'auto') return 'auto';
  return mode === 'firstLastFrame' || mode === 'referenceImage' ? mode : 'firstFrame';
}

function inferItemMode(item) {
  if (['firstFrame', 'firstLastFrame', 'referenceImage', 'textToVideo'].includes(item.videoMode)) return item.videoMode;
  if ((item.referenceImages || []).length > 0) return 'referenceImage';
  if (item.lastFramePath || item.lastFrameUrl) return 'firstLastFrame';
  if (item.imagePath || item.imageUrl) return 'firstFrame';
  return 'textToVideo';
}

function modelForMode(dsConfig, mode) {
  if (mode === 'referenceImage') return dsConfig.refVideoModel;
  if (mode === 'firstLastFrame') return dsConfig.lastFrameVideoModel || dsConfig.videoModel;
  return dsConfig.videoModel;
}

async function submitBatch(sentClips, bodyPayload, dsConfig, signal, onProgress) {
  let taskId = null;
  try {
    const res = await fetch('/api/generate/video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': dsConfig.apiKey, 'X-Ark-Api-Key': dsConfig.arkApiKey },
      signal,
      body: JSON.stringify(bodyPayload),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return { error: `HTTP ${res.status}: ${errText.substring(0, 100)}` };
    }
    ({ taskId } = await res.json());
    registerBackendTask(taskId);
    const startTime = Date.now();
    const MAX_WAIT = 20 * 60 * 1000;
    for (let attempt = 0; attempt < 400; attempt++) {
      if (signal?.aborted) return { error: 'Cancelled' };
      if (Date.now() - startTime > MAX_WAIT) return { error: 'Timeout' };
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
        if (!taskRes.ok) return { error: 'Task not found or server restarted' };
        taskData = await taskRes.json();
        if (onProgress) onProgress(taskData);
        else reportBatchProgress('generatingVideos', taskData);
      } catch {
        clearTimeout(tid);
        if (signal?.aborted) break;
        continue;
      }
      if (taskData.status === 'completed') {
        return { clips: taskData.result?.clips || [] };
      }
      if (taskData.status === 'failed' || taskData.status === 'cancelled' || taskData.status === 'interrupted') {
        return { error: taskData.status === 'cancelled' ? 'Cancelled' : (taskData.error || 'Generation failed') };
      }
    }
    return { error: 'Timeout' };
  } catch (err) {
    return { error: err.message };
  } finally {
    unregisterBackendTask(taskId);
  }
}

function failAll(items, error) {
  return items.map(item => ({ id: item.id, videoPath: '', status: 'failed', error }));
}

const videoProvider = {
  id: 'video',
  name: 'DashScope / Ark Video Generation',
  capabilities: ['video'],

  async generate({ items, uploads, overrides = {}, signal } = {}) {
    const dsConfig = getImageConfig();
    const hasKey = !!(dsConfig.apiKey || dsConfig.arkApiKey);
    if (!hasKey || !items?.length) {
      return items.map(item => ({
        id: item.id, videoPath: '', status: 'failed',
        error: !hasKey ? 'Not configured' : 'No items',
      }));
    }
    if (signal?.aborted) return failAll(items, 'Cancelled');

    const hasUploads = uploads && (uploads.firstFrame || uploads.lastFrame || uploads.referenceImages?.length > 0);
    let mode = effectiveVideoMode(uploads);

    if (mode === 'auto' && hasUploads) {
      mode = uploads.lastFrame ? 'firstLastFrame' : 'firstFrame';
    }

    const clips = items.map(item => {
      const overridePrompt = overrides.promptOverrides?.[item.id];
      const overrideRef = overrides.referenceOverrides?.[item.id];
      const overrideSeed = overrides.seed?.[item.id];
      return {
        id: item.id,
        prompt: overridePrompt || item.prompt,
        imagePath: overrideRef ? '' : (item.imagePath || ''),
        imageUrl: overrideRef || item.imageUrl || '',
        lastFramePath: item.lastFramePath || '',
        lastFrameUrl: item.lastFrameUrl || '',
        referenceImages: (item.referenceImages || []).slice(0, MAX_REFERENCE_IMAGES),
        videoMode: item.videoMode,
        duration: item.duration ?? DEFAULT_CLIP_DURATION,
        seed: overrideSeed ?? item.seed ?? 42,
      };
    });

    if (mode === 'auto') {
      const groups = new Map();
      const skippedIds = [];

      for (const clip of clips) {
        const itemMode = inferItemMode(clip);
        if (itemMode === 'textToVideo') { skippedIds.push(clip.id); continue; }
        const model = modelForMode(dsConfig, itemMode);
        if (!model) { skippedIds.push(clip.id); continue; }
        if (!groups.has(itemMode)) groups.set(itemMode, { clips: [], model });
        groups.get(itemMode).clips.push(clip);
      }

      const allResults = new Map();
      const overallTotal = [...groups.values()].reduce((sum, g) => sum + g.clips.length, 0);
      let completedBefore = 0;
      for (const [groupMode, group] of groups) {
        if (signal?.aborted) {
          for (const c of group.clips) allResults.set(c.id, { videoPath: '', status: 'failed', error: 'Cancelled' });
          continue;
        }
        const dsRes = dsVideoResolution(state.resolution || '720P', group.model);
        const bodyPayload = {
          clips: group.clips.map(c => videoClipPayloadForMode(c, groupMode)),
          model: group.model,
          mode: groupMode,
          duration: DEFAULT_CLIP_DURATION,
          resolution: dsRes,
          aspectRatio: state.aspectRatio || '16:9',
          seed: group.clips[0].seed,
          audio: true,
        };
        const onProgress = (taskData) => {
          const groupTotal = Math.max(0, Number(taskData.total) || 0);
          const fromPercent = groupTotal
            ? Math.floor((Math.max(0, Number(taskData.progress) || 0) / 100) * groupTotal)
            : 0;
          const completed = taskData.status === 'completed'
            ? completedBefore + groupTotal
            : completedBefore + fromPercent;
          reportPhase('generatingVideos', {
            mode: 'determinate', total: overallTotal, completed,
            activeItem: Math.min(overallTotal, completed + 1),
          });
        };
        const batchResult = await submitBatch(group.clips, bodyPayload, dsConfig, signal, onProgress);
        if (batchResult.clips) {
          let groupOk = 0;
          for (const r of batchResult.clips) {
            const clipId = group.clips[r.index]?.id;
            if (clipId) {
              const ok = r.status === 'ok';
              if (ok) groupOk++;
              allResults.set(clipId, {
                videoPath: r.path || '',
                status: ok ? 'complete' : 'failed',
                error: ok ? null : (r.error || 'Generation failed'),
                trace: r.trace || null,
              });
            }
          }
          completedBefore += groupOk;
        } else {
          for (const c of group.clips) {
            allResults.set(c.id, { videoPath: '', status: 'failed', error: batchResult.error });
          }
        }
      }

      return items.map(item => {
        const result = allResults.get(item.id);
        if (result) return { id: item.id, ...result };
        if (skippedIds.includes(item.id)) {
          return { id: item.id, videoPath: '', status: 'skipped', error: 'No image or model not configured' };
        }
        return { id: item.id, videoPath: '', status: 'failed', error: 'Incomplete results' };
      });
    }

    const isUsable = c => (mode === 'referenceImage'
      ? c.referenceImages.length > 0
      : !!(c.imagePath || c.imageUrl));
    const sentClips = hasUploads ? clips : clips.filter(isUsable);

    if (!hasUploads && !sentClips.length) {
      return items.map(item => ({
        id: item.id, videoPath: '', status: 'skipped',
        error: mode === 'referenceImage' ? 'No reference image' : 'No first frame image',
      }));
    }

    const chosenModel = modelForMode(dsConfig, mode);
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
          aspectRatio: state.aspectRatio || '16:9',
          seed: clips[0].seed,
          audio: true,
        }
      : {
          clips: sentClips.map(c => videoClipPayloadForMode(c, mode)),
          model: chosenModel,
          mode,
          duration: DEFAULT_CLIP_DURATION,
          resolution: dsRes,
          aspectRatio: state.aspectRatio || '16:9',
          seed: sentClips[0]?.seed ?? 42,
          audio: true,
        };

    const batchResult = await submitBatch(sentClips, bodyPayload, dsConfig, signal);

    if (batchResult.error && !batchResult.clips) {
      return failAll(items, batchResult.error);
    }

    const resultMap = new Map();
    for (const r of (batchResult.clips || [])) {
      const clipId = sentClips[r.index]?.id;
      if (clipId) {
        resultMap.set(clipId, {
          videoPath: r.path || '',
          status: r.status === 'ok' ? 'complete' : 'failed',
          error: r.status === 'ok' ? null : (r.error || 'Generation failed'),
          trace: r.trace || null,
        });
      }
    }

    return items.map(item => {
      const result = resultMap.get(item.id);
      if (result) return { id: item.id, ...result };
      const clip = sentClips.find(c => c.id === item.id);
      if (!clip) {
        return {
          id: item.id, videoPath: '', status: 'skipped',
          error: mode === 'referenceImage' ? 'No reference image' : 'No first frame image',
        };
      }
      return { id: item.id, videoPath: '', status: 'failed', error: 'Incomplete results' };
    });
  },
};

registerProvider(videoProvider);

export { getDefaultVideoDuration, getVideoDurationRange } from '../utils/resolution.js';
