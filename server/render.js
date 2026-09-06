import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const ffmpegPath = require('ffmpeg-static');

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile(ffmpegPath, args, (err, stdout, stderr) => {
      if (err) reject(new Error(`ffmpeg concat failed: ${stderr || err.message}`));
      else resolve();
    });
  });
}

export async function concatVideos(inputPaths, outputPath) {
  const dir = path.dirname(outputPath);
  fs.mkdirSync(dir, { recursive: true });

  const listFile = outputPath + '.list';
  const content = inputPaths.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
  fs.writeFileSync(listFile, content);

  const concat = ['-y', '-f', 'concat', '-safe', '0', '-i', listFile];
  try {
    try {
      await runFfmpeg([...concat, '-c', 'copy', outputPath]);
    } catch {
      await runFfmpeg([...concat,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '128k',
        outputPath]);
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
