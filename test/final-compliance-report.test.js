import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFinalComplianceReport } from '../src/js/compliance/finalReport.js';
import { QCVerdict } from '../src/js/agents/qcTypes.js';

test('final compliance report scans all text stages and requires review when visual checks are unavailable', async () => {
  const report = await buildFinalComplianceReport({
    userInput: 'An original traveler crosses a quiet desert.',
    data: {
      script: { title: 'Sand Road', characters: [{ name: 'Mira' }] },
      storyboard: { episodes: [{ segments: [{ shots: [{ description: 'Mira walks onward' }] }] }] },
      referenceImages: { shots: [{ prompt: 'original traveler, no logos' }] },
      videoClips: { clips: [{ prompt: 'wind moves across the sand' }] },
    },
  });
  assert.equal(report.schemaVersion, 2);
  assert.equal(report.verdict, QCVerdict.CONDITIONAL_PASS);
  assert.equal(report.summary.humanReviewRequired, true);
  assert.equal(report.automaticClearance, false);
  assert.ok(report.checks.some(check => check.id === 'final-video-visual' && check.status === 'UNAVAILABLE'));
  assert.ok(report.sha256 === null || /^[a-f0-9]{64}$/.test(report.sha256));
});

test('final compliance report does not treat unknown upload rights as authorized', async () => {
  const report = await buildFinalComplianceReport({ uploads: { firstFrame: { name: 'frame.png' } } });
  assert.equal(report.sourceRights[0].status, 'UNKNOWN');
  assert.equal(report.sourceRights[0].authorized, false);
  assert.equal(report.summary.humanReviewRequired, true);
});

test('final compliance report hash is stable for identical evidence', async () => {
  const input = { data: { script: { title: 'Original Story' } } };
  const first = await buildFinalComplianceReport(input);
  await new Promise(resolve => setTimeout(resolve, 2));
  const second = await buildFinalComplianceReport(input);
  assert.equal(first.sha256, second.sha256);
});

test('final compliance report preserves blocking IP findings', async () => {
  const report = await buildFinalComplianceReport({
    data: { script: { title: 'Spider-Man Returns' } },
  });
  assert.equal(report.verdict, QCVerdict.FAIL);
  assert.ok(report.summary.blockingFindings > 0);
  assert.ok(report.findings.some(finding => finding.candidateIp === 'Spider-Man'));
});
