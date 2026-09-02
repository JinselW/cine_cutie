const providers = {};
let activeProviders = {};

const STORAGE_KEY = 'cine-cutie-providers';

function loadPreferences() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) activeProviders = JSON.parse(saved);
  } catch {}
}

function savePreferences() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(activeProviders));
  } catch {}
}

loadPreferences();

export function registerProvider(provider) {
  providers[provider.id] = provider;
}

export function getProviders(capability) {
  return Object.values(providers).filter(p => p.capabilities.includes(capability));
}

export function getActiveProvider(capability) {
  const id = activeProviders[capability];
  if (id && providers[id]) return providers[id];
  const available = getProviders(capability);
  return available[0] || null;
}

export function setActiveProvider(capability, id) {
  activeProviders[capability] = id;
  savePreferences();
}

export function listAllProviders() {
  return Object.values(providers);
}
