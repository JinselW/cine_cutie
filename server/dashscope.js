const DASHSCOPE_BASE = 'https://dashscope.aliyuncs.com/api/v1';

export async function submitImageTask(prompt, { model = 'wanx2.1-t2i-turbo', size = '1024*1024', apiKey } = {}) {
  const url = `${DASHSCOPE_BASE}/services/aigc/text2image/image-synthesis`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  console.log(`[DashScope] Submitting image task: model=${model}, size=${size}`);
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
        parameters: { size, n: 1 }
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

export async function submitVideoTask(prompt, imageUrl, { model = 'wanx2.1-i2v-turbo', duration = 5, resolution = '720P', apiKey } = {}) {
  const url = `${DASHSCOPE_BASE}/services/aigc/video-generation/video-synthesis`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  console.log(`[DashScope] Submitting video task: model=${model}, duration=${duration}, resolution=${resolution}`);
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
        parameters: { duration, resolution }
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
