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

// wan2.5/2.6 文生图要求总像素位于 1280²~1440²；使用官方推荐的常见比例尺寸。
export function computeImageSize(aspectRatio, tierId) {
  const recommended = {
    '1:1': '1280*1280',
    '3:4': '1104*1472',
    '4:3': '1472*1104',
    '9:16': '960*1696',
    '16:9': '1696*960',
  };
  if (recommended[aspectRatio]) return recommended[aspectRatio];
  const [rw, rh] = parseRatio(aspectRatio);
  const totalPixels = 1280 * 1280;
  let w = Math.sqrt(totalPixels * rw / rh);
  let h = totalPixels / w;

  const MAX = 4096;
  const MIN = 240;
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

// 视频档位：wan2.7 系和 doubao-seedance 无 480P，回退 720P
export function dsVideoResolution(tierId, model) {
  const tier = RESOLUTION_TIERS.some(t => t.id === tierId) ? tierId : DEFAULT_RESOLUTION;
  if (tier === '480P' && (/^wan2\.[67]-(?:i2v|r2v)/.test(model || '') || /seedance/.test(model || ''))) return '720P';
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

const DURATION_RULES = [
  { pattern: /^wan2\.6-r2v/, range: [2, 10] },
  { pattern: /^wan2\.7-/, range: [2, 15] },
  { pattern: /^wan2\.6-i2v-flash/, range: [2, 15] },
  { pattern: /^wan2\.6-i2v-us/, values: [5, 10, 15] },
  { pattern: /^wan2\.6-i2v/, range: [2, 15] },
  { pattern: /^wan2\.5-i2v/, values: [5, 10] },
  { pattern: /^wanx2\.1-i2v-turbo/, values: [3, 4, 5] },
  { pattern: /^doubao-seedance/, values: [5, 10] },
];

export function getDefaultVideoDuration(modelName) {
  const rule = DURATION_RULES.find(r => r.pattern.test(modelName || ''));
  if (!rule) return 5;
  if (rule.values) return rule.values.includes(5) ? 5 : rule.values[0];
  return Math.min(rule.range[1], Math.max(rule.range[0], 5));
}

export function getVideoDurationRange(modelName) {
  const rule = DURATION_RULES.find(r => r.pattern.test(modelName || ''));
  const fallback = getDefaultVideoDuration(modelName);
  if (!rule) return { min: 3, max: 10, fallback };
  if (rule.values) return { min: rule.values[0], max: rule.values[rule.values.length - 1], fallback };
  return { min: rule.range[0], max: rule.range[1], fallback };
}
