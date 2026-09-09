import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import mammoth from 'mammoth';
import { createMemoryRouter } from './memory.js';
import { LRUCache } from './cache.js';
import { submitImageTask, submitImageEditTask, parseImageResultUrl, submitVideoTask, submitVideoTaskV2, pollTask, downloadFile, detectVideoMode, hasVideoUploads, fileToDataUri } from './dashscope.js';
import { createTask, getTask, updateTask, cancelTask, isTaskCancelled, cleanupTasks } from './tasks.js';
import { concatVideos, checkFfmpeg, renderWithTransitions, probeStreams, probeAudioQuality, probeVisualDefects, applyBgm, sanitizeVolume } from './render.js';
import { submitWorkflow, pollUntilDone, downloadOutput, uploadImageToComfy, checkComfyUIStatus, getComfyMonitorStatus, selectWorkflowMode, cancelPrompt, MAX_COMFY_REFERENCE_IMAGES } from './comfyui.js';
import { ensureTunnel, closeTunnel, getTunnelStatus, deleteComfyInputFiles, getDgxMetrics } from './ssh-tunnel.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const cache = new LRUCache(100);
const PORT = process.env.PORT || 3006;

const MEDIA_DIR = process.env.MEDIA_DIR || path.join(__dirname, '..', 'media');
fs.mkdirSync(MEDIA_DIR, { recursive: true });

const UPLOADS_DIR = path.join(MEDIA_DIR, 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const MEDIA_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function cleanupMedia() {
  const now = Date.now();
  let cleaned = 0;
  for (const dir of [MEDIA_DIR, UPLOADS_DIR]) {
    try {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const filePath = path.join(dir, file);
        try {
          const stat = fs.statSync(filePath);
          if (stat.isFile() && now - stat.mtimeMs > MEDIA_MAX_AGE_MS) {
            fs.unlinkSync(filePath);
            cleaned++;
          }
        } catch {}
      }
    } catch {}
  }
  if (cleaned > 0) {
    console.log(`[MediaCleanup] removed ${cleaned} file(s) older than 7 days`);
  }
}

// Run cleanup on startup and every 24 hours
cleanupMedia();
setInterval(cleanupMedia, 24 * 60 * 60 * 1000);

// Clean up completed tasks older than 1 hour, every 10 minutes
setInterval(() => cleanupTasks(3600000), 10 * 60 * 1000);

function isPathWithinDir(filePath, allowedDir) {
  if (typeof filePath !== 'string' || !filePath) return false;
  const resolved = path.resolve(filePath);
  const allowed = path.resolve(allowedDir);
  return resolved.startsWith(allowed + path.sep) || resolved === allowed;
}

function safeResolveMediaPath(ref) {
  if (typeof ref !== 'string' || !ref) return null;
  let filePath = null;
  if (ref.startsWith('/api/media/uploads/')) {
    filePath = path.join(UPLOADS_DIR, path.basename(ref));
  } else if (ref.startsWith('/api/media/')) {
    filePath = path.join(MEDIA_DIR, path.basename(ref));
  }
  if (!filePath) return null;
  const resolved = path.resolve(filePath);
  if (!isPathWithinDir(resolved, MEDIA_DIR)) return null;
  return fs.existsSync(resolved) ? resolved : null;
}

function buildSshConfig(partial) {
  const password = process.env.COMFY_SSH_PASSWORD || partial?.password;
  if (!password) return null;

  const serverHost = process.env.COMFY_SSH_HOST;
  const serverPort = process.env.COMFY_SSH_PORT;
  const serverUser = process.env.COMFY_SSH_USER;
  const serverComfyPort = process.env.COMFY_SSH_COMFY_PORT;

  const host = serverHost || partial?.host;
  const port = serverPort || partial?.port || 6078;
  const user = serverUser || partial?.user || 'Developer';
  const comfyPort = serverComfyPort || partial?.comfyPort || 8188;

  if (!host || !user) return null;

  return { host, port, user, password, comfyPort };
}

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`);
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\//.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  }
});

function isV2Model(name) {
  return typeof name === 'string' && /^wan2\.\d/.test(name);
}

const bgmUpload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext || '.mp3'}`);
    }
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /^audio\//.test(file.mimetype) || /\.(mp3|wav|m4a|ogg|aac|flac)$/i.test((file.originalname || ''));
    if (ok) cb(null, true);
    else cb(new Error('Only audio files are allowed'));
  }
});

// 图生图参考图：只接受同源 /api/media 路径，服务端读本地文件，避免任意文件读取
function resolveMediaRef(ref) {
  return safeResolveMediaPath(ref);
}

const PROMPT_MAX_CHARS = 20000;

// wan2.7-r2v 最多接受 5 张参考图
const MAX_VIDEO_REFS = 5;

// DashScope 云端取不到本机文件：本地 /api/media 一律转 data URI；远端 URL（24h 过期）仅作兜底
async function toDashScopeImage(ref) {
  if (typeof ref !== 'string' || !ref) return null;
  const localPath = resolveMediaRef(ref);
  if (localPath) return fileToDataUri(localPath);
  return /^https?:\/\//.test(ref) ? ref : null;
}

const promptUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

function decodeTextBuffer(buf) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('gbk').decode(buf);
  }
}

