import { getIPComplianceAgent } from '../agents/ipComplianceAgent.js';
import { QCVerdict } from '../agents/qcTypes.js';

const WATERMARK_PATTERN = /\b(watermark|sample|preview|stock|shutterstock|alamy|getty(?:images)?|adobe\s*stock)\b|水印|样片|预览图/iu;
const VERDICT_ORDER = [QCVerdict.PASS, QCVerdict.CONDITIONAL_PASS, QCVerdict.FAIL];

function worst(values) {
  return values.reduce((current, value) => VERDICT_ORDER.indexOf(value) > VERDICT_ORDER.indexOf(current) ? value : current, QCVerdict.PASS);
}

export function evaluateVisualResponse(payload, { stage = 'unknown', mediaRef = '' } = {}) {
  const textAgent = getIPComplianceAgent();
  const findings = [];
  const checks = [];
  const samples = Array.isArray(payload?.samples) ? payload.samples : [];
  const ocrUnavailable = samples.length === 0 || samples.every(sample => sample.ocr?.status !== 'COMPLETED');
  const observations = samples.flatMap(sample => sample.ocr?.observations || []);

  for (const observation of observations) {
    const text = String(observation.text || '').trim();
    if (!text) continue;
    if (WATERMARK_PATTERN.test(text)) findings.push({ type: 'WATERMARK', action: 'BLOCK', verdict: QCVerdict.FAIL, risk: 'HIGH', matched: text, confidence: observation.confidence, evidence: observation });
    const ip = textAgent.checkText(text);
    for (const finding of ip.findings || []) findings.push({ ...finding, type: finding.candidateType === 'brand' ? 'LOGO_OR_BRAND_TEXT' : 'OCR_IP_TEXT', evidence: observation });
    if (!ip.findings?.length && observation.confidence < 0.65) findings.push({ type: 'LOW_CONFIDENCE_TEXT', action: 'REVIEW', verdict: QCVerdict.CONDITIONAL_PASS, risk: 'LOW', matched: text, confidence: observation.confidence, evidence: observation });
  }

  const providers = ['similarity', 'publicFigure'].flatMap(kind => samples.map(sample => ({ kind, result: sample[kind] })));
  for (const { kind, result } of providers) {
    for (const finding of result?.findings || []) {
      const confidence = Number(finding.confidence) || 0;
      const action = finding.action || (confidence >= 0.9 ? 'BLOCK' : 'REVIEW');
      findings.push({ ...finding, type: kind === 'similarity' ? 'VISUAL_SIMILARITY' : 'PUBLIC_FIGURE', action, verdict: action === 'BLOCK' ? QCVerdict.FAIL : QCVerdict.CONDITIONAL_PASS, evidence: finding.evidence || null });
    }
  }

  checks.push({ id: 'ocr', checker: samples.find(sample => sample.ocr)?.ocr?.checker || { name: 'tesseract-ocr', version: null }, status: ocrUnavailable ? 'UNAVAILABLE' : 'COMPLETED', reason: ocrUnavailable ? samples.find(sample => sample.ocr?.reason)?.ocr.reason || 'No OCR samples were produced' : null });
  for (const [id, key, name] of [['visual-similarity', 'similarity', 'visual-similarity'], ['public-figure', 'publicFigure', 'public-figure-recognition']]) {
    const results = samples.map(sample => sample[key]).filter(Boolean);
    const completed = results.some(result => result.status === 'COMPLETED');
    checks.push({ id, checker: results[0]?.checker || { name, version: null }, status: completed ? 'COMPLETED' : 'UNAVAILABLE', reason: completed ? null : results[0]?.reason || `${name} provider is unavailable` });
  }

  let verdict = worst(findings.map(finding => finding.verdict));
  const unavailable = checks.some(check => check.status === 'UNAVAILABLE');
  if (unavailable && verdict === QCVerdict.PASS) verdict = QCVerdict.CONDITIONAL_PASS;
  return {
    schemaVersion: 1, stage, mediaRef, scope: payload?.scope || null, verdict,
    status: findings.some(f => f.verdict === QCVerdict.FAIL) ? 'BLOCKED' : unavailable || findings.length ? 'REVIEW_REQUIRED' : 'PASS',
    humanReviewRequired: unavailable || findings.some(f => f.verdict === QCVerdict.CONDITIONAL_PASS),
    checks, findings,
  };
}

export async function checkVisualMedia(mediaRef, { type = 'image', stage = 'unknown', signal, intervalSeconds, maxFrames, fetchImpl = globalThis.fetch } = {}) {
  if (!mediaRef || typeof fetchImpl !== 'function') return evaluateVisualResponse(null, { stage, mediaRef });
  try {
    const response = await fetchImpl('/api/compliance/visual', {
      method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mediaRef, type, intervalSeconds, maxFrames }),
    });
    if (!response.ok) throw new Error(`Visual compliance service returned HTTP ${response.status}`);
    return evaluateVisualResponse(await response.json(), { stage, mediaRef });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    return { ...evaluateVisualResponse(null, { stage, mediaRef }), error: error.message };
  }
}

export async function checkVisualMediaBatch(items, options = {}) {
  const results = [];
  for (const item of items) results.push({ id: item.id, ...(await checkVisualMedia(item.mediaRef, { ...options, type: item.type || options.type })) });
  const verdict = worst(results.map(result => result.verdict));
  return { schemaVersion: 1, stage: options.stage || 'unknown', verdict, status: verdict === QCVerdict.FAIL ? 'BLOCKED' : results.some(r => r.humanReviewRequired) ? 'REVIEW_REQUIRED' : 'PASS', humanReviewRequired: results.some(r => r.humanReviewRequired), results };
}
