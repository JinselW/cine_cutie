import test from 'node:test';
import assert from 'node:assert/strict';
import { createArtifact, recordItemAttempt } from '../src/js/artifacts/artifactTypes.js';
import { getWorkflowIdentity } from '../server/comfyui.js';

test('every generation attempt schema preserves provider, model, workflow and hashes', () => {
  const artifact = createArtifact({ kind: 'videoClip', stepId: 'videoGeneration', data: {} });
  recordItemAttempt(artifact, 'shot-1', {
    provider: 'comfyui', model: 'MiniMax H3', modelVersion: 'workflow-managed',
    workflowId: 'h3_first_frame_to_video.json', workflowHash: 'a'.repeat(64),
    inputHash: 'b'.repeat(64), outputHash: 'c'.repeat(64), upstreamTaskId: 'prompt-123',
    seed: 42, prompt: 'test', status: 'complete',
  });
  const attempt = artifact.itemLineage['shot-1'].attempts[0];
  assert.equal(attempt.provider, 'comfyui');
  assert.equal(attempt.model, 'MiniMax H3');
  assert.equal(attempt.workflowId, 'h3_first_frame_to_video.json');
  assert.match(attempt.workflowHash, /^[a-f0-9]{64}$/);
  assert.match(attempt.inputHash, /^[a-f0-9]{64}$/);
  assert.match(attempt.outputHash, /^[a-f0-9]{64}$/);
  assert.equal(attempt.upstreamTaskId, 'prompt-123');
});

test('ComfyUI workflow identity is selected by effective mode and hashed from checked-in bytes', () => {
  const identity = getWorkflowIdentity('firstLastFrame', 1);
  assert.equal(identity.workflowMode, 'firstFrame');
  assert.equal(identity.workflowId, 'h3_first_frame_to_video.json');
  assert.match(identity.workflowHash, /^[a-f0-9]{64}$/);
});
