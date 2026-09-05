import { registerProvider } from './registry.js';

const CFG_KEY = 'cine-cutie-dashscope';

let config = { apiKey: '', imageModel: 'wanx2.1-t2i-turbo', videoModel: 'wanx2.1-i2v-plus' };

function loadConfig() {
  try {
    const saved = localStorage.getItem(CFG_KEY);
    if (saved) config = { ...config, ...JSON.parse(saved) };
  } catch {}
}

function saveConfig(cfg) {
  config = { ...config, ...cfg };
  try {
    localStorage.setItem(CFG_KEY, JSON.stringify(config));
  } catch {}
}

function isConfigured() {
  return !!config.apiKey;
}

function getConfig() {
  return { ...config };
}

loadConfig();

const imageProvider = {
  id: 'image',
  name: 'DashScope Image Generation',
  capabilities: ['image'],

  async generate({ items, overrides = {}, signal } = {}) {
    if (!isConfigured() || !items?.length) {
      return items.map(item => ({
        id: item.id,
        path: '',
        imageUrl: '',
        status: 'failed',
        error: !isConfigured() ? 'Not configured' : 'No items',
      }));
    }

    const prompts = items.map(item => {
      const overridePrompt = overrides.promptOverrides && overrides.promptOverrides[item.id];
      return overridePrompt || item.prompt;
    });

    const seeds = items.map(item => {
      const overrideSeed = overrides.seed?.[item.id];
      return overrideSeed ?? item.seed ?? 42;
    });

    const ids = items.map(item => item.id);

    return await generateImages(prompts, ids, seeds, signal);
  },
};

async function generateImages(prompts, ids, seeds, externalSignal) {
  try {
    if (externalSignal?.aborted) {
      return prompts.map((_, i) => ({
        id: ids[i], path: '', imageUrl: '', status: 'failed', error: 'Cancelled',
      }));
    }

    const res = await fetch('/api/generate/image', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': config.apiKey,
      },
      signal: externalSignal,
      body: JSON.stringify({
        prompts,
        model: config.imageModel,
        size: '1024*1024',
        seed: seeds[0] || 42,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return prompts.map((_, i) => ({
        id: ids[i],
        path: '',
        imageUrl: '',
        status: 'failed',
        error: `HTTP ${res.status}: ${errText.substring(0, 100)}`,
      }));
    }

    const { taskId } = await res.json();
    const results = [];
    const startTime = Date.now();
    const MAX_WAIT = 10 * 60 * 1000;

    for (let attempt = 0; attempt < 200; attempt++) {
      if (externalSignal?.aborted) {
        return prompts.map((_, i) => ({
          id: ids[i], path: '', imageUrl: '', status: 'failed', error: 'Cancelled',
        }));
      }
      if (Date.now() - startTime > MAX_WAIT) {
        return prompts.map((_, i) => ({
          id: ids[i],
          path: '',
          imageUrl: '',
          status: 'failed',
          error: 'Timeout',
        }));
      }
      await new Promise(r => setTimeout(r, 3000));

      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 30000);
      if (externalSignal) {
        if (externalSignal.aborted) { ctrl.abort(); clearTimeout(tid); break; }
        externalSignal.addEventListener('abort', () => ctrl.abort(), { once: true });
      }
      let taskData;
      try {
        const taskRes = await fetch(`/api/task/${taskId}`, { signal: ctrl.signal });
        clearTimeout(tid);
        taskData = await taskRes.json();
      } catch {
        clearTimeout(tid);
        if (externalSignal?.aborted) break;
        continue;
      }

      if (taskData.status === 'completed') {
        const images = taskData.result?.images || [];
        for (let i = 0; i < prompts.length; i++) {
          const img = images.find(e => e.index === i);
          results.push({
            id: ids[i],
            path: img?.path || '',
            imageUrl: img?.imageUrl || '',
            status: img?.path ? 'complete' : 'failed',
            error: img?.path ? null : 'No image returned',
          });
        }
        break;
      }
      if (taskData.status === 'failed') {
        return prompts.map((_, i) => ({
          id: ids[i],
          path: '',
          imageUrl: '',
          status: 'failed',
          error: taskData.error || 'Generation failed',
        }));
      }
    }

    while (results.length < prompts.length) {
      results.push({
        id: ids[results.length],
        path: '',
        imageUrl: '',
        status: 'failed',
        error: 'Incomplete results',
      });
    }
    return results;
  } catch (err) {
    return prompts.map((_, i) => ({
      id: ids[i],
      path: '',
      imageUrl: '',
      status: 'failed',
      error: err.message,
    }));
  }
}

registerProvider(imageProvider);

export { saveConfig, getConfig, isConfigured };
