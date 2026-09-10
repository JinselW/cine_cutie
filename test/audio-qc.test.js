import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateDeliveryBaseline, DELIVERY_QC_LIMITS } from '../src/js/agents/deliveryQC.js';
import { QCVerdict } from '../src/js/agents/qcTypes.js';

function makeData(overrides = {}) {
  return {
    finalVideo: '/tmp/test.mp4',
    status: 'complete',
    qcBaseline: {
      durationSeconds: 10,
      width: 1280, height: 720, fps: 24,
      blackDurationSeconds: 0, freezeDurationSeconds: 0,
      hasAudio: true, truePeakDbfs: -1, integratedLufs: -16,
      audioSilenceSeconds: 0, audioDurationSeconds: 10,
      ...overrides.qcBaseline,
    },
    soundPlan: overrides.soundPlan || null,
    audioResult: overrides.audioResult || null,
  };
}

test('audio_silence: PASS when silence is within limits', () => {
  const data = makeData({ qcBaseline: { audioSilenceSeconds: 1 } });
  const result = evaluateDeliveryBaseline(data);
  const silenceCheck = result.checks.find(c => c.id === 'audio_silence');
  assert.ok(silenceCheck);
  assert.equal(silenceCheck.status, 'PASS');
});

test('audio_silence: FAIL when excessive silence duration and ratio', () => {
  const data = makeData({ qcBaseline: { audioSilenceSeconds: 5, durationSeconds: 10 } });
  const result = evaluateDeliveryBaseline(data);
  const silenceCheck = result.checks.find(c => c.id === 'audio_silence');
  assert.ok(silenceCheck);
  assert.equal(silenceCheck.status, 'FAIL');
  assert.equal(result.verdict, QCVerdict.FAIL);
});

test('audio_silence: PASS when duration high but ratio low', () => {
  const data = makeData({ qcBaseline: { audioSilenceSeconds: 4, durationSeconds: 60 } });
  const result = evaluateDeliveryBaseline(data);
  const silenceCheck = result.checks.find(c => c.id === 'audio_silence');
  assert.equal(silenceCheck.status, 'PASS');
});

test('audio_duration: PASS when audio matches video duration', () => {
  const data = makeData({ qcBaseline: { audioDurationSeconds: 10, durationSeconds: 10 } });
  const result = evaluateDeliveryBaseline(data);
  const durCheck = result.checks.find(c => c.id === 'audio_duration');
  assert.ok(durCheck);
  assert.equal(durCheck.status, 'PASS');
});

test('audio_duration: WARN when mismatch exceeds limit', () => {
  const data = makeData({ qcBaseline: { audioDurationSeconds: 5, durationSeconds: 10 } });
  const result = evaluateDeliveryBaseline(data);
  const durCheck = result.checks.find(c => c.id === 'audio_duration');
  assert.ok(durCheck);
  assert.equal(durCheck.status, 'WARN');
  assert.equal(durCheck.actual.mismatch, 5);
});

test('audio_duration: not checked when hasAudio is false', () => {
  const data = makeData({ qcBaseline: { hasAudio: false, audioDurationSeconds: null } });
  const result = evaluateDeliveryBaseline(data);
  const durCheck = result.checks.find(c => c.id === 'audio_duration');
  assert.equal(durCheck, undefined);
});

test('audio_presence: WARN by default when no audio', () => {
  const data = makeData({ qcBaseline: { hasAudio: false } });
  const result = evaluateDeliveryBaseline(data);
  const presenceCheck = result.checks.find(c => c.id === 'audio_presence');
  assert.ok(presenceCheck);
  assert.equal(presenceCheck.status, 'WARN');
});

test('audio_presence: FAIL when audioPresenceBlocking is true', () => {
  const data = makeData({ qcBaseline: { hasAudio: false } });
  const result = evaluateDeliveryBaseline(data, { limits: { ...DELIVERY_QC_LIMITS, audioPresenceBlocking: true } });
  const presenceCheck = result.checks.find(c => c.id === 'audio_presence');
  assert.ok(presenceCheck);
  assert.equal(presenceCheck.status, 'FAIL');
  assert.equal(result.verdict, QCVerdict.FAIL);
});

test('audio_dialogueRatio: PASS with info when sound plan has dialogue', () => {
  const data = makeData({ soundPlan: { shots: [
    { shotId: 's1', dialogue: 'Hello' },
    { shotId: 's2', dialogue: '', narratorText: '' },
  ]}});
  const result = evaluateDeliveryBaseline(data);
  const ratioCheck = result.checks.find(c => c.id === 'audio_dialogueRatio');
  assert.ok(ratioCheck);
  assert.equal(ratioCheck.status, 'PASS');
  assert.equal(ratioCheck.actual.dialogueShots, 1);
  assert.equal(ratioCheck.actual.totalShots, 2);
});

test('audio_dialogueRatio: not checked when no sound plan', () => {
  const data = makeData();
  const result = evaluateDeliveryBaseline(data);
  const ratioCheck = result.checks.find(c => c.id === 'audio_dialogueRatio');
  assert.equal(ratioCheck, undefined);
});

test('audio_sources: PASS when all tracks generated', () => {
  const data = makeData({ audioResult: { total: 3, trackResults: [
    { degraded: false }, { degraded: false }, { degraded: false },
  ]}});
  const result = evaluateDeliveryBaseline(data);
  const srcCheck = result.checks.find(c => c.id === 'audio_sources');
  assert.ok(srcCheck);
  assert.equal(srcCheck.status, 'PASS');
});

test('audio_sources: WARN when all tracks degraded', () => {
  const data = makeData({ audioResult: { total: 2, trackResults: [
    { degraded: true }, { degraded: true },
  ]}});
  const result = evaluateDeliveryBaseline(data);
  const srcCheck = result.checks.find(c => c.id === 'audio_sources');
  assert.ok(srcCheck);
  assert.equal(srcCheck.status, 'WARN');
  assert.match(srcCheck.message, /All audio tracks used fallback/);
});

test('audio_sources: WARN when some tracks degraded', () => {
  const data = makeData({ audioResult: { total: 3, trackResults: [
    { degraded: false }, { degraded: true }, { degraded: false },
  ]}});
  const result = evaluateDeliveryBaseline(data);
  const srcCheck = result.checks.find(c => c.id === 'audio_sources');
  assert.ok(srcCheck);
  assert.equal(srcCheck.status, 'WARN');
  assert.match(srcCheck.message, /1\/3/);
});

test('audio_sources: not checked when no audioResult', () => {
  const data = makeData();
  const result = evaluateDeliveryBaseline(data);
  const srcCheck = result.checks.find(c => c.id === 'audio_sources');
  assert.equal(srcCheck, undefined);
});

test('configurable limits: custom silence threshold', () => {
  const data = makeData({ qcBaseline: { audioSilenceSeconds: 1.5, durationSeconds: 10 } });
  const defaultResult = evaluateDeliveryBaseline(data);
  const strictResult = evaluateDeliveryBaseline(data, {
    limits: { ...DELIVERY_QC_LIMITS, silenceDurationFailSeconds: 1, silenceRatioFail: 0.05 },
  });
  assert.equal(defaultResult.checks.find(c => c.id === 'audio_silence').status, 'PASS');
  assert.equal(strictResult.checks.find(c => c.id === 'audio_silence').status, 'FAIL');
});
