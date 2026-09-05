import { registerProvider, getActiveProvider, setActiveProvider, listAllProviders } from './registry.js';
import { buildMessages } from './prompts.js';
import { t } from '../i18n.js';
import { addAgentMessage } from '../ui/render.js';

const CFG_KEY = 'cine-cutie-llm';

let config = { endpoint: '', apiKey: '', model: '', jsonMode: true, useProxy: false };

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
  if (config.apiKey) {
    setActiveProvider('text', 'llm');
  } else {
    setActiveProvider('text', 'template');
  }
}

function isConfigured() {
  return !!(config.apiKey && config.model);
}

function getConfig() {
  return { ...config };
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
    model: config.model,
    messages,
    temperature: 0.8
  };
  if (config.jsonMode && !retryWithoutJsonFormat) {
    body.response_format = { type: 'json_object' };
  }

  try {
    let url, headers;

    if (config.useProxy) {
      url = '/api/chat/completions';
      headers = {
        'Content-Type': 'application/json',
        'X-Target-Endpoint': config.endpoint || 'https://api.openai.com/v1',
        'X-Api-Key': config.apiKey
      };
    } else {
      const endpoint = (config.endpoint || 'https://api.openai.com/v1').replace(/\/+$/, '');
      url = `${endpoint}/chat/completions`;
      headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`
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
  if (!config.apiKey) return { ok: false, error: 'No API key configured' };
  if (!config.model) return { ok: false, error: 'No model specified' };

  try {
    const endpoint = (config.endpoint || 'https://api.openai.com/v1').replace(/\/+$/, '');
    const url = `${endpoint}/chat/completions`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: config.model,
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
        return { ok: false, error: `Model not found: ${config.model}` };
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

export { saveConfig, getConfig, isConfigured, testConnection, loadConfig, consumeStepMetrics, chat };
