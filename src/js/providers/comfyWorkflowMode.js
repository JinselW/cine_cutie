export const MAX_COMFY_REFERENCE_IMAGES = 6;

function mediaPath(value) {
  return typeof value === 'string' && value.startsWith('/api/media/') ? value : '';
}

function uploadPath(file) {
  return mediaPath(file?.serverPath || file?.path || '');
}

export function selectComfyWorkflow(item, uploads) {
  const references = (item.referenceImages || []).map(mediaPath).filter(Boolean);
  const uploadedReferences = (uploads?.referenceImages || []).map(uploadPath).filter(Boolean);
  const requested = item.videoMode;
  const first = mediaPath(item.imagePath || item.imageUrl) || uploadPath(uploads?.firstFrame);
  const last = mediaPath(item.lastFramePath || item.lastFrameUrl) || uploadPath(uploads?.lastFrame);
  const refs = (references.length ? references : uploadedReferences).slice(0, MAX_COMFY_REFERENCE_IMAGES);

  if (requested === 'textToVideo') return { mode: 'textToVideo', images: [] };
  if (requested === 'firstLastFrame' && first && last) return { mode: 'firstLastFrame', images: [first, last] };
  if (requested === 'firstFrame' && first) return { mode: 'firstFrame', images: [first] };
  if (requested === 'referenceImage' && refs.length) return { mode: 'referenceImage', images: refs };

  if (references.length || uploadedReferences.length) {
    return {
      mode: 'referenceImage',
      images: refs,
    };
  }

  if (first && last) return { mode: 'firstLastFrame', images: [first, last] };
  if (first) return { mode: 'firstFrame', images: [first] };
  return { mode: 'textToVideo', images: [] };
}