function normalizePromptText(raw) {
  const bom = String.fromCharCode(0xfeff);
  return raw
    .split(bom).join('')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function extractPromptText(file) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ext === '.docx') {
    const result = await mammoth.extractRawText({ buffer: file.buffer });
    return normalizePromptText(result.value);
  }
  if (ext === '.txt' || ext === '.md' || ext === '.markdown') {
    return normalizePromptText(decodeTextBuffer(file.buffer));
  }
  if (ext === '.doc') {
    throw new Error('legacy .doc is not supported, please re-save it as .docx');
  }
  return null;
}

app.use(express.json({ limit: '10mb' }));
app.use('/api/memory', createMemoryRouter(process.env.MEMORY_DIR || path.join(__dirname, '..', 'data', 'memory')));

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (req.path.startsWith('/api/')) {
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
    }
  });
  next();
});

app.post('/api/chat/completions', async (req, res) => {
  const { model, messages, temperature, response_format } = req.body;

  if (!model || !messages) {
    return res.status(400).json({ error: 'Missing required fields: model, messages' });
  }

  const endpoint = req.headers['x-target-endpoint'] || 'https://api.openai.com/v1';
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    return res.status(401).json({ error: 'Missing API key. Send via X-Api-Key header.' });
  }

  const cached = cache.get(model, messages, endpoint, temperature, response_format);
  if (cached) {
    res.set('X-Cache', 'HIT');
    return res.json(cached);
  }

  const url = `${endpoint.replace(/\/+$/, '')}/chat/completions`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);

    const body = { model, messages, temperature: temperature ?? 0.8 };
    if (response_format) body.response_format = response_format;

    const upstream = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '');
      return res.status(upstream.status).json({
        error: `Upstream API error: ${upstream.status}`,
        detail: text.substring(0, 500)
      });
    }

    const data = await upstream.json();
    cache.set(model, messages, data, endpoint, temperature, response_format);

    res.set('X-Cache', 'MISS');
    res.json(data);
  } catch (err) {
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'Upstream request timed out (90s)' });
    }
    res.status(502).json({ error: 'Upstream request failed', detail: err.message });
  }
});

app.post('/api/generate/image', async (req, res) => {
  const { prompts, model, size, seed, seeds, refs, img2imgModel, img2imgSize } = req.body;
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    return res.status(401).json({ error: 'Missing DashScope API key. Send via X-Api-Key header.' });
  }

  if (!Array.isArray(prompts) || prompts.length === 0) {
    return res.status(400).json({ error: 'Missing prompts array' });
  }

  const MAX_PROMPTS = 50;
  if (prompts.length > MAX_PROMPTS) {
    return res.status(400).json({ error: `Too many prompts (max ${MAX_PROMPTS})` });
  }

  const task = createTask('image', { total: prompts.length });

  (async () => {
    const results = [];
    console.log(`[ImageBatch] task=${task.id} starting ${prompts.length} images`);
    for (let i = 0; i < prompts.length; i++) {
      if (isTaskCancelled(task.id)) break;
      const itemSeed = Array.isArray(seeds) && seeds[i] != null ? seeds[i] : seed;
      const itemRefs = Array.isArray(refs) ? refs[i] : null;
      let lastError = null;
      for (let retry = 0; retry <= 2; retry++) {
        if (isTaskCancelled(task.id)) { lastError = 'Cancelled'; break; }
        if (retry > 0) {
          console.log(`[ImageBatch] task=${task.id} image ${i + 1} retry ${retry}/2 after 3s`);
          await new Promise(r => setTimeout(r, 3000));
        }
        try {
          console.log(`[ImageBatch] task=${task.id} image ${i + 1}/${prompts.length}`);
          updateTask(task.id, { status: 'running', current: i + 1, progress: Math.round((i / prompts.length) * 100) });

          let taskId;
          if (itemRefs?.length && img2imgModel) {
            const dataUris = [];
            for (const ref of itemRefs) {
              const localPath = resolveMediaRef(ref);
              if (localPath) dataUris.push(await fileToDataUri(localPath));
            }
            if (dataUris.length === 0) {
              throw new Error(`Reference images not found on server: ${itemRefs.join(', ')}`);
            }
            taskId = await submitImageEditTask(prompts[i], dataUris, {
              model: img2imgModel, size: img2imgSize || size, apiKey, seed: itemSeed
            });
          } else {
            taskId = await submitImageTask(prompts[i], { model, size, apiKey, seed: itemSeed });
          }

          let pollResult;
          for (let attempt = 0; attempt < 120; attempt++) {
            if (isTaskCancelled(task.id)) { lastError = 'Cancelled'; break; }
            await new Promise(r => setTimeout(r, 3000));
            pollResult = await pollTask(taskId, apiKey);
            const status = pollResult.output?.task_status;
            if (status === 'SUCCEEDED' || status === 'FAILED') break;
          }

          if (lastError === 'Cancelled') break;

          if (pollResult?.output?.task_status === 'SUCCEEDED') {
            const imageUrl = parseImageResultUrl(pollResult);
            if (imageUrl) {
              const filename = `img_${task.id}_${i}.png`;
              const savePath = path.join(MEDIA_DIR, filename);
              await downloadFile(imageUrl, savePath);
              results.push({ index: i, status: 'ok', path: `/api/media/${filename}`, imageUrl, prompt: prompts[i] });
              console.log(`[ImageBatch] task=${task.id} image ${i + 1} OK`);
              lastError = null;
              break;
            } else {
              lastError = 'No image URL in response';
              console.log(`[ImageBatch] task=${task.id} image ${i + 1} FAILED: no URL`);
            }
          } else {
            const errMsg = pollResult?.output?.message || 'Task failed';
            lastError = errMsg;
            console.log(`[ImageBatch] task=${task.id} image ${i + 1} FAILED: ${errMsg}`);
          }
        } catch (err) {
          lastError = err.message;
          console.log(`[ImageBatch] task=${task.id} image ${i + 1} ERROR: ${err.message}`);
        }
      }
      if (lastError && lastError !== 'Cancelled') {
        results.push({ index: i, status: 'error', error: lastError });
      }
    }

    const successCount = results.filter(r => r.status === 'ok').length;
    const cancelled = isTaskCancelled(task.id);
    const finalStatus = cancelled ? 'cancelled' : 'completed';
    console.log(`[ImageBatch] task=${task.id} ${finalStatus}: ${successCount}/${prompts.length} succeeded`);
    updateTask(task.id, {
      status: finalStatus,
      progress: cancelled ? Math.round((successCount / prompts.length) * 100) : 100,
      result: { images: results, total: prompts.length, success: successCount }
    });
  })().catch(err => {
    console.error(`[ImageBatch] task=${task.id} FATAL: ${err.message}`);
    updateTask(task.id, { status: 'failed', error: err.message });
  });

  res.json({ taskId: task.id });
});

