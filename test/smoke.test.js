import test from 'node:test';
import assert from 'node:assert/strict';
import { accessSync, readFileSync } from 'node:fs';
import { STEPS } from '../src/js/config.js';
import { buildSubtitleCues } from '../src/js/agents/editorAgent.js';
import { formatSrt } from '../server/render.js';

test('production entry points and all six pipeline stages exist', () => {
  for (const file of ['dist/index.html', 'server/index.js', 'server/workflows/h3_text_to_video.json']) accessSync(file);
  assert.deepEqual(STEPS.map(step => step.id), [
    'script', 'characterDesign', 'storyboard', 'referenceImages', 'videoGeneration', 'postProduction',
  ]);
});

test('render route exposes cancellation, QC, BGM and subtitle stages', () => {
  const source = readFileSync('server/index.js', 'utf8');
  for (const marker of ['isTaskCancelled', 'probeVisualDefects', 'applyBgm', 'applySubtitles']) {
    assert.ok(source.includes(marker), `missing ${marker}`);
  }
});

test('subtitle smoke path produces timed SRT from a storyboard and script', () => {
  const storyboard = { episodes: [{ segments: [{ shots: [{ shot_id: 's1', duration: 3 }] }] }] };
  const script = { episodes: [{ segments: [{ dialogue: '小满：我们出发吧！' }] }] };
  const cues = buildSubtitleCues(storyboard, script, [{ shot_id: 's1' }]);
  const srt = formatSrt(cues);
  assert.equal(cues.length, 1);
  assert.match(srt, /00:00:00,000 --> 00:00:03,000/);
  assert.match(srt, /小满：我们出发吧！/);
});
