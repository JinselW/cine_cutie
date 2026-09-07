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
  if (references.length || uploadedReferences.length) {
    return {
      mode: 'referenceImage',
      images: (references.length ? references : uploadedReferences).slice(0, MAX_COMFY_REFERENCE_IMAGES),
    };
  }

  const first = mediaPath(item.imagePath || item.imageUrl) || uploadPath(uploads?.firstFrame);
  const last = mediaPath(item.lastFramePath || item.lastFrameUrl) || uploadPath(uploads?.lastFrame);
  if (first && last) return { mode: 'firstLastFrame', images: [first, last] };
  if (first) return { mode: 'firstFrame', images: [first] };
  return { mode: 'textToVideo', images: [] };
}
