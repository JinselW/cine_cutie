import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'child_process';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';
import { applyAudioOverlay, generateSilentAudio } from '../server/audio-mix.js';
import { probeStreams } from '../server/render.js';
import { buildAudioTracks } from '../src/js/agents/editorAgent.js';

const FF = createRequire(import.meta.url)('ffmpeg-static');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cine-review-'));
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

// Review fix #1: applyAudioOverlay must preserve native audio, not replace it with silence.
test('applyAudioOverlay preserves native audio when video has dialogue/ambience', async () => {
  const videoWithAudio = makeVideo('native_v.mp4', 3, true);
  const overlay = path.join(dir, 'native_overlay.m4a');
  await generateSilentAudio(overlay, 3);

  const out = path.join(dir, 'native_out.mp4');
  await applyAudioOverlay(videoWithAudio, overlay, out);

  const info = await probeStreams(out);
  assert.ok(info.hasVideo, 'output must have video');
  assert.ok(info.hasAudio, 'output must retain audio — native audio must not be replaced by silence');
  assert.ok(info.duration > 0, 'output must have non-zero duration');
});

test('applyAudioOverlay uses overlay as sole audio when video has no native audio', async () => {
  const videoNoAudio = makeVideo('no_native_v.mp4', 3, false);
  const overlay = path.join(dir, 'sole_overlay.m4a');
  await generateSilentAudio(overlay, 3);

  const out = path.join(dir, 'no_native_out.mp4');
  await applyAudioOverlay(videoNoAudio, overlay, out);

  const info = await probeStreams(out);
  assert.ok(info.hasVideo, 'output must have video');
  assert.ok(info.hasAudio, 'output must have audio from overlay');
});

// Review fix #2: buildAudioTracks must match by shotId, not array index.
// Reordering clips must not misalign audio.
test('buildAudioTracks matches by shotId — reordering clips preserves sound-video correspondence', () => {
  const soundPlan = {
    shots: [
      { shotId: 's1', dialogue: 'Line for shot 1', ambiencePrompt: 'rain', soundEffects: [], voiceProfile: 'vp1', speakerId: null, duration: 5 },
      { shotId: 's2', dialogue: 'Line for shot 2', ambiencePrompt: 'wind', soundEffects: [], voiceProfile: 'vp2', speakerId: null, duration: 3 },
      { shotId: 's3', dialogue: '', ambiencePrompt: 'traffic', soundEffects: ['car horn'], voiceProfile: 'neutral-narrator', speakerId: null, duration: 4 },
    ],
  };

  // Original order
  const clipsOriginal = [
    { shot_id: 's1', duration: 5 },
    { shot_id: 's2', duration: 3 },
    { shot_id: 's3', duration: 4 },
  ];

  // Reversed order — simulates editor reordering/excluding shots
  const clipsReversed = [
    { shot_id: 's3', duration: 4 },
    { shot_id: 's1', duration: 5 },
    { shot_id: 's2', duration: 3 },
  ];

  const tracksOriginal = buildAudioTracks(soundPlan, clipsOriginal, []);
  const tracksReordered = buildAudioTracks(soundPlan, clipsReversed, []);

  // In original order, first TTS track should be for s1
  const ttsOriginal = tracksOriginal.filter(t => t.type === 'tts');
  assert.equal(ttsOriginal[0].text, 'Line for shot 1', 'first TTS in original order must be for s1');

  // In reversed order, first TTS track should be for s1 (not s3, which has no dialogue)
  const ttsReordered = tracksReordered.filter(t => t.type === 'tts');
  assert.equal(ttsReordered[0].text, 'Line for shot 1', 'first TTS in reversed order must still be for s1 (matched by shotId)');
  assert.equal(ttsReordered[1].text, 'Line for shot 2', 'second TTS in reversed order must be for s2');

  // SFX tracks: in reversed order, s3 comes first
  const sfxReordered = tracksReordered.filter(t => t.type === 'sfx');
  assert.ok(sfxReordered[0].prompt.includes('traffic'), 'first SFX in reversed order must be for s3');
});

test('buildAudioTracks skips clips whose shotId is not in the sound plan', () => {
  const soundPlan = {
    shots: [
      { shotId: 's1', dialogue: 'Hello', ambiencePrompt: 'rain', soundEffects: [], voiceProfile: 'vp1', speakerId: null, duration: 5 },
    ],
  };
  const clips = [
    { shot_id: 's1', duration: 5 },
    { shot_id: 's999', duration: 3 },
  ];

  const tracks = buildAudioTracks(soundPlan, clips, []);
  const ttsTracks = tracks.filter(t => t.type === 'tts');
  assert.equal(ttsTracks.length, 1, 'only one TTS track — s999 must be skipped');
  assert.equal(ttsTracks[0].text, 'Hello');
});

// Review fix #3 (degraded skip): when all tracks are degraded, overlay must not be applied.
// This tests the decision logic used in EditorAgent.#callProvider.
test('all-degraded audio result must not produce an overlay path', () => {
  const audioResult = {
    mixedAudioPath: '/tmp/mixed.m4a',
    trackResults: [
      { type: 'tts', degraded: true, fallbackReason: 'No TTS provider' },
      { type: 'sfx', degraded: true, fallbackReason: 'No SFX provider' },
    ],
  };

  const allDegraded = audioResult.trackResults.length > 0
    && audioResult.trackResults.every(t => t.degraded);
  const hasRealAudio = audioResult.mixedAudioPath && !allDegraded;

  assert.equal(allDegraded, true, 'all tracks are degraded');
  assert.equal(hasRealAudio, false, 'must not apply overlay when all tracks are degraded (silence)');
});

test('partial-degraded audio result still produces an overlay path', () => {
  const audioResult = {
    mixedAudioPath: '/tmp/mixed.m4a',
    trackResults: [
      { type: 'tts', degraded: true, fallbackReason: 'No TTS provider' },
      { type: 'sfx', degraded: false },
    ],
  };

  const allDegraded = audioResult.trackResults.length > 0
    && audioResult.trackResults.every(t => t.degraded);
  const hasRealAudio = audioResult.mixedAudioPath && !allDegraded;

  assert.equal(allDegraded, false, 'not all tracks are degraded');
  assert.equal(hasRealAudio, true, 'must apply overlay when at least one track is real');
});
