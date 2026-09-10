import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ensureTunnel } from './ssh-tunnel.js';
import { createHash } from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ComfyVideoMode = Object.freeze({
  TEXT: 'textToVideo',
  FIRST: 'firstFrame',
  FIRST_LAST: 'firstLastFrame',
  REFERENCE: 'referenceImage',
});

const WORKFLOW_FILES = Object.freeze({
  [ComfyVideoMode.TEXT]: 'h3_text_to_video.json',
  [ComfyVideoMode.FIRST]: 'h3_first_frame_to_video.json',
  [ComfyVideoMode.FIRST_LAST]: 'h3_first_last_frame_to_video.json',
  [ComfyVideoMode.REFERENCE]: 'h3_reference_to_video.json',
});

export const MAX_COMFY_REFERENCE_IMAGES = 6;

export function selectWorkflowMode(requestedMode, imageCount) {
  const count = Math.max(0, Number(imageCount) || 0);
  if (requestedMode === ComfyVideoMode.REFERENCE) {
    return count > 0 ? ComfyVideoMode.REFERENCE : ComfyVideoMode.TEXT;
  }
  if (requestedMode === ComfyVideoMode.FIRST_LAST) {
    if (count >= 2) return ComfyVideoMode.FIRST_LAST;
    return count === 1 ? ComfyVideoMode.FIRST : ComfyVideoMode.TEXT;
  }
  if (requestedMode === ComfyVideoMode.FIRST) {
    return count > 0 ? ComfyVideoMode.FIRST : ComfyVideoMode.TEXT;
  }
  return ComfyVideoMode.TEXT;
}

function loadWorkflowTemplate(mode) {
  const filename = WORKFLOW_FILES[mode];
  if (!filename) throw new Error(`Unsupported ComfyUI video mode: ${mode}`);
  const templatePath = path.join(__dirname, 'workflows', filename);
  return JSON.parse(fs.readFileSync(templatePath, 'utf-8'));
}

export function getWorkflowIdentity(requestedMode, imageCount = 0) {
  const mode = selectWorkflowMode(requestedMode, imageCount);
  const filename = WORKFLOW_FILES[mode];
  const bytes = fs.readFileSync(path.join(__dirname, 'workflows', filename));
  return { workflowId: filename, workflowHash: createHash('sha256').update(bytes).digest('hex'), workflowMode: mode };
}

function findNodes(workflow, classType) {
  return Object.entries(workflow).filter(([, node]) => node.class_type === classType);
}

function firstNode(workflow, classType) {
  return findNodes(workflow, classType)[0] || null;
}

function inputNodeId(input) {
  return Array.isArray(input) && typeof input[0] === 'string' ? input[0] : null;
}

function normalizeDuration(value) {
  const seconds = Math.round(Number(value));
  return Number.isFinite(seconds) ? Math.min(30, Math.max(1, seconds)) : 5;
}

function configureCommon(workflow, { prompt, seed, duration, enableLightning, aspectRatio, megapixels }) {
  const generator = firstNode(workflow, 'MiniMaxH3ImageToVideo') || firstNode(workflow, 'MiniMaxH3ReferenceToVideo');
  if (!generator) throw new Error('ComfyUI workflow has no MiniMax H3 generation node');

  const promptInput = generator[1].inputs.prompt;
  if (typeof promptInput === 'string') {
    generator[1].inputs.prompt = prompt || 'Scene animation';
  } else {
    const promptId = inputNodeId(promptInput);
    if (!promptId || !workflow[promptId]?.inputs || !('value' in workflow[promptId].inputs)) {
      throw new Error('ComfyUI workflow prompt input is not configurable');
    }
    workflow[promptId].inputs.value = prompt || 'Scene animation';
  }

  const noise = firstNode(workflow, 'RandomNoise');
  if (!noise) throw new Error('ComfyUI workflow has no RandomNoise node');
  noise[1].inputs.noise_seed = seed ?? Math.floor(Math.random() * 1e15);

  const durationNode = findNodes(workflow, 'PrimitiveFloat')
    .find(([, node]) => /duration/i.test(node._meta?.title || '')) || firstNode(workflow, 'PrimitiveFloat');
  if (!durationNode) throw new Error('ComfyUI workflow has no duration input');
  durationNode[1].inputs.value = normalizeDuration(duration);

  const resolution = firstNode(workflow, 'ResolutionSelector');
  if (!resolution) throw new Error('ComfyUI workflow has no resolution selector');
  const aspectMap = {
    '16:9': '16:9 (Widescreen)',
    '9:16': '9:16 (Portrait Widescreen)',
    '1:1': '1:1 (Square)',
    '4:3': '4:3 (Standard)',
    '3:4': '3:4 (Portrait Standard)',
    '21:9': '21:9 (Ultrawide)',
  };
  resolution[1].inputs.aspect_ratio = aspectMap[aspectRatio] || '16:9 (Widescreen)';
  if (Number.isFinite(megapixels)) {
    resolution[1].inputs.megapixels = megapixels;
  }

  const lightning = findNodes(workflow, 'PrimitiveBoolean')
    .find(([, node]) => /lightning/i.test(node._meta?.title || ''));
  if (lightning) lightning[1].inputs.value = !!enableLightning;
  return generator;
}

