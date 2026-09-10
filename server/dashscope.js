const DASHSCOPE_BASE = 'https://dashscope.aliyuncs.com/api/v1';

export async function submitImageTask(prompt, { model, size = '1024*1024', apiKey, seed } = {}) {
  if (!model) throw new Error('submitImageTask: model is required');
  const url = imageTaskEndpoint(model);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  console.log(`[DashScope] Submitting image task: model=${model}, size=${size}${seed != null ? `, seed=${seed}` : ''}`);
  console.log(`[DashScope]   prompt: ${prompt.substring(0, 80)}...`);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'X-DashScope-Async': 'enable'
      },
      body: JSON.stringify(buildImageTaskRequest(prompt, { model, size, seed })),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`[DashScope] Image submit FAILED (${res.status}): ${text.substring(0, 300)}`);
      throw new Error(`DashScope image submit failed (${res.status}): ${text.substring(0, 300)}`);
    }

    const data = await res.json();
    const taskId = data.output?.task_id;
    console.log(`[DashScope] Image task submitted: task_id=${taskId}`);
    return taskId;
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      console.error(`[DashScope] Image submit TIMEOUT (30s)`);
      throw new Error('DashScope image submit timed out (30s)');
    }
    console.error(`[DashScope] Image submit ERROR: ${err.message}`);
    throw err;
  }
}

export function imageTaskEndpoint(model) {
  return model === 'wan2.5-t2i-preview'
    ? `${DASHSCOPE_BASE}/services/aigc/text2image/image-synthesis`
    : `${DASHSCOPE_BASE}/services/aigc/image-generation/generation`;
}

export function buildImageTaskRequest(prompt, { model, size = '1280*1280', seed } = {}) {
  if (model === 'wan2.5-t2i-preview') {
    return {
      model,
      input: { prompt },
      parameters: { size, n: 1, prompt_extend: true, watermark: false, ...(seed != null && { seed }) },
    };
  }
  return {
    model,
    input: { messages: [{ role: 'user', content: [{ text: prompt }] }] },
    parameters: { size, n: 1, prompt_extend: true, watermark: false, ...(seed != null && { seed }) },
  };
}

// 图生图（万相2.6-image / 2.7-image 图像编辑）：input.messages.content = 1 个 text + 1~4 个 image
export async function submitImageEditTask(prompt, imageUrls, { model, size = '1K', apiKey, seed } = {}) {
  if (!model) throw new Error('submitImageEditTask: model is required');
  if (!Array.isArray(imageUrls) || imageUrls.length === 0) {
    throw new Error('submitImageEditTask: at least one reference image is required');
  }
  const url = `${DASHSCOPE_BASE}/services/aigc/image-generation/generation`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  console.log(`[DashScope] Submitting image-edit task: model=${model}, refs=${imageUrls.length}, size=${size}${seed != null ? `, seed=${seed}` : ''}`);
  console.log(`[DashScope]   prompt: ${prompt.substring(0, 80)}...`);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'X-DashScope-Async': 'enable'
      },
      body: JSON.stringify(buildImageEditTaskRequest(prompt, imageUrls, { model, size, seed })),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`[DashScope] Image-edit submit FAILED (${res.status}): ${text.substring(0, 300)}`);
      throw new Error(`DashScope image-edit submit failed (${res.status}): ${text.substring(0, 300)}`);
    }

    const data = await res.json();
    const taskId = data.output?.task_id;
    console.log(`[DashScope] Image-edit task submitted: task_id=${taskId}`);
    return taskId;
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      console.error(`[DashScope] Image-edit submit TIMEOUT (30s)`);
      throw new Error('DashScope image-edit submit timed out (30s)');
    }
    console.error(`[DashScope] Image-edit submit ERROR: ${err.message}`);
    throw err;
  }
}

export function buildImageEditTaskRequest(prompt, imageUrls, { model, size = '1K', seed } = {}) {
  const is27 = model === 'wan2.7-image';
  const maxImages = is27 ? 9 : 4;
  return {
    model,
    input: {
      messages: [{
        role: 'user',
        content: [
          ...imageUrls.slice(0, maxImages).map(image => ({ image })),
          { text: prompt },
        ],
      }],
    },
    parameters: {
      size,
      n: 1,
      watermark: false,
      ...(!is27 && { prompt_extend: false, enable_interleave: false }),
      ...(seed != null && { seed }),
    },
  };
}

