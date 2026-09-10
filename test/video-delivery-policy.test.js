// Run: node --experimental-vm-modules --test test/video-delivery-policy.test.js
// Final footage ships on the user's judgement, not the reviewer's: only IP
// compliance and a genuinely broken render may stop the last two steps.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ArtifactStatus } from '../src/js/artifacts/artifactTypes.js';
import { QCVerdict } from '../src/js/agents/qcTypes.js';
import { checkConsistency } from '../src/js/agents/qcConsistency.js';
import { DeliveryQCAgent } from '../src/js/agents/deliveryQCAgent.js';
import { promptHarness, promptContext } from './helpers/promptHarness.js';
import { createHarness, STEP_DATA } from './helpers/orchestratorHarness.js';

const healthyBaseline = {
  durationSeconds: 30, width: 1280, height: 720, fps: 24, hasAudio: true,
  integratedLufs: -16, truePeakDbfs: -1, blackDurationSeconds: 0, freezeDurationSeconds: 0,
};

async function runVideoAgent(harnessOverrides, { seedSalt, mutateQc } = {}) {
  const h = await promptHarness(harnessOverrides);
  const ctx = promptContext();
  const agent = new h.PromptAgent();
  const image = await new h.ReferenceAgent({ promptAgent: agent }).run(ctx);
  if (mutateQc) mutateQc(h.qc);
  const result = await new h.VideoAgent({ promptAgent: agent })
    .run({ ...ctx, referenceImages: image.artifacts[0].data, ...(seedSalt ? { seedSalt } : {}) });
  return { h, result };
}

test('a rejected creative score neither re-shoots the batch nor fails the step', async () => {
  const { h, result } = await runVideoAgent({}, {
    mutateQc: qc => { qc.score = 1; qc.verdict = QCVerdict.FAIL; },
  });
  assert.equal(h.calls.videos.length, 1, 'one generation pass, no score-driven retry');
  assert.equal(result.artifacts[0].status, ArtifactStatus.COMPLETE);
  assert.equal(result.metadata.qualityScore, 1, 'the score is still reported');
  assert.notEqual(result.metadata.verdict, QCVerdict.FAIL, 'quality alone never blocks delivery');
});

test('protected content in a clip still fails the step regardless of its score', async () => {
  const { h, result } = await runVideoAgent(
    { visualCompliance: { verdict: QCVerdict.FAIL, issues: ['watermark'], checks: [] } },
    { mutateQc: qc => { qc.score = 9; qc.verdict = QCVerdict.PASS; } },
  );
  assert.equal(result.artifacts[0].status, ArtifactStatus.FAILED);
  assert.equal(result.metadata.verdict, QCVerdict.FAIL);
  assert.equal(h.calls.videos.length, 1);
});

test('a re-run varies the generation seed while the first pass stays reproducible', async () => {
  const first = await runVideoAgent({});
  const reroll = await runVideoAgent({}, { seedSalt: 77 });
  assert.equal(first.h.calls.videos[0][0].seed, 42);
  assert.equal(reroll.h.calls.videos[0][0].seed, 42 + 77);
});

test('partial clip coverage warns instead of failing the video step', () => {
  const entities = { refShotCount: 3, refVideoMode: 'firstFrame' };
  const clips = statuses => ({ mode: 'firstFrame', clips: statuses.map((status, i) => ({ shot_id: `s${i}`, status })) });

  assert.equal(checkConsistency('videoGeneration', clips(['complete', 'complete', 'complete']), entities).verdict, QCVerdict.PASS);
  assert.equal(checkConsistency('videoGeneration', clips(['complete', 'failed', 'failed']), entities).verdict, QCVerdict.CONDITIONAL_PASS);
  assert.equal(checkConsistency('videoGeneration', clips(['failed', 'failed', 'failed']), entities).verdict, QCVerdict.FAIL,
    'nothing rendered at all is the only fatal clip outcome');
});

test('delivery does not run or expose a creative score', async () => {
  const agent = new DeliveryQCAgent();
  const result = await agent.process({ data: { finalVideo: '/api/media/final.mp4', status: 'complete', qcBaseline: healthyBaseline }, totalDuration: 30 });
  assert.equal(result.verdict, QCVerdict.PASS);
  assert.equal(result.creative, null);
  assert.equal(result.score, null);
});

test('a broken render still fails delivery', async () => {
  const agent = new DeliveryQCAgent();
  const result = await agent.process({ data: { finalVideo: '', status: 'failed', qcBaseline: {} }, totalDuration: 30 });
  assert.equal(result.verdict, QCVerdict.FAIL);
  assert.equal(result.repairPlan.targetStep, 'postProduction');
});

test('a short film that overruns its target still ships', async () => {
  const agent = new DeliveryQCAgent();
  const result = await agent.process({
    data: { finalVideo: '/api/media/final.mp4', status: 'complete', qcBaseline: { ...healthyBaseline, durationSeconds: 6.51 } },
    totalDuration: 5,
  });
  assert.notEqual(result.verdict, QCVerdict.FAIL, 'whole-second clips and crossfade overlap make a 5s target unreachable');
  assert.equal(result.score, null);
});

test('rerunStep re-runs a completed step with a fresh seed and no feedback', async () => {
  const h = await createHarness();
  await h.runPipeline(5);
  const first = h.accepted('videoGeneration');
  assert.equal(h.calls.runs.filter(run => run.stepId === 'videoGeneration').length, 1);

  h.plan('videoGeneration', [{ data: { ...STEP_DATA.videoGeneration, clips: [{ shot_id: 1, videoPath: '/clip/take-2.mp4' }] } }]);
  await h.api.rerunStep('videoGeneration');

  const rerun = h.calls.runs.at(-1);
  assert.equal(rerun.stepId, 'videoGeneration');
  assert.equal(rerun.feedback, '', 'a re-run repeats the approved step rather than revising it');
  const ctx = h.calls.contexts.at(-1).ctx;
  assert.ok(Number.isInteger(ctx.seedSalt) && ctx.seedSalt > 0, 'the re-run carries a fresh seed salt');

  const second = h.accepted('videoGeneration');
  assert.equal(second.version, first.version + 1);
  assert.equal(second.parentArtifactId, first.id);
  assert.equal(second.data.clips[0].videoPath, '/clip/take-2.mp4');
  assert.ok(h.calls.messages.some(message => message.text.includes('ui.rerunStarted')));
  assert.ok(h.calls.messages.some(message => message.text.includes('ui.rerunComplete')));
});

test('a re-run of the video step retires the cut that consumed the old clips', async () => {
  const h = await createHarness();
  await h.runPipeline(6);
  const firstCut = h.accepted('postProduction');

  await h.api.rerunStep('videoGeneration');

  assert.equal(firstCut.status, ArtifactStatus.STALE);
  assert.equal(h.accepted('postProduction'), null);
  assert.equal(h.state.data.finalVideo, null);
  assert.equal(h.state.currentStep, 4, 'the pipeline rewinds so the final cut can be re-rendered');
});
