import { execFile, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { isTaskCancelled } from './tasks.js';

const require = createRequire(import.meta.url);
const ffmpegPath = require('ffmpeg-static');

export function parseFfmpegDuration(output = '') {
  const match = String(output).match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) return 0;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

export function parseFfmpegProgress(output = '') {
  const matches = [...String(output).matchAll(/out_time_(?:us|ms)=(\d+)/g)];
  return matches.length ? Number(matches[matches.length - 1][1]) / 1_000_000 : 0;
}

function srtTime(value) {
  const ms = Math.max(0, Math.round(Number(value || 0) * 1000));
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const millis = ms % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
}

export function formatSrt(cues = []) {
  return cues.filter(cue => Number(cue?.end) > Number(cue?.start) && String(cue?.text || '').trim())
    .map((cue, index) => `${index + 1}\n${srtTime(cue.start)} --> ${srtTime(cue.end)}\n${String(cue.text).replace(/\r?\n/g, ' ').trim()}\n`)
    .join('\n');
}

function subtitleFilterPath(filePath) {
  return filePath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

export async function applySubtitles(inputPath, cues, outputPath, { onProgress, taskId } = {}) {
  const srt = formatSrt(cues);
  if (!srt) return inputPath;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const subtitlePath = `${outputPath}.srt`;
  fs.writeFileSync(subtitlePath, `\uFEFF${srt}`, 'utf8');
  const info = await probeStreams(inputPath);
  const cancelCheck = taskId ? () => isTaskCancelled(taskId) : null;
  try {
    await runFfmpeg([
      '-y', '-i', inputPath,
      '-vf', `subtitles='${subtitleFilterPath(subtitlePath)}':force_style='FontName=Noto Sans CJK SC,FontSize=18,Outline=2,Shadow=1,MarginV=28'`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-c:a', 'copy', outputPath,
    ], { durationSeconds: info.duration, onProgress, cancelCheck });
    return outputPath;
  } finally {
    try { fs.unlinkSync(subtitlePath); } catch {}
  }
}

export function parseVisualDefects(output = '') {
  const text = String(output);
  const sumDurations = pattern => [...text.matchAll(pattern)]
    .reduce((sum, match) => sum + (Number(match[1]) || 0), 0);
  return {
    blackDurationSeconds: sumDurations(/black_duration:([0-9.]+)/g),
    freezeDurationSeconds: sumDurations(/freeze_duration:\s*([0-9.]+)/g),
  };
}

export function probeVisualDefects(inputPath) {
  return new Promise(resolve => {
    execFile(ffmpegPath, ['-hide_banner', '-i', inputPath, '-vf',
      'blackdetect=d=0.2:pix_th=0.10,freezedetect=n=-50dB:d=1', '-an', '-f', 'null', '-'],
    (_err, _stdout, stderr) => resolve(parseVisualDefects(stderr)));
  });
}

function probeDuration(inputPath) {
  return new Promise(resolve => {
    execFile(ffmpegPath, ['-hide_banner', '-i', inputPath], (_err, _stdout, stderr) => {
      resolve(parseFfmpegDuration(stderr));
    });
  });
}

function runFfmpeg(args, { durationSeconds = 0, onProgress, cancelCheck } = {}) {
  return new Promise((resolve, reject) => {
    if (cancelCheck?.()) {
      reject(new Error('Cancelled'));
      return;
    }
    const outputPath = args[args.length - 1];
    const child = spawn(ffmpegPath, [
      ...args.slice(0, -1), '-progress', 'pipe:1', '-nostats', outputPath,
    ]);
    let stdout = '';
    let stderr = '';
    let cancelTimer = null;
    const stopPolling = () => { if (cancelTimer) { clearInterval(cancelTimer); cancelTimer = null; } };
    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
      const seconds = parseFfmpegProgress(stdout);
      if (durationSeconds > 0 && seconds > 0) {
        onProgress?.(Math.min(99, Math.floor((seconds / durationSeconds) * 100)));
      }
      if (stdout.length > 8192) stdout = stdout.slice(-4096);
    });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', err => { stopPolling(); reject(new Error(`ffmpeg concat failed: ${err.message}`)); });
    child.on('close', code => {
      stopPolling();
      if (cancelCheck?.()) reject(new Error('Cancelled'));
      else if (code) reject(new Error(`ffmpeg concat failed: ${stderr || `exit code ${code}`}`));
      else resolve();
    });
    if (typeof cancelCheck === 'function') {
      cancelTimer = setInterval(() => {
        if (cancelCheck()) {
          stopPolling();
          child.kill('SIGKILL');
          reject(new Error('Cancelled'));
        }
      }, 100);
    }
  });
}