app.post('/api/upload/bgm', bgmUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({ path: `/api/media/uploads/${req.file.filename}`, filename: req.file.filename, originalName: req.file.originalname });
});

app.post('/api/upload/prompt', promptUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const text = await extractPromptText(req.file);
    if (text === null) {
      return res.status(400).json({ error: 'Unsupported file type, use .docx / .txt / .md' });
    }
    if (!text) return res.status(400).json({ error: 'No readable text found in file' });
    const truncated = text.length > PROMPT_MAX_CHARS;
    res.json({
      name: req.file.originalname,
      text: truncated ? text.slice(0, PROMPT_MAX_CHARS) : text,
      chars: text.length,
      truncated,
    });
  } catch (err) {
    res.status(400).json({ error: `Failed to read file: ${err.message}` });
  }
});

app.post('/api/generate/video', async (req, res) => {
  const { clips, model, duration, resolution, seed, aspectRatio, uploads, mode: clientMode, audio } = req.body;
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    return res.status(401).json({ error: 'Missing DashScope API key. Send via X-Api-Key header.' });
  }

  if (!Array.isArray(clips) || clips.length === 0) {
    return res.status(400).json({ error: 'Missing clips array' });
  }

  const MAX_CLIPS = 30;
  if (clips.length > MAX_CLIPS) {
    return res.status(400).json({ error: `Too many clips (max ${MAX_CLIPS})` });
  }

  // Validate upload paths to prevent path traversal
  if (uploads) {
    const pathsToCheck = [
      uploads.firstFrame?.localPath,
      uploads.lastFrame?.localPath,
      ...(uploads.referenceImages || []).map(r => r.localPath),
    ].filter(Boolean);

    for (const p of pathsToCheck) {
      if (!isPathWithinDir(p, UPLOADS_DIR)) {
        return res.status(400).json({ error: 'Invalid upload path: must be within uploads directory' });
      }
    }
  }

  const hasUploads = hasVideoUploads(uploads);
  const mode = hasUploads ? detectVideoMode(uploads) : 'legacy';
  const effectiveModel = model;

  if (!effectiveModel) {
    return res.status(400).json({ error: 'Missing model — pick one in Settings' });
  }

  if (mode === 'i2v' && uploads.lastFrame?.localPath && !uploads.firstFrame?.localPath) {
    return res.status(400).json({ error: 'A last frame requires a first frame' });
  }

  if (mode === 'r2v' && !isV2Model(effectiveModel)) {
    return res.status(400).json({ error: `${effectiveModel} accepts no reference images — pick a wan2.7 r2v model in Settings` });
  }

  const task = createTask('video', { total: clips.length });

  (async () => {
    const results = [];
    console.log(`[VideoBatch] task=${task.id} starting ${clips.length} clips, mode=${mode}, videoMode=${clientMode || 'n/a'}, model=${effectiveModel}`);
    for (let i = 0; i < clips.length; i++) {
      if (isTaskCancelled(task.id)) break;
      const clip = clips[i];

      let lastError = null;
      for (let retry = 0; retry <= 2; retry++) {
        if (isTaskCancelled(task.id)) { lastError = 'Cancelled'; break; }
        if (retry > 0) {
          console.log(`[VideoBatch] task=${task.id} clip ${i + 1} retry ${retry}/2 after 5s`);
          await new Promise(r => setTimeout(r, 5000));
        }
        try {
          console.log(`[VideoBatch] task=${task.id} clip ${i + 1}/${clips.length}`);
          updateTask(task.id, { status: 'running', current: i + 1, progress: Math.round((i / clips.length) * 100) });

          let taskId;

          if (hasUploads) {
            if (isV2Model(effectiveModel)) {
              const mediaArray = [];
              if (uploads.firstFrame?.localPath) {
                const dataUri = await fileToDataUri(uploads.firstFrame.localPath);
                mediaArray.push({ type: 'first_frame', url: dataUri });
              }
              if (uploads.lastFrame?.localPath) {
                const dataUri = await fileToDataUri(uploads.lastFrame.localPath);
                mediaArray.push({ type: 'last_frame', url: dataUri });
              }
              if (uploads.referenceImages?.length > 0) {
                for (const ref of uploads.referenceImages) {
                  if (ref.localPath) {
                    const dataUri = await fileToDataUri(ref.localPath);
                    mediaArray.push({ type: 'reference_image', url: dataUri });
                  }
                }
              }

              if (mediaArray.length === 0) {
                lastError = null;
                results.push({ index: i, status: 'error', error: 'No valid upload media' });
                break;
              }

              console.log(`[VideoBatch V2] task=${task.id} clip ${i + 1} media=${mediaArray.length} items`);
              taskId = await submitVideoTaskV2(clip.prompt || 'Scene animation', mediaArray, {
                model: effectiveModel, duration: clip.duration ?? duration, resolution, apiKey, seed: clip.seed ?? seed, aspectRatio, audio
              });
            } else {
              const firstUrl = await fileToDataUri(uploads.firstFrame.localPath);
              if (uploads.lastFrame?.localPath) {
                console.warn(`[VideoBatch] task=${task.id} clip ${i + 1}: ${effectiveModel} only takes a first frame (input.img_url) — the uploaded last frame was ignored; choose a wan2.7 model in Settings for first+last frame video`);
              }
              console.log(`[VideoBatch] task=${task.id} clip ${i + 1} uploaded img_url=${firstUrl.slice(0, 60)}…`);
              taskId = await submitVideoTask(clip.prompt || 'Scene animation', firstUrl, {
                model: effectiveModel, duration: clip.duration ?? duration, resolution, apiKey, seed: clip.seed ?? seed, aspectRatio, audio
              });
            }
          } else {
            const clipRefs = Array.isArray(clip.referenceImages) ? clip.referenceImages.slice(0, MAX_VIDEO_REFS) : [];
            const clipSeed = clip.seed ?? seed;
            const clipDuration = clip.duration ?? duration;
            const firstRef = clip.imagePath || clip.imageUrl;
            const lastRef = clip.lastFramePath || clip.lastFrameUrl;

            if (clipRefs.length) {
              if (!isV2Model(effectiveModel)) {
                lastError = null;
                results.push({ index: i, status: 'error', error: `${effectiveModel} accepts no reference images — pick a wan2.7 r2v model in Settings` });
                console.log(`[VideoBatch] task=${task.id} clip ${i + 1} ERROR: ${effectiveModel} is not a reference-to-video model`);
                break;
              }

              const media = [];
              for (const ref of clipRefs) {
                const url = await toDashScopeImage(ref);
                if (url) media.push({ type: 'reference_image', url });
              }
              if (!media.length) {
                lastError = null;
                results.push({ index: i, status: 'error', error: `Reference images not found on server: ${clipRefs.join(', ')}` });
                console.log(`[VideoBatch] task=${task.id} clip ${i + 1} SKIPPED: no usable reference image`);
                break;
              }

              console.log(`[VideoBatch r2v] task=${task.id} clip ${i + 1} refs=${media.length}`);
              taskId = await submitVideoTaskV2(clip.prompt || 'Scene animation', media, {
                model: effectiveModel, duration: clipDuration, resolution, apiKey, seed: clipSeed, aspectRatio, audio
              });
            } else {
              const firstUrl = await toDashScopeImage(firstRef);
              if (!firstUrl) {
                lastError = null;
                results.push({ index: i, status: 'error', error: firstRef ? `First frame not found on server: ${firstRef}` : 'No first frame provided' });
                console.log(`[VideoBatch] task=${task.id} clip ${i + 1} SKIPPED: no usable first frame`);
                break;
              }

              if (isV2Model(effectiveModel)) {
                const media = [{ type: 'first_frame', url: firstUrl }];
                const lastUrl = await toDashScopeImage(lastRef);
                if (lastUrl) media.push({ type: 'last_frame', url: lastUrl });
                else if (lastRef) console.warn(`[VideoBatch] task=${task.id} clip ${i + 1} last frame unavailable (${lastRef}), using the first frame only`);

                console.log(`[VideoBatch V2] task=${task.id} clip ${i + 1} media=${media.length} items`);
                taskId = await submitVideoTaskV2(clip.prompt || 'Scene animation', media, {
                  model: effectiveModel, duration: clipDuration, resolution, apiKey, seed: clipSeed, aspectRatio, audio
                });
              } else {
                if (lastRef) {
                  console.warn(`[VideoBatch] task=${task.id} clip ${i + 1}: ${effectiveModel} only takes a first frame (input.img_url) — the last frame was ignored; choose a wan2.7 model in Settings for first+last frame video`);
                }
                console.log(`[VideoBatch] task=${task.id} clip ${i + 1} img_url=${firstUrl.slice(0, 60)}…`);
                taskId = await submitVideoTask(clip.prompt, firstUrl, {
                  model: effectiveModel, duration: clipDuration, resolution, apiKey, seed: clipSeed, aspectRatio, audio
                });
              }
            }
          }

          let pollResult;
          for (let attempt = 0; attempt < 240; attempt++) {
            if (isTaskCancelled(task.id)) { lastError = 'Cancelled'; break; }
            await new Promise(r => setTimeout(r, 5000));
            pollResult = await pollTask(taskId, apiKey);
            const status = pollResult.output?.task_status;
            if (status === 'SUCCEEDED' || status === 'FAILED') break;
          }

          if (lastError === 'Cancelled') break;

          if (pollResult?.output?.task_status === 'SUCCEEDED') {
            const videoUrl = pollResult.output.video_url;
            if (videoUrl) {
              const filename = `vid_${task.id}_${i}.mp4`;
              const savePath = path.join(MEDIA_DIR, filename);
              await downloadFile(videoUrl, savePath);
              results.push({ index: i, status: 'ok', path: `/api/media/${filename}`, prompt: clip.prompt });
              console.log(`[VideoBatch] task=${task.id} clip ${i + 1} OK`);
              lastError = null;
              break;
            } else {
              lastError = 'No video URL in response';
              console.log(`[VideoBatch] task=${task.id} clip ${i + 1} FAILED: no video URL`);
            }
          } else {
            const errMsg = pollResult?.output?.message || 'Task failed';
            lastError = errMsg;
            console.log(`[VideoBatch] task=${task.id} clip ${i + 1} FAILED: ${errMsg}`);
          }
        } catch (err) {
          lastError = err.message;
          console.log(`[VideoBatch] task=${task.id} clip ${i + 1} ERROR: ${err.message}`);
        }
      }
      if (lastError && lastError !== 'Cancelled') {
        results.push({ index: i, status: 'error', error: lastError });
      }
    }

    const successCount = results.filter(r => r.status === 'ok').length;
    const cancelled = isTaskCancelled(task.id);
    const finalStatus = cancelled ? 'cancelled' : 'completed';
    console.log(`[VideoBatch] task=${task.id} ${finalStatus}: ${successCount}/${clips.length} succeeded`);
    updateTask(task.id, {
      status: finalStatus,
      progress: cancelled ? Math.round((successCount / clips.length) * 100) : 100,
      result: { clips: results, total: clips.length, success: successCount }
    });
  })().catch(err => {
    console.error(`[VideoBatch] task=${task.id} FATAL: ${err.message}`);
    updateTask(task.id, { status: 'failed', error: err.message });
  });

  res.json({ taskId: task.id });
});

