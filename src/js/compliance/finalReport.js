import { getIPComplianceAgent } from '../agents/ipComplianceAgent.js';
import { QCVerdict } from '../agents/qcTypes.js';
import { checkVisualMedia } from './visualCompliance.js';

const VERDICT_ORDER = [QCVerdict.PASS, QCVerdict.CONDITIONAL_PASS, QCVerdict.FAIL];

function worstVerdict(values) {
  return values.reduce((worst, value) =>
    VERDICT_ORDER.indexOf(value) > VERDICT_ORDER.indexOf(worst) ? value : worst, QCVerdict.PASS);
}

function collectStrings(value, output = [], seen = new Set()) {
  if (typeof value === 'string') {
    if (value.trim()) output.push(value);
    return output;
  }
  if (!value || typeof value !== 'object' || seen.has(value)) return output;
  seen.add(value);
  for (const item of Array.isArray(value) ? value : Object.values(value)) collectStrings(item, output, seen);
  return output;
}

async function sha256(value) {
  const text = JSON.stringify(value);
  if (!globalThis.crypto?.subtle) return null;
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function collectSourceRights(uploads) {
  const entries = [];
  if (!uploads) return entries;
  const add = (kind, asset) => {
    if (!asset) return;
    entries.push({
      kind,
      name: asset.name || asset.filename || null,
      source: asset.source || asset.sourceUrl || null,
      license: asset.license || asset.licenseId || null,
      authorized: asset.authorized === true,
      authorizationEvidence: asset.authorizationEvidence || null,
      status: asset.authorized === true && (asset.source || asset.sourceUrl) && (asset.license || asset.authorizationEvidence)
        ? 'DECLARED' : 'UNKNOWN',
    });
  };
  add('firstFrame', uploads.firstFrame);
  add('lastFrame', uploads.lastFrame);
  for (const asset of uploads.referenceImages || []) add('referenceImage', asset);
  return entries;
}

function visualCheckToReport(id, name, result) {
  const findings = result?.findings || result?.results?.flatMap(item => item.findings || []) || [];
  return {
    id, name, status: result?.status || 'UNAVAILABLE',
    verdict: result?.verdict || QCVerdict.CONDITIONAL_PASS,
    issues: findings.map(finding => `${finding.type}: ${finding.matched || finding.label || 'visual evidence'}`),
    findings,
    visual: result || null,
  };
}

export async function buildFinalComplianceReport({ userInput = '', data = {}, uploads = null, finalVideo = null, signal = null } = {}) {
  const agent = getIPComplianceAgent();
  const checks = [];
  const inputResult = agent.checkUserInput(userInput);
  checks.push({ id: 'user-input-ip', name: '用户输入文本 IP 筛查', status: 'completed', ...inputResult });

  for (const stepId of ['script', 'characterDesign', 'storyboard', 'referenceImages', 'videoGeneration']) {
    if (!data?.[stepId] && !(stepId === 'videoGeneration' && data?.videoClips)) continue;
    const payload = stepId === 'videoGeneration' ? (data.videoGeneration || data.videoClips) : data[stepId];
    const result = agent.checkStepOutput(stepId, payload);
    checks.push({ id: `${stepId}-ip`, name: `${stepId} 文本与提示词 IP 筛查`, status: 'completed', ...result });
  }

  const promptPackage = data?.promptPackage || data?.referenceImages?.promptPackage || null;
  if (promptPackage) {
    const result = agent.checkTexts(collectStrings(promptPackage));
    checks.push({ id: 'prompt-package-ip', name: 'PromptPackage 全字段 IP 筛查', status: 'completed', ...result });
  }

  const sourceRights = collectSourceRights(uploads);
  const hasUploads = sourceRights.length > 0;
  const unknownRights = sourceRights.filter(entry => entry.status === 'UNKNOWN');
  checks.push({
    id: 'source-rights',
    name: '输入素材权利声明',
    status: unknownRights.length ? 'requires-human-review' : hasUploads ? 'declared' : 'not-applicable',
    verdict: unknownRights.length ? QCVerdict.CONDITIONAL_PASS : QCVerdict.PASS,
    issues: unknownRights.length ? ['部分上传素材缺少来源、许可证或授权证明，不能自动视为已授权。'] : [],
    assets: sourceRights,
  });

  for (const [id, name, result] of [
    ['character-design-visual', '角色与场景图片视觉合规', data?.characterDesign?.visualCompliance],
    ['reference-images-visual', '镜头参考图视觉合规', data?.referenceImages?.visualCompliance],
    ['video-clips-visual', '视频片段视觉合规', (data?.videoGeneration || data?.videoClips)?.visualCompliance],
  ]) if (result) checks.push(visualCheckToReport(id, name, result));

  const finalVisual = finalVideo
    ? await checkVisualMedia(finalVideo, { type: 'video', stage: 'postProduction', signal })
    : null;
  checks.push(visualCheckToReport('final-video-visual', '最终成片 OCR、商标、水印、相似度与公众人物检查', finalVisual));

  const findings = checks.flatMap(check => (check.findings || []).map(finding => ({ checkId: check.id, ...finding })));
  const uniqueFindings = [...new Map(findings.map(finding => [
    `${finding.checkId}|${finding.type || finding.candidateId}|${finding.matchType || ''}|${finding.matched || finding.label || ''}|${finding.evidence?.frame || ''}`, finding,
  ])).values()];
  const verdict = worstVerdict(checks.map(check => check.verdict));
  const report = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    verdict,
    automaticClearance: false,
    summary: {
      checkCount: checks.length,
      findingCount: uniqueFindings.length,
      blockingFindings: uniqueFindings.filter(finding => finding.verdict === QCVerdict.FAIL).length,
      humanReviewRequired: checks.some(check => check.status === 'requires-human-review' || check.status === 'UNAVAILABLE' || check.visual?.humanReviewRequired),
    },
    checks,
    findings: uniqueFindings,
    recommendations: [
      ...new Set([
        ...uniqueFindings.map(finding => finding.recommendation).filter(Boolean),
        '交付前人工观看完整成片，检查商标、水印、公众人物肖像及与既有作品的视觉近似。',
        ...(unknownRights.length ? ['补充上传素材的来源、许可证和授权证明。'] : []),
      ]),
    ],
    limitations: [
      '文本匹配不能证明不存在版权、商标或肖像权风险。',
      'OCR 只能识别可见文字，不能单独证明版权、商标或肖像权合规。',
      ...(checks.some(check => check.visual?.checks?.some(item => item.status === 'UNAVAILABLE'))
        ? ['一个或多个可选视觉模型不可用；对应项目必须人工复核。'] : []),
    ],
    sourceRights,
  };
  report.sha256 = await sha256({ ...report, generatedAt: undefined });
  return report;
}
