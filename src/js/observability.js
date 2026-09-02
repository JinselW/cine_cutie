import { STEPS } from './config.js';

const executionLog = [];
let currentEntry = null;

export function logStepStart(stepId, agentName) {
  currentEntry = {
    stepId,
    agentName,
    startTime: Date.now(),
    duration: 0,
    tokens: { prompt: 0, completion: 0 },
    qualityScore: null,
    retryCount: 0,
    fallbackUsed: false
  };
}

export function logStepComplete() {
  if (!currentEntry) return;
  currentEntry.duration = Math.round((Date.now() - currentEntry.startTime) / 100) / 10;
  executionLog.push({ ...currentEntry });
  currentEntry = null;
}

export function updateStepMetrics(metrics) {
  if (!currentEntry) return;
  if (metrics.tokens) {
    currentEntry.tokens.prompt += metrics.tokens.prompt || 0;
    currentEntry.tokens.completion += metrics.tokens.completion || 0;
  }
  if (metrics.qualityScore != null) currentEntry.qualityScore = metrics.qualityScore;
  if (metrics.retryCount != null) currentEntry.retryCount = metrics.retryCount;
  if (metrics.fallbackUsed) currentEntry.fallbackUsed = true;
}

export function getExecutionLog() {
  return executionLog;
}

export function resetLog() {
  executionLog.length = 0;
  currentEntry = null;
}

export function getTotalTokens() {
  return executionLog.reduce(
    (acc, e) => ({ prompt: acc.prompt + e.tokens.prompt, completion: acc.completion + e.tokens.completion }),
    { prompt: 0, completion: 0 }
  );
}

export function getAverageQuality() {
  const scored = executionLog.filter(e => e.qualityScore != null);
  if (scored.length === 0) return null;
  return Math.round(scored.reduce((s, e) => s + e.qualityScore, 0) / scored.length * 10) / 10;
}
