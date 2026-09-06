import { registerProvider, getActiveProvider, setActiveProvider, listAllProviders } from './registry.js';
import { buildMessages } from './prompts.js';
import { t } from '../i18n.js';
import { addAgentMessage } from '../ui/render.js';

const SETTINGS_KEY = 'cine-cutie-settings';
const OLD_LLM_KEY = 'cine-cutie-llm';
const OLD_DS_KEY = 'cine-cutie-dashscope';

const PROVIDER_DEFAULTS = {
  openai:    { endpoint: 'https://api.openai.com/v1', apiKey: '' },
  deepseek:  { endpoint: 'https://api.deepseek.com/v1', apiKey: '' },
  dashscope: { endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1', apiKey: '' },
  ark:       { endpoint: 'https://ark.cn-beijing.volces.com/api/v3', apiKey: '' },
  kling:     { endpoint: 'https://api.klingai.com', apiKey: '' },
  gemini:    { endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai', apiKey: '' },
};

const MODEL_PRESETS = {
  openai:    ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
  deepseek:  ['deepseek-chat', 'deepseek-reasoner'],
  dashscope: ['qwen-plus', 'qwen-turbo', 'qwen-max', 'qwen-vl-max'],
  ark:       ['doubao-pro-32k', 'doubao-lite-32k'],
  gemini:    ['gemini-2.0-flash', 'gemini-1.5-pro'],
};

const IMAGE_PRESETS = ['wanx2.1-t2i-turbo', 'wanx2.1-t2i-plus'];
const VIDEO_PRESETS = ['wanx2.1-i2v-plus', 'wan2.7-i2v'];
const REF_VIDEO_PRESETS = ['wan2.7-r2v'];

let config = {
  apiProviders: structuredClone(PROVIDER_DEFAULTS),
  models: {
    text: { provider: 'dashscope', name: 'qwen-plus' },
    image: { name: 'wanx2.1-t2i-turbo' },
    video: { name: 'wanx2.1-i2v-plus' },
    refVideo: { name: 'wan2.7-r2v' },
  },
  jsonMode: true,
  useProxy: false,
};

function inferProvider(modelName) {
  if (!modelName) return null;
  if (/gpt|o1|o3/i.test(modelName)) return 'openai';
  if (/deepseek/i.test(modelName)) return 'deepseek';
  if (/qwen/i.test(modelName)) return 'dashscope';
  if (/doubao/i.test(modelName)) return 'ark';
  if (/gemini/i.test(modelName)) return 'gemini';
  return null;
}

function migrateOldConfig() {
  const oldLlm = localStorage.getItem(OLD_LLM_KEY);
  const oldDs = localStorage.getItem(OLD_DS_KEY);
  if (!oldLlm && !oldDs) return null;

  const newCfg = {
    apiProviders: structuredClone(PROVIDER_DEFAULTS),
    models: {
      text: { provider: 'dashscope', name: '' },
      image: { name: 'wanx2.1-t2i-turbo' },
      video: { name: 'wanx2.1-i2v-plus' },
      refVideo: { name: 'wan2.7-r2v' },
    },
    jsonMode: true,
    useProxy: false,
  };

  if (oldLlm) {
    try {
      const old = JSON.parse(oldLlm);
      const provider = inferProvider(old.model) || 'dashscope';
      if (old.endpoint) newCfg.apiProviders[provider].endpoint = old.endpoint;
      if (old.apiKey) newCfg.apiProviders[provider].apiKey = old.apiKey;
      if (old.model) newCfg.models.text = { provider, name: old.model };
      newCfg.jsonMode = old.jsonMode ?? true;
      newCfg.useProxy = old.useProxy ?? false;
    } catch {}
  }

  if (oldDs) {
    try {
      const old = JSON.parse(oldDs);
      if (old.apiKey) newCfg.apiProviders.dashscope.apiKey = old.apiKey;
      if (old.imageModel) newCfg.models.image = { name: old.imageModel };
      if (old.videoModel) newCfg.models.video = { name: old.videoModel };
    } catch {}
  }

  return newCfg;
}

function loadConfig() {
  try {
    const saved = localStorage.getItem(SETTINGS_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      config = {
        apiProviders: { ...structuredClone(PROVIDER_DEFAULTS), ...parsed.apiProviders },
        models: {
          text: parsed.models?.text || { provider: 'dashscope', name: '' },
          image: parsed.models?.image || { name: 'wanx2.1-t2i-turbo' },
          video: parsed.models?.video || { name: 'wanx2.1-i2v-plus' },
          refVideo: parsed.models?.refVideo || { name: 'wan2.7-r2v' },
        },
        jsonMode: parsed.jsonMode ?? true,
        useProxy: parsed.useProxy ?? false,
      };
      for (const key of Object.keys(PROVIDER_DEFAULTS)) {
        config.apiProviders[key] = { ...PROVIDER_DEFAULTS[key], ...(parsed.apiProviders?.[key] || {}) };
      }
    } else {
      const migrated = migrateOldConfig();
      if (migrated) {
        config = migrated;
        saveConfig(config);
      }
    }
  } catch {}
}

function saveConfig(cfg) {
  if (cfg.apiProviders) {
    for (const key of Object.keys(PROVIDER_DEFAULTS)) {
      if (cfg.apiProviders[key]) {
        config.apiProviders[key] = { ...config.apiProviders[key], ...cfg.apiProviders[key] };
      }
    }
  }
  if (cfg.models) {
    for (const k of Object.keys(cfg.models)) {
      config.models[k] = { ...config.models[k], ...cfg.models[k] };
    }
  }
  if (cfg.jsonMode !== undefined) config.jsonMode = cfg.jsonMode;
  if (cfg.useProxy !== undefined) config.useProxy = cfg.useProxy;

  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      apiProviders: config.apiProviders,
      models: config.models,
      jsonMode: config.jsonMode,
      useProxy: config.useProxy,
    }));
  } catch {}

  if (isConfigured()) {
    setActiveProvider('text', 'llm');
  } else {
    setActiveProvider('text', 'template');
  }
}