export async function concatVideos(inputPaths, outputPath, { onProgress, taskId } = {}) {
  const dir = path.dirname(outputPath);
  fs.mkdirSync(dir, { recursive: true });
  const cancelCheck = taskId ? () => isTaskCancelled(taskId) : null;

  const listFile = outputPath + '.list';
  // ffmpeg concat demuxer 使用 '' 转义单引号，而非 shell 的 '\''
  const content = inputPaths.map(p => `file '${p.replace(/'/g, "''")}'`).join('\n');
  fs.writeFileSync(listFile, content);
  const durations = await Promise.all(inputPaths.map(probeDuration));
  const durationSeconds = durations.reduce((sum, value) => sum + value, 0);

  const concat = ['-y', '-f', 'concat', '-safe', '0', '-i', listFile];
  try {
    let copySucceeded = false;
    try {
      await runFfmpeg([...concat, '-c', 'copy', outputPath], { durationSeconds, onProgress, cancelCheck });
      const stat = fs.statSync(outputPath);
      copySucceeded = stat.size > 0;
    } catch (err) {
      // a cancelled copy must not be mistaken for an encode failure and start a second ffmpeg
      if (cancelCheck?.() || (err?.message || '').includes('Cancelled')) throw err;
      copySucceeded = false;
    }

    if (!copySucceeded) {
      onProgress?.(0);
      await runFfmpeg([...concat,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '128k',
        outputPath], { durationSeconds, onProgress, cancelCheck });
    }
    return outputPath;
  } finally {
    try { fs.unlinkSync(listFile); } catch {}
  }
}

export const DEFAULT_TRANSITION = 0.5;

