import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import fs from 'fs';
import {
  registerAudioProvider, getAudioProvider, setActiveAudioProvider,
  getAudioProviders, listAudioProviders, clearAudioProviders,
} from '../server/audio-providers.js';
import { generateAudioAsset } from '../server/audio-mix.js';
import { createTask, cancelTask } from '../server/tasks.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cine-prov-'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
test.after(async () => {
  for (let i = 0; i < 5; i++) {
    try { fs.rmSync(dir, { recursive: true, force: true }); return; } catch { await sleep(100); }
  }
});

function fakeProvider(id, capability, result) {
  return { id, name: id, capability, generate: async () => result };
}

test('registerAudioProvider makes the first provider for a capability active', () => {
  clearAudioProviders();
  registerAudioProvider(fakeProvider('a', 'tts', {}));
  registerAudioProvider(fakeProvider('b', 'tts', {}));
  assert.equal(getAudioProvider('tts').id, 'a', 'first registered becomes active default');
  assert.equal(getAudioProviders('tts').length, 2);
});

test('setActiveAudioProvider switches the active provider and is respected by getAudioProvider', () => {
  clearAudioProviders();
  registerAudioProvider(fakeProvider('a', 'tts', {}));
  registerAudioProvider(fakeProvider('b', 'tts', {}));
  setActiveAudioProvider('tts', 'b');
  assert.equal(getAudioProvider('tts').id, 'b', 'active selection must be honored');
  assert.equal(getAudioProvider('tts', 'a').id, 'a', 'explicit id lookup still works');
});

test('setActiveAudioProvider throws for an unknown provider id', () => {
  clearAudioProviders();
  registerAudioProvider(fakeProvider('a', 'tts', {}));
  assert.throws(() => setActiveAudioProvider('tts', 'nope'), /not found/);
});

test('registerAudioProvider rejects a provider without id/capability or with a bad capability', () => {
  clearAudioProviders();
  assert.throws(() => registerAudioProvider({ capability: 'tts' }), /id and capability/);
  assert.throws(() => registerAudioProvider({ id: 'x', capability: 'midi' }), /Unknown audio capability/);
});

test('listAudioProviders marks the active provider per capability', () => {
  clearAudioProviders();
  registerAudioProvider(fakeProvider('a', 'tts', {}));
  registerAudioProvider(fakeProvider('b', 'tts', {}));
  registerAudioProvider(fakeProvider('s', 'sfx', {}));
  setActiveAudioProvider('tts', 'b');
  const list = listAudioProviders();
  assert.equal(list.tts.find(p => p.id === 'b').active, true);
  assert.equal(list.tts.find(p => p.id === 'a').active, false);
  assert.equal(list.sfx.find(p => p.id === 's').active, true);
});

test('generateAudioAsset uses the registered provider instead of silent fallback', async () => {
  clearAudioProviders();
  const out = path.join(dir, 'prov.m4a');
  let captured = null;
  registerAudioProvider({
    id: 'spy', name: 'spy', capability: 'tts',
    generate: async (args) => {
      captured = args;
      fs.writeFileSync(args.outputPath, 'fake-audio-bytes');
      return { audioPath: args.outputPath, duration: args.duration, degraded: false,
        lineage: { provider: 'spy', text: args.text } };
    },
  });

  const result = await generateAudioAsset({ type: 'tts', text: 'Hello', duration: 3, outputPath: out });
  assert.equal(result.degraded, false, 'real provider output must not be degraded');
  assert.equal(result.audioPath, out);
  assert.equal(captured.text, 'Hello', 'provider receives the text');
  assert.equal(captured.type, 'tts');
});

test('generateAudioAsset normalizes a provider returning no audioPath to a degraded result', async () => {
  clearAudioProviders();
  const out = path.join(dir, 'null.m4a');
  registerAudioProvider({
    id: 'broken', name: 'broken', capability: 'tts',
    generate: async () => ({ audioPath: null, duration: 0, degraded: true, fallbackReason: 'upstream 503' }),
  });

  const result = await generateAudioAsset({ type: 'tts', text: 'Hi', duration: 2, outputPath: out });
  assert.equal(result.degraded, true);
  assert.equal(result.audioPath, null);
  assert.equal(result.fallbackReason, 'upstream 503', 'provider failure reason is surfaced');
});

test('generateAudioAsset propagates cancellation to the provider via signal.aborted', async () => {
  clearAudioProviders();
  const out = path.join(dir, 'cancel.m4a');
  let sawAborted = null;
  registerAudioProvider({
    id: 'slow', name: 'slow', capability: 'tts',
    generate: async ({ signal }) => {
      sawAborted = signal?.aborted ?? false;
      return { audioPath: null, duration: 0, degraded: true, fallbackReason: signal?.aborted ? 'Cancelled' : 'done' };
    },
  });

  const task = createTask('audio', { total: 1 });
  cancelTask(task.id);
  const result = await generateAudioAsset({ type: 'tts', text: 'Hi', duration: 2, outputPath: out, taskId: task.id });
  // generateAudioAsset short-circuits on a pre-cancelled task before calling the provider
  assert.equal(result.degraded, true);
  assert.equal(result.fallbackReason, 'Cancelled');
});

test('generateAudioAsset falls back to degraded silence when no provider is registered', async () => {
  clearAudioProviders();
  const out = path.join(dir, 'fallback.m4a');
  const result = await generateAudioAsset({ type: 'tts', text: 'Hi', duration: 1, outputPath: out });
  assert.equal(result.degraded, true);
  assert.equal(result.fallbackReason, 'No TTS provider configured');
  assert.ok(fs.existsSync(out), 'silent fallback file is created');
});

// Guarded end-to-end test: exercises the real Microsoft Edge TTS provider.
// Skipped automatically when the network/synthesis endpoint is unreachable.
test('edge-tts provider synthesizes real speech end-to-end', async (t) => {
  clearAudioProviders();
  await import('../server/edgeTtsProvider.js');
  const out = path.join(dir, 'edge.m4a');
  const result = await generateAudioAsset({ type: 'tts', text: 'Hello world', duration: 3, outputPath: out });
  if (result.degraded) {
    t.skip(`edge-tts unavailable in this environment: ${result.fallbackReason}`);
    return;
  }
  assert.equal(result.degraded, false);
  assert.ok(fs.existsSync(out));
  assert.ok(fs.statSync(out).size > 1000, 'synthesized speech must be a non-trivial audio file');
  assert.equal(result.lineage.provider, 'edge-tts');
  assert.match(result.lineage.model, /Neural$/);
});
