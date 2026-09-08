import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'child_process';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';
import { applyBgm, probeStreams, probeAudioQuality } from '../server/render.js';
import { createTask, cancelTask } from '../server/tasks.js';

const FF = createRequire(import.meta.url)('ffmpeg-static');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cine-bgm-'));
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

function makeBgm(name, freq, secs) {
  const p = path.join(dir, name);
  execFileSync(FF, ['-y', '-f', 'lavfi', '-i', `sine=frequency=${freq}:duration=${secs}`, '-c:a', 'aac', p], { stdio: 'ignore' });
  return p;
}

test('mixes BGM under dialogue and preserves the video stream', async () => {
  const video = makeVideo('v.mp4', 3, true);
  const bgm = makeBgm('bgm_short.m4a', 300, 1); // shorter than the video → looped
  const out = path.join(dir, 'out.mp4');
  await applyBgm(video, bgm, out, { onProgress: () => {} });
  const info = await probeStreams(out);
  assert.ok(info.hasVideo);
  assert.ok(info.hasAudio);
  assert.ok(Math.abs(info.duration - 3.0) < 0.2, `duration ${info.duration} ~ 3.0`);
  const quality = await probeAudioQuality(out);
  assert.ok(Number.isFinite(quality.integratedLufs));
  assert.ok(Number.isFinite(quality.truePeakDbfs));
});

test('trims an over-long BGM to the video duration', async () => {
  const video = makeVideo('v2.mp4', 3, true);
  const bgm = makeBgm('bgm_long.m4a', 500, 6); // longer than the video → trimmed
  const out = path.join(dir, 'out2.mp4');
  await applyBgm(video, bgm, out, { onProgress: () => {} });
  const info = await probeStreams(out);
  assert.ok(Math.abs(info.duration - 3.0) < 0.2, `duration ${info.duration} ~ 3.0`);
});

test('adds BGM as the only track when the video carries no audio', async () => {
  const video = makeVideo('v_silent.mp4', 3, false);
  const bgm = makeBgm('bgm3.m4a', 400, 3);
  const out = path.join(dir, 'out3.mp4');
  await applyBgm(video, bgm, out, { onProgress: () => {} });
  const info = await probeStreams(out);
  assert.ok(info.hasVideo);
  assert.ok(info.hasAudio, 'BGM should become the audio track');
  assert.ok(Math.abs(info.duration - 3.0) < 0.2);
});

test('cancelling a BGM mix kills the ffmpeg child', async () => {
  const video = makeVideo('v_cancel.mp4', 4, true);
  const bgm = makeBgm('bgm_cancel.m4a', 400, 4);
  const out = path.join(dir, 'out_cancel.mp4');
  const task = createTask('render');
  setTimeout(() => cancelTask(task.id), 120);
  let finished = false;
  await assert.rejects(
    applyBgm(video, bgm, out, { taskId: task.id, onProgress: () => {} }).then(() => { finished = true; }),
    /Cancelled/,
  );
  assert.equal(finished, false);
});
