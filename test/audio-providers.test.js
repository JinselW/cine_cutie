import test from 'node:test';
import assert from 'node:assert/strict';
import { registerAudioProvider, getAudioProvider, getAudioProviders, listAudioProviders, degradeResult } from '../src/js/audio/audioRegistry.js';
import { isTtsConfigured } from '../src/js/audio/ttsProvider.js';
import { isSfxConfigured } from '../src/js/audio/sfxProvider.js';

test('mock TTS provider is registered by default', () => {
  const providers = getAudioProviders('tts');
  assert.ok(providers.length >= 1);
  assert.ok(providers.some(p => p.id === 'mock-tts'));
});

test('mock SFX provider is registered by default', () => {
  const providers = getAudioProviders('sfx');
  assert.ok(providers.length >= 1);
  assert.ok(providers.some(p => p.id === 'mock-sfx'));
});

test('isTtsConfigured returns false for mock provider', () => {
  assert.equal(isTtsConfigured(), false);
});

test('isSfxConfigured returns false for mock provider', () => {
  assert.equal(isSfxConfigured(), false);
});

test('mock TTS degrades with reason on empty text', async () => {
  const provider = getAudioProvider('tts');
  const result = await provider.generate({ text: '' });
  assert.equal(result.degraded, true);
  assert.equal(result.audioPath, null);
  assert.equal(result.fallbackReason, 'Empty text');
});

test('mock TTS degrades with reason on valid text', async () => {
  const provider = getAudioProvider('tts');
  const result = await provider.generate({ text: 'Hello world' });
  assert.equal(result.degraded, true);
  assert.equal(result.fallbackReason, 'No TTS provider configured');
});

test('mock TTS degrades on cancelled signal', async () => {
  const provider = getAudioProvider('tts');
  const controller = new AbortController();
  controller.abort();
  const result = await provider.generate({ text: 'Hello', signal: controller.signal });
  assert.equal(result.degraded, true);
  assert.equal(result.fallbackReason, 'Cancelled');
});

test('mock SFX degrades with reason on empty prompt', async () => {
  const provider = getAudioProvider('sfx');
  const result = await provider.generate({ prompt: '' });
  assert.equal(result.degraded, true);
  assert.equal(result.fallbackReason, 'Empty prompt');
});

test('mock SFX degrades with reason on valid prompt', async () => {
  const provider = getAudioProvider('sfx');
  const result = await provider.generate({ prompt: 'rain falling' });
  assert.equal(result.degraded, true);
  assert.equal(result.fallbackReason, 'No SFX provider configured');
});

test('degradeResult returns standard structure with lineage', () => {
  const result = degradeResult('tts', 'test reason');
  assert.equal(result.degraded, true);
  assert.equal(result.audioPath, null);
  assert.equal(result.duration, 0);
  assert.equal(result.fallbackReason, 'test reason');
  assert.ok(result.lineage);
  assert.equal(result.lineage.provider, 'tts');
  assert.equal(result.lineage.fallbackReason, 'test reason');
  assert.ok(result.lineage.startTime);
});

test('registerAudioProvider rejects provider without id', () => {
  assert.throws(() => registerAudioProvider({ capability: 'tts' }), /must have id and capability/);
});

test('registerAudioProvider rejects provider without capability', () => {
  assert.throws(() => registerAudioProvider({ id: 'test' }), /must have id and capability/);
});

test('custom provider can be registered and retrieved', async () => {
  const custom = {
    id: 'test-tts',
    name: 'Test TTS',
    capability: 'tts',
    async generate() { return { audioPath: '/test.m4a', duration: 5, degraded: false, lineage: {} }; },
  };
  registerAudioProvider(custom);
  const all = getAudioProviders('tts');
  assert.ok(all.some(p => p.id === 'test-tts'));
  const allProviders = listAudioProviders();
  assert.ok(allProviders.some(p => p.id === 'test-tts'));
});
