import { execFile, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { isTaskCancelled } from './tasks.js';
import { getAudioProvider } from './audio-providers.js';

const require = createRequire(import.meta.url);
const ffmpegPath = require('ffmpeg-static');

function runFfmpegAudio(args, { durationSeconds = 0, cancelCheck } = {}) {
  return new Promise((resolve, reject) => {
    if (cancelCheck?.()) { reject(new Error('Cancelled')); return; }
    const outputPath = args[args.length - 1];
    const child = spawn(ffmpegPath, [...args.slice(0, -1), '-progress', 'pipe:1', '-nostats', outputPath]);
    let stderr = '';
    let cancelTimer = null;
    const stopPolling = () => { if (cancelTimer) { clearInterval(cancelTimer); cancelTimer = null; } };
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', err => { stopPolling(); reject(new Error(`ffmpeg audio failed: ${err.message}`)); });
    child.on('close', code => {
      stopPolling();
      if (cancelCheck?.()) reject(new Error('Cancelled'));
      else if (code) reject(new Error(`ffmpeg audio failed: ${stderr || `exit code ${code}`}`));
      else resolve();
    });
    if (typeof cancelCheck === 'function') {
      cancelTimer = setInterval(() => {
        if (cancelCheck()) { stopPolling(); child.kill('SIGKILL'); reject(new Error('Cancelled')); }
      }, 100);
    }
  });
}

export async function generateSilentAudio(outputPath, duration, { cancelCheck } = {}) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  await runFfmpegAudio([
    '-y', '-f', 'lavfi', '-i', `anullsrc=r=48000:cl=stereo`,
    '-t', String(Math.max(0.1, duration)),
    '-c:a', 'aac', '-b:a', '128k',
    outputPath,
  ], { cancelCheck });
  return outputPath;
}

export async function generateAudioAsset({ type, text, prompt, duration, voiceProfile, speakerId, outputPath, taskId }) {
  const cancelCheck = taskId ? () => isTaskCancelled(taskId) : null;
  if (cancelCheck?.()) {
    return { audioPath: null, duration: 0, degraded: true, fallbackReason: 'Cancelled',
      lineage: buildLineage(type, text || prompt, voiceProfile, speakerId, null, 'Cancelled') };
  }

  const capability = type === 'tts' ? 'tts' : 'sfx';
  const provider = getAudioProvider(capability);

  if (provider) {
    const signal = cancelCheck ? { get aborted() { return cancelCheck(); } } : undefined;
    const result = await provider.generate({
      type,
      text: type === 'tts' ? text : null,
      prompt: type === 'sfx' ? prompt : null,
      duration,
      voiceProfile,
      speakerId,
      outputPath,
      signal,
    });
    if (result && result.audioPath) return result;
    const reason = result?.fallbackReason || 'Provider returned no audio';
    return {
      audioPath: null,
      duration: 0,
      degraded: true,
      fallbackReason: reason,
      lineage: result?.lineage || buildLineage(type, text || prompt, voiceProfile, speakerId, null, reason),
    };
  }

  await generateSilentAudio(outputPath, duration, { cancelCheck });
  return {
    audioPath: outputPath,
    duration,
    degraded: true,
    fallbackReason: type === 'tts' ? 'No TTS provider configured' : 'No SFX provider configured',
    lineage: buildLineage(type, text || prompt, voiceProfile, speakerId, outputPath,
      type === 'tts' ? 'No TTS provider configured' : 'No SFX provider configured'),
  };
}

function buildLineage(type, promptText, voiceProfile, speakerId, outputPath, fallbackReason) {
  return {
    provider: type === 'tts' ? 'mock-tts' : 'mock-sfx',
    model: null,
    modelVersion: null,
    prompt: type === 'sfx' ? promptText : null,
    text: type === 'tts' ? promptText : null,
    speakerId: speakerId || null,
    voiceProfile: voiceProfile || null,
    seed: null,
    inputHash: null,
    outputHash: null,
    taskId: null,
    startTime: new Date().toISOString(),
    endTime: new Date().toISOString(),
    fallbackReason,
  };
}

/**
 * Mix multiple audio tracks (already timed to shot durations) into a single
 * timeline audio file. Tracks are padded/trimmed to their target durations
 * and concatenated in order.
 */
