import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAudioLineageEntry } from '../server/audio-mix.js';
import { degradeResult } from '../src/js/audio/audioRegistry.js';

test('buildAudioLineageEntry: returns all fields with correct values', () => {
  const entry = buildAudioLineageEntry({
    type: 'tts',
    provider: 'elevenlabs',
    model: 'eleven_multilingual_v2',
    modelVersion: 'v2.1',
    text: 'Hello world',
    speakerId: 'char-hero',
    voiceProfile: 'char-hero',
    seed: 42,
    inputHash: 'abc123',
    outputHash: 'def456',
    taskId: 'task-1',
    startTime: '2026-09-10T00:00:00Z',
    endTime: '2026-09-10T00:00:05Z',
    fallbackReason: null,
  });

  assert.equal(entry.provider, 'elevenlabs');
  assert.equal(entry.model, 'eleven_multilingual_v2');
  assert.equal(entry.modelVersion, 'v2.1');
  assert.equal(entry.text, 'Hello world');
  assert.equal(entry.prompt, null);
  assert.equal(entry.speakerId, 'char-hero');
  assert.equal(entry.voiceProfile, 'char-hero');
  assert.equal(entry.seed, 42);
  assert.equal(entry.inputHash, 'abc123');
  assert.equal(entry.outputHash, 'def456');
  assert.equal(entry.taskId, 'task-1');
  assert.equal(entry.startTime, '2026-09-10T00:00:00Z');
  assert.equal(entry.endTime, '2026-09-10T00:00:05Z');
  assert.equal(entry.fallbackReason, null);
});

test('buildAudioLineageEntry: defaults missing fields to null', () => {
  const entry = buildAudioLineageEntry({});
  assert.equal(entry.provider, null);
  assert.equal(entry.model, null);
  assert.equal(entry.modelVersion, null);
  assert.equal(entry.prompt, null);
  assert.equal(entry.text, null);
  assert.equal(entry.speakerId, null);
  assert.equal(entry.voiceProfile, null);
  assert.equal(entry.seed, null);
  assert.equal(entry.inputHash, null);
  assert.equal(entry.outputHash, null);
  assert.equal(entry.taskId, null);
  assert.equal(entry.startTime, null);
  assert.equal(entry.endTime, null);
  assert.equal(entry.fallbackReason, null);
});

test('buildAudioLineageEntry: preserves seed=0 (not coerced to null)', () => {
  const entry = buildAudioLineageEntry({ seed: 0 });
  assert.equal(entry.seed, 0);
});

test('buildAudioLineageEntry: SFX type includes prompt not text', () => {
  const entry = buildAudioLineageEntry({
    type: 'sfx',
    provider: 'mock-sfx',
    prompt: 'Rain on tin roof',
  });
  assert.equal(entry.prompt, 'Rain on tin roof');
  assert.equal(entry.text, null);
});

test('degradeResult (audioRegistry): lineage has all required fields', () => {
  const result = degradeResult('tts', 'No provider configured');
  const lin = result.lineage;
  assert.ok(lin);
  assert.equal(lin.provider, 'tts');
  assert.equal(lin.model, null);
  assert.equal(lin.modelVersion, null);
  assert.equal(lin.prompt, null);
  assert.equal(lin.text, null);
  assert.equal(lin.speakerId, null);
  assert.equal(lin.voiceProfile, null);
  assert.equal(lin.seed, null);
  assert.equal(lin.inputHash, null);
  assert.equal(lin.outputHash, null);
  assert.equal(lin.taskId, null);
  assert.ok(lin.startTime);
  assert.ok(lin.endTime);
  assert.equal(lin.fallbackReason, 'No provider configured');
});

test('degradeResult: result has degraded flag and fallbackReason', () => {
  const result = degradeResult('sfx', 'Empty prompt');
  assert.equal(result.degraded, true);
  assert.equal(result.fallbackReason, 'Empty prompt');
  assert.equal(result.audioPath, null);
  assert.equal(result.duration, 0);
});

test('lineage timestamps are valid ISO strings', () => {
  const entry = buildAudioLineageEntry({
    startTime: new Date().toISOString(),
    endTime: new Date().toISOString(),
  });
  assert.ok(!isNaN(Date.parse(entry.startTime)));
  assert.ok(!isNaN(Date.parse(entry.endTime)));
});
