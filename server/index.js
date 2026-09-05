import express from 'express';
import { LRUCache } from './cache.js';
import { submitImageTask, submitVideoTask, pollTask, downloadFile } from './dashscope.js';
import { createTask, getTask, updateTask } from './tasks.js';
import { concatVideos, checkFfmpeg } from './render.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const cache = new LRUCache(100);
const PORT = process.env.PORT || 3006;

const MEDIA_DIR = path.join(__dirname, '..', 'media');
fs.mkdirSync(MEDIA_DIR, { recursive: true });

app.use(express.json({ limit: '10mb' }));

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

  const cached = cache.get(model, messages);
  if (cached) {
    res.set('X-Cache', 'HIT');
    return res.json(cached);
  }

  const endpoint = req.headers['x-target-endpoint'] || 'https://api.openai.com/v1';
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    return res.status(401).json({ error: 'Missing API key. Send via X-Api-Key header.' });
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
    cache.set(model, messages, data);

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
  const { prompts, model, size, seed } = req.body;
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    return res.status(401).json({ error: 'Missing DashScope API key. Send via X-Api-Key header.' });
  }

  if (!Array.isArray(prompts) || prompts.length === 0) {
    return res.status(400).json({ error: 'Missing prompts array' });
  }

  const task = createTask('image', { total: prompts.length });

  (async () => {
    const results = [];
    console.log(`[ImageBatch] task=${task.id} starting ${prompts.length} images`);
    for (let i = 0; i < prompts.length; i++) {
      let lastError = null;
      for (let retry = 0; retry <= 2; retry++) {
        if (retry > 0) {
          console.log(`[ImageBatch] task=${task.id} image ${i + 1} retry ${retry}/2 after 3s`);
          await new Promise(r => setTimeout(r, 3000));
        }
        try {
          console.log(`[ImageBatch] task=${task.id} image ${i + 1}/${prompts.length}`);
          updateTask(task.id, { status: 'running', current: i + 1, progress: Math.round((i / prompts.length) * 100) });

          const taskId = await submitImageTask(prompts[i], { model, size, apiKey, seed });

          let pollResult;
          for (let attempt = 0; attempt < 120; attempt++) {
            await new Promise(r => setTimeout(r, 3000));
            pollResult = await pollTask(taskId, apiKey);
            const status = pollResult.output?.task_status;
            if (status === 'SUCCEEDED' || status === 'FAILED') break;
          }

          if (pollResult?.output?.task_status === 'SUCCEEDED') {
            const imageUrl = pollResult.output.results?.[0]?.url;
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
      if (lastError) {
        results.push({ index: i, status: 'error', error: lastError });
      }
    }

    const successCount = results.filter(r => r.status === 'ok').length;
    console.log(`[ImageBatch] task=${task.id} completed: ${successCount}/${prompts.length} succeeded`);
    updateTask(task.id, {
      status: 'completed',
      progress: 100,
      result: { images: results, total: prompts.length, success: successCount }
    });
  })().catch(err => {
    console.error(`[ImageBatch] task=${task.id} FATAL: ${err.message}`);
    updateTask(task.id, { status: 'failed', error: err.message });
  });

  res.json({ taskId: task.id });
});

app.post('/api/generate/video', async (req, res) => {
  const { clips, model, duration, resolution, seed } = req.body;
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    return res.status(401).json({ error: 'Missing DashScope API key. Send via X-Api-Key header.' });
  }

  if (!Array.isArray(clips) || clips.length === 0) {
    return res.status(400).json({ error: 'Missing clips array' });
  }

  const task = createTask('video', { total: clips.length });

  (async () => {
    const results = [];
    console.log(`[VideoBatch] task=${task.id} starting ${clips.length} clips`);
    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i];
      if (!clip.imageUrl) {
        results.push({ index: i, status: 'error', error: 'No imageUrl provided' });
        console.log(`[VideoBatch] task=${task.id} clip ${i + 1} SKIPPED: no imageUrl`);
        continue;
      }

      let lastError = null;
      for (let retry = 0; retry <= 2; retry++) {
        if (retry > 0) {
          console.log(`[VideoBatch] task=${task.id} clip ${i + 1} retry ${retry}/2 after 5s`);
          await new Promise(r => setTimeout(r, 5000));
        }
        try {
          console.log(`[VideoBatch] task=${task.id} clip ${i + 1}/${clips.length}`);
          updateTask(task.id, { status: 'running', current: i + 1, progress: Math.round((i / clips.length) * 100) });

          const imageUrl = clip.imageUrl.startsWith('http')
            ? clip.imageUrl
            : `${req.protocol}://${req.get('host')}${clip.imageUrl}`;
          console.log(`[VideoBatch] task=${task.id} clip ${i + 1} imageUrl=${imageUrl}`);

          const taskId = await submitVideoTask(clip.prompt, imageUrl, { model, duration, resolution, apiKey, seed });

          let pollResult;
          for (let attempt = 0; attempt < 240; attempt++) {
            await new Promise(r => setTimeout(r, 5000));
            pollResult = await pollTask(taskId, apiKey);
            const status = pollResult.output?.task_status;
            if (status === 'SUCCEEDED' || status === 'FAILED') break;
          }

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
      if (lastError) {
        results.push({ index: i, status: 'error', error: lastError });
      }
    }

    const successCount = results.filter(r => r.status === 'ok').length;
    console.log(`[VideoBatch] task=${task.id} completed: ${successCount}/${clips.length} succeeded`);
    updateTask(task.id, {
      status: 'completed',
      progress: 100,
      result: { clips: results, total: clips.length, success: successCount }
    });
  })().catch(err => {
    console.error(`[VideoBatch] task=${task.id} FATAL: ${err.message}`);
    updateTask(task.id, { status: 'failed', error: err.message });
  });

  res.json({ taskId: task.id });
});

