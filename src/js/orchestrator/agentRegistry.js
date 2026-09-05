const registry = new Map();

export function registerAgent(stepId, agent) {
  registry.set(stepId, agent);
}

export function resolveAgent(stepId) {
  return registry.get(stepId) ?? null;
}

export function hasAgent(stepId) {
  return registry.has(stepId);
}

export function listRegisteredAgents() {
  return [...registry.entries()].map(([stepId, agent]) => ({
    stepId,
    agentName: agent?.name ?? 'unnamed',
  }));
}

export function clearRegistry() {
  registry.clear();
}
