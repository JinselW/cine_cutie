import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBgmFilterGraph, sanitizeVolume } from '../server/render.js';

test('sanitizeVolume clamps to 0-1 and falls back on NaN', () => {
  assert.equal(sanitizeVolume(0), 0);
  assert.equal(sanitizeVolume(1), 1);
  assert.equal(sanitizeVolume(5), 1); // oversized clamps to 1
  assert.equal(sanitizeVolume(-1), 0); // negative clamps to 0
  assert.equal(sanitizeVolume(NaN), 0.6); // NaN falls back to default
  assert.equal(sanitizeVolume(undefined), 0.6);
  assert.equal(sanitizeVolume('garbage'), 0.6);
  assert.equal(sanitizeVolume('0.4'), 0.4);
});

test('ducks BGM under dialogue when the video has an audio track', () => {
  const { filterComplex, audioLabel } = buildBgmFilterGraph(true, 10, { bgmVolume: 0.5, fadeIn: 0.3, fadeOut: 0.3 });
  assert.match(filterComplex, /asplit=2\[mA\]\[mB\]/);
  assert.match(filterComplex, /sidechaincompress/);
  assert.match(filterComplex, /amix=inputs=2:duration=first:dropout_transition=0:normalize=0/);
  assert.match(filterComplex, /loudnorm=I=-16:TP=-1\.5:LRA=11/);
  assert.match(filterComplex, /afade=t=in:st=0:d=0\.300/);
  assert.match(filterComplex, /afade=t=out:st=9\.700:d=0\.300/);
  assert.match(filterComplex, /alimiter=limit=0\.95/);
  assert.equal(audioLabel, 'aout');
});

test('uses BGM as the only track when the video has no audio', () => {
  const { filterComplex } = buildBgmFilterGraph(false, 10, { bgmVolume: 0.5 });
  assert.match(filterComplex, /loudnorm/);
  assert.match(filterComplex, /alimiter/);
  assert.doesNotMatch(filterComplex, /sidechaincompress/);
  assert.doesNotMatch(filterComplex, /asplit/);
});

test('BGM is bounded to the video duration via atrim', () => {
  const { filterComplex } = buildBgmFilterGraph(true, 12, {});
  assert.match(filterComplex, /atrim=duration=12\.000/);
});
