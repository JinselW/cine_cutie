import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFfmpegDuration, parseFfmpegProgress } from '../server/render.js';

test('FFmpeg duration parser converts media duration to seconds', () => {
  assert.equal(parseFfmpegDuration('Duration: 00:01:12.500, start: 0.000000'), 72.5);
  assert.equal(parseFfmpegDuration('duration unavailable'), 0);
});

test('FFmpeg progress parser uses the latest emitted output timestamp', () => {
  const output = 'out_time_us=1250000\nprogress=continue\nout_time_us=7250000\n';
  assert.equal(parseFfmpegProgress(output), 7.25);
});
