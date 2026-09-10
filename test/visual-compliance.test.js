import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateVisualResponse, checkVisualMedia } from '../src/js/compliance/visualCompliance.js';
import { parseTsv } from '../server/visual-compliance.js';
import { inspectMedia, runProcess } from '../server/visual-compliance.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ffmpegPath = require('ffmpeg-static');

function payload(text, confidence = 0.98, overrides = {}) {
  return {
    scope: { mediaType: 'image', source: '/api/media/test.png' },
    samples: [{
      ocr: { status: 'COMPLETED', checker: { name: 'tesseract-ocr', version: '5' }, observations: text ? [{ text, confidence, source: '/api/media/test.png', box: { x: 1, y: 2, width: 3, height: 4 } }] : [] },
      similarity: { status: 'COMPLETED', checker: { name: 'mock-similarity', version: '1' }, findings: [] },
      publicFigure: { status: 'COMPLETED', checker: { name: 'mock-public-figure', version: '1' }, findings: [] },
      ...overrides,
    }],
  };
}

test('OCR exact brand text is blocking and retains evidence', () => {
  const result = evaluateVisualResponse(payload('Coca-Cola'));
  assert.equal(result.verdict, 'FAIL');
  assert.ok(result.findings.some(finding => finding.type === 'LOGO_OR_BRAND_TEXT'));
  assert.equal(result.findings[0].evidence.source, '/api/media/test.png');
});

test('watermark text is blocking', () => {
  const result = evaluateVisualResponse(payload('Shutterstock preview'));
  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.findings.some(finding => finding.type === 'WATERMARK'));
});

test('clean OCR with all configured providers passes', () => {
  const result = evaluateVisualResponse(payload('A quiet original scene'));
  assert.equal(result.verdict, 'PASS');
  assert.equal(result.humanReviewRequired, false);
});

test('unavailable checks require human review and never pass', () => {
  const result = evaluateVisualResponse({ samples: [{
    ocr: { status: 'UNAVAILABLE', reason: 'missing binary', observations: [] },
    similarity: { status: 'UNAVAILABLE', reason: 'not configured', findings: [] },
    publicFigure: { status: 'UNAVAILABLE', reason: 'not configured', findings: [] },
  }] });
  assert.equal(result.verdict, 'CONDITIONAL_PASS');
  assert.equal(result.status, 'REVIEW_REQUIRED');
  assert.equal(result.humanReviewRequired, true);
});

test('low confidence OCR enters review instead of blocking', () => {
  const result = evaluateVisualResponse(payload('uncertain glyphs', 0.4));
  assert.equal(result.verdict, 'CONDITIONAL_PASS');
  assert.ok(result.findings.some(finding => finding.type === 'LOW_CONFIDENCE_TEXT'));
});

test('optional provider can block public figure evidence', () => {
  const result = evaluateVisualResponse(payload('', 1, { publicFigure: {
    status: 'COMPLETED', checker: { name: 'mock-face', version: '2' },
    findings: [{ label: 'public person', confidence: 0.95, action: 'BLOCK', evidence: { frame: 3 } }],
  } }));
  assert.equal(result.verdict, 'FAIL');
  assert.ok(result.findings.some(finding => finding.type === 'PUBLIC_FIGURE'));
});

test('Tesseract TSV parser keeps boxes and frame evidence', () => {
  const tsv = 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n5\t1\t1\t1\t1\t1\t10\t20\t30\t40\t87.5\tSample';
  assert.deepEqual(parseTsv(tsv, { source: 'frame.jpg', frame: 2, timestampSeconds: 5 }), [{
    text: 'Sample', confidence: 0.875, source: 'frame.jpg', timestampSeconds: 5, frame: 2,
    box: { x: 10, y: 20, width: 30, height: 40 },
  }]);
});

test('client sends video sampling options and evaluates response', async () => {
  let request;
  const result = await checkVisualMedia('/api/media/movie.mp4', {
    type: 'video', stage: 'postProduction', intervalSeconds: 3, maxFrames: 8,
    fetchImpl: async (_url, options) => { request = JSON.parse(options.body); return { ok: true, json: async () => payload('Original') }; },
  });
  assert.deepEqual(request, { mediaRef: '/api/media/movie.mp4', type: 'video', intervalSeconds: 3, maxFrames: 8 });
  assert.equal(result.verdict, 'PASS');
});

test('video integration samples configured timestamps and cleans temporary frames', async () => {
  const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cine-visual-test-'));
  const videoPath = path.join(workDir, 'sample.mp4');
  const listTemps = async () => new Set((await fs.promises.readdir(os.tmpdir())).filter(name => name.startsWith('cine-visual-')));
  try {
    await runProcess(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=10:d=2.2', '-pix_fmt', 'yuv420p', videoPath]);
    const before = await listTemps();
    const previousBin = process.env.OCR_BIN;
    process.env.OCR_BIN = path.join(workDir, 'missing-tesseract');
    let result;
    try { result = await inspectMedia(videoPath, { type: 'video', source: '/api/media/sample.mp4', intervalSeconds: 1, maxFrames: 3 }); }
    finally { if (previousBin == null) delete process.env.OCR_BIN; else process.env.OCR_BIN = previousBin; }
    const after = await listTemps();
    assert.equal(result.scope.intervalSeconds, 1);
    assert.equal(result.scope.sampledFrames, 2);
    assert.deepEqual(result.samples.map(sample => sample.timestampSeconds), [0, 1]);
    assert.deepEqual(after, before);
  } finally {
    await fs.promises.rm(workDir, { recursive: true, force: true });
  }
});
