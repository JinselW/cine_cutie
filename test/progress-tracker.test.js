import test from 'node:test';
import assert from 'node:assert/strict';
import {
  startProgressRun, beginStage, reportPhase, reportBatchProgress, reportPercentProgress, getProgressSnapshot,
} from '../src/js/progressTracker.js';

test('unknown work stays indeterminate and never invents a percentage', () => {
  startProgressRun();
  beginStage('script');
  reportPhase('generatingText');
  const progress = getProgressSnapshot();
  assert.equal(progress.mode, 'indeterminate');
  assert.equal(progress.total, 0);
});

test('measured render percentages are monotonic', () => {
  startProgressRun();
  beginStage('postProduction');
  reportPercentProgress('rendering', 42.8);
  reportPercentProgress('rendering', 31);
  const progress = getProgressSnapshot();
  assert.equal(progress.completed, 42);
  assert.equal(progress.total, 100);
  assert.equal(progress.unit, 'percent');
});

test('batch progress comes from completed items and cannot move backwards', () => {
  startProgressRun();
  beginStage('referenceImages');
  reportBatchProgress('generatingImages', { total: 7, current: 4, progress: 57 });
  assert.equal(getProgressSnapshot().completed, 3);
  reportBatchProgress('generatingImages', { total: 7, current: 3, progress: 28 });
  assert.equal(getProgressSnapshot().completed, 3);
  reportBatchProgress('generatingImages', { total: 7, status: 'completed', progress: 100 });
  assert.equal(getProgressSnapshot().completed, 7);
});
