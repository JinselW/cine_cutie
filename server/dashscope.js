const DASHSCOPE_BASE = 'https://dashscope.aliyuncs.com/api/v1';

export async function submitImageTask(prompt, { model, size = '1024*1024', apiKey, seed } = {}) {
  if (!model) throw new Error('submitImageTask: model is required');
  const url = `${DASHSCOPE_BASE}/services/aigc/text2image/image-synthesis`;
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
      body: JSON.stringify({
        model,
        input: { prompt },
        parameters: { size, n: 1, ...(seed != null && { seed }) }
      }),
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
      body: JSON.stringify({
        model,
        input: {
          messages: [{
            role: 'user',
            content: [
              { text: prompt },
              ...imageUrls.slice(0, 4).map(image => ({ image }))
            ]
          }]
        },
        parameters: {
          size,
          n: 1,
          watermark: false,
          prompt_extend: false,
          ...(seed != null && { seed })
        }
      }),
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

export async function submitVideoTask(prompt, imageUrl, { model, duration = 5, resolution = '720P', apiKey, seed, aspectRatio } = {}) {
  if (!model) throw new Error('submitVideoTask: model is required');
  const seconds = clampVideoDuration(model, duration);
  const url = `${DASHSCOPE_BASE}/services/aigc/video-generation/video-synthesis`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  console.log(`[DashScope] Submitting video task: model=${model}, duration=${seconds}, resolution=${resolution}${seed != null ? `, seed=${seed}` : ''}`);
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
      body: JSON.stringify({
        model,
        input: {
          prompt,
          img_url: imageUrl
        },
        parameters: { duration: seconds, resolution, ...(seed != null && { seed }), ...(aspectRatio && { aspect_ratio: aspectRatio }) }
      }),
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

export async function fileToDataUri(filePath) {
  const { readFile } = await import('fs/promises');
  const { extname } = await import('path');
  const buf = await readFile(filePath);
  const ext = extname(filePath).toLowerCase();
  const mimeMap = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
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
      body: JSON.stringify({
        model,
        input: {
          prompt,
          media: mediaArray
        },
        parameters: {
          duration: seconds,
          resolution,
          ...(seed != null && { seed }),
          ...(aspectRatio && { aspect_ratio: aspectRatio })
        }
      }),
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