app.post('/api/render/final', async (req, res) => {
  const { videoPaths, transitions, fadeIn, fadeOut, bgm, bgmEnabled, bgmVolume } = req.body;

  if (!Array.isArray(videoPaths) || videoPaths.length === 0) {
    return res.status(400).json({ error: 'Missing videoPaths array' });
  }

  const hasFfmpeg = await checkFfmpeg();
  if (!hasFfmpeg) {
    return res.status(500).json({ error: 'ffmpeg not found on server' });
  }

  const task = createTask('render', { total: videoPaths.length });

  (async () => {
    updateTask(task.id, { status: 'running', phase: 'preparing', progress: 0 });

    if (isTaskCancelled(task.id)) {
      updateTask(task.id, { status: 'cancelled', progress: 0 });
      return;
    }

    const localPaths = videoPaths.map(p => {
      if (typeof p !== 'string' || !p) return null;
      // Only accept /api/media/ paths and resolve safely
      const resolved = safeResolveMediaPath(p);
      if (!resolved) return null;
      return resolved;
    }).filter(Boolean);

    if (localPaths.length !== videoPaths.length) {
      updateTask(task.id, { status: 'failed', error: 'Invalid video path: must be within media directory' });
      return;
    }

    for (const lp of localPaths) {
      if (!fs.existsSync(lp)) {
        updateTask(task.id, { status: 'failed', error: `File not found: ${lp}` });
        return;
      }
    }

    updateTask(task.id, { phase: 'rendering', progress: 0 });

    if (isTaskCancelled(task.id)) {
      updateTask(task.id, { status: 'cancelled', progress: 0 });
      return;
    }

    const outputFilename = `final_${Date.now()}.mp4`;
    const outputPath = path.join(MEDIA_DIR, outputFilename);

    const wantsFx = !!(fadeIn || fadeOut)
      || (Array.isArray(transitions) && transitions.some(t => t && t.type === 'crossfade'));
    const transitionsAligned = Array.isArray(transitions) && transitions.length === localPaths.length - 1;
    // transition chain needs every clip to have a readable video geometry + a valid positive duration; audio-less clips get silence injected
    const streams = wantsFx ? await Promise.all(localPaths.map(probeStreams)) : null;
    const geometryOk = !!streams && streams.every(s => s.hasVideo && s.width > 0 && s.height > 0 && Number.isFinite(s.duration) && s.duration > 0);
    const useFx = wantsFx && localPaths.length >= 1 && geometryOk && (!Array.isArray(transitions) || transitionsAligned);

    let lastProgress = 0;
    const onProgress = (progress) => {
      if (progress <= lastProgress || isTaskCancelled(task.id)) return;
      lastProgress = progress;
      updateTask(task.id, { phase: 'rendering', progress });
    };

    let bgmOutput = null;
    let adopted = false;
    try {
      if (useFx) {
        await renderWithTransitions(localPaths, transitions, outputPath, {
          onProgress,
          fadeIn: !!fadeIn,
          fadeOut: !!fadeOut,
          taskId: task.id,
        });
      } else {
        await concatVideos(localPaths, outputPath, { onProgress, taskId: task.id });
      }

      // BGM is an additive audio mix on top of the assembled video (video stream is copied).
      const bgmLocal = (bgmEnabled && typeof bgm === 'string') ? safeResolveMediaPath(bgm) : null;
      if (bgmLocal) {
        bgmOutput = path.join(MEDIA_DIR, `final_${Date.now()}_bgm.mp4`);
        updateTask(task.id, { phase: 'rendering', progress: 90 });
        await applyBgm(outputPath, bgmLocal, bgmOutput, {
          bgmVolume: sanitizeVolume(bgmVolume),
          taskId: task.id,
        });
        adopted = true;
      }

      const cancelled = isTaskCancelled(task.id);
      const finalStatus = cancelled ? 'cancelled' : 'completed';
      const finalOutput = adopted ? bgmOutput : outputPath;
      const media = await probeStreams(finalOutput);
      const audioQuality = media.hasAudio ? await probeAudioQuality(finalOutput) : { integratedLufs: null, truePeakDbfs: null };
      const visualDefects = await probeVisualDefects(finalOutput);
      updateTask(task.id, {
        status: finalStatus,
        progress: finalStatus === 'completed' ? 100 : (cancelled ? 90 : 0),
        result: {
          path: `/api/media/${path.basename(finalOutput)}`,
          filename: path.basename(finalOutput),
          qcBaseline: {
            durationSeconds: media.duration,
            hasAudio: media.hasAudio,
            integratedLufs: audioQuality.integratedLufs,
            truePeakDbfs: audioQuality.truePeakDbfs,
            blackDurationSeconds: visualDefects.blackDurationSeconds,
            freezeDurationSeconds: visualDefects.freezeDurationSeconds,
            width: media.width,
            height: media.height,
            fps: media.fps,
            clipCount: localPaths.length,
            transitionCount: useFx && Array.isArray(transitions)
              ? transitions.filter(t => t?.type === 'crossfade').length : 0,
            bgmApplied: adopted,
            renderMode: useFx ? 'transitions' : 'concat',
          },
        }
      });
    } catch (err) {
      const cancelled = isTaskCancelled(task.id);
      updateTask(task.id, cancelled ? { status: 'cancelled', progress: 90 } : { status: 'failed', error: err.message });
    } finally {
      // On success the base concat/transition output is dropped when BGM was adopted; on failure/cancel
      // both the base and any partial BGM output are removed so media/ is not littered.
      const done = getTask(task.id)?.status === 'completed';
      const toRemove = done ? (adopted ? [outputPath] : []) : [outputPath, ...(bgmOutput ? [bgmOutput] : [])];
      for (const p of toRemove) {
        try { if (p && fs.existsSync(p)) fs.unlinkSync(p); } catch {}
      }
    }
  })().catch(err => {
    const cancelled = isTaskCancelled(task.id);
    updateTask(task.id, cancelled ? { status: 'cancelled', progress: 90 } : { status: 'failed', error: err.message });
  });

  res.json({ taskId: task.id });
});

