export const RESOLUTION_TIERS = [
  { id: '480P', mp: 0.4 },
  { id: '720P', mp: 0.9 },
  { id: '1080P', mp: 2.0 },
];

export const DEFAULT_RESOLUTION = '720P';

export function tierToMp(tierId) {
  const tier = RESOLUTION_TIERS.find(t => t.id === tierId);
  return tier ? tier.mp : 0.9;
}

// 由画面比例 + 分辨率档位算出图片 W*H（供文生图/i2v 首帧使用）
// 单边约束到 DashScope wanx2.1 的 [512,1440]，四舍五入到 16 的倍数
export function computeImageSize(aspectRatio, tierId) {
  const [rw, rh] = parseRatio(aspectRatio);
  const totalPixels = tierToMp(tierId) * 1_000_000;
  let w = Math.sqrt(totalPixels * rw / rh);
  let h = totalPixels / w;

  const MAX = 1440;
  const MIN = 512;
  const maxSide = Math.max(w, h);
  const minSide = Math.min(w, h);
  let s = 1;
  if (maxSide > MAX) s = MAX / maxSide;
  else if (minSide < MIN) s = MIN / minSide;
  w *= s;
  h *= s;

  w = Math.min(MAX, Math.max(MIN, Math.round(w / 16) * 16));
  h = Math.min(MAX, Math.max(MIN, Math.round(h / 16) * 16));
  return `${w}*${h}`;
}

// 图生图（万相2.6-image 编辑模式）要求总像素在 768²~2048² 之间，低于下限时按比例放大
const IMG2IMG_MIN_PIXELS = 768 * 768;
const IMG2IMG_MAX_EDGE = 2048;

export function computeImg2ImgSize(aspectRatio, tierId) {
  const [w, h] = computeImageSize(aspectRatio, tierId).split('*').map(Number);
  if (w * h >= IMG2IMG_MIN_PIXELS) return `${w}*${h}`;
  const scale = Math.sqrt(IMG2IMG_MIN_PIXELS / (w * h));
  const upscale = v => Math.min(IMG2IMG_MAX_EDGE, Math.round((v * scale) / 16) * 16);
  return `${upscale(w)}*${upscale(h)}`;
}

// DashScope 视频档位：2.7 系（r2v / general i2v）无 480P，回退 720P
export function dsVideoResolution(tierId, model) {
  const tier = RESOLUTION_TIERS.some(t => t.id === tierId) ? tierId : DEFAULT_RESOLUTION;
  if (tier === '480P' && /2\.7/.test(model || '')) return '720P';
  return tier;
}

function parseRatio(aspectRatio) {
  const m = /^(?:\s*)(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*$/.exec(aspectRatio || '');
  if (!m) return [16, 9];
  const rw = parseFloat(m[1]);
  const rh = parseFloat(m[2]);
  if (!rw || !rh) return [16, 9];
  return [rw, rh];
}
