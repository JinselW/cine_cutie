// Run: node --experimental-vm-modules --test test/artifact-dependency.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { STEPS, producerStepOfDataKey } from '../src/js/config.js';
import { ArtifactStatus } from '../src/js/artifacts/artifactTypes.js';
import { QCVerdict, Severity } from '../src/js/agents/qcTypes.js';
import { createHarness, host, STEP_DATA } from './helpers/orchestratorHarness.js';

test('a context key resolves to the step that produces it', () => {
  assert.equal(producerStepOfDataKey('videoClips'), 'videoGeneration');
  assert.equal(producerStepOfDataKey('finalVideo'), 'postProduction');
  assert.equal(producerStepOfDataKey('script'), 'script');
  assert.equal(producerStepOfDataKey('unmappedKey'), 'unmappedKey');
  for (const step of STEPS) {
    for (const dataKey of step.contextKeys || []) {
      assert.ok(STEPS.some(candidate => candidate.id === producerStepOfDataKey(dataKey)),
        `${step.id} asks for "${dataKey}", which no step produces`);
    }
  }
});

test('a full run records the exact upstream version each step consumed', async () => {
  const h = await createHarness();
  await h.runPipeline(STEPS.length);

  const script = h.accepted('script');
  const character = h.accepted('characterDesign');
  const board = h.accepted('storyboard');
  const reference = h.accepted('referenceImages');
  const video = h.accepted('videoGeneration');
  const final = h.accepted('postProduction');
  for (const artifact of [script, character, board, reference, video, final]) assert.ok(artifact, 'every step adopted a version');

  const sourcesOf = stepId => host(h.accepted(stepId).sourceArtifactIds);
  assert.deepEqual(sourcesOf('script'), []);
  assert.deepEqual(sourcesOf('characterDesign'), [script.id]);
  assert.deepEqual(sourcesOf('storyboard'), [script.id]);
  assert.deepEqual(sourcesOf('referenceImages'), [script.id, board.id, character.id]);
  assert.deepEqual(sourcesOf('videoGeneration'), [script.id, board.id, reference.id, character.id]);
  assert.deepEqual(sourcesOf('postProduction'), [script.id, board.id, video.id],
    'postProduction depends on the videoGeneration artifact behind the videoClips key');
  assert.deepEqual(h.store.validateGraph(), { ok: true, issues: [] });
});

test('agents receive adopted upstream data, never a superseded or missing one', async () => {
  const h = await createHarness();
  await h.runPipeline(STEPS.length);

  const contextOf = stepId => h.calls.contexts.find(call => call.stepId === stepId).ctx;
  const videoContext = contextOf('videoGeneration');
  assert.deepEqual(host(videoContext.sourceArtifactIds), {
    script: h.accepted('script').id,
    storyboard: h.accepted('storyboard').id,
    referenceImages: h.accepted('referenceImages').id,
    characterDesign: h.accepted('characterDesign').id,
  });
  assert.deepEqual(videoContext.referenceImages, STEP_DATA.referenceImages);

  const postContext = contextOf('postProduction');
  assert.deepEqual(host(postContext.sourceArtifactIds), {
    script: h.accepted('script').id,
    storyboard: h.accepted('storyboard').id,
    videoClips: h.accepted('videoGeneration').id,
  });
  assert.deepEqual(postContext.videoClips, STEP_DATA.videoGeneration);
  assert.equal(postContext.videoGeneration, undefined, 'the producer step id is not leaked as a context key');
});

test('a step refuses to run when an upstream step has no adopted version', async () => {
  const h = await createHarness();
  await h.runPipeline(3);
  const runsBefore = h.calls.runs.length;

  h.store.supersede(h.accepted('script').id);
  await h.api.reviseStep('storyboard', 'tighten the pacing');

  assert.equal(h.calls.runs.length, runsBefore, 'the agent is never invoked');
  assert.equal(h.calls.failures.length, 1);
  assert.ok(h.calls.failures[0][0].includes('pipeline.missingUpstream'));
  assert.ok(h.calls.failures[0][0].includes('script'), 'the missing upstream key is named');
});

test('a rejected upstream revision keeps the previous version consumable', async () => {
  const h = await createHarness();
  await h.runPipeline(2);
  const scriptV1 = h.accepted('script');
  h.plan('script', [{ gate: { verdict: QCVerdict.FAIL, severity: Severity.HIGH, issues: ['rejected'] } }]);
  await h.api.reviseStep('script', 'rewrite');

  assert.equal(scriptV1.status, ArtifactStatus.COMPLETE);
  assert.equal(h.accepted('script').id, scriptV1.id);
  assert.equal(h.state.data.script, scriptV1.data);
  assert.equal(h.store.getLatestByStep('script').status, ArtifactStatus.FAILED);

  h.state.stopped = false;
  h.plan('characterDesign', [{}]);
  await h.api.reviseStep('characterDesign', 'redo designs');
  const context = h.calls.contexts.find(call => call.stepId === 'characterDesign').ctx;
  assert.equal(context.script, scriptV1.data, 'the next step still consumes the adopted version');
  assert.deepEqual(host(h.accepted('characterDesign').sourceArtifactIds), [scriptV1.id]);
});
