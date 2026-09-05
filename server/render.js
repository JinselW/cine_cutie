import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const ffmpegPath = require('ffmpeg-static');

export async function concatVideos(inputPaths, outputPath) {
  const dir = path.dirname(outputPath);
  fs.mkdirSync(dir, { recursive: true });

  const listFile = outputPath + '.list';
  const content = inputPaths.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
  fs.writeFileSync(listFile, content);

  return new Promise((resolve, reject) => {
    execFile(ffmpegPath, [
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', listFile,
      '-c', 'copy',
      outputPath
    ], (err, stdout, stderr) => {
      try { fs.unlinkSync(listFile); } catch {}
      if (err) {
        reject(new Error(`ffmpeg concat failed: ${stderr || err.message}`));
      } else {
        resolve(outputPath);
      }
    });
  });
}

export async function checkFfmpeg() {
  return new Promise(resolve => {
    execFile(ffmpegPath, ['-version'], (err) => {
      resolve(!err);
    });
  });
}
