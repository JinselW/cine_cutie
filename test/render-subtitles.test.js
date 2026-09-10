import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { applySubtitles, formatSrt, probeStreams } from '../server/render.js';
import { buildSubtitleCues } from '../src/js/agents/editorAgent.js';

const require = createRequire(import.meta.url);
const ffmpeg = require('ffmpeg-static');

test('SRT formatter rejects empty/invalid cues and normalizes line breaks', () => {
  const srt = formatSrt([
    { start: 0, end: 1.25, text: '第一行\n第二行' },
    { start: 2, end: 1, text: 'invalid' },
    { start: 2, end: 3, text: '  ' },
  ]);
  assert.equal(srt, '1\n00:00:00,000 --> 00:00:01,250\n第一行 第二行\n');
});

test('subtitle timeline accounts for crossfade overlap', () => {
  const storyboard = { episodes: [{ segments: [
    { shots: [{ shot_id: 'a', duration: 3 }] },
    { shots: [{ shot_id: 'b', duration: 4 }] },
  ] }] };
  const script = { episodes: [{ segments: [{ dialogue: 'A' }, { dialogue: 'B' }] }] };
  const cues = buildSubtitleCues(storyboard, script, [{ shot_id: 'a' }, { shot_id: 'b' }], [{ type: 'crossfade', duration: 0.5 }]);
  assert.deepEqual(cues, [
    { start: 0, end: 2.5, text: 'A' },
    { start: 2.5, end: 6.5, text: 'B' },
  ]);
});

test('FFmpeg burns subtitles while preserving duration and audio', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cine-subtitle-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const input = path.join(dir, 'input.mp4');
  const output = path.join(dir, 'output.mp4');
  execFileSync(ffmpeg, [
    '-y', '-f', 'lavfi', '-i', 'color=c=blue:size=320x180:rate=24:duration=2',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', input,
  ], { stdio: 'ignore' });
  await applySubtitles(input, [{ start: 0.2, end: 1.8, text: 'Subtitle test' }], output);
  const info = await probeStreams(output);
  assert.ok(fs.statSync(output).size > 0);
  assert.ok(info.hasVideo);
  assert.ok(info.hasAudio);
  assert.ok(Math.abs(info.duration - 2) < 0.2);
});