function configureFrameImages(workflow, generator, mode, imageFiles) {
  const files = imageFiles.filter(Boolean);
  if (mode === ComfyVideoMode.FIRST || mode === ComfyVideoMode.FIRST_LAST) {
    const bindings = mode === ComfyVideoMode.FIRST ? ['first_frame'] : ['first_frame', 'last_frame'];
    if (files.length < bindings.length) throw new Error(`${mode} requires ${bindings.length} image(s)`);
    bindings.forEach((binding, index) => {
      const nodeId = inputNodeId(generator[1].inputs[binding]);
      if (!nodeId || workflow[nodeId]?.class_type !== 'LoadImage') {
        throw new Error(`ComfyUI workflow has no ${binding} LoadImage node`);
      }
      workflow[nodeId].inputs.image = files[index];
    });
  }
}

function configureReferenceImages(workflow, generator, imageFiles) {
  const files = imageFiles.filter(Boolean).slice(0, MAX_COMFY_REFERENCE_IMAGES);
  if (!files.length) throw new Error('referenceImage requires at least one image');

  const prefix = 'ref_images.ref_image_';
  const existingBindings = Object.keys(generator[1].inputs).filter(key => key.startsWith(prefix));
  const templateBinding = existingBindings[0];
  const templateNodeId = inputNodeId(generator[1].inputs[templateBinding]);
  if (!templateBinding || !templateNodeId || workflow[templateNodeId]?.class_type !== 'LoadImage') {
    throw new Error('ComfyUI reference workflow has no reference LoadImage node');
  }

  const oldNodeIds = new Set(existingBindings.map(key => inputNodeId(generator[1].inputs[key])).filter(Boolean));
  for (const key of existingBindings) delete generator[1].inputs[key];
  for (const nodeId of oldNodeIds) delete workflow[nodeId];

  for (let i = 0; i < files.length; i++) {
    const nodeId = String(9000 + i);
    workflow[nodeId] = {
      inputs: { image: files[i] },
      class_type: 'LoadImage',
      _meta: { title: `Reference image ${i + 1}` },
    };
    generator[1].inputs[`${prefix}${i}`] = [nodeId, 0];
  }
}

export function buildWorkflow({ mode, prompt, seed, duration, imageFiles = [], enableLightning = false, aspectRatio = '16:9', megapixels }) {
  const effectiveMode = selectWorkflowMode(mode, imageFiles.length);
  const workflow = loadWorkflowTemplate(effectiveMode);
  const generator = configureCommon(workflow, { prompt, seed, duration, enableLightning, aspectRatio, megapixels });
  if (effectiveMode === ComfyVideoMode.REFERENCE) configureReferenceImages(workflow, generator, imageFiles);
  else configureFrameImages(workflow, generator, effectiveMode, imageFiles);

  return workflow;
}

