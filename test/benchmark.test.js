import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildGpuRuntime, percentile, runGpuAttempt, sha256File, skippedAttempt, summarizeSamples } from '../scripts/benchmark-lib.mjs';

const spec = { mode: 'textToVideo', profile: 'balanced', workflowId: 'h3.json', workflowSha256: 'abc', seed: 42, inference: {}, modelEngineering: {} };

test('sample summary records peaks and minimum free disk without inventing missing values', () => {
  const summary = summarizeSamples([
    { system: { gpus: [{ utilization: 20, memoryUsedMiB: 100 }], memory: { usedBytes: 200 }, disk: { availableBytes: 900 } } },
    { system: { gpus: [{ utilization: 80, memoryUsedMiB: 300 }], memory: { usedBytes: 250 }, disk: { availableBytes: 800 } } },
  ]);
  assert.equal(summary.peakGpuUtilizationPercent, 80);
  assert.equal(summary.peakVramUsedMiB, 300);
  assert.equal(summary.peakUnifiedMemoryUsedBytes, 250);
  assert.equal(summary.minimumDiskAvailableBytes, 800);
  assert.equal(percentile([1, 4, 2, 3], .5), 3);
});

test('successful attempt measures queue/inference and hashes downloaded output', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cine-bench-')); const output = path.join(dir, 'out.mp4'); writeFileSync(output, 'video');
  let clock = 1000; const states = [{ pending: true }, { running: true }, { completed: true, status: 'success', outputs: [{ filename: 'x.mp4' }] }];
  const result = await runGpuAttempt(spec, { now: () => clock, sleep: async ms => { clock += ms; }, submit: async () => 'prompt-1', snapshot: async () => states.shift(), sampleMetrics: async () => ({ system: { gpus: [{ utilization: 77, memoryUsedMiB: 123 }] } }), download: async () => ({ savePath: output }) }, { pollIntervalMs: 10 });
  assert.equal(result.status, 'success'); assert.equal(result.promptId, 'prompt-1'); assert.equal(result.timingMs.queue, 10); assert.equal(result.timingMs.inference, 10); assert.equal(result.output.sizeBytes, 5); assert.equal(result.output.sha256, sha256File(output));
});

test('timeout cancels prompt and reports no fabricated inference timing', async () => {
  let clock = 0; let cancelled = null;
  const result = await runGpuAttempt(spec, { now: () => clock, sleep: async ms => { clock += ms; }, submit: async () => 'slow', snapshot: async () => ({ pending: true }), sampleMetrics: async () => ({}), cancel: async id => { cancelled = id; } }, { timeoutMs: 15, pollIntervalMs: 10 });
  assert.equal(result.status, 'failed'); assert.match(result.reason, /Timed out/); assert.equal(cancelled, 'slow'); assert.equal(result.timingMs.inference, null);
});

test('failure, cancellation, skip and unmeasured report retain explicit reasons', async () => {
  let clock = 0;
  const failed = await runGpuAttempt(spec, { now: () => clock, sleep: async ms => { clock += ms; }, submit: async () => 'bad', snapshot: async () => ({ completed: true, status: 'error', messages: ['OOM'] }), sampleMetrics: async () => ({}) });
  assert.equal(failed.status, 'failed'); assert.match(failed.reason, /OOM/);
  const controller = new AbortController(); controller.abort(); let cancelled = false;
  const aborted = await runGpuAttempt(spec, { submit: async () => 'cancel-me', snapshot: async () => ({}), sampleMetrics: async () => ({}), cancel: async () => { cancelled = true; } }, { signal: controller.signal });
  assert.equal(aborted.status, 'cancelled'); assert.equal(cancelled, true);
  const skipped = skippedAttempt(spec, 'missing input'); assert.equal(skipped.status, 'skipped');
  assert.deepEqual(buildGpuRuntime([skipped], 'offline'), { measured: false, reason: 'offline', attempts: [skipped] });
});