// 文生图轮询结果在 output.results[].url，图生图在 output.choices[].message.content[].image
export function parseImageResultUrl(pollData) {
  const direct = pollData?.output?.results?.[0]?.url;
  if (direct) return direct;
  const content = pollData?.output?.choices?.[0]?.message?.content;
  if (Array.isArray(content)) {
    const found = content.find(c => typeof c?.image === 'string' && c.image);
    if (found) return found.image;
  }
  return null;
}

// 每个模型接受的 duration 不同（百炼官方 API 参考）：wan2.7 系列与 wan2.6-i2v/-flash 是 [2,15] 的整数，
// wan2.6-i2v-us 只有 5/10/15，wan2.5-i2v 只有 5/10，wanx2.1-i2v-turbo 只有 3/4/5，
// wanx2.1-i2v-plus 与 wan2.2-i2v-* 固定 5 秒且不支持修改。
const DURATION_RULES = [
  { pattern: /^wan2\.6-r2v/, range: [2, 10] },
  { pattern: /^wan2\.7-/, range: [2, 15] },
  { pattern: /^wan2\.6-i2v-flash/, range: [2, 15] },
  { pattern: /^wan2\.6-i2v-us/, values: [5, 10, 15] },
  { pattern: /^wan2\.6-i2v/, range: [2, 15] },
  { pattern: /^wan2\.5-i2v/, values: [5, 10] },
  { pattern: /^wanx2\.1-i2v-turbo/, values: [3, 4, 5] },
];

// 表外的模型统一按 5 秒提交：5 秒是所有已知档位都接受的值，比送一个可能被拒的时长安全
const UNIVERSAL_DURATION = 5;

export function clampVideoDuration(model, seconds) {
  const rule = DURATION_RULES.find(r => r.pattern.test(model || ''));
  const wanted = Number(seconds);

  if (!rule) {
    if (Number.isFinite(wanted) && wanted !== UNIVERSAL_DURATION) {
      console.warn(`[DashScope] ${model || 'unknown model'} has no documented duration rule — submitting ${UNIVERSAL_DURATION}s instead of the requested ${wanted}s`);
    }
    return UNIVERSAL_DURATION;
  }

  if (!Number.isFinite(wanted)) return UNIVERSAL_DURATION;

  const clamped = rule.values
    ? rule.values.reduce((best, v) => (Math.abs(v - wanted) < Math.abs(best - wanted) ? v : best))
    : Math.min(rule.range[1], Math.max(rule.range[0], Math.round(wanted)));

  if (clamped !== wanted) {
    const allowed = rule.values ? `${rule.values.join('/')}s` : `${rule.range[0]}-${rule.range[1]}s`;
    console.warn(`[DashScope] ${model} only accepts ${allowed} — using ${clamped}s instead of the requested ${wanted}s`);
  }
  return clamped;
}

export async function submitVideoTask(prompt, imageUrl, { model, duration = 5, resolution = '720P', apiKey, seed, aspectRatio, audio } = {}) {
  if (!model) throw new Error('submitVideoTask: model is required');
  const seconds = clampVideoDuration(model, duration);
  const url = `${DASHSCOPE_BASE}/services/aigc/video-generation/video-synthesis`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  console.log(`[DashScope] Submitting video task: model=${model}, duration=${seconds}, resolution=${resolution}${seed != null ? `, seed=${seed}` : ''}${audio ? ', audio=true' : ''}`);
  console.log(`[DashScope]   img_url: ${imageUrl}`);
  console.log(`[DashScope]   prompt: ${prompt.substring(0, 80)}...`);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'X-DashScope-Async': 'enable'
      },
      body: JSON.stringify(buildFirstFrameVideoTaskRequest(prompt, imageUrl, {
        model, duration: seconds, resolution, seed, audio,
      })),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`[DashScope] Video submit FAILED (${res.status}): ${text.substring(0, 300)}`);
      throw new Error(`DashScope video submit failed (${res.status}): ${text.substring(0, 300)}`);
    }

    const data = await res.json();
    const taskId = data.output?.task_id;
    console.log(`[DashScope] Video task submitted: task_id=${taskId}`);
    return taskId;
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      console.error(`[DashScope] Video submit TIMEOUT (30s)`);
      throw new Error('DashScope video submit timed out (30s)');
    }
    console.error(`[DashScope] Video submit ERROR: ${err.message}`);
    throw err;
  }
}

