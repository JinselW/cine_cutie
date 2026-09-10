import { QCVerdict, Severity } from './qcTypes.js';

export const DELIVERY_QC_LIMITS = Object.freeze({ durationToleranceRatio: 0.1, durationToleranceFloorSeconds: 2,
  blackDurationFailSeconds: 0.5, blackRatioFail: 0.02, freezeDurationFailSeconds: 2,
  clippingPeakDbfs: -0.1, quietIntegratedLufs: -24, loudIntegratedLufs: -8,
  silenceDurationFailSeconds: 3, silenceRatioFail: 0.3,
  audioVideoDurationMismatchSeconds: 1.5,
  minDialogueRatio: 0.0, maxBgmRatio: 1.0,
  audioPresenceBlocking: false });
const finite = value => { const number = Number(value); return Number.isFinite(number) ? number : null; };
const check = (id, status, message, actual = null, expected = null) => ({ id, status, message, actual, expected });

export function evaluateDeliveryBaseline(data, { expectedDuration = null, limits = DELIVERY_QC_LIMITS } = {}) {
  const baseline = data?.qcBaseline || {}; const checks = [];
  const duration = finite(baseline.durationSeconds); const width = finite(baseline.width); const height = finite(baseline.height); const fps = finite(baseline.fps);
  const blackDuration = finite(baseline.blackDurationSeconds) ?? 0; const freezeDuration = finite(baseline.freezeDurationSeconds) ?? 0;
  checks.push(check('output', data?.finalVideo && data?.status !== 'failed' ? 'PASS' : 'FAIL', data?.finalVideo ? 'Final video was produced' : 'Final video is missing'));
  const validStream = width > 0 && height > 0 && fps > 0 && duration > 0;
  checks.push(check('video_stream', validStream ? 'PASS' : 'FAIL', validStream ? 'Playable video stream detected' : 'Video stream metadata is invalid', { width, height, fps, duration }));
  const requestedDuration = finite(expectedDuration);
  if (requestedDuration > 0 && duration > 0) { const tolerance = Math.max(2, requestedDuration * limits.durationToleranceRatio); const delta = Math.abs(duration - requestedDuration);
    checks.push(check('duration', delta <= tolerance ? 'PASS' : 'FAIL', delta <= tolerance ? 'Duration matches the requested delivery' : 'Final duration differs materially from the requested duration', duration, { seconds: requestedDuration, tolerance })); }
  const blackRatio = duration > 0 ? blackDuration / duration : 0; const blackFail = blackDuration >= limits.blackDurationFailSeconds && blackRatio >= limits.blackRatioFail;
  checks.push(check('black_frames', blackFail ? 'FAIL' : 'PASS', blackFail ? 'Excessive black frames detected' : 'No excessive black frames detected', { seconds: blackDuration, ratio: blackRatio }));
  const freezeFail = freezeDuration >= limits.freezeDurationFailSeconds;
  checks.push(check('freeze_frames', freezeFail ? 'FAIL' : 'PASS', freezeFail ? 'Long frozen segment detected' : 'No long frozen segment detected', freezeDuration));

  if (baseline.hasAudio) {
    const peak = finite(baseline.truePeakDbfs); const loudness = finite(baseline.integratedLufs);
    if (peak != null) checks.push(check('audio_peak', peak >= limits.clippingPeakDbfs ? 'WARN' : 'PASS', peak >= limits.clippingPeakDbfs ? 'Audio may be clipping' : 'Audio peak is within range', peak));
    if (loudness != null) { const out = loudness < limits.quietIntegratedLufs || loudness > limits.loudIntegratedLufs; checks.push(check('audio_loudness', out ? 'WARN' : 'PASS', out ? 'Integrated loudness is outside the delivery range' : 'Integrated loudness is within range', loudness)); }

    const silenceDuration = finite(baseline.audioSilenceSeconds) ?? 0;
    const silenceRatio = duration > 0 ? silenceDuration / duration : 0;
    const silenceFail = silenceDuration >= limits.silenceDurationFailSeconds && silenceRatio >= limits.silenceRatioFail;
    checks.push(check('audio_silence', silenceFail ? 'FAIL' : 'PASS', silenceFail ? 'Excessive silence detected in audio track' : 'No excessive silence detected', { seconds: silenceDuration, ratio: silenceRatio }));

    const audioDuration = finite(baseline.audioDurationSeconds);
    if (audioDuration != null && duration > 0) {
      const mismatch = Math.abs(audioDuration - duration);
      const mismatchFail = mismatch > limits.audioVideoDurationMismatchSeconds;
      checks.push(check('audio_duration', mismatchFail ? 'WARN' : 'PASS', mismatchFail ? 'Audio track duration mismatches video' : 'Audio duration matches video', { audioDuration, videoDuration: duration, mismatch }));
    }
  } else {
    const audioPresenceStatus = limits.audioPresenceBlocking ? 'FAIL' : 'WARN';
    checks.push(check('audio_presence', audioPresenceStatus, 'Final video has no audio stream'));
  }

  const soundPlan = data?.soundPlan;
  if (soundPlan?.shots?.length) {
    const totalShots = soundPlan.shots.length;
    const dialogueShots = soundPlan.shots.filter(s => s.dialogue || s.narratorText).length;
    const dialogueRatio = totalShots > 0 ? dialogueShots / totalShots : 0;
    checks.push(check('audio_dialogueRatio', 'PASS', `Dialogue planned for ${dialogueShots}/${totalShots} shots`, { ratio: dialogueRatio, dialogueShots, totalShots }));
  }

  const audioResult = data?.audioResult;
  if (audioResult) {
    const degradedCount = (audioResult.trackResults || []).filter(t => t.degraded).length;
    const totalCount = audioResult.total || 0;
    if (totalCount > 0 && degradedCount === totalCount) {
      checks.push(check('audio_sources', 'WARN', 'All audio tracks used fallback (no provider configured)', { degraded: degradedCount, total: totalCount }));
    } else if (degradedCount > 0) {
      checks.push(check('audio_sources', 'WARN', `${degradedCount}/${totalCount} audio tracks used fallback`, { degraded: degradedCount, total: totalCount }));
    } else if (totalCount > 0) {
      checks.push(check('audio_sources', 'PASS', `All ${totalCount} audio tracks generated`, { degraded: 0, total: totalCount }));
    }
  }

  const failed = checks.filter(x => x.status === 'FAIL'); const warned = checks.filter(x => x.status === 'WARN');
  const verdict = failed.length ? QCVerdict.FAIL : warned.length ? QCVerdict.CONDITIONAL_PASS : QCVerdict.PASS;
  const repairTarget = failed.some(x => ['output', 'video_stream'].includes(x.id)) ? 'postProduction' : failed.some(x => ['black_frames', 'freeze_frames'].includes(x.id)) ? 'videoGeneration' : failed.some(x => x.id === 'duration') ? 'storyboard' : null;
  return { verdict, severity: failed.length ? Severity.HIGH : warned.length ? Severity.MEDIUM : null, score: verdict === QCVerdict.PASS ? 10 : verdict === QCVerdict.CONDITIONAL_PASS ? 7 : 5,
    checks, issues: [...failed, ...warned].map(x => x.message), repairPlan: repairTarget ? { targetStep: repairTarget, reason: failed.map(x => x.message).join('; ') } : null };
}
