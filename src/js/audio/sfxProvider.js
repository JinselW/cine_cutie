/**
 * SFX provider — generates sound effects and ambience from prompts.
 *
 * Default: mock provider that returns degraded results (no real SFX).
 * Real providers can be registered via registerAudioProvider.
 *
 * An SFX provider must implement:
 *   generate({ prompt, duration, signal }) →
 *     { audioPath, duration, lineage, degraded?, error? }
 */

import { registerAudioProvider, degradeResult, getAudioProvider } from './audioRegistry.js';

const mockSfxProvider = {
  id: 'mock-sfx',
  name: 'Mock SFX (no-op)',
  capability: 'sfx',

  async generate({ prompt, duration, signal } = {}) {
    if (!prompt || !prompt.trim()) {
      return degradeResult('sfx', 'Empty prompt');
    }
    if (signal?.aborted) {
      return degradeResult('sfx', 'Cancelled');
    }
    return degradeResult('sfx', 'No SFX provider configured');
  },
};

registerAudioProvider(mockSfxProvider);

export function isSfxConfigured() {
  const provider = getAudioProvider('sfx');
  return provider && provider.id !== 'mock-sfx';
}