app.post('/api/generate/video-comfy', async (req, res) => {
  const { clips, sshConfig: clientSsh, aspectRatio, megapixels, enableLightning, uploads } = req.body;

  if (!clientSsh?.host || !clientSsh?.user) {
    return res.status(400).json({ error: 'Missing SSH config (host, user required)' });
  }

  const sshConfig = buildSshConfig(clientSsh);
  if (!sshConfig) {
    return res.status(500).json({ error: 'SSH password not configured — set COMFY_SSH_PASSWORD in .env or enter it in Settings' });
  }

  if (!Array.isArray(clips) || clips.length === 0) {
    return res.status(400).json({ error: 'Missing clips array' });
  }

  const MAX_CLIPS = 30;
  if (clips.length > MAX_CLIPS) {
    return res.status(400).json({ error: `Too many clips (max ${MAX_CLIPS})` });
  }

  // Validate upload paths to prevent path traversal
  if (uploads?.referenceImages?.length > 0) {
    for (const ref of uploads.referenceImages) {
      if (ref.localPath && !isPathWithinDir(ref.localPath, UPLOADS_DIR)) {
        return res.status(400).json({ error: 'Invalid upload path: must be within uploads directory' });
      }
    }
  }

  const task = createTask('video-comfy', { total: clips.length });
  const remoteImageCache = new Map();
  let tunnelEstablished = false;

  (async () => {
    const results = [];
    console.log(`[ComfyUI] task=${task.id} starting ${clips.length} clips`);
    updateTask(task.id, { status: 'running', phase: 'connecting', progress: 0 });

    if (isTaskCancelled(task.id)) {
      updateTask(task.id, { status: 'cancelled', progress: 0 });
      return;
    }

    try {
      const tunnel = await ensureTunnel(sshConfig);
      tunnelEstablished = true;
      console.log(`[ComfyUI] tunnel ready at localhost:${tunnel.port}`);
    } catch (err) {
      updateTask(task.id, { status: 'failed', phase: 'failed', error: `SSH tunnel failed: ${err.message}` });
      return;
    }

    for (let i = 0; i < clips.length; i++) {
      if (isTaskCancelled(task.id)) break;
      const clip = clips[i];
      let lastError = null;

      // Item-level retries are owned by VideoAgent. Submitting again here would
      // multiply long-running GPU jobs and hide the failed attempt from lineage.
      for (let retry = 0; retry < 1; retry++) {
        if (isTaskCancelled(task.id)) { lastError = 'Cancelled'; break; }
        try {
          updateTask(task.id, {
            status: 'running', phase: 'uploading', current: i + 1,
            progress: Math.round((i / clips.length) * 100),
          });

          const requestedRefs = Array.isArray(clip.images) ? clip.images.slice(0, MAX_COMFY_REFERENCE_IMAGES) : [];
          const legacyRefs = uploads?.referenceImages?.map(ref => ref.localPath).filter(Boolean) || [];
          const localImagePaths = requestedRefs.length
            ? requestedRefs.map(ref => resolveMediaRef(ref))
            : legacyRefs;
          if (requestedRefs.length && localImagePaths.some(filePath => !filePath)) {
            throw new Error('One or more ComfyUI input images are missing from the media directory');
          }

          const mode = selectWorkflowMode(clip.mode, localImagePaths.filter(Boolean).length);
          const imageFiles = [];
          for (const localPath of localImagePaths.filter(Boolean)) {
            let remoteName = remoteImageCache.get(localPath);
            if (!remoteName) {
              remoteName = `cine_${task.id}_${i}_${imageFiles.length}_${Date.now()}${path.extname(localPath) || '.png'}`;
              await uploadImageToComfy(sshConfig, localPath, remoteName);
              remoteImageCache.set(localPath, remoteName);
            }
            imageFiles.push(remoteName);
          }

          const comfyAbort = new AbortController();
          let promptId;
          let promptFinished = false;
          let remoteCancellation = null;
          const cancelRemote = () => {
            comfyAbort.abort();
            if (promptId && !remoteCancellation) remoteCancellation = cancelPrompt(sshConfig, promptId);
            return remoteCancellation;
          };
          const cancelWatcher = setInterval(() => {
            if (isTaskCancelled(task.id)) void cancelRemote();
          }, 1000);

          try {
            promptId = await submitWorkflow(sshConfig, {
              mode,
              prompt: clip.prompt || 'Scene animation',
              seed: clip.seed ?? Math.floor(Math.random() * 1e15),
              duration: clip.duration ?? 5,
              imageFiles,
              enableLightning: enableLightning || false,
              aspectRatio: aspectRatio || '16:9',
              megapixels: Number.isFinite(megapixels) ? megapixels : undefined,
              signal: comfyAbort.signal,
            });

            console.log(`[ComfyUI] task=${task.id} clip ${i + 1} submitted, mode=${mode}, images=${imageFiles.length}, duration=${clip.duration ?? 5}s, prompt_id=${promptId}`);
            updateTask(task.id, {
              phase: 'generating', current: i + 1, promptId,
              workflowMode: mode, clipStartedAt: Date.now(),
            });

            const result = await pollUntilDone(sshConfig, promptId, { timeoutMs: 600000, signal: comfyAbort.signal });
            promptFinished = true;

            if (comfyAbort.signal.aborted || isTaskCancelled(task.id)) {
              lastError = 'Cancelled';
              console.log(`[ComfyUI] task=${task.id} clip ${i + 1} CANCELLED`);
              break;
            }

            if (result.status === 'success' && result.outputs.length > 0) {
              updateTask(task.id, { phase: 'downloading' });
              const output = result.outputs[0];
              const downloaded = await downloadOutput(sshConfig, output, MEDIA_DIR);
              results.push({ index: i, status: 'ok', path: `/api/media/${downloaded.localName}`, prompt: clip.prompt });
              console.log(`[ComfyUI] task=${task.id} clip ${i + 1} OK → ${downloaded.localName}`);
              lastError = null;
              updateTask(task.id, {
                phase: 'clip-complete', promptId: null,
                progress: Math.round(((i + 1) / clips.length) * 100),
              });
            } else {
              lastError = result.message || 'No output from ComfyUI';
              console.log(`[ComfyUI] task=${task.id} clip ${i + 1} FAILED: ${lastError}`);
            }
          } finally {
            clearInterval(cancelWatcher);
            if (!promptFinished && promptId) await cancelRemote();
            else if (remoteCancellation) await remoteCancellation;
          }

          if (lastError === 'Cancelled') break;
          if (!lastError) break;
        } catch (err) {
          if (err.name === 'AbortError' || err.message === 'Cancelled') {
            lastError = 'Cancelled';
            console.log(`[ComfyUI] task=${task.id} clip ${i + 1} CANCELLED`);
            break;
          }
          lastError = err.message;
          console.log(`[ComfyUI] task=${task.id} clip ${i + 1} ERROR: ${err.message}`);
        }
      }

      if (lastError && lastError !== 'Cancelled') {
        results.push({ index: i, status: 'error', error: lastError });
      }
    }

    const successCount = results.filter(r => r.status === 'ok').length;
    const cancelled = isTaskCancelled(task.id);
    const finalStatus = cancelled ? 'cancelled' : 'completed';
    console.log(`[ComfyUI] task=${task.id} ${finalStatus}: ${successCount}/${clips.length} succeeded`);
    updateTask(task.id, {
      status: finalStatus,
      phase: finalStatus,
      promptId: null,
      progress: cancelled ? Math.round((successCount / clips.length) * 100) : 100,
      result: { clips: results, total: clips.length, success: successCount }
    });
  })().catch(err => {
    console.error(`[ComfyUI] task=${task.id} FATAL: ${err.message}`);
    updateTask(task.id, { status: 'failed', phase: 'failed', promptId: null, error: err.message });
  }).finally(async () => {
    if (!tunnelEstablished) return;
    try {
      await deleteComfyInputFiles(sshConfig, [...remoteImageCache.values()]);
    } catch (err) {
      console.warn(`[ComfyUI] task=${task.id} input cleanup failed: ${err.message}`);
    }
  });

  res.json({ taskId: task.id });
});

