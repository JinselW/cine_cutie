import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './helpers/orchestratorHarness.js';

test('interactive approval is written into accepted artifact provenance', async () => {
  const h = await createHarness({ mode: 'interactive' });
  await h.orchestrator.startPipeline();
  const artifact = h.store.getAcceptedByStep('script');
  assert.ok(artifact);
  const review = h.orchestrator.recordReviewDecision('script');
  assert.equal(review.actor, 'human');
  assert.equal(review.decision, 'approved');
  assert.equal(artifact.provenance.review.mode, 'interactive');
  assert.ok(Number.isFinite(artifact.provenance.review.reviewedAt));
});

test('automatic mode cannot fabricate a human review', async () => {
  const h = await createHarness({ mode: 'auto' });
  await h.orchestrator.startPipeline();
  assert.equal(h.orchestrator.recordReviewDecision('script'), null);
  assert.equal(h.store.getAcceptedByStep('script').provenance.review, undefined);
});