export function probeStreams(inputPath) {
  return new Promise(resolve => {
    execFile(ffmpegPath, ['-hide_banner', '-i', inputPath], (_err, _stdout, stderr) => {
      const videoLine = String(stderr).split('\n').find(l => /Stream#\d+:\d+.*Video:/.test(l))
        || String(stderr).split('\n').find(l => /Video:/.test(l)) || '';
      const size = videoLine.match(/(\d{2,5})x(\d{2,5})/);
      const fps = videoLine.match(/(\d+(?:\.\d+)?)\s*fps/);
      const pixFmt = videoLine.match(/Video:\s*([^,]+)/)?.[1]?.trim();
      resolve({
        duration: parseFfmpegDuration(stderr),
        hasVideo: /Video:/.test(stderr),
        hasAudio: /Audio:\s/.test(stderr),
        width: size ? Number(size[1]) : 0,
        height: size ? Number(size[2]) : 0,
        fps: fps ? Number(fps[1]) : 0,
        pixFmt,
      });
    });
  });
}

export function probeAudioQuality(inputPath) {
  return new Promise(resolve => {
    execFile(ffmpegPath, ['-hide_banner', '-i', inputPath, '-filter_complex', 'ebur128=peak=true', '-f', 'null', '-'], (_err, _stdout, stderr) => {
      const text = String(stderr || '');
      const summary = text.slice(text.lastIndexOf('Summary:'));
      const integrated = summary.match(/I:\s*(-?\d+(?:\.\d+)?)\s*LUFS/);
      const peak = summary.match(/Peak:\s*(-?\d+(?:\.\d+)?)\s*dBFS/);
      resolve({ integratedLufs: integrated ? Number(integrated[1]) : null, truePeakDbfs: peak ? Number(peak[1]) : null });
    });
  });
}

export function parseSilenceDuration(output = '') {
  const matches = [...String(output).matchAll(/silence_duration:\s*([0-9.]+)/g)];
  return matches.reduce((sum, m) => sum + (Number(m[1]) || 0), 0);
}

export function probeSilenceDuration(inputPath) {
  return new Promise(resolve => {
    execFile(ffmpegPath, ['-hide_banner', '-i', inputPath, '-af',
      'silencedetect=noise=-50dB:d=0.5', '-f', 'null', '-'],
    (_err, _stdout, stderr) => resolve(parseSilenceDuration(stderr)));
  });
}

export function probeAudioStreamDuration(inputPath) {
  return new Promise(resolve => {
    execFile(ffmpegPath, ['-hide_banner', '-i', inputPath], (_err, _stdout, stderr) => {
      const text = String(stderr);
      const audioLine = text.split('\n').find(l => /Stream.*Audio:/.test(l));
      if (!audioLine) return resolve(null);
      const dur = audioLine.match(/Duration:\s*([0-9.]+)/);
      if (dur) return resolve(Number(dur[1]));
      resolve(parseFfmpegDuration(text));
    });
  });
}

function pickTarget(streams) {
  const first = streams[0] || {};
  const width = first.width || 1280;
  const height = first.height || 720;
  const fps = Number(first.fps) > 0 ? Math.round(first.fps) : 24;
  return { width: width % 2 ? width + 1 : width, height: height % 2 ? height + 1 : height, fps };
}

function normVideo(i, W, H, F) {
  // scale+pad normalize any resolution/SAR to the target, fps + format normalise frame rate and pixels
  return `[${i}:v]setpts=PTS-STARTPTS,scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${F},format=yuv420p,settb=AVTB[v${i}]`;
}

function normAudio(i, duration, hasAudio) {
  // a clip without an audio stream is padded with silence so the transition chain still runs
  if (hasAudio) return `[${i}:a]aresample=48000,aformat=channel_layouts=stereo[a${i}]`;
  return `anullsrc=r=48000:cl=stereo[ns${i}];[ns${i}]atrim=duration=${(duration || 1).toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`;
}

// Builds one filter_complex graph that chains clips with crossfades (xfade + acrossfade)
// at scene-change boundaries and hard cuts (concat) elsewhere. Every branch is normalised to
// a shared resolution/fps/timebase so xfade accepts heterogeneous clips.
export function buildTransitionFilterGraph(clips, transitions = [], { fadeIn = false, fadeOut = false, width = 1280, height = 720, fps = 24 } = {}) {
  const n = clips.length;
  const parts = [];
  for (let i = 0; i < n; i++) {
    parts.push(normVideo(i, width, height, fps));
    parts.push(normAudio(i, clips[i]?.duration, clips[i]?.hasAudio));
  }

  let curV = 'v0';
  let curA = 'a0';
  let total = clips[0]?.duration || 0;

  for (let b = 1; b < n; b++) {
    const tf = transitions[b - 1] || {};
    const req = Number(tf.duration);
    // clamp to the incoming clip length and the cumulative duration; anything non-positive is a hard cut
    const td = (tf.type === 'crossfade' && Number.isFinite(req) && req > 0)
      ? Math.max(0, Math.min(req, clips[b]?.duration || 0, total))
      : 0;
    const offset = total - td;

    if (td > 0 && offset > 0) {
      const vOut = `xf${b}`;
      const aOut = `af${b}`;
      parts.push(`[${curV}][v${b}]xfade=transition=fade:duration=${td.toFixed(3)}:offset=${offset.toFixed(3)}[${vOut}]`);
      parts.push(`[${curA}][a${b}]acrossfade=d=${td.toFixed(3)}[${aOut}]`);
      curV = vOut;
      curA = aOut;
      total = total - td + (clips[b]?.duration || 0);
    } else {
      const cV = `cx${b}`;
      const vOut = `cf${b}`;
      const aOut = `caf${b}`;
      parts.push(`[${curV}][v${b}]concat=n=2:v=1:a=0[${cV}];[${cV}]settb=AVTB[${vOut}]`);
      parts.push(`[${curA}][a${b}]concat=n=2:v=0:a=1[${aOut}]`);
      curV = vOut;
      curA = aOut;
      total = total + (clips[b]?.duration || 0);
    }
  }

  let videoLabel = curV;
  let audioLabel = curA;
  if (fadeIn || fadeOut) {
    const dIn = fadeIn ? Math.min(DEFAULT_TRANSITION, total) : 0;
    const dOut = fadeOut ? Math.min(DEFAULT_TRANSITION, total) : 0;
    const hasIn = dIn > 0;
    const hasOut = dOut > 0 && (total - dOut) > 0;
    if (hasIn || hasOut) {
      const stOut = Math.max(0, total - dOut);
      let vChain = `[${curV}]`;
      let aChain = `[${curA}]`;
      if (hasIn) { vChain += `fade=t=in:st=0:d=${dIn.toFixed(3)},`; aChain += `afade=t=in:st=0:d=${dIn.toFixed(3)},`; }
      if (hasOut) { vChain += `fade=t=out:st=${stOut.toFixed(3)}:d=${dOut.toFixed(3)},`; aChain += `afade=t=out:st=${stOut.toFixed(3)}:d=${dOut.toFixed(3)},`; }
      vChain = vChain.replace(/,$/, '') + '[fv]';
      aChain = aChain.replace(/,$/, '') + '[fa]';
      parts.push(vChain);
      parts.push(aChain);
      videoLabel = 'fv';
      audioLabel = 'fa';
    }
  }

  return { filterComplex: parts.join(';'), videoLabel, audioLabel, total };
}

export async function renderWithTransitions(inputPaths, transitions, outputPath, { onProgress, fadeIn = false, fadeOut = false, taskId } = {}) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const streams = await Promise.all(inputPaths.map(probeStreams));
  if (streams.some(s => !(Number.isFinite(s.duration) && s.duration > 0) || !s.hasVideo || !(s.width > 0 && s.height > 0))) {
    throw new Error('Invalid clip: missing video stream, geometry or zero duration');
  }
  const target = pickTarget(streams);
  const clips = streams.map(s => ({ duration: s.duration, hasAudio: s.hasAudio }));
  const { filterComplex, videoLabel, audioLabel, total } = buildTransitionFilterGraph(clips, transitions, {
    fadeIn, fadeOut, width: target.width, height: target.height, fps: target.fps,
  });
  const cancelCheck = taskId ? () => isTaskCancelled(taskId) : null;
  const inputs = inputPaths.flatMap(p => ['-i', p]);
  const args = [
    '-y', ...inputs,
    '-filter_complex', filterComplex,
    '-map', `[${videoLabel}]`, '-map', `[${audioLabel}]`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k',
  ];
  await runFfmpeg([...args, outputPath], { durationSeconds: total, onProgress, cancelCheck });
  return outputPath;
}

