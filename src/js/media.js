import { state } from './state.js';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_REF_IMAGES = 5;

function validateImage(file) {
  if (!file.type.startsWith('image/')) return 'Only image files allowed';
  if (file.size > MAX_FILE_SIZE) return 'File too large (max 10MB)';
  return null;
}

function makeSlotEntry(file) {
  return {
    file,
    name: file.name,
    size: file.size,
    previewUrl: URL.createObjectURL(file),
    serverPath: null,
    localPath: null,
  };
}

export function setFirstFrame(file) {
  const err = validateImage(file);
  if (err) return err;
  revokeSlot(state.uploads.firstFrame);
  state.uploads.firstFrame = makeSlotEntry(file);
  return null;
}

export function setLastFrame(file) {
  const err = validateImage(file);
  if (err) return err;
  if (!state.uploads.firstFrame) return 'Need first frame before setting last frame';
  revokeSlot(state.uploads.lastFrame);
  state.uploads.lastFrame = makeSlotEntry(file);
  return null;
}

export function addReferenceImages(fileList) {
  const errors = [];
  for (const file of fileList) {
    const err = validateImage(file);
    if (err) { errors.push(err); continue; }
    if (state.uploads.referenceImages.length >= MAX_REF_IMAGES) {
      errors.push(`Max ${MAX_REF_IMAGES} reference images`);
      break;
    }
    state.uploads.referenceImages.push(makeSlotEntry(file));
  }
  return errors.length ? errors.join('; ') : null;
}

export function removeReferenceImage(index) {
  const entry = state.uploads.referenceImages[index];
  if (entry) {
    revokeSlot(entry);
    state.uploads.referenceImages.splice(index, 1);
  }
}

export function clearSlot(name) {
  if (name === 'firstFrame') {
    revokeSlot(state.uploads.firstFrame);
    state.uploads.firstFrame = null;
    revokeSlot(state.uploads.lastFrame);
    state.uploads.lastFrame = null;
  } else if (name === 'lastFrame') {
    revokeSlot(state.uploads.lastFrame);
    state.uploads.lastFrame = null;
  } else if (name === 'referenceImages') {
    state.uploads.referenceImages.forEach(revokeSlot);
    state.uploads.referenceImages = [];
  }
}

export function clearAllUploads() {
  revokeSlot(state.uploads.firstFrame);
  revokeSlot(state.uploads.lastFrame);
  state.uploads.referenceImages.forEach(revokeSlot);
  state.uploads = { firstFrame: null, lastFrame: null, referenceImages: [] };
}

export function getUploads() {
  return state.uploads;
}

export function hasUploads() {
  return !!(state.uploads.firstFrame || state.uploads.lastFrame || state.uploads.referenceImages.length > 0);
}

export async function uploadToServer() {
  const files = [];
  const slotMap = { firstFrame: null, lastFrame: null, referenceImages: [] };

  if (state.uploads.firstFrame) files.push({ slot: 'firstFrame', entry: state.uploads.firstFrame, file: state.uploads.firstFrame.file });
  if (state.uploads.lastFrame) files.push({ slot: 'lastFrame', entry: state.uploads.lastFrame, file: state.uploads.lastFrame.file });
  for (let i = 0; i < state.uploads.referenceImages.length; i++) {
    const entry = state.uploads.referenceImages[i];
    files.push({ slot: 'referenceImages', index: i, entry, file: entry.file });
  }

  if (!files.length) return null;

  const formData = new FormData();
  for (const f of files) formData.append('files', f.file);

  const res = await fetch('/api/upload', { method: 'POST', body: formData });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  const { files: serverFiles } = await res.json();

  for (let i = 0; i < files.length; i++) {
    const { slot, index, entry } = files[i];
    const serverFile = serverFiles[i];
    if (serverFile) {
      entry.serverPath = serverFile.path;
      entry.localPath = serverFile.localPath;
    }
  }

  return state.uploads;
}

function revokeSlot(entry) {
  if (entry?.previewUrl) URL.revokeObjectURL(entry.previewUrl);
}