function isConfigured() {
  const { provider, name } = config.models.text;
  return !!(name && config.apiProviders[provider]?.apiKey);
}

function getConfig() {
  return {
    apiProviders: structuredClone(config.apiProviders),
    models: structuredClone(config.models),
    jsonMode: config.jsonMode,
    useProxy: config.useProxy,
  };
}

function getTextProviderEndpoint() {
  const provider = config.models.text.provider;
  return (config.apiProviders[provider]?.endpoint || PROVIDER_DEFAULTS[provider]?.endpoint || '').replace(/\/+$/, '');
}

function getTextProviderApiKey() {
  const provider = config.models.text.provider;
  return config.apiProviders[provider]?.apiKey || '';
}

loadConfig();

let stepUsage = { prompt: 0, completion: 0 };
let stepFallback = false;

function resetStepMetrics() {
  stepUsage = { prompt: 0, completion: 0 };
  stepFallback = false;
}

function consumeStepMetrics() {
  const m = { tokens: { ...stepUsage }, retries: 0, fallbackUsed: stepFallback };
  resetStepMetrics();
  return m;
}

class LLMError extends Error {
  constructor(i18nKey, detail) {
    super(i18nKey);
    this.i18nKey = i18nKey;
    this.detail = detail;
  }
}

async function callChat(messages, { retryWithoutJsonFormat = false, signal: externalSignal } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000);

  let onExternalAbort;
  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timeout);
      controller.abort();
    } else {
      onExternalAbort = () => controller.abort();
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

  const body = {
    model: config.models.text.name,
    messages,
    temperature: 0.8
  };
  if (config.jsonMode && !retryWithoutJsonFormat) {
    body.response_format = { type: 'json_object' };
  }

  const endpoint = getTextProviderEndpoint();
  const apiKey = getTextProviderApiKey();

  try {
    let url, headers;

    if (config.useProxy) {
      url = '/api/chat/completions';
      headers = {
        'Content-Type': 'application/json',
        'X-Target-Endpoint': endpoint || 'https://api.openai.com/v1',
        'X-Api-Key': apiKey
      };
    } else {
      url = `${endpoint}/chat/completions`;
      headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      };
    }

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      if (res.status === 401 || res.status === 403) {
        throw new LLMError('llm.errAuth', `${res.status}: ${text.substring(0, 200)}`);
      }
      if (res.status === 429) {
        throw new LLMError('llm.errRateLimit', text.substring(0, 200));
      }
      if (res.status === 400 && text.includes('response_format')) {
        if (!retryWithoutJsonFormat) {
          return callChat(messages, { retryWithoutJsonFormat: true, signal: externalSignal });
        }
      }
      throw new LLMError('llm.errHttp', `${res.status}: ${text.substring(0, 200)}`);
    }

    const data = await res.json();
    if (data.usage) {
      stepUsage.prompt += data.usage.prompt_tokens || 0;
      stepUsage.completion += data.usage.completion_tokens || 0;
    }
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new LLMError('llm.errParse', 'Empty response from model');
    }
    if (onExternalAbort && externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
    return content;
  } catch (err) {
    clearTimeout(timeout);
    if (onExternalAbort && externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
    if (err instanceof LLMError) throw err;
    if (err.name === 'AbortError') {
      throw new LLMError('llm.errTimeout', '90s');
    }
    throw new LLMError('llm.errNetwork', err.message);
  }
}

