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

function probeDuration(inputPath) {
  return new Promise(resolve => {
    execFile(ffmpegPath, ['-hide_banner', '-i', inputPath], (_err, _stdout, stderr) => {
      resolve(parseFfmpegDuration(stderr));
    });
  });
}

function runFfmpeg(args, { durationSeconds = 0, onProgress, cancelCheck } = {}) {
  return new Promise((resolve, reject) => {
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
      if (code) reject(new Error(`ffmpeg concat failed: ${stderr || `exit code ${code}`}`));
      else resolve();
    });
    if (typeof cancelCheck === 'function') {
      cancelTimer = setInterval(() => {
        if (cancelCheck()) {
          stopPolling();
          child.kill('SIGKILL');
          reject(new Error('Cancelled'));
        }
      }, 500);
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
