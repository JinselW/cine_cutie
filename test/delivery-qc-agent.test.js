import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateDeliveryBaseline } from '../src/js/agents/deliveryQC.js';
import { QCVerdict } from '../src/js/agents/qcTypes.js';
import { parseVisualDefects } from '../server/render.js';

const healthy = {
  finalVideo: '/api/media/final.mp4', status: 'complete',
  qcBaseline: { durationSeconds: 30, width: 1280, height: 720, fps: 24, hasAudio: true,
    integratedLufs: -16, truePeakDbfs: -1, blackDurationSeconds: 0, freezeDurationSeconds: 0 },
};

test('delivery baseline passes a healthy render', () => {
  const result = evaluateDeliveryBaseline(healthy, { expectedDuration: 30 });
  assert.equal(result.verdict, QCVerdict.PASS);
  assert.equal(result.repairPlan, null);
});

test('delivery baseline blocks missing or malformed output', () => {
  const result = evaluateDeliveryBaseline({ status: 'failed', finalVideo: '', qcBaseline: {} }, { expectedDuration: 30 });
  assert.equal(result.verdict, QCVerdict.FAIL);
  assert.equal(result.repairPlan.targetStep, 'postProduction');
});

test('delivery baseline blocks material duration drift', () => {
  const result = evaluateDeliveryBaseline({ ...healthy, qcBaseline: { ...healthy.qcBaseline, durationSeconds: 20 } }, { expectedDuration: 30 });
  assert.equal(result.verdict, QCVerdict.FAIL);
  assert.equal(result.repairPlan.targetStep, 'storyboard');
});

test('delivery baseline blocks long black and frozen segments', () => {
  const result = evaluateDeliveryBaseline({ ...healthy, qcBaseline: { ...healthy.qcBaseline, blackDurationSeconds: 1, freezeDurationSeconds: 3 } }, { expectedDuration: 30 });
  assert.equal(result.verdict, QCVerdict.FAIL);
  assert.equal(result.repairPlan.targetStep, 'videoGeneration');
});

test('delivery baseline warns rather than fails for missing audio', () => {
  const result = evaluateDeliveryBaseline({ ...healthy, qcBaseline: { ...healthy.qcBaseline, hasAudio: false } }, { expectedDuration: 30 });
  assert.equal(result.verdict, QCVerdict.CONDITIONAL_PASS);
});

test('visual defect parser sums ffmpeg intervals', () => {
  const parsed = parseVisualDefects('black_duration:0.4\nblack_duration:0.3\nfreeze_duration: 2.25');
  assert.equal(parsed.blackDurationSeconds, 0.7);
  assert.equal(parsed.freezeDurationSeconds, 2.25);
});
