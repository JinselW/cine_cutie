import { execFile, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

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

function runFfmpeg(args, { durationSeconds = 0, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const outputPath = args[args.length - 1];
    const child = spawn(ffmpegPath, [
      ...args.slice(0, -1), '-progress', 'pipe:1', '-nostats', outputPath,
    ]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
      const seconds = parseFfmpegProgress(stdout);
      if (durationSeconds > 0 && seconds > 0) {
        onProgress?.(Math.min(99, Math.floor((seconds / durationSeconds) * 100)));
      }
      if (stdout.length > 8192) stdout = stdout.slice(-4096);
    });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', err => reject(new Error(`ffmpeg concat failed: ${err.message}`)));
    child.on('close', code => {
      if (code) reject(new Error(`ffmpeg concat failed: ${stderr || `exit code ${code}`}`));
      else resolve();
    });
  });
}

export async function concatVideos(inputPaths, outputPath, { onProgress } = {}) {
  const dir = path.dirname(outputPath);
  fs.mkdirSync(dir, { recursive: true });

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
      await runFfmpeg([...concat, '-c', 'copy', outputPath], { durationSeconds, onProgress });
      const stat = fs.statSync(outputPath);
      copySucceeded = stat.size > 0;
    } catch {
      copySucceeded = false;
    }

    if (!copySucceeded) {
      onProgress?.(0);
      await runFfmpeg([...concat,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '128k',
        outputPath], { durationSeconds, onProgress });
    }
    return outputPath;
  } finally {
    try { fs.unlinkSync(listFile); } catch {}
  }
}

export async function checkFfmpeg() {
  return new Promise(resolve => {
    execFile(ffmpegPath, ['-version'], (err) => {
      resolve(!err);
    });
  });
}
