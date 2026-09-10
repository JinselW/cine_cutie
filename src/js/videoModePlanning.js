export const VIDEO_MODES_BY_SHOT = Object.freeze([
  'firstFrame',
  'firstLastFrame',
  'referenceImage',
]);

export function buildVideoModeCandidates(preferred, assets, { allowText = false } = {}) {
  const available = new Set();
  const hasFirst = Boolean(assets?.imagePath || assets?.imageUrl);
  const hasLast = Boolean(assets?.lastFramePath || assets?.lastFrameUrl);
  const hasReferences = Array.isArray(assets?.referenceImages) && assets.referenceImages.length > 0;

  if (hasFirst) available.add('firstFrame');
  if (hasFirst && hasLast) available.add('firstLastFrame');
  if (hasReferences) available.add('referenceImage');
  if (allowText) available.add('textToVideo');

  const fallbacks = {
    firstFrame: ['referenceImage', 'firstLastFrame', 'textToVideo'],
    firstLastFrame: ['firstFrame', 'referenceImage', 'textToVideo'],
    referenceImage: ['firstFrame', 'firstLastFrame', 'textToVideo'],
    textToVideo: ['firstFrame', 'referenceImage', 'firstLastFrame'],
  };
  const order = [preferred, ...(fallbacks[preferred] || fallbacks.firstFrame)];
  return [...new Set(order)].filter(mode => available.has(mode));
}

export function videoClipPayloadForMode(clip, mode) {
  const common = { prompt: clip.prompt, duration: clip.duration, seed: clip.seed };
  if (mode === 'referenceImage') return { ...common, referenceImages: clip.referenceImages || [] };
  if (mode === 'firstLastFrame') return {
    ...common,
    imagePath: clip.imagePath || '',
    imageUrl: clip.imageUrl || '',
    lastFramePath: clip.lastFramePath || '',
    lastFrameUrl: clip.lastFrameUrl || '',
  };
  if (mode === 'firstFrame') return {
    ...common,
    imagePath: clip.imagePath || '',
    imageUrl: clip.imageUrl || '',
  };
  return common;
}

export function isVideoModelUnavailableError(error) {
  const message = String(error || '');
  return /(?:not configured|quota|insufficient|balance|credit|unauthori[sz]ed|forbidden|access denied|permission|model.{0,30}(?:not found|unavailable|disabled|unsupported)|(?:http\s*)?(?:401|403|404|429)\b)/i.test(message);
}
