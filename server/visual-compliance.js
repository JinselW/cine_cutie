import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import ffmpegStatic from 'ffmpeg-static';

const DEFAULT_INTERVAL_SECONDS = 5;
const MAX_FRAMES = 24;
const versionCache = new Map();

function abortError() {
  const error = new Error('Visual compliance check cancelled');
  error.name = 'AbortError';
  return error;
}

export function runProcess(command, args, { signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const child = spawn(command, args, { windowsHide: true });
    let stdout = '', stderr = '';
    const abort = () => { child.kill('SIGKILL'); reject(abortError()); };
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    child.on('error', error => { signal?.removeEventListener('abort', abort); reject(error); });
    child.on('close', code => {
      signal?.removeEventListener('abort', abort);
      if (signal?.aborted) return;
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${path.basename(command)} exited with ${code}: ${stderr.slice(-500)}`));
    });
  });
}

export function parseTsv(tsv, { source, timestampSeconds = null, frame = null } = {}) {
  const lines = String(tsv || '').trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split('\t');
  return lines.slice(1).map(line => {
    const values = line.split('\t');
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
    const confidence = Number(row.conf);
    const text = String(row.text || '').trim();
    if (!text || !Number.isFinite(confidence) || confidence < 0) return null;
    return {
      text,
      confidence: Math.max(0, Math.min(1, confidence / 100)),
      source,
      timestampSeconds,
      frame,
      box: {
        x: Number(row.left) || 0, y: Number(row.top) || 0,
        width: Number(row.width) || 0, height: Number(row.height) || 0,
      },
    };
  }).filter(Boolean);
}

export async function runOcr(imagePath, { signal, command = process.env.OCR_BIN || 'tesseract', language = process.env.OCR_LANG || 'eng+chi_sim' } = {}) {
  try {
    if (!versionCache.has(command)) {
      const version = await runProcess(command, ['--version'], { signal });
      versionCache.set(command, String(version.stdout || version.stderr).split(/\r?\n/)[0].trim() || null);
    }
    const { stdout } = await runProcess(command, [imagePath, 'stdout', '-l', language, 'tsv'], { signal });
    return { status: 'COMPLETED', checker: { name: 'tesseract-ocr', version: versionCache.get(command) }, observations: parseTsv(stdout, { source: imagePath }) };
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    return { status: 'UNAVAILABLE', checker: { name: 'tesseract-ocr', version: null }, observations: [], reason: error.code === 'ENOENT' ? 'Tesseract executable not found' : error.message };
  }
}

export async function extractVideoFrames(videoPath, { signal, intervalSeconds = DEFAULT_INTERVAL_SECONDS, maxFrames = MAX_FRAMES, ffmpegPath = process.env.FFMPEG_BIN || ffmpegStatic } = {}) {
  const interval = Math.max(0.5, Math.min(60, Number(intervalSeconds) || DEFAULT_INTERVAL_SECONDS));
  const limit = Math.max(1, Math.min(MAX_FRAMES, Number(maxFrames) || MAX_FRAMES));
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cine-visual-'));
  try {
    const pattern = path.join(tempDir, 'frame_%04d.jpg');
    await runProcess(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-i', videoPath, '-vf', `fps=1/${interval}`, '-frames:v', String(limit), '-q:v', '3', pattern], { signal });
    const files = (await fs.promises.readdir(tempDir)).filter(file => /^frame_\d+\.jpg$/i.test(file)).sort();
    return { tempDir, intervalSeconds: interval, frames: files.map((file, index) => ({ path: path.join(tempDir, file), frame: index + 1, timestampSeconds: index * interval })) };
  } catch (error) {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

async function runOptionalProvider(endpoint, imagePath, metadata, signal, name) {
  if (!endpoint) return { status: 'UNAVAILABLE', checker: { name, version: null }, findings: [], reason: `${name} endpoint is not configured` };
  try {
    const image = await fs.promises.readFile(imagePath);
    const response = await fetch(endpoint, {
      method: 'POST', signal,
      headers: { 'content-type': 'application/json', ...(process.env.VISUAL_COMPLIANCE_API_KEY ? { authorization: `Bearer ${process.env.VISUAL_COMPLIANCE_API_KEY}` } : {}) },
      body: JSON.stringify({ imageBase64: image.toString('base64'), mimeType: 'image/jpeg', metadata }),
    });
    if (!response.ok) throw new Error(`${name} returned HTTP ${response.status}`);
    const result = await response.json();
    return { status: 'COMPLETED', checker: { name, version: result.modelVersion || result.version || null }, findings: Array.isArray(result.findings) ? result.findings : [] };
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    return { status: 'UNAVAILABLE', checker: { name, version: null }, findings: [], reason: error.message };
  }
}

async function inspectImage(imagePath, metadata, options) {
  const ocr = await runOcr(imagePath, options);
  const observations = ocr.observations.map(item => ({ ...item, ...metadata, source: metadata.source }));
  const [similarity, publicFigure] = await Promise.all([
    runOptionalProvider(process.env.VISUAL_SIMILARITY_ENDPOINT, imagePath, metadata, options.signal, 'visual-similarity'),
    runOptionalProvider(process.env.PUBLIC_FIGURE_ENDPOINT, imagePath, metadata, options.signal, 'public-figure-recognition'),
  ]);
  return { frame: metadata.frame ?? null, timestampSeconds: metadata.timestampSeconds ?? null, source: metadata.source, ocr: { ...ocr, observations }, similarity, publicFigure };
}

export async function inspectMedia(filePath, { type = 'image', source = filePath, signal, intervalSeconds, maxFrames } = {}) {
  const scope = { mediaType: type, source, intervalSeconds: type === 'video' ? Math.max(0.5, Math.min(60, Number(intervalSeconds) || DEFAULT_INTERVAL_SECONDS)) : null, maxFrames: type === 'video' ? Math.max(1, Math.min(MAX_FRAMES, Number(maxFrames) || MAX_FRAMES)) : null };
  if (type !== 'video') return { scope, samples: [await inspectImage(filePath, { source, frame: null, timestampSeconds: null }, { signal })] };
  const extraction = await extractVideoFrames(filePath, { signal, intervalSeconds, maxFrames });
  try {
    const samples = [];
    for (const frame of extraction.frames) {
      if (signal?.aborted) throw abortError();
      samples.push(await inspectImage(frame.path, { source, frame: frame.frame, timestampSeconds: frame.timestampSeconds }, { signal }));
    }
    return { scope: { ...scope, intervalSeconds: extraction.intervalSeconds, sampledFrames: samples.length }, samples };
  } finally {
    await fs.promises.rm(extraction.tempDir, { recursive: true, force: true });
  }
}
