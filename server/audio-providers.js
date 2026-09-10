const providers = new Map();
const activeProviders = new Map();

export function registerAudioProvider(provider) {
  if (!provider?.id || !provider?.capability) {
    throw new Error('Audio provider requires id and capability');
  }
  if (provider.capability !== 'tts' && provider.capability !== 'sfx') {
    throw new Error(`Unknown audio capability: ${provider.capability}`);
  }
  const key = `${provider.capability}:${provider.id}`;
  providers.set(key, provider);
  // First provider registered for a capability becomes the default active one.
  if (!activeProviders.has(provider.capability)) {
    activeProviders.set(provider.capability, provider);
  }
  return provider;
}

export function getAudioProvider(capability, id) {
  if (id) return providers.get(`${capability}:${id}`) || null;
  return activeProviders.get(capability) || null;
}

export function getAudioProviders(capability) {
  const result = [];
  for (const [key, provider] of providers) {
    if (key.startsWith(`${capability}:`)) result.push(provider);
  }
  return result;
}

export function setActiveAudioProvider(capability, id) {
  const provider = providers.get(`${capability}:${id}`);
  if (!provider) throw new Error(`Audio provider not found: ${capability}:${id}`);
  activeProviders.set(capability, provider);
  return provider;
}

export function listAudioProviders() {
  const result = { tts: [], sfx: [] };
  for (const provider of providers.values()) {
    if (result[provider.capability]) result[provider.capability].push(provider);
  }
  for (const capability of ['tts', 'sfx']) {
    const active = activeProviders.get(capability);
    if (active) result[capability] = result[capability].map(p => ({ ...p, active: p.id === active.id }));
  }
  return result;
}

export function clearAudioProviders() {
  providers.clear();
  activeProviders.clear();
}