export async function mixAudioTimeline(tracks, outputPath, { taskId } = {}) {
  const cancelCheck = taskId ? () => isTaskCancelled(taskId) : null;
  if (!tracks || tracks.length === 0) {
    await generateSilentAudio(outputPath, 0.1, { cancelCheck });
    return outputPath;
  }

  const validTracks = tracks.filter(t => t.audioPath && fs.existsSync(t.audioPath));
  if (validTracks.length === 0) {
    const totalDuration = tracks.reduce((sum, t) => sum + (t.duration || 0), 0);
    await generateSilentAudio(outputPath, totalDuration, { cancelCheck });
    return outputPath;
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const inputs = [];
  const filterParts = [];
  for (let i = 0; i < validTracks.length; i++) {
    inputs.push('-i', validTracks[i].audioPath);
    const dur = validTracks[i].duration || 5;
    filterParts.push(
      `[${i}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,` +
      `atrim=duration=${dur.toFixed(3)},asetpts=PTS-STARTPTS,` +
      `adelay=${Math.round((validTracks[i].offset || 0) * 1000)}|${Math.round((validTracks[i].offset || 0) * 1000)}[a${i}]`
    );
  }

  if (validTracks.length === 1) {
    filterParts.push(`[a0]aresample=48000[mix]`);
  } else {
    const label = validTracks.map((_, i) => `[a${i}]`).join('');
    filterParts.push(`${label}amix=inputs=${validTracks.length}:duration=longest:normalize=0[mix]`);
  }
  filterParts.push(`[mix]alimiter=limit=0.95[aout]`);

  const args = [
    '-y', ...inputs,
    '-filter_complex', filterParts.join(';'),
    '-map', '[aout]', '-c:a', 'aac', '-b:a', '128k',
    outputPath,
  ];
  await runFfmpegAudio(args, { cancelCheck });
  return outputPath;
}

/**
 * Overlay a pre-mixed audio track onto a video file. The video stream is
 * copied. If the video has native audio, the overlay is mixed with it using
 * amix so native dialogue/ambience is preserved. If no native audio, the
 * overlay is used as the sole audio track.
 */
export async function applyAudioOverlay(videoPath, overlayAudioPath, outputPath, { overlayVolume = 1.0, taskId } = {}) {
  const cancelCheck = taskId ? () => isTaskCancelled(taskId) : null;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const vol = Number.isFinite(overlayVolume) ? Math.max(0, Math.min(2, overlayVolume)) : 1.0;

  const { hasAudio } = await probeVideoAudio(videoPath);

  let filterParts;
  let audioLabel;
  if (hasAudio) {
    filterParts = [
      `[0:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[na]`,
      `[1:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,volume=${vol}[ov]`,
      `[na][ov]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[mix]`,
      `[mix]aresample=48000,alimiter=limit=0.95[aout]`,
    ];
    audioLabel = '[aout]';
  } else {
    filterParts = [
      `[1:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,volume=${vol}[aout]`,
    ];
    audioLabel = '[aout]';
  }

  const args = [
    '-y', '-i', videoPath, '-i', overlayAudioPath,
    '-filter_complex', filterParts.join(';'),
    '-map', '0:v', '-c:v', 'copy',
    '-map', audioLabel, '-c:a', 'aac', '-b:a', '128k',
    '-shortest',
    outputPath,
  ];
  await runFfmpegAudio(args, { cancelCheck });
  return outputPath;
}

function probeVideoAudio(inputPath) {
  return new Promise(resolve => {
    execFile(ffmpegPath, ['-hide_banner', '-i', inputPath], (_err, _stdout, stderr) => {
      resolve({ hasAudio: /Audio:\s/.test(String(stderr)) });
    });
  });
}

export function buildAudioLineageEntry({ type, provider, model, modelVersion, text, prompt, speakerId, voiceProfile, seed, inputHash, outputHash, taskId, startTime, endTime, fallbackReason }) {
  return {
    provider: provider || null,
    model: model || null,
    modelVersion: modelVersion || null,
    prompt: prompt || null,
    text: text || null,
    speakerId: speakerId || null,
    voiceProfile: voiceProfile || null,
    seed: seed ?? null,
    inputHash: inputHash || null,
    outputHash: outputHash || null,
    taskId: taskId || null,
    startTime: startTime || null,
    endTime: endTime || null,
    fallbackReason: fallbackReason || null,
  };
}
