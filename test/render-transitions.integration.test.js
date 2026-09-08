import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'child_process';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';
import { renderWithTransitions, concatVideos, probeStreams } from '../server/render.js';
import { createTask, cancelTask } from '../server/tasks.js';

const FF = createRequire(import.meta.url)('ffmpeg-static');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cine-cx-'));
// a cancelled ffmpeg child may still hold file handles on Windows; retry cleanup so the test isn't flaky
const sleep = ms => new Promise(r => setTimeout(r, ms));
const close = async () => {
  for (let i = 0; i < 5; i++) {
    try { fs.rmSync(dir, { recursive: true, force: true }); return; } catch { await sleep(100); }
  }
};
test.after(close);

function makeClip(name, size, rate, secs, withAudio) {
  const args = ['-y', '-f', 'lavfi', '-i', `testsrc=duration=${secs}:size=${size}:rate=${rate}`];
  if (withAudio) args.push('-f', 'lavfi', '-i', `sine=frequency=440:duration=${secs}`);
  args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p');
  if (withAudio) args.push('-c:a', 'aac', '-shortest');
  args.push(path.join(dir, name));
  execFileSync(FF, args, { stdio: 'ignore' });
  return path.join(dir, name);
}

test('renders heterogeneous clips: downscaled fps, audio-less clip, fade in/out', async () => {
  const paths = [
    makeClip('a.mp4', '640x360', '24', '2', true),
    makeClip('b.mp4', '320x240', '30', '1', false), // different res+fps, no audio
    makeClip('c.mp4', '640x360', '24', '1.5', true),
  ];
  const out = path.join(dir, 'out.mp4');
  await renderWithTransitions(
    paths,
    [{ type: 'cut', duration: 0 }, { type: 'crossfade', duration: 0.5 }],
    out, { fadeIn: true, fadeOut: true, onProgress: () => {} },
  );
  const info = await probeStreams(out);
  assert.ok(info.hasVideo);
  assert.ok(info.hasAudio, 'audio-less clip should be padded with silence');
  assert.equal(info.width, 640);
  assert.equal(info.height, 360);
  assert.ok(Math.abs(info.duration - 4.0) < 0.2, `duration ${info.duration} ~ 4.0`);
});

test('oversized transition duration degrades to a hard cut and still renders', async () => {
  const paths = [makeClip('d.mp4', '320x180', '24', '2', true), makeClip('e.mp4', '320x180', '24', '2', true)];
  const out = path.join(dir, 'out-huge.mp4');
  await renderWithTransitions(paths, [{ type: 'crossfade', duration: 100 }], out, { onProgress: () => {} });
  const info = await probeStreams(out);
  assert.ok(info.hasVideo);
  assert.ok(Math.abs(info.duration - 4.0) < 0.2, `duration ${info.duration} ~ 4.0`);
});

test('concat fallback still produces output on heterogeneous clips', async () => {
  const paths = [
    makeClip('f.mp4', '640x360', '24', '2', true),
    makeClip('g.mp4', '320x240', '30', '1', false),
  ];
  const out = path.join(dir, 'out-concat.mp4');
  await concatVideos(paths, out, { onProgress: () => {} });
  const info = await probeStreams(out);
  assert.ok(info.hasVideo);
  assert.ok(info.width > 0);
});

test('cancelling a render kills the ffmpeg child instead of finishing', async () => {
  const paths = [
    makeClip('k.mp4', '1280x720', '24', '4', true),
    makeClip('l.mp4', '1280x720', '24', '4', true),
    makeClip('m.mp4', '1280x720', '24', '4', true),
  ];
  const out = path.join(dir, 'out-cancel.mp4');
  const task = createTask('render');
  setTimeout(() => cancelTask(task.id), 120);
  let finished = false;
  await assert.rejects(
    renderWithTransitions(paths, [{ type: 'crossfade', duration: 0.5 }, { type: 'crossfade', duration: 0.5 }], out, {
      taskId: task.id, onProgress: () => {},
    }).then(() => { finished = true; }),
    /Cancelled/,
  );
  assert.equal(finished, false);
});
