import { registerProvider, getActiveProvider, setActiveProvider, listAllProviders } from './registry.js';
import { buildMessages } from './prompts.js';
import { critiqueOutput, shouldRetry, buildRetryFeedback, reportScore, reportRetry, MAX_RETRIES } from './critic.js';
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
let stepRetries = 0;
let stepFallback = false;

function resetStepMetrics() {
  stepUsage = { prompt: 0, completion: 0 };
  stepRetries = 0;
  stepFallback = false;
}

function consumeStepMetrics() {
  const m = { tokens: { ...stepUsage }, retries: stepRetries, fallbackUsed: stepFallback };
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

async function callChat(messages, { retryWithoutJsonFormat = false } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000);

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
          return callChat(messages, { retryWithoutJsonFormat: true });
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
    return content;
  } catch (err) {
    clearTimeout(timeout);
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
    case 'planning':
      return data.theme && data.keyElements && Array.isArray(data.keyElements);
    case 'screenplay':
      return data.title && data.acts && Array.isArray(data.acts) && data.acts.length >= 2;
    case 'characters':
      return Array.isArray(data) && data.length >= 2 && data[0].name;
    case 'visualDesign':
      return data.style && Array.isArray(data.palette) && data.palette.length >= 4;
    case 'storyboard':
      return Array.isArray(data) && data.length >= 3 && data[0].num != null;
    case 'shotGen':
      return typeof data === 'object' && !Array.isArray(data) && Object.keys(data).length >= 1;
    case 'shotCuration':
      return typeof data === 'object' && !Array.isArray(data);
    case 'editing':
      return data.clips && Array.isArray(data.clips) && data.clips.length >= 1;
    case 'audio':
      return data.music && Array.isArray(data.sceneAudio);
    case 'postProduction':
      return data.colorGrading && Array.isArray(data.vfx);
    case 'final':
      return data.title && data.status;
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

function buildFinalFilmLocal(context) {
  return {
    title: context.screenplay?.title || 'Untitled Film',
    genre: context.screenplay?.genre || 'Unknown',
    runtime: context.editTimeline?.totalDuration || 'N/A',
    scenes: context.storyboard?.length || 0,
    status: 'Complete'
  };
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

    if (step === 'final') {
      return buildFinalFilmLocal(context);
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

    let currentResult = parsed;
    let bestResult = parsed;
    let bestScore = -1;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const critique = await critiqueOutput(step, currentResult, context, callChat);

      if (!critique) break;

      reportScore(step, critique.score, '⭐');

      if (critique.score > bestScore) {
        bestScore = critique.score;
        bestResult = currentResult;
      }

      if (!shouldRetry(critique) || attempt === MAX_RETRIES) break;

      reportRetry(step, critique.score, attempt + 1, '⭐');
      stepRetries++;

      const feedbackMessages = [
        ...messages,
        { role: 'assistant', content: JSON.stringify(currentResult) },
        { role: 'user', content: buildRetryFeedback(critique) }
      ];

      try {
        const retryRaw = await callChat(feedbackMessages);
        const retryParsed = parseJson(retryRaw);
        if (validate(step, retryParsed)) {
          currentResult = retryParsed;
        } else {
          break;
        }
      } catch {
        break;
      }
    }

    return bestResult;
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

export { saveConfig, getConfig, isConfigured, testConnection, loadConfig, consumeStepMetrics };
