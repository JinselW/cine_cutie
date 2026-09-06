import { registerProvider } from './registry.js';
import { state } from '../state.js';
import { computeImageSize, DEFAULT_RESOLUTION } from '../utils/resolution.js';

const SETTINGS_KEY = 'cine-cutie-settings';
const OLD_DS_KEY = 'cine-cutie-dashscope';

let config = { apiKey: '', imageModel: 'wanx2.1-t2i-turbo', videoModel: 'wanx2.1-i2v-plus', refVideoModel: 'wan2.7-r2v' };

function loadConfig() {
  try {
    const saved = localStorage.getItem(SETTINGS_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      config.apiKey = parsed.apiProviders?.dashscope?.apiKey || '';
      config.imageModel = parsed.models?.image?.name || 'wanx2.1-t2i-turbo';
      config.videoModel = parsed.models?.video?.name || 'wanx2.1-i2v-plus';
      config.refVideoModel = parsed.models?.refVideo?.name || 'wan2.7-r2v';
    } else {
      const oldSaved = localStorage.getItem(OLD_DS_KEY);
      if (oldSaved) {
        const old = JSON.parse(oldSaved);
        config = { ...config, ...old };
      }
    }
  } catch {}
}

function saveConfig(cfg) {
  if (cfg.apiKey !== undefined) config.apiKey = cfg.apiKey;
  if (cfg.imageModel !== undefined) config.imageModel = cfg.imageModel;
  if (cfg.videoModel !== undefined) config.videoModel = cfg.videoModel;
  if (cfg.refVideoModel !== undefined) config.refVideoModel = cfg.refVideoModel;

  try {
    const saved = localStorage.getItem(SETTINGS_KEY);
    let parsed = saved ? JSON.parse(saved) : {};
    if (!parsed.apiProviders) parsed.apiProviders = {};
    if (!parsed.apiProviders.dashscope) parsed.apiProviders.dashscope = {};
    if (cfg.apiKey !== undefined) parsed.apiProviders.dashscope.apiKey = cfg.apiKey;
    if (!parsed.models) parsed.models = {};
    if (cfg.imageModel !== undefined) parsed.models.image = { name: cfg.imageModel };
    if (cfg.videoModel !== undefined) parsed.models.video = { name: cfg.videoModel };
    if (cfg.refVideoModel !== undefined) parsed.models.refVideo = { name: cfg.refVideoModel };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(parsed));
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
        size: computeImageSize(state.aspectRatio, state.resolution || DEFAULT_RESOLUTION),
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
