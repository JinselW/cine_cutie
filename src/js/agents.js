import { STEPS, dataKeyOf } from './config.js';
import { state } from './state.js';
import { getActiveProvider } from './providers/registry.js';
import { extractEntities, mergeEntities, buildConsistencyConstraints } from './providers/consistency.js';
import { logStepStart, logStepComplete, updateStepMetrics } from './observability.js';
import { consumeStepMetrics } from './providers/llm.js';

function buildContext(stepId) {
  const step = STEPS.find(s => s.id === stepId);
  const keys = step?.contextKeys || [];
  const d = state.data;
  const constraints = buildConsistencyConstraints(state.entities);

  const ctx = { userInput: state.userInput, genre: state.genre, media: state.media, constraints };
  for (const key of keys) {
    if (d[key] != null) ctx[key] = d[key];
  }
  return ctx;
}

export async function runAgent(stepId, feedback = '') {
  const step = STEPS.find(s => s.id === stepId);
  if (!step) throw new Error(`Unknown step: ${stepId}`);

  const provider = getActiveProvider(step.capability);
  if (!provider) throw new Error(`No provider for capability: ${step.capability}`);

  logStepStart(stepId, step.agent || 'Agent');

  const ctx = { ...buildContext(stepId), feedback };
  if (feedback) {
    ctx.previousResult = state.data[dataKeyOf(step)];
  }

  const result = await provider.generate({
    step: stepId,
    genre: state.genre,
    context: ctx
  });

  const metrics = consumeStepMetrics();
  updateStepMetrics(metrics);
  logStepComplete();

  const newEntities = extractEntities(stepId, result);
  if (newEntities) {
    state.entities = mergeEntities(state.entities, newEntities);
  }

  return result;
}

export function getAgentName(stepId) {
  const step = STEPS.find(s => s.id === stepId);
  return step?.agent || 'Agent';
}
