import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.join(directory, '..', 'config', 'inference-profiles.json');

export function loadInferenceProfiles() {
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

export function resolveInferenceProfile(name = process.env.CINE_INFERENCE_PROFILE) {
  const config = loadInferenceProfiles();
  const selected = name && config.profiles[name] ? name : config.defaultProfile;
  return { name: selected, ...config.profiles[selected] };
}

export function resolveInferenceOptions(request = {}, profileName) {
  const profile = resolveInferenceProfile(profileName);
  const requestedMp = Number(request.megapixels);
  return {
    profile: profile.name,
    enableLightning: typeof request.enableLightning === 'boolean' ? request.enableLightning : profile.enableLightning,
    megapixels: Number.isFinite(requestedMp) ? Math.min(2, Math.max(0.1, requestedMp)) : profile.megapixels,
    maxConcurrentGpuJobs: profile.maxConcurrentGpuJobs,
  };
}
