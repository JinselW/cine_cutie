import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFeedback, appendPromptGuidance, feedbackDirective } from '../src/js/feedback.js';
import { combineVerdict } from '../src/js/agents/qcAgent.js';
import { QCVerdict, Severity } from '../src/js/agents/qcTypes.js';

test('feedback is appended as a mandatory generation requirement', () => {
  const prompt = appendFeedback('cinematic portrait', 'keep the coat red');
  assert.match(prompt, /cinematic portrait/);
  assert.match(prompt, /USER REVISION REQUIREMENT \(must be satisfied\): keep the coat red/);
});

test('feedback appending is idempotent across retry layers', () => {
  const once = appendFeedback('base prompt', 'remove the crowd');
  const twice = appendFeedback(once, 'remove the crowd');
  assert.equal(twice, once);
});

test('quality suggestions preserve both the original prompt and user feedback', () => {
  const prompt = appendPromptGuidance('base prompt', {
    feedback: 'use a static camera',
    suggestions: ['reduce motion blur'],
  });
  assert.match(prompt, /^base prompt/);
  assert.match(prompt, /QUALITY IMPROVEMENTS: reduce motion blur/);
  assert.match(prompt, /use a static camera/);
  assert.equal(feedbackDirective('   '), '');
});

test('QC fails closed when a revision does not prove feedback compliance', () => {
  const consistency = { verdict: QCVerdict.PASS, severity: null, issues: [] };
  const result = combineVerdict(consistency, {
    score: 9,
    issues: [],
    suggestions: [],
    feedbackSatisfied: false,
    feedbackIssues: ['The requested red coat is still blue.'],
  }, { feedbackRequired: true });

  assert.equal(result.verdict, QCVerdict.FAIL);
  assert.equal(result.severity, Severity.HIGH);
  assert.equal(result.score, 0);
  assert.deepEqual(result.issues, ['The requested red coat is still blue.']);
});

test('QC accepts a structurally valid revision only when feedback is explicitly satisfied', () => {
  const consistency = { verdict: QCVerdict.PASS, severity: null, issues: [] };
  const result = combineVerdict(consistency, {
    score: 8.5,
    issues: [],
    suggestions: [],
    feedbackSatisfied: true,
    feedbackIssues: [],
  }, { feedbackRequired: true });

  assert.equal(result.verdict, QCVerdict.PASS);
  assert.equal(result.feedbackSatisfied, true);
  assert.equal(result.score, 8.5);
});
