import 'dotenv/config';
import { readFileSync, readdirSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { performance } from 'node:perf_hooks';
import { buildWorkflow, getWorkflowIdentity, submitWorkflow, getPromptSnapshot, cancelPrompt, downloadOutput, uploadImageToComfy } from '../server/comfyui.js';
import { getDgxMetrics } from '../server/ssh-tunnel.js';
import { resolveInferenceProfile, loadInferenceProfiles } from '../server/inference-profiles.js';
import { BENCHMARK_MODES, buildGpuRuntime, percentile, runGpuAttempt, sha256File, skippedAttempt } from './benchmark-lib.mjs';

const workflowDir = path.resolve('server/workflows');
const outputPath = path.resolve(process.argv[2] || 'reports/benchmark.json');
const iterations = Math.max(10, Number(process.env.CINE_BENCH_ITERATIONS) || 100);
const seed = Number(process.env.CINE_BENCH_SEED) || 42;
const duration = Number(process.env.CINE_BENCH_DURATION) || 5;
const profilesConfig = loadInferenceProfiles();
const requestedProfiles = (process.env.CINE_BENCH_PROFILES || profilesConfig.defaultProfile).split(',').map(v => v.trim()).filter(v => profilesConfig.profiles[v]);
const realEnabled = /^(1|true)$/i.test(process.env.CINE_BENCH_REAL || '');
const inputPaths = { firstFrame: [process.env.CINE_BENCH_FIRST_IMAGE], firstLastFrame: [process.env.CINE_BENCH_FIRST_IMAGE, process.env.CINE_BENCH_LAST_IMAGE], referenceImage: (process.env.CINE_BENCH_REFERENCE_IMAGES || '').split(path.delimiter).filter(Boolean) };

const workflowFiles = readdirSync(workflowDir).filter(name => name.endsWith('.json')).sort();
const workflows = workflowFiles.map(name => {
  const filePath = path.join(workflowDir, name); const bytes = readFileSync(filePath); const parsed = JSON.parse(bytes);
  const evidence = [...new Set(JSON.stringify(parsed).match(/[\w.-]*(?:int8|nvfp4|awq|fp32|fp16|bf16)[\w.-]*/gi) || [])].sort();
  return { name, sha256: sha256File(filePath), bytes: bytes.length, nodeCount: Object.keys(parsed).length, precisionAndQuantizationEvidence: evidence };
});

const compiler = {};
for (const mode of BENCHMARK_MODES) {
  const images = mode === 'textToVideo' ? [] : mode === 'firstFrame' ? ['first.png'] : mode === 'firstLastFrame' ? ['first.png', 'last.png'] : ['ref-a.png', 'ref-b.png'];
  const samples = [];
  for (let i = 0; i < iterations; i++) { const start = performance.now(); JSON.stringify(buildWorkflow({ mode, imageFiles: images, prompt: 'Deterministic benchmark shot', seed, duration, enableLightning: true, aspectRatio: '16:9', megapixels: 0.7 })); samples.push(performance.now() - start); }
  compiler[mode] = { metric: 'localWorkflowCompilation', iterations, medianMs: +percentile(samples, .5).toFixed(3), p95Ms: +percentile(samples, .95).toFixed(3) };
}

const attempts = []; let unavailableReason = realEnabled ? null : 'Real inference disabled; set CINE_BENCH_REAL=1 on a configured ComfyUI host';
const sshConfig = realEnabled ? sshConfigFromEnv() : null;
if (realEnabled && !sshConfig) unavailableReason = 'Missing COMFY_SSH_HOST, COMFY_SSH_USER, or COMFY_SSH_PASSWORD';
if (sshConfig) {
  const outputDir = path.resolve(process.env.CINE_BENCH_OUTPUT_DIR || 'reports/benchmark-outputs'); mkdirSync(outputDir, { recursive: true });
  for (const profileName of requestedProfiles) {
    const profile = resolveInferenceProfile(profileName);
    const concurrency = Math.max(1, Math.min(Number(process.env.CINE_BENCH_CONCURRENCY) || 1, profile.maxConcurrentGpuJobs || 1));
    const specs = [];
    for (const mode of BENCHMARK_MODES) {
      const localImages = inputPaths[mode] || []; const missing = localImages.filter(file => !file || !existsSync(path.resolve(file)));
      const requiredImageCount = mode === 'firstLastFrame' ? 2 : mode === 'textToVideo' ? 0 : 1;
      const identity = getWorkflowIdentity(mode, requiredImageCount);
      const spec = { mode, profile: profileName, seed, workflowId: identity.workflowId, workflowSha256: identity.workflowHash,
        inference: { durationSeconds: duration, aspectRatio: '16:9', megapixels: profile.megapixels, enableLightning: profile.enableLightning }, modelEngineering: profilesConfig.modelEngineering, localImages };
      if (mode !== 'textToVideo' && missing.length) attempts.push(skippedAttempt(spec, `Missing legal input image(s): ${missing.join(', ')}`)); else specs.push(spec);
    }
    await runBounded(specs, concurrency, async spec => {
      const remoteImages = [];
      return runGpuAttempt(spec, {
        submit: async value => {
          for (const local of value.localImages) { const resolved = path.resolve(local); const name = `benchmark_${sha256File(resolved).slice(0, 16)}${path.extname(local)}`; await uploadImageToComfy(sshConfig, resolved, name); remoteImages.push(name); }
          return submitWorkflow(sshConfig, { mode: value.mode, prompt: process.env.CINE_BENCH_PROMPT || 'A cinematic landscape, gentle camera movement', seed, duration, imageFiles: remoteImages, enableLightning: profile.enableLightning, aspectRatio: '16:9', megapixels: profile.megapixels });
        },
        snapshot: id => getPromptSnapshot(sshConfig, id), cancel: id => cancelPrompt(sshConfig, id), sampleMetrics: async () => ({ system: await getDgxMetrics(sshConfig) }), download: output => downloadOutput(sshConfig, output, outputDir),
      }, { timeoutMs: Number(process.env.CINE_BENCH_TIMEOUT_MS) || 900000, pollIntervalMs: Number(process.env.CINE_BENCH_POLL_MS) || 2000 });
    }, attempts);
  }
}

const report = { schemaVersion: 2, generatedAt: new Date().toISOString(), environment: { node: process.version, platform: process.platform, arch: process.arch }, scope: 'Local workflow compilation and optional real ComfyUI/H3 inference. Compiler timings are not GPU performance.', reproducibility: { seed, durationSeconds: duration, aspectRatio: '16:9', profiles: requestedProfiles }, workflows, compiler, queuePolicy: { requestedConcurrency: Number(process.env.CINE_BENCH_CONCURRENCY) || 1, boundedByProfile: true, defaultConcurrency: 1 }, gpuRuntime: buildGpuRuntime(attempts, unavailableReason) };
mkdirSync(path.dirname(outputPath), { recursive: true }); writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Benchmark evidence written to ${outputPath}`); console.log(JSON.stringify({ compiler, gpuRuntime: { measured: report.gpuRuntime.measured, reason: report.gpuRuntime.reason, attempts: attempts.length } }, null, 2));

function sshConfigFromEnv() { if (!process.env.COMFY_SSH_HOST || !process.env.COMFY_SSH_USER || !process.env.COMFY_SSH_PASSWORD) return null; return { host: process.env.COMFY_SSH_HOST, port: Number(process.env.COMFY_SSH_PORT) || 22, user: process.env.COMFY_SSH_USER, password: process.env.COMFY_SSH_PASSWORD, comfyPort: Number(process.env.COMFY_SSH_COMFY_PORT) || 8188 }; }
async function runBounded(items, limit, worker, destination) { let index = 0; await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (index < items.length) destination.push(await worker(items[index++])); })); }