app.post('/api/upload/comfy', upload.array('files', 10), async (req, res) => {
  if (!req.files?.length) {
    return res.status(400).json({ error: 'No files uploaded' });
  }

  let clientSsh;
  try {
    clientSsh = req.body.sshConfig ? JSON.parse(req.body.sshConfig) : null;
  } catch {
    return res.status(400).json({ error: 'Invalid sshConfig JSON' });
  }
  if (!clientSsh?.host) {
    return res.status(400).json({ error: 'Missing sshConfig in form data' });
  }

  const sshConfig = buildSshConfig(clientSsh);
  if (!sshConfig) {
    return res.status(500).json({ error: 'SSH password not configured — set COMFY_SSH_PASSWORD in .env or enter it in Settings' });
  }

  const uploaded = [];
  for (const file of req.files) {
    try {
      const remoteName = await uploadImageToComfy(sshConfig, file.path, file.filename);
      uploaded.push({ localPath: file.path, remoteName, path: `/api/media/uploads/${file.filename}` });
    } catch (err) {
      uploaded.push({ localPath: file.path, error: err.message, path: `/api/media/uploads/${file.filename}` });
    }
  }

  res.json({ files: uploaded });
});

app.get('/api/comfyui/status', async (req, res) => {
  const sshConfigStr = req.headers['x-ssh-config'];
  if (!sshConfigStr) {
    return res.json({ tunnel: getTunnelStatus(), comfyui: { online: false, error: 'No SSH config provided' } });
  }

  try {
    const clientSsh = JSON.parse(sshConfigStr);
    const sshConfig = buildSshConfig(clientSsh);
    if (!sshConfig) {
      return res.json({ tunnel: getTunnelStatus(), comfyui: { online: false, error: 'SSH password not configured — set COMFY_SSH_PASSWORD in .env or enter it in Settings' } });
    }
    const tunnel = getTunnelStatus();
    const comfyStatus = await checkComfyUIStatus(sshConfig);
    res.json({ tunnel, comfyui: comfyStatus });
  } catch (err) {
    res.json({ tunnel: getTunnelStatus(), comfyui: { online: false, error: err.message } });
  }
});

