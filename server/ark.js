const ARK_BASE = 'https://ark.cn-beijing.volces.com/api/v3';

const SEEDANCE_DURATION_RULES = [
  { pattern: /^doubao-seedance-1-0-lite/, values: [5, 10] },
  { pattern: /^doubao-seedance-1-0-pro/, values: [5, 10] },
  { pattern: /^doubao-seedance-1-5-pro/, values: [5, 10] },
  { pattern: /^doubao-seedance-2-0/, values: [5, 10] },
];

export function clampArkVideoDuration(model, seconds) {
  const rule = SEEDANCE_DURATION_RULES.find(r => r.pattern.test(model || ''));
  const wanted = Number(seconds);
  if (!rule || !Number.isFinite(wanted)) return 5;
  return rule.values.reduce((best, v) => Math.abs(v - wanted) < Math.abs(best - wanted) ? v : best);
}

export function isArkModel(name) {
  return typeof name === 'string' && /^doubao-(seedance|seedream)/.test(name);
}

export function isArkVideoModel(name) {
  return typeof name === 'string' && name.startsWith('doubao-seedance');
}

export function isArkImageModel(name) {
  return typeof name === 'string' && name.startsWith('doubao-seedream');
}

export async function submitArkVideoTask(prompt, contentItems, { model, duration = 5, resolution = '720p', apiKey, seed, ratio } = {}) {
  if (!model) throw new Error('submitArkVideoTask: model is required');
  const seconds = clampArkVideoDuration(model, duration);
  const url = `${ARK_BASE}/contents/generations/tasks`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  const content = [{ type: 'text', text: prompt }];
  if (Array.isArray(contentItems)) content.push(...contentItems);

  console.log(`[Ark] Submitting video task: model=${model}, content=${content.length} items, duration=${seconds}s, resolution=${resolution}`);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        content,
        duration: seconds,
        resolution: resolution.toLowerCase(),
        ...(ratio && { ratio }),
        ...(seed != null && { seed }),
        watermark: false,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`[Ark] Video submit FAILED (${res.status}): ${text.substring(0, 300)}`);
      throw new Error(`Ark video submit failed (${res.status}): ${text.substring(0, 300)}`);
    }

    const data = await res.json();
    const taskId = data.id;
    console.log(`[Ark] Video task submitted: id=${taskId}`);
    return taskId;
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') throw new Error('Ark video submit timed out (30s)');
    console.error(`[Ark] Video submit ERROR: ${err.message}`);
    throw err;
  }
}

export async function pollArkTask(taskId, apiKey) {
  const url = `${ARK_BASE}/contents/generations/tasks/${taskId}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Ark poll failed (${res.status}): ${text.substring(0, 300)}`);
    }

    const data = await res.json();
    console.log(`[Ark] Poll ${taskId}: status=${data.status}`);
    return data;
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') throw new Error('Ark poll timed out (15s)');
    throw err;
  }
}

export function parseArkVideoUrl(pollResult) {
  return pollResult?.content?.video_url || pollResult?.video_url || null;
}

export async function submitArkImageTask(prompt, { model, size = '2K', apiKey, imageUrls } = {}) {
  if (!model) throw new Error('submitArkImageTask: model is required');
  const url = `${ARK_BASE}/images/generations`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 240000);

  const body = {
    model,
    prompt,
    size,
    response_format: 'url',
    watermark: false,
  };
  if (Array.isArray(imageUrls) && imageUrls.length) body.image = imageUrls;

  console.log(`[Ark] Submitting image task (sync): model=${model}, size=${size}`);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`[Ark] Image submit FAILED (${res.status}): ${text.substring(0, 300)}`);
      throw new Error(`Ark image submit failed (${res.status}): ${text.substring(0, 300)}`);
    }

    const data = await res.json();
    const imageUrl = data?.data?.[0]?.url;
    if (!imageUrl) throw new Error('Ark image response missing data[0].url');
    console.log(`[Ark] Image generated (sync): ${imageUrl.substring(0, 80)}...`);
    return imageUrl;
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') throw new Error('Ark image submit timed out (240s)');
    console.error(`[Ark] Image submit ERROR: ${err.message}`);
    throw err;
  }
}
