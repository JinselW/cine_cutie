import { state } from './state.js';

let nextId = 1;

function detectKind(file) {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('audio/')) return 'audio';
  if (file.type.startsWith('video/')) return 'video';
  return 'text';
}

export function addFiles(fileList) {
  for (const file of fileList) {
    if (state.media.find(m => m.name === file.name && m.size === file.size)) continue;
    state.media.push({
      id: nextId++,
      file,
      name: file.name,
      size: file.size,
      kind: detectKind(file),
      url: URL.createObjectURL(file)
    });
  }
}

export function removeMedia(id) {
  const idx = state.media.findIndex(m => m.id === id);
  if (idx >= 0) {
    URL.revokeObjectURL(state.media[idx].url);
    state.media.splice(idx, 1);
  }
}

export function listMedia(kind) {
  return kind ? state.media.filter(m => m.kind === kind) : [...state.media];
}

export function clearMedia() {
  state.media.forEach(m => URL.revokeObjectURL(m.url));
  state.media = [];
}