export async function checkFfmpeg() {
  return new Promise(resolve => {
    execFile(ffmpegPath, ['-version'], (err) => {
      resolve(!err);
    });
  });
}

export const DEFAULT_BGM_VOLUME = 0.6;
const BGM_FADE = 0.3;

// Clamp a BGM volume to [0, 1]; NaN / non-finite falls back to the default, oversized values clamp to 1.
export function sanitizeVolume(value, fallback = DEFAULT_BGM_VOLUME) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

// BGM is looped at input level (`-stream_loop -1`), bounded by atrim to the video duration, then
// loudness-normalised. When the video carries audio (dialogue), a sidechain compressor ducks the
// BGM under it so dialogue stays intelligible; otherwise the BGM is used as the only audio track.
export function buildBgmFilterGraph(inputHasAudio, duration, { bgmVolume = DEFAULT_BGM_VOLUME, fadeIn = 0, fadeOut = 0 } = {}) {
  const bgm = `aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,atrim=duration=${duration.toFixed(3)},asetpts=PTS-STARTPTS,loudnorm=I=-16:TP=-1.5:LRA=11,volume=${bgmVolume}[bn]`;
  const stOut = Math.max(0, duration - fadeOut);
  const fades = `afade=t=in:st=0:d=${fadeIn.toFixed(3)},afade=t=out:st=${stOut.toFixed(3)}:d=${fadeOut.toFixed(3)}`;
  if (inputHasAudio) {
    const parts = [
      `[0:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,asplit=2[mA][mB]`,
      `[1:a]${bgm}`,
      `[bn][mA]sidechaincompress=threshold=0.05:ratio=8:attack=200:release=1000[duck]`,
      `[mB][duck]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[mix]`,
      `[mix]${fades},aresample=48000,alimiter=limit=0.95[aout]`,
    ];
    return { filterComplex: parts.join(';'), audioLabel: 'aout' };
  }
  const parts = [
    `[1:a]${bgm}`,
    `[bn]${fades},aresample=48000,alimiter=limit=0.95[aout]`,
  ];
  return { filterComplex: parts.join(';'), audioLabel: 'aout' };
}

export async function applyBgm(inputPath, bgmPath, outputPath, { bgmVolume = DEFAULT_BGM_VOLUME, fadeIn = BGM_FADE, fadeOut = BGM_FADE, onProgress, taskId } = {}) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const info = await probeStreams(inputPath);
  if (!(Number.isFinite(info.duration) && info.duration > 0)) throw new Error('Invalid video for BGM mix');
  const { filterComplex, audioLabel } = buildBgmFilterGraph(info.hasAudio, info.duration, { bgmVolume: sanitizeVolume(bgmVolume), fadeIn, fadeOut });
  const cancelCheck = taskId ? () => isTaskCancelled(taskId) : null;
  const args = [
    '-y', '-i', inputPath, '-stream_loop', '-1', '-i', bgmPath,
    '-filter_complex', filterComplex,
    '-map', '0:v', '-c:v', 'copy',
    '-map', `[${audioLabel}]`, '-c:a', 'aac', '-b:a', '128k',
  ];
  await runFfmpeg([...args, outputPath], { durationSeconds: info.duration, onProgress, cancelCheck });
  return outputPath;
}
