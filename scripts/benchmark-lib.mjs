import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';

export const BENCHMARK_MODES = ['textToVideo', 'firstFrame', 'firstLastFrame', 'referenceImage'];
export const sha256File = filePath => createHash('sha256').update(readFileSync(filePath)).digest('hex');

export function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

export function summarizeSamples(samples) {
  const maximum = selector => { const values = samples.flatMap(selector).filter(Number.isFinite); return values.length ? Math.max(...values) : null; };
  const disk = samples.map(sample => sample.system?.disk?.availableBytes).filter(Number.isFinite);
  return { count: samples.length,
    peakGpuUtilizationPercent: maximum(sample => (sample.system?.gpus || []).map(gpu => gpu.utilization)),
    peakVramUsedMiB: maximum(sample => (sample.system?.gpus || []).map(gpu => gpu.memoryUsedMiB)),
    peakUnifiedMemoryUsedBytes: maximum(sample => [sample.system?.memory?.usedBytes]),
    peakSystemMemoryUsedBytes: maximum(sample => [sample.system?.memory?.usedBytes]),
    minimumDiskAvailableBytes: disk.length ? Math.min(...disk) : null };
}

const iso = value => value == null ? null : new Date(value).toISOString();
export async function runGpuAttempt(spec, dependencies, options = {}) {
  const now = dependencies.now || Date.now;
  const sleep = dependencies.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const pollIntervalMs = options.pollIntervalMs ?? 2000; const timeoutMs = options.timeoutMs ?? 900000;
  const attemptBeganMs = now(); let submittedMs = null; const samples = [];
  let promptId = null; let startedMs = null; let endedMs = null; let status = 'failed'; let reason = null; let output = null;
  try {
    promptId = await dependencies.submit(spec); submittedMs = now();
    while (true) {
      if (options.signal?.aborted) { await dependencies.cancel?.(promptId); status = 'cancelled'; reason = 'Benchmark cancelled'; endedMs = now(); break; }
      if (now() - submittedMs > timeoutMs) { await dependencies.cancel?.(promptId); status = 'failed'; reason = `Timed out after ${timeoutMs} ms`; endedMs = now(); break; }
      const [snapshotResult, metricResult] = await Promise.allSettled([dependencies.snapshot(promptId), dependencies.sampleMetrics()]);
      if (metricResult.status === 'fulfilled') samples.push({ timestamp: iso(now()), ...metricResult.value });
      if (snapshotResult.status === 'rejected') throw snapshotResult.reason;
      const snapshot = snapshotResult.value;
      if (snapshot.running && startedMs == null) startedMs = now();
      if (snapshot.completed) {
        endedMs = now(); status = snapshot.status === 'success' ? 'success' : snapshot.status === 'cancelled' ? 'cancelled' : 'failed';
        reason = status === 'success' ? null : formatReason(snapshot.messages, `ComfyUI status: ${snapshot.status || 'unknown'}`);
        if (status === 'success') {
          if (!snapshot.outputs?.length) { status = 'failed'; reason = 'ComfyUI completed without a video output'; }
          else output = await dependencies.download(snapshot.outputs[0]);
        }
        break;
      }
      await sleep(pollIntervalMs);
    }
  } catch (error) { endedMs = now(); status = options.signal?.aborted ? 'cancelled' : 'failed'; reason = error?.message || String(error); }
  endedMs ??= now(); const effectiveStart = startedMs;
  return { mode: spec.mode, profile: spec.profile, promptId, workflowId: spec.workflowId, workflowSha256: spec.workflowSha256,
    seed: spec.seed, inference: spec.inference, modelEngineering: spec.modelEngineering, status, reason, fallbackReason: spec.fallbackReason || null,
    timestamps: { submittedAt: iso(submittedMs), startedAt: iso(effectiveStart), endedAt: iso(endedMs) },
    timingMs: { queue: effectiveStart == null || submittedMs == null ? null : effectiveStart - submittedMs, inference: effectiveStart == null ? null : endedMs - effectiveStart, total: submittedMs == null ? endedMs - attemptBeganMs : endedMs - submittedMs },
    resources: summarizeSamples(samples), samples,
    output: output ? { path: output.savePath, sizeBytes: statSync(output.savePath).size, sha256: sha256File(output.savePath) } : null };
}

function formatReason(messages, fallback) { return Array.isArray(messages) && messages.length ? messages.map(v => typeof v === 'string' ? v : JSON.stringify(v)).join('; ') : fallback; }
export function skippedAttempt(spec, reason) { return { mode: spec.mode, profile: spec.profile, promptId: null, workflowId: spec.workflowId, workflowSha256: spec.workflowSha256, seed: spec.seed, inference: spec.inference, modelEngineering: spec.modelEngineering, status: 'skipped', reason, fallbackReason: spec.fallbackReason || null, timestamps: { submittedAt: null, startedAt: null, endedAt: null }, timingMs: { queue: null, inference: null, total: null }, resources: null, samples: [], output: null }; }
export function buildGpuRuntime(attempts, reason = null) { const measured = attempts.some(a => a.promptId && ['success', 'failed', 'cancelled'].includes(a.status)); return { measured, reason: measured ? null : reason || 'No real ComfyUI inference was submitted', attempts }; }
