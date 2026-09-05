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

export async function submitVideoTask(prompt, imageUrl, { model, duration = 5, resolution = '720P', apiKey, seed, aspectRatio } = {}) {
  if (!model) throw new Error('submitVideoTask: model is required');
  const url = `${DASHSCOPE_BASE}/services/aigc/video-generation/video-synthesis`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  console.log(`[DashScope] Submitting video task: model=${model}, duration=${duration}, resolution=${resolution}${seed != null ? `, seed=${seed}` : ''}`);
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
        parameters: { duration, resolution, ...(seed != null && { seed }), ...(aspectRatio && { aspect_ratio: aspectRatio }) }
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
  const url = `${DASHSCOPE_BASE}/services/aigc/video-generation/video-synthesis`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  console.log(`[DashScope V2] Submitting video task: model=${model}, media=${mediaArray.length} items, duration=${duration}, resolution=${resolution}`);
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
          duration,
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