app.get('/api/comfyui/monitor', async (req, res) => {
  const sshConfigStr = req.headers['x-ssh-config'];
  if (!sshConfigStr) return res.status(400).json({ error: 'No SSH config provided' });
  try {
    const sshConfig = buildSshConfig(JSON.parse(sshConfigStr));
    if (!sshConfig) return res.status(500).json({ error: 'SSH password not configured — set COMFY_SSH_PASSWORD in .env or enter it in Settings' });
    const [comfy, system] = await Promise.allSettled([
      getComfyMonitorStatus(sshConfig),
      getDgxMetrics(sshConfig),
    ]);
    if (comfy.status === 'rejected' && system.status === 'rejected') {
      return res.status(502).json({ error: comfy.reason?.message || system.reason?.message || 'DGX Spark unavailable' });
    }
    const comfyui = comfy.status === 'fulfilled' ? comfy.value : { online: false, error: comfy.reason?.message };
    const systemInfo = system.status === 'fulfilled' ? system.value : { gpus: [], memory: null, disk: null, error: system.reason?.message };
    systemInfo.gpus = (systemInfo.gpus || []).map((gpu, index) => {
      const device = comfyui.devices?.[index];
      const memoryTotalMiB = Number.isFinite(gpu.memoryTotalMiB) ? gpu.memoryTotalMiB : device?.memoryTotalMiB;
      const memoryUsedMiB = Number.isFinite(gpu.memoryUsedMiB)
        ? gpu.memoryUsedMiB
        : (Number.isFinite(memoryTotalMiB) && Number.isFinite(device?.memoryFreeMiB) ? memoryTotalMiB - device.memoryFreeMiB : null);
      return { ...gpu, memoryUsedMiB, memoryTotalMiB };
    });
    res.json({
      timestamp: Date.now(),
      comfyui,
      system: systemInfo,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/comfyui/tunnel/close', (req, res) => {
  closeTunnel()
    .then(() => res.json({ ok: true }))
    .catch(err => res.status(500).json({ error: err.message }));
});

app.get('/api/task/:id', (req, res) => {
  const task = getTask(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json(task);
});

app.post('/api/task/:id/cancel', (req, res) => {
  const task = cancelTask(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json({ ok: true, status: task.status });
});

app.get('/api/media/uploads/:filename', (req, res) => {
  const filePath = path.join(UPLOADS_DIR, path.basename(req.params.filename));
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }
  res.sendFile(filePath);
});

app.get('/api/media/:filename', (req, res) => {
  const filePath = path.join(MEDIA_DIR, path.basename(req.params.filename));
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }
  res.sendFile(filePath);
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', cache: cache.stats() });
});

app.use(express.static(path.join(__dirname, '..', 'dist')));

app.get('*', (req, res) => {
  if (!req.path.startsWith('/api/')) {
    res.sendFile(path.join(__dirname, '..', 'dist', 'index.html'));
  } else {
    res.status(404).json({ error: 'API endpoint not found' });
  }
});

const HOST = process.env.HOST || '127.0.0.1';
app.listen(PORT, HOST, () => {
  console.log(`Cine-Cutie server running at http://${HOST}:${PORT}`);
  console.log(`Serving static files from dist/`);
  console.log(`Media files in ${MEDIA_DIR}`);
  console.log(`Cache: LRU, max ${cache.maxSize} entries`);
});
