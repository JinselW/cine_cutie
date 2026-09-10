import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'child_process';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';
import { generateSilentAudio, generateAudioAsset, mixAudioTimeline, applyAudioOverlay, buildAudioLineageEntry } from '../server/audio-mix.js';
import { probeStreams, probeAudioQuality } from '../server/render.js';
import { createTask, cancelTask } from '../server/tasks.js';

const FF = createRequire(import.meta.url)('ffmpeg-static');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cine-audio-'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const close = async () => {
  for (let i = 0; i < 5; i++) {
    try { fs.rmSync(dir, { recursive: true, force: true }); return; } catch { await sleep(100); }
  }
};
test.after(close);

function makeVideo(name, secs, withAudio) {
  const args = ['-y', '-f', 'lavfi', '-i', `testsrc=duration=${secs}:size=320x180:rate=24`];
  if (withAudio) args.push('-f', 'lavfi', '-i', `sine=frequency=440:duration=${secs}`);
  args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p');
  if (withAudio) args.push('-c:a', 'aac', '-shortest');
  args.push(path.join(dir, name));
  execFileSync(FF, args, { stdio: 'ignore' });
  return path.join(dir, name);
}

test('generateSilentAudio creates a valid audio file', async () => {
  const out = path.join(dir, 'silent.m4a');
  await generateSilentAudio(out, 2);
  assert.ok(fs.existsSync(out));
  const stat = fs.statSync(out);
  assert.ok(stat.size > 0);
});

test('generateAudioAsset returns lineage and degraded flag', async () => {
  const out = path.join(dir, 'asset.m4a');
  const result = await generateAudioAsset({
    type: 'tts', text: 'Hello', duration: 2, outputPath: out,
  });
  assert.ok(fs.existsSync(out));
  assert.equal(result.degraded, true);
  assert.equal(result.fallbackReason, 'No TTS provider configured');
  assert.ok(result.lineage);
  assert.equal(result.lineage.provider, 'mock-tts');
  assert.equal(result.lineage.text, 'Hello');
});

test('generateAudioAsset for SFX type uses mock-sfx provider', async () => {
  const out = path.join(dir, 'sfx.m4a');
  const result = await generateAudioAsset({
    type: 'sfx', prompt: 'rain', duration: 1, outputPath: out,
  });
  assert.equal(result.lineage.provider, 'mock-sfx');
  assert.equal(result.lineage.prompt, 'rain');
});

test('mixAudioTimeline mixes multiple tracks into one file', async () => {
  const t1 = path.join(dir, 't1.m4a');
  const t2 = path.join(dir, 't2.m4a');
  await generateSilentAudio(t1, 2);
  await generateSilentAudio(t2, 3);

  const mixed = path.join(dir, 'mixed.m4a');
  await mixAudioTimeline([
    { audioPath: t1, duration: 2, offset: 0 },
    { audioPath: t2, duration: 3, offset: 2 },
  ], mixed);

  assert.ok(fs.existsSync(mixed));
  const stat = fs.statSync(mixed);
  assert.ok(stat.size > 0);
});

test('mixAudioTimeline with empty tracks creates silent output', async () => {
  const mixed = path.join(dir, 'mixed_empty.m4a');
  await mixAudioTimeline([], mixed);
  assert.ok(fs.existsSync(mixed));
});

test('mixAudioTimeline with all-missing tracks creates silent output', async () => {
  const mixed = path.join(dir, 'mixed_missing.m4a');
  await mixAudioTimeline([
    { audioPath: '/nonexistent.m4a', duration: 2, offset: 0 },
  ], mixed);
  assert.ok(fs.existsSync(mixed));
});

test('applyAudioOverlay overlays audio onto video', async () => {
  const video = makeVideo('overlay_v.mp4', 3, false);
  const audio = path.join(dir, 'overlay_a.m4a');
  await generateSilentAudio(audio, 3);

  const out = path.join(dir, 'overlay_out.mp4');
  await applyAudioOverlay(video, audio, out);

  assert.ok(fs.existsSync(out));
  const info = await probeStreams(out);
  assert.ok(info.hasVideo);
  assert.ok(info.hasAudio);
  assert.ok(Math.abs(info.duration - 3.0) < 0.5);
});

test('applyAudioOverlay respects volume parameter', async () => {
  const video = makeVideo('vol_v.mp4', 2, true);
  const audio = path.join(dir, 'vol_a.m4a');
  await generateSilentAudio(audio, 2);

  const out = path.join(dir, 'vol_out.mp4');
  await applyAudioOverlay(video, audio, out, { overlayVolume: 0.5 });
  assert.ok(fs.existsSync(out));
  const info = await probeStreams(out);
  assert.ok(info.hasAudio);
});

test('buildAudioLineageEntry returns complete structure', () => {
  const entry = buildAudioLineageEntry({
    type: 'tts', provider: 'edge-tts', model: 'zh-CN-XiaoxiaoNeural',
    text: 'Hello', speakerId: 'char_1', voiceProfile: 'char-char_1',
    seed: 42, startTime: '2026-01-01T00:00:00Z', endTime: '2026-01-01T00:00:01Z',
  });
  assert.equal(entry.provider, 'edge-tts');
  assert.equal(entry.model, 'zh-CN-XiaoxiaoNeural');
  assert.equal(entry.text, 'Hello');
  assert.equal(entry.speakerId, 'char_1');
  assert.equal(entry.seed, 42);
});

test('generateAudioAsset supports cancellation via taskId', async () => {
  const task = createTask('audio', { total: 1 });
  cancelTask(task.id);

  const out = path.join(dir, 'cancelled.m4a');
  const result = await generateAudioAsset({
    type: 'tts', text: 'Hello', duration: 2, outputPath: out, taskId: task.id,
  });
  assert.equal(result.degraded, true);
  assert.equal(result.fallbackReason, 'Cancelled');
});