app.post('/api/render/final', async (req, res) => {
  const { videoPaths } = req.body;

  if (!Array.isArray(videoPaths) || videoPaths.length === 0) {
    return res.status(400).json({ error: 'Missing videoPaths array' });
  }

  const hasFfmpeg = await checkFfmpeg();
  if (!hasFfmpeg) {
    return res.status(500).json({ error: 'ffmpeg not found on server' });
  }

  const task = createTask('render', { total: videoPaths.length });

  (async () => {
    updateTask(task.id, { status: 'running', progress: 10 });

    const localPaths = videoPaths.map(p => {
      if (p.startsWith('/api/media/')) {
        return path.join(MEDIA_DIR, p.replace('/api/media/', ''));
      }
      return path.join(MEDIA_DIR, path.basename(p));
    });

    for (const lp of localPaths) {
      if (!fs.existsSync(lp)) {
        updateTask(task.id, { status: 'failed', error: `File not found: ${lp}` });
        return;
      }
    }

    updateTask(task.id, { progress: 30 });

    const outputFilename = `final_${Date.now()}.mp4`;
    const outputPath = path.join(MEDIA_DIR, outputFilename);

    await concatVideos(localPaths, outputPath);

    updateTask(task.id, {
      status: 'completed',
      progress: 100,
      result: { path: `/api/media/${outputFilename}`, filename: outputFilename }
    });
  })().catch(err => {
    updateTask(task.id, { status: 'failed', error: err.message });
  });

  res.json({ taskId: task.id });
});

app.get('/api/task/:id', (req, res) => {
  const task = getTask(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json(task);
});

app.get('/api/media/:filename', (req, res) => {
  const filePath = path.join(MEDIA_DIR, path.basename(req.params.filename));
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }
  res.sendFile(filePath);
});

app.get('/api/cache/stats', (req, res) => {
  res.json(cache.stats());
});

app.post('/api/cache/clear', (req, res) => {
  cache.cache.clear();
  cache.hits = 0;
  cache.misses = 0;
  res.json({ ok: true, message: 'Cache cleared' });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', cache: cache.stats() });
});

app.use(express.static(path.join(__dirname, '..', 'dist')));

app.get('*', (req, res) => {
  if (!req.path.startsWith('/api/')) {
    res.sendFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
});

app.listen(PORT, () => {
  console.log(`Cine-Cutie server running at http://localhost:${PORT}`);
  console.log(`Serving static files from dist/`);
  console.log(`Media files in ${MEDIA_DIR}`);
  console.log(`Cache: LRU, max ${cache.maxSize} entries`);
});
