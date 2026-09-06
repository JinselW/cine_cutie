// 把已生成的图片/视频转成 OpenAI 兼容的多模态片段（image_url），供视觉评估模型打分。
// 纯浏览器端：同源媒体走 fetch/canvas，公网直链（DashScope 24h）直接透传。

const MAX_IMAGE_EDGE = 512;

export async function imageParts(data, stepId, { maxImages = 6 } = {}) {
  const sources = dedupeSources(collectImageSources(data, stepId)).slice(0, maxImages);
  const parts = [];
  for (const s of sources) {
    const url = await resolveImageSrc(s);
    if (url) parts.push({ type: 'image_url', image_url: { url } });
  }
  return parts;
}

export async function videoParts(data, stepId, { maxClips = 3, framesPerClip = 6 } = {}) {
  const paths = collectVideoSources(data, stepId).slice(0, maxClips);
  const parts = [];
  for (const p of paths) {
    for (const url of await extractFrames(p, framesPerClip)) {
      parts.push({ type: 'image_url', image_url: { url } });
    }
  }
  return parts;
}

function collectImageSources(data, stepId) {
  const out = [];
  const push = it => {
    if (it && (it.imageUrl || it.imagePath)) out.push({ imageUrl: it.imageUrl, imagePath: it.imagePath });
  };
  if (stepId === 'characterDesign') {
    (data?.characters || []).forEach(push);
    (data?.settings || []).forEach(push);
  } else if (stepId === 'referenceImages') {
    (data?.shots || []).forEach(push);
  }
  return out;
}

function collectVideoSources(data, stepId) {
  if (stepId === 'videoGeneration') {
    return (data?.clips || []).filter(c => c.status === 'complete' && c.videoPath).map(c => c.videoPath);
  }
  if (stepId === 'postProduction') {
    return data?.finalVideo ? [data.finalVideo] : [];
  }
  return [];
}

function dedupeSources(sources) {
  const seen = new Set();
  const out = [];
  for (const s of sources) {
    const key = s.imageUrl || s.imagePath;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

async function resolveImageSrc({ imageUrl, imagePath }) {
  if (imageUrl && (imageUrl.startsWith('http://') || imageUrl.startsWith('https://'))) return imageUrl;
  if (imageUrl && imageUrl.startsWith('data:')) return imageUrl;
  if (imagePath && imagePath.startsWith('/api/media/')) {
    try {
      const res = await fetch(imagePath);
      if (!res.ok) return '';
      return await blobToDataUrl(await res.blob());
    } catch {
      return '';
    }
  }
  return '';
}

function blobToDataUrl(blob) {
  return new Promise(resolve => {
    const fr = new FileReader();
    fr.onload = () => resolve(typeof fr.result === 'string' ? fr.result : '');
    fr.onerror = () => resolve('');
    fr.readAsDataURL(blob);
  });
}

async function extractFrames(src, n) {
  if (!(src.startsWith('/api/media/') || src.startsWith('data:'))) return [];
  const video = document.createElement('video');
  video.src = src;
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  document.body.appendChild(video);

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const frames = [];

  try {
    await waitForEvent(video, 'loadedmetadata', 'error', 10000);
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    if (!duration || !video.videoWidth) return frames;

    const scale = Math.min(1, MAX_IMAGE_EDGE / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);

    for (let i = 0; i < n; i++) {
      const t = n <= 1 ? duration * 0.5 : Math.min(duration - 0.05, (i + 0.5) * (duration / n));
      if (!(await seekTo(video, t, 3000))) continue;
      try {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        frames.push(canvas.toDataURL('image/jpeg', 0.7));
      } catch {
        break;
      }
    }
    return frames;
  } catch {
    return frames;
  } finally {
    try {
      video.removeAttribute('src');
      video.load();
    } catch {}
    video.remove();
  }
}

function waitForEvent(el, okEvent, errEvent, ms) {
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => { cleanup(); reject(new Error('timeout')); }, ms);
    const onOk = () => { cleanup(); resolve(); };
    const onErr = () => { cleanup(); reject(new Error('media error')); };
    function cleanup() {
      clearTimeout(to);
      el.removeEventListener(okEvent, onOk);
      el.removeEventListener(errEvent, onErr);
    }
    el.addEventListener(okEvent, onOk, { once: true });
    el.addEventListener(errEvent, onErr, { once: true });
  });
}

function seekTo(video, t, ms) {
  return new Promise(resolve => {
    let done = false;
    const finish = val => {
      if (done) return;
      done = true;
      clearTimeout(to);
      video.removeEventListener('seeked', onSeeked);
      resolve(val);
    };
    const onSeeked = () => finish(true);
    const to = setTimeout(() => finish(false), ms);
    video.addEventListener('seeked', onSeeked);
    try {
      video.currentTime = t;
    } catch {
      finish(false);
    }
  });
}