function parseJson(raw) {
  let text = raw.trim();
  text = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
  text = text.trim();

  try {
    return JSON.parse(text);
  } catch {
    const firstBrace = text.indexOf('{');
    const firstBracket = text.indexOf('[');
    let start = -1;
    let endChar;
    if (firstBrace >= 0 && (firstBracket < 0 || firstBrace < firstBracket)) {
      start = firstBrace;
      endChar = '}';
    } else if (firstBracket >= 0) {
      start = firstBracket;
      endChar = ']';
    }
    if (start >= 0) {
      const end = text.lastIndexOf(endChar);
      if (end > start) {
        try {
          return JSON.parse(text.substring(start, end + 1));
        } catch {}
      }
    }
    throw new LLMError('llm.errParse', text.substring(0, 200));
  }
}

function validate(stepId, data) {
  if (data == null) return false;
  switch (stepId) {
    case 'script':
      return data.title
        && Array.isArray(data.characters) && data.characters.length >= 1
        && Array.isArray(data.episodes) && data.episodes.length >= 1;
    case 'storyboard':
      return Array.isArray(data.episodes) && data.episodes.length >= 1
        && data.episodes[0].segments
        && data.episodes[0].segments[0]?.shots
        && data.episodes[0].segments[0].shots.length >= 1;
    default:
      return true;
  }
}

function getTemplateProvider() {
  return listAllProviders().find(p => p.id === 'template');
}

async function fallbackToTemplate(stepId, genre, context, reason) {
  stepFallback = true;
  const tpl = getTemplateProvider();
  if (tpl) {
    const result = await tpl.generate({ step: stepId, genre, context });
    addAgentMessage('⚠️', t('llm.fellBack', { reason: t(reason?.i18nKey || 'llm.errNetwork') }));
    return result;
  }
  throw reason;
}

const llmProvider = {
  id: 'llm',
  name: 'OpenAI-compatible API',
  capabilities: ['text'],

  async generate({ step, genre, context }) {
    if (!isConfigured()) {
      const tpl = getTemplateProvider();
      if (tpl) return tpl.generate({ step, genre, context });
      return null;
    }

    resetStepMetrics();

    const messages = buildMessages(step, context);
    if (!messages) {
      const tpl = getTemplateProvider();
      if (tpl) return tpl.generate({ step, genre, context });
      return null;
    }

    let raw;
    let parsed;
    try {
      raw = await callChat(messages);
      parsed = parseJson(raw);
    } catch (err) {
      if (err instanceof LLMError && err.i18nKey === 'llm.errParse') {
        try {
          const retryMessages = [
            ...messages,
            { role: 'assistant', content: raw || '' },
            { role: 'user', content: 'Your last reply was not valid JSON. Please reply again with ONLY the JSON object/array. No markdown, no code fences, no commentary.' }
          ];
          const retryRaw = await callChat(retryMessages);
          parsed = parseJson(retryRaw);
        } catch (retryErr) {
          return fallbackToTemplate(step, genre, context, retryErr);
        }
      } else {
        return fallbackToTemplate(step, genre, context, err);
      }
    }

    if (!validate(step, parsed)) {
      return fallbackToTemplate(step, genre, context, new LLMError('llm.errSchema', `Validation failed for step ${step}`));
    }

    return parsed;
  }
};

registerProvider(llmProvider);

async function testConnection() {
  const apiKey = getTextProviderApiKey();
  const model = config.models.text.name;
  if (!apiKey) return { ok: false, error: 'No API key configured' };
  if (!model) return { ok: false, error: 'No model specified' };

  try {
    const endpoint = getTextProviderEndpoint();
    const url = `${endpoint}/chat/completions`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Reply with the word OK' }],
        max_tokens: 5
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      if (res.status === 401 || res.status === 403) {
        return { ok: false, error: `Authentication failed (${res.status})` };
      }
      if (res.status === 404) {
        return { ok: false, error: `Model not found: ${model}` };
      }
      return { ok: false, error: `HTTP ${res.status}: ${text.substring(0, 200)}` };
    }

    return { ok: true };
  } catch (err) {
    if (err.name === 'AbortError') {
      return { ok: false, error: 'Connection timed out (15s)' };
    }
    return { ok: false, error: `Network error: ${err.message}` };
  }
}

if (isConfigured()) {
  setActiveProvider('text', 'llm');
}

async function chat(messages, { signal, retryWithoutJsonFormat } = {}) {
  return callChat(messages, { signal, retryWithoutJsonFormat });
}

export {
  saveConfig, getConfig, isConfigured, testConnection, loadConfig,
  consumeStepMetrics, chat,
  MODEL_PRESETS, IMAGE_PRESETS, VIDEO_PRESETS, REF_VIDEO_PRESETS,
  PROVIDER_DEFAULTS, inferProvider,
};
