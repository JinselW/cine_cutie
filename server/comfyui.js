import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ensureTunnel } from './ssh-tunnel.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const NODE_IDS = {
  prompt: '138',
  seed: '129',
  duration: '132',
  resolution: '115',
  loraSwitch: '146',
  refImages: ['137', '149', '150', '151', '154', '155'],
};

function loadWorkflowTemplate() {
  const templatePath = path.join(__dirname, 'workflows', 'h3_reference_to_video.json');
  return JSON.parse(fs.readFileSync(templatePath, 'utf-8'));
}

function buildWorkflow({ prompt, seed, duration, refImageFiles, enableLightning = false, aspectRatio = '16:9', megapixels }) {
  const workflow = loadWorkflowTemplate();

  workflow[NODE_IDS.prompt].inputs.value = prompt;
  workflow[NODE_IDS.seed].inputs.noise_seed = seed ?? Math.floor(Math.random() * 1e15);
  workflow[NODE_IDS.duration].inputs.value = duration ?? 5;

  const aspectMap = {
    '16:9': '16:9 (Widescreen)',
    '9:16': '9:16 (Portrait Widescreen)',
    '1:1': '1:1 (Square)',
    '4:3': '4:3 (Standard)',
    '3:4': '3:4 (Portrait Standard)',
    '21:9': '21:9 (Ultrawide)',
  };
  workflow[NODE_IDS.resolution].inputs.aspect_ratio = aspectMap[aspectRatio] || '16:9 (Widescreen)';
  if (Number.isFinite(megapixels)) {
    workflow[NODE_IDS.resolution].inputs.megapixels = megapixels;
  }

  workflow[NODE_IDS.loraSwitch].inputs.value = enableLightning;

  for (let i = 0; i < NODE_IDS.refImages.length; i++) {
    const nodeId = NODE_IDS.refImages[i];
    const fileName = refImageFiles?.[i] || '';
    if (fileName) {
      workflow[nodeId].inputs.image = fileName;
    }
  }

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
  return res.json();
}

export async function submitWorkflow(sshConfig, { prompt, seed, duration, refImageFiles, enableLightning, aspectRatio, megapixels, signal }) {
  const workflow = buildWorkflow({ prompt, seed, duration, refImageFiles, enableLightning, aspectRatio, megapixels });

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
        const outputs = entry.outputs || {};
        const videoOutputs = [];
        for (const nodeOutput of Object.values(outputs)) {
          if (nodeOutput.videos) {
            videoOutputs.push(...nodeOutput.videos);
          }
          if (nodeOutput.images) {
            videoOutputs.push(...nodeOutput.images);
          }
        }
        return { status: 'success', outputs: videoOutputs };
      }
      if (entry.status?.status_str === 'error') {
        return { status: 'error', message: entry.status?.messages?.join(', ') || 'Unknown error' };
      }
    }
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