async function comfyRequest(sshConfig, endpoint, { method = 'GET', body = null, signal } = {}) {
  const tunnel = await ensureTunnel(sshConfig);
  const url = `http://${tunnel.host}:${tunnel.port}${endpoint}`;

  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
    signal,
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`ComfyUI ${endpoint} → ${res.status}: ${text.substring(0, 300)}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

export async function getPromptSnapshot(sshConfig, promptId, { signal } = {}) {
  const [queue, history] = await Promise.all([
    comfyRequest(sshConfig, '/queue', { signal }),
    comfyRequest(sshConfig, `/history/${promptId}`, { signal }),
  ]);
  const entry = history[promptId] || null;
  const pending = Array.isArray(queue?.queue_pending)
    && queue.queue_pending.some(item => Array.isArray(item) && item.includes(promptId));
  return {
    running: isPromptRunning(queue, promptId), pending, completed: !!entry,
    status: entry?.status?.status_str || null, messages: entry?.status?.messages || [],
    outputs: entry ? collectVideoOutputs(entry.outputs) : [],
  };
}

export function collectVideoOutputs(outputs = {}) {
  const videos = [];
  for (const nodeOutput of Object.values(outputs)) {
    if (Array.isArray(nodeOutput?.videos)) videos.push(...nodeOutput.videos);
  }
  return videos;
}

export async function submitWorkflow(sshConfig, { mode, prompt, seed, duration, imageFiles, enableLightning, aspectRatio, megapixels, signal }) {
  const workflow = buildWorkflow({ mode, prompt, seed, duration, imageFiles, enableLightning, aspectRatio, megapixels });

  const result = await comfyRequest(sshConfig, '/prompt', {
    method: 'POST',
    body: { prompt: workflow },
    signal,
  });

  return result.prompt_id;
}

export async function pollUntilDone(sshConfig, promptId, { timeoutMs = 600000, pollIntervalMs = 5000, signal } = {}) {
  const startTime = Date.now();

  while (true) {
    if (signal?.aborted) throw new Error('Cancelled');
    if (Date.now() - startTime > timeoutMs) throw new Error('ComfyUI generation timeout');

    await new Promise(r => setTimeout(r, pollIntervalMs));

    const history = await comfyRequest(sshConfig, `/history/${promptId}`, { signal });
    if (history[promptId]) {
      const entry = history[promptId];
      if (entry.status?.status_str === 'success') {
        const videoOutputs = collectVideoOutputs(entry.outputs);
        if (!videoOutputs.length) {
          return { status: 'error', message: 'ComfyUI completed without a video output' };
        }
        return { status: 'success', outputs: videoOutputs };
      }
      if (entry.status?.status_str === 'error') {
        return { status: 'error', message: entry.status?.messages?.join(', ') || 'Unknown error' };
      }
    }
  }
}

export function isPromptRunning(queue, promptId) {
  return Array.isArray(queue?.queue_running)
    && queue.queue_running.some(entry => Array.isArray(entry) && entry.includes(promptId));
}

export async function cancelPrompt(sshConfig, promptId) {
  if (!promptId) return;
  let queue = {};
  try { queue = await comfyRequest(sshConfig, '/queue'); } catch {}

  try {
    await comfyRequest(sshConfig, '/queue', {
      method: 'POST',
      body: { delete: [promptId] },
    });
  } catch {}

  if (isPromptRunning(queue, promptId)) {
    try { await comfyRequest(sshConfig, '/interrupt', { method: 'POST', body: {} }); } catch {}
  }
}

export async function downloadOutput(sshConfig, outputInfo, saveDir) {
  const { filename, subfolder, type } = outputInfo;
  const params = new URLSearchParams({ filename, type: type || 'output' });
  if (subfolder) params.set('subfolder', subfolder);

  const tunnel = await ensureTunnel(sshConfig);
  const url = `http://${tunnel.host}:${tunnel.port}/view?${params}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${filename}: ${res.status}`);

  const buffer = Buffer.from(await res.arrayBuffer());
  const ext = path.extname(filename) || '.mp4';
  const localName = `comfy_${Date.now()}_${Math.random().toString(36).slice(2, 6)}${ext}`;
  const savePath = path.join(saveDir, localName);
  fs.writeFileSync(savePath, buffer);

  return { localName, savePath, remoteFilename: filename };
}

export async function uploadImageToComfy(sshConfig, localFilePath, remoteFileName) {
  const tunnel = await ensureTunnel(sshConfig);
  const url = `http://${tunnel.host}:${tunnel.port}/upload/image`;

  const fileBuffer = fs.readFileSync(localFilePath);
  const formData = new FormData();
  const ext = path.extname(remoteFileName);
  const mimeMap = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
  const blob = new Blob([fileBuffer], { type: mimeMap[ext] || 'image/png' });
  formData.append('image', blob, remoteFileName);
  formData.append('overwrite', 'true');

  const res = await fetch(url, { method: 'POST', body: formData });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Upload to ComfyUI failed: ${res.status} ${text.substring(0, 200)}`);
  }
  return remoteFileName;
}

export async function checkComfyUIStatus(sshConfig) {
  try {
    const stats = await comfyRequest(sshConfig, '/system_stats');
    return {
      online: true,
      gpu: stats.devices?.map(d => ({
        name: d.name,
        vram_total: Math.round(d.vram_total / 1024 / 1024),
        vram_free: Math.round(d.vram_free / 1024 / 1024),
      })),
    };
  } catch (err) {
    return { online: false, error: err.message };
  }
}

export async function getComfyMonitorStatus(sshConfig) {
  const [stats, queue] = await Promise.all([
    comfyRequest(sshConfig, '/system_stats'),
    comfyRequest(sshConfig, '/queue'),
  ]);
  return {
    online: true,
    version: stats.system?.comfyui_version || null,
    devices: (stats.devices || []).map(device => ({
      name: device.name || null,
      memoryTotalMiB: Number.isFinite(device.vram_total) ? device.vram_total / 1024 / 1024 : null,
      memoryFreeMiB: Number.isFinite(device.vram_free) ? device.vram_free / 1024 / 1024 : null,
    })),
    queue: {
      running: Array.isArray(queue.queue_running) ? queue.queue_running.length : 0,
      pending: Array.isArray(queue.queue_pending) ? queue.queue_pending.length : 0,
    },
  };
}
