/**
 * TTS provider — generates speech audio from text.
 *
 * Default: mock provider that returns degraded results (no real TTS).
 * Real providers can be registered via registerAudioProvider.
 *
 * A TTS provider must implement:
 *   generate({ text, voiceProfile, speakerId, lang, signal }) →
 *     { audioPath, duration, lineage, degraded?, error? }
 */

import { registerAudioProvider, degradeResult, getAudioProvider } from './audioRegistry.js';

const mockTtsProvider = {
  id: 'mock-tts',
  name: 'Mock TTS (no-op)',
  capability: 'tts',

  async generate({ text, voiceProfile, speakerId, lang, signal } = {}) {
    if (!text || !text.trim()) {
      return degradeResult('tts', 'Empty text');
    }
    if (signal?.aborted) {
      return degradeResult('tts', 'Cancelled');
    }
    return degradeResult('tts', 'No TTS provider configured');
  },
};

registerAudioProvider(mockTtsProvider);

export function isTtsConfigured() {
  const provider = getAudioProvider('tts');
  return provider && provider.id !== 'mock-tts';
}
