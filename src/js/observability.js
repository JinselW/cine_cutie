import { ArtifactStatus } from './artifacts/artifactTypes.js';

let _store = null;
let currentEntry = null;

export function initObservability(store) {
  _store = store;
}

export function logStepStart(stepId, agentName) {
  currentEntry = {
    stepId,
    agentName,
    startTime: Date.now(),
    tokens: { prompt: 0, completion: 0 },
    qualityScore: null,
    retryCount: 0,
    fallbackUsed: false,
  };
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

export function logStepComplete() {
  currentEntry = null;
}

export function getExecutionLog() {
  if (!_store) return [];
  return _store.listAll()
    .filter(a => a.status !== ArtifactStatus.STALE && a.status !== ArtifactStatus.SUPERSEDED)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map(a => ({
      stepId: a.stepId,
      agentName: a.provenance?.agent || 'Agent',
      startTime: a.createdAt,
      duration: Math.round((a.updatedAt - a.createdAt) / 100) / 10,
      tokens: a.metrics?.tokens || { prompt: 0, completion: 0 },
      qualityScore: a.metrics?.qualityScore ?? null,
      retryCount: a.metrics?.retries ?? 0,
      fallbackUsed: a.metrics?.fallbackUsed ?? false,
    }));
}

export function resetLog() {
  currentEntry = null;
}

export function getTotalTokens() {
  const log = getExecutionLog();
  return log.reduce(
    (acc, e) => ({ prompt: acc.prompt + (e.tokens.prompt || 0), completion: acc.completion + (e.tokens.completion || 0) }),
    { prompt: 0, completion: 0 },
  );
}

export function getAverageQuality() {
  const log = getExecutionLog();
  const scored = log.filter(e => e.qualityScore != null);
  if (scored.length === 0) return null;
  return Math.round(scored.reduce((s, e) => s + e.qualityScore, 0) / scored.length * 10) / 10;
}
