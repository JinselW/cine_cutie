import { QCVerdict, Severity } from './qcTypes.js';

export const DELIVERY_QC_LIMITS = Object.freeze({ durationToleranceRatio: 0.1, durationToleranceFloorSeconds: 2,
  blackDurationFailSeconds: 0.5, blackRatioFail: 0.02, freezeDurationFailSeconds: 2,
  clippingPeakDbfs: -0.1, quietIntegratedLufs: -24, loudIntegratedLufs: -8 });
const finite = value => { const number = Number(value); return Number.isFinite(number) ? number : null; };
const check = (id, status, message, actual = null, expected = null) => ({ id, status, message, actual, expected });

export function evaluateDeliveryBaseline(data, { expectedDuration = null } = {}) {
  const baseline = data?.qcBaseline || {}; const checks = [];
  const duration = finite(baseline.durationSeconds); const width = finite(baseline.width); const height = finite(baseline.height); const fps = finite(baseline.fps);
  const blackDuration = finite(baseline.blackDurationSeconds) ?? 0; const freezeDuration = finite(baseline.freezeDurationSeconds) ?? 0;
  checks.push(check('output', data?.finalVideo && data?.status !== 'failed' ? 'PASS' : 'FAIL', data?.finalVideo ? 'Final video was produced' : 'Final video is missing'));
  const validStream = width > 0 && height > 0 && fps > 0 && duration > 0;
  checks.push(check('video_stream', validStream ? 'PASS' : 'FAIL', validStream ? 'Playable video stream detected' : 'Video stream metadata is invalid', { width, height, fps, duration }));
  const requestedDuration = finite(expectedDuration);
  if (requestedDuration > 0 && duration > 0) { const tolerance = Math.max(2, requestedDuration * 0.1); const delta = Math.abs(duration - requestedDuration);
    checks.push(check('duration', delta <= tolerance ? 'PASS' : 'FAIL', delta <= tolerance ? 'Duration matches the requested delivery' : 'Final duration differs materially from the requested duration', duration, { seconds: requestedDuration, tolerance })); }
  const blackRatio = duration > 0 ? blackDuration / duration : 0; const blackFail = blackDuration >= 0.5 && blackRatio >= 0.02;
  checks.push(check('black_frames', blackFail ? 'FAIL' : 'PASS', blackFail ? 'Excessive black frames detected' : 'No excessive black frames detected', { seconds: blackDuration, ratio: blackRatio }));
  const freezeFail = freezeDuration >= 2;
  checks.push(check('freeze_frames', freezeFail ? 'FAIL' : 'PASS', freezeFail ? 'Long frozen segment detected' : 'No long frozen segment detected', freezeDuration));
  if (baseline.hasAudio) { const peak = finite(baseline.truePeakDbfs); const loudness = finite(baseline.integratedLufs);
    if (peak != null) checks.push(check('audio_peak', peak >= -0.1 ? 'WARN' : 'PASS', peak >= -0.1 ? 'Audio may be clipping' : 'Audio peak is within range', peak));
    if (loudness != null) { const out = loudness < -24 || loudness > -8; checks.push(check('audio_loudness', out ? 'WARN' : 'PASS', out ? 'Integrated loudness is outside the delivery range' : 'Integrated loudness is within range', loudness)); }
  } else checks.push(check('audio_presence', 'WARN', 'Final video has no audio stream'));
  const failed = checks.filter(x => x.status === 'FAIL'); const warned = checks.filter(x => x.status === 'WARN');
  const verdict = failed.length ? QCVerdict.FAIL : warned.length ? QCVerdict.CONDITIONAL_PASS : QCVerdict.PASS;
  const repairTarget = failed.some(x => ['output', 'video_stream'].includes(x.id)) ? 'postProduction' : failed.some(x => ['black_frames', 'freeze_frames'].includes(x.id)) ? 'videoGeneration' : failed.some(x => x.id === 'duration') ? 'storyboard' : null;
  return { verdict, severity: failed.length ? Severity.HIGH : warned.length ? Severity.MEDIUM : null, score: verdict === QCVerdict.PASS ? 10 : verdict === QCVerdict.CONDITIONAL_PASS ? 7 : 5,
    checks, issues: [...failed, ...warned].map(x => x.message), repairPlan: repairTarget ? { targetStep: repairTarget, reason: failed.map(x => x.message).join('; ') } : null };
}
