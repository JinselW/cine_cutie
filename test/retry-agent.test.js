import test from 'node:test';
import assert from 'node:assert/strict';
import { RetryAgent, ItemRetryStrategy } from '../src/js/agents/retryAgent.js';
import { selectComfyWorkflow } from '../src/js/providers/comfyWorkflowMode.js';

test('first real prompt failure produces an addressable prompt rewrite', () => {
  const agent = new RetryAgent();
  const [plan] = agent.planItemRetry(
    [{ itemId: 'shot-1', error: 'prompt quality rejected' }],
    { 'shot-1': { attempts: [{ status: 'failed', error: 'prompt quality rejected', seed: 10 }] } },
    { feedback: 'Use a clearer action prompt' },
  );

  assert.equal(plan.strategy, ItemRetryStrategy.REWRITE_PROMPT);
  assert.equal(plan.overrides.promptOverrides['shot-1'], 'Use a clearer action prompt');
  assert.equal(plan.overrides.seed, 11);
});

test('retry limit counts provider calls rather than pending bookkeeping entries', () => {
  const agent = new RetryAgent();
  const failed = [{ itemId: 'shot-1', error: 'network error' }];
  const twoCalls = { 'shot-1': { attempts: [{ status: 'failed' }, { status: 'failed' }] } };
  const threeCalls = { 'shot-1': { attempts: [...twoCalls['shot-1'].attempts, { status: 'failed' }] } };

  assert.notEqual(agent.planItemRetry(failed, twoCalls)[0].strategy, ItemRetryStrategy.GIVE_UP);
  assert.equal(agent.planItemRetry(failed, threeCalls)[0].strategy, ItemRetryStrategy.GIVE_UP);
});

test('replaced ComfyUI reference list selects the replacement image', () => {
  assert.deepEqual(selectComfyWorkflow({
    imageUrl: '/api/media/new.png',
    referenceImages: ['/api/media/new.png'],
  }), {
    mode: 'referenceImage',
    images: ['/api/media/new.png'],
  });
});
