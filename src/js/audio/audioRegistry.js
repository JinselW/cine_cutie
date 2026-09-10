/**
 * Audio provider registry — manages TTS and SFX providers with pluggable
 * backends. When no provider is configured, operations degrade gracefully:
 * TTS returns degraded:true with no audio path, SFX returns degraded:true.
 *
 * Providers are registered by capability ('tts' | 'sfx').
 * Each provider must implement:
 *   generate({ ... }) → { audioPath, duration, lineage, degraded?, error? }
 */

const providers = {};
let activeProviders = {};

const STORAGE_KEY = 'cine-cutie-audio-providers';

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

if (typeof localStorage !== 'undefined') loadPreferences();

export function registerAudioProvider(provider) {
  if (!provider?.id || !provider?.capability) {
    throw new Error('Audio provider must have id and capability');
  }
  const key = `${provider.capability}:${provider.id}`;
  providers[key] = provider;
}

export function getAudioProvider(capability) {
  const id = activeProviders[capability];
  if (id) {
    const p = providers[`${capability}:${id}`];
    if (p) return p;
  }
  const all = getAudioProviders(capability);
  return all[0] || null;
}

export function getAudioProviders(capability) {
  return Object.values(providers).filter(p => p.capability === capability);
}

export function setActiveAudioProvider(capability, id) {
  activeProviders[capability] = id;
  savePreferences();
}

export function listAudioProviders() {
  return Object.values(providers);
}

export function degradeResult(capability, reason) {
  return {
    audioPath: null,
    duration: 0,
    degraded: true,
    fallbackReason: reason,
    lineage: {
      provider: capability,
      model: null,
      modelVersion: null,
      prompt: null,
      text: null,
      speakerId: null,
      voiceProfile: null,
      seed: null,
      inputHash: null,
      outputHash: null,
      taskId: null,
      startTime: new Date().toISOString(),
      endTime: new Date().toISOString(),
      fallbackReason: reason,
    },
  };
}
