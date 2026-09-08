import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTransitionFilterGraph } from '../server/render.js';

const clips = (durations, allAudio = true) => durations.map(d => ({ duration: d, hasAudio: allAudio }));

test('uniform crossfade chain computes offsets and shortened total', () => {
  const { filterComplex, videoLabel, audioLabel, total } = buildTransitionFilterGraph(
    clips([3, 3, 3]),
    [{ type: 'crossfade', duration: 0.5 }, { type: 'crossfade', duration: 0.5 }],
  );
  assert.equal(total, 8); // 9 - 2*0.5
  assert.match(filterComplex, /xfade=transition=fade:duration=0\.500:offset=2\.500/);
  assert.match(filterComplex, /xfade=transition=fade:duration=0\.500:offset=5\.000/);
  assert.equal(videoLabel, 'xf2');
  assert.equal(audioLabel, 'af2');
  assert.match(filterComplex, /acrossfade=d=0\.500/);
});

test('mixed cut + crossfade uses concat for the cut and shortens only the crossfade', () => {
  const { filterComplex, total } = buildTransitionFilterGraph(
    clips([3, 3, 3]),
    [{ type: 'cut', duration: 0 }, { type: 'crossfade', duration: 0.5 }],
  );
  assert.equal(total, 8.5);
  assert.match(filterComplex, /concat=n=2:v=1:a=0/);
  assert.match(filterComplex, /xfade=transition=fade:duration=0\.500:offset=5\.500/);
});

test('fade in/out applies to both video and audio and relabels both outputs', () => {
  const { filterComplex, videoLabel, audioLabel } = buildTransitionFilterGraph(
    clips([4, 4]),
    [{ type: 'cut', duration: 0 }],
    { fadeIn: true, fadeOut: true },
  );
  assert.match(filterComplex, /fade=t=in:st=0:d=0\.500/);
  assert.match(filterComplex, /fade=t=out:st=7\.500:d=0\.500/);
  assert.match(filterComplex, /afade=t=in:st=0:d=0\.500/);
  assert.match(filterComplex, /afade=t=out:st=7\.500:d=0\.500/);
  assert.equal(videoLabel, 'fv');
  assert.equal(audioLabel, 'fa');
});

test('full input normalisation (scale/pad, fps, setsar, format) is applied per video branch', () => {
  const { filterComplex } = buildTransitionFilterGraph(clips([3, 3]), [], { width: 640, height: 360, fps: 30 });
  assert.match(filterComplex, /scale=640:360:force_original_aspect_ratio=decrease/);
  assert.match(filterComplex, /pad=640:360:\(ow-iw\)\/2:\(oh-ih\)\/2/);
  assert.match(filterComplex, /setsar=1/);
  assert.match(filterComplex, /fps=30/);
  assert.match(filterComplex, /format=yuv420p/);
  assert.match(filterComplex, /settb=AVTB/);
});

test('clips without an audio stream get an injected silence track', () => {
  const { filterComplex } = buildTransitionFilterGraph(
    [{ duration: 3, hasAudio: true }, { duration: 3, hasAudio: false }],
    [{ type: 'crossfade', duration: 0.5 }],
  );
  assert.match(filterComplex, /anullsrc=r=48000:cl=stereo/);
  assert.match(filterComplex, /atrim=duration=3\.000/);
  assert.match(filterComplex, /acrossfade=d=0\.500/);
});

test('invalid or oversized transition durations degrade to a hard cut', () => {
  // oversized duration clamps to the incoming clip length → offset hits 0 → treated as cut
  const oversized = buildTransitionFilterGraph(clips([3, 3]), [{ type: 'crossfade', duration: 100 }]);
  assert.equal(oversized.total, 6);
  assert.doesNotMatch(oversized.filterComplex, /xfade/);
  // non-finite duration also degrades to a cut
  const nan = buildTransitionFilterGraph(clips([3, 3]), [{ type: 'crossfade', duration: NaN }]);
  assert.equal(nan.total, 6);
  assert.doesNotMatch(nan.filterComplex, /xfade/);
  // a negative duration is a cut too
  const neg = buildTransitionFilterGraph(clips([3, 3]), [{ type: 'crossfade', duration: -1 }]);
  assert.equal(neg.total, 6);
  assert.doesNotMatch(neg.filterComplex, /xfade/);
});

test('missing transition entry defaults to a hard cut', () => {
  const { total, filterComplex } = buildTransitionFilterGraph(clips([3, 3]), []);
  assert.equal(total, 6);
  assert.match(filterComplex, /concat=n=2:v=1:a=0/);
  assert.doesNotMatch(filterComplex, /xfade/);
});

test('single clip without fades is a pass-through chain', () => {
  const { total, videoLabel, filterComplex } = buildTransitionFilterGraph(clips([5]), []);
  assert.equal(total, 5);
  assert.equal(videoLabel, 'v0');
  assert.doesNotMatch(filterComplex, /xfade|concat=/);
});