export function buildFirstFrameVideoTaskRequest(prompt, imageUrl, { model, duration = 5, resolution = '720P', seed, audio } = {}) {
  return {
    model,
    input: { prompt, img_url: imageUrl },
    parameters: {
      duration,
      resolution,
      prompt_extend: true,
      shot_type: 'single',
      watermark: false,
      ...(seed != null && { seed }),
      ...(model === 'wan2.6-i2v-flash' && typeof audio === 'boolean' && { audio }),
    },
  };
}

export async function pollTask(taskId, apiKey) {
  const url = `${DASHSCOPE_BASE}/tasks/${taskId}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`[DashScope] Poll FAILED for ${taskId} (${res.status}): ${text.substring(0, 200)}`);
      throw new Error(`DashScope poll failed (${res.status}): ${text.substring(0, 300)}`);
    }

    const data = await res.json();
    const status = data.output?.task_status;
    console.log(`[DashScope] Poll ${taskId}: status=${status}`);
    return data;
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      console.error(`[DashScope] Poll TIMEOUT for ${taskId} (15s)`);
      throw new Error('DashScope poll timed out (15s)');
    }
    console.error(`[DashScope] Poll ERROR for ${taskId}: ${err.message}`);
    throw err;
  }
}

export function detectVideoMode(uploads) {
  if (uploads?.referenceImages?.length > 0) return 'r2v';
  if (uploads?.firstFrame || uploads?.lastFrame) return 'i2v';
  return 'legacy';
}

export function hasVideoUploads(uploads) {
  return Boolean(
    uploads?.firstFrame?.localPath
    || uploads?.lastFrame?.localPath
    || uploads?.referenceImages?.some(ref => ref?.localPath),
  );
}

export async function fileToDataUri(filePath) {
  const { readFile } = await import('fs/promises');
  const { extname } = await import('path');
  const buf = await readFile(filePath);
  const ext = extname(filePath).toLowerCase();
  const mimeMap = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.bmp': 'image/bmp' };
  const mime = mimeMap[ext] || 'image/png';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

export async function submitVideoTaskV2(prompt, mediaArray, { model, duration = 5, resolution = '720P', apiKey, seed, aspectRatio } = {}) {
  if (!model) throw new Error('submitVideoTaskV2: model is required');
  const seconds = clampVideoDuration(model, duration);
  const url = `${DASHSCOPE_BASE}/services/aigc/video-generation/video-synthesis`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  console.log(`[DashScope V2] Submitting video task: model=${model}, media=${mediaArray.length} items, duration=${seconds}, resolution=${resolution}`);
  console.log(`[DashScope V2]   prompt: ${prompt.substring(0, 80)}...`);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'X-DashScope-Async': 'enable'
      },
      body: JSON.stringify(buildV2VideoTaskRequest(prompt, mediaArray, {
        model, duration: seconds, resolution, seed, aspectRatio,
      })),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`[DashScope V2] Video submit FAILED (${res.status}): ${text.substring(0, 300)}`);
      throw new Error(`DashScope V2 video submit failed (${res.status}): ${text.substring(0, 300)}`);
    }

    const data = await res.json();
    const taskId = data.output?.task_id;
    console.log(`[DashScope V2] Video task submitted: task_id=${taskId}`);
    return taskId;
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      console.error(`[DashScope V2] Video submit TIMEOUT (30s)`);
      throw new Error('DashScope V2 video submit timed out (30s)');
    }
    console.error(`[DashScope V2] Video submit ERROR: ${err.message}`);
    throw err;
  }
}

export function buildV2VideoTaskRequest(prompt, mediaArray, { model, duration = 5, resolution = '720P', seed, aspectRatio } = {}) {
  const hasFirstFrame = mediaArray.some(item => item?.type === 'first_frame');
  const referenceCount = mediaArray.filter(item => item?.type === 'reference_image').length;
  const adaptedPrompt = referenceCount
    ? `Preserve the exact identities of ${Array.from({ length: referenceCount }, (_, i) => `Image ${i + 1}`).join(', ')}. ${prompt}`
    : prompt;
  return {
    model,
    input: { prompt: adaptedPrompt, media: mediaArray },
    parameters: {
      duration,
      resolution,
      prompt_extend: true,
      watermark: false,
      ...(seed != null && { seed }),
      ...(!hasFirstFrame && aspectRatio && { ratio: aspectRatio }),
    },
  };
}

export function referenceVideoSize(resolution = '720P', aspectRatio = '16:9') {
  const tier = resolution === '1080P' ? '1080P' : '720P';
  const ratio = ['16:9', '9:16', '1:1', '4:3', '3:4'].includes(aspectRatio) ? aspectRatio : '16:9';
  const sizes = {
    '720P': { '16:9': '1280*720', '9:16': '720*1280', '1:1': '960*960', '4:3': '1088*832', '3:4': '832*1088' },
    '1080P': { '16:9': '1920*1080', '9:16': '1080*1920', '1:1': '1440*1440', '4:3': '1632*1248', '3:4': '1248*1632' },
  };
  return sizes[tier][ratio];
}

export function buildLegacyReferenceVideoTaskRequest(prompt, referenceUrls, { model, duration = 5, resolution = '720P', seed, aspectRatio, audio } = {}) {
  const subjects = Array.from({ length: Math.min(referenceUrls.length, 5) }, (_, i) => `character${i + 1}`).join(', ');
  return {
    model,
    input: {
      prompt: `Preserve the exact identities of ${subjects}. ${prompt}`,
      reference_urls: referenceUrls.slice(0, 5),
    },
    parameters: {
      size: referenceVideoSize(resolution, aspectRatio),
      duration,
      prompt_extend: true,
      shot_type: 'single',
      watermark: false,
      ...(seed != null && { seed }),
      ...(model === 'wan2.6-r2v-flash' && typeof audio === 'boolean' && { audio }),
    },
  };
}

export async function submitLegacyReferenceVideoTask(prompt, referenceUrls, options = {}) {
  if (!options.model) throw new Error('submitLegacyReferenceVideoTask: model is required');
  if (!referenceUrls?.length) throw new Error('submitLegacyReferenceVideoTask: at least one reference is required');
  const seconds = clampVideoDuration(options.model, options.duration);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(`${DASHSCOPE_BASE}/services/aigc/video-generation/video-synthesis`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${options.apiKey}`,
        'X-DashScope-Async': 'enable',
      },
      body: JSON.stringify(buildLegacyReferenceVideoTaskRequest(prompt, referenceUrls, {
        ...options, duration: seconds,
      })),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`DashScope legacy reference-video submit failed (${res.status}): ${text.substring(0, 300)}`);
    }
    return (await res.json()).output?.task_id;
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') throw new Error('DashScope legacy reference-video submit timed out (30s)');
    throw err;
  }
}

export async function downloadFile(fileUrl, savePath) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  console.log(`[DashScope] Downloading: ${fileUrl.substring(0, 100)}...`);
  console.log(`[DashScope]   saving to: ${savePath}`);

  try {
    const res = await fetch(fileUrl, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) throw new Error(`Download failed: ${res.status}`);

    const buffer = Buffer.from(await res.arrayBuffer());
    const fs = await import('fs');
    const { dirname } = await import('path');
    fs.mkdirSync(dirname(savePath), { recursive: true });
    fs.writeFileSync(savePath, buffer);
    console.log(`[DashScope] Downloaded ${(buffer.length / 1024).toFixed(1)}KB → ${savePath}`);
    return savePath;
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      console.error(`[DashScope] Download TIMEOUT (60s)`);
      throw new Error('Download timed out (60s)');
    }
    console.error(`[DashScope] Download ERROR: ${err.message}`);
    throw err;
  }
}
