import { VIDEO_MODES_BY_SHOT } from '../videoModePlanning.js';

export const storyboardShots = ctx => (ctx.storyboard?.episodes || []).flatMap(ep => (ep.segments || []).flatMap(seg => seg.shots || []));
// The package may only plan modes the video stage can actually execute.
export const MODES = [...VIDEO_MODES_BY_SHOT];
export function validatePromptPackage(pkg, ctx) {
  const errors = [];
  const expected = storyboardShots(ctx);
  if (!Array.isArray(pkg?.shots)) return { valid: false, errors: ['shots must be an array'] };
  const shots = pkg.shots;
  if (!pkg.styleProfile || !pkg.styleProfile.language || !pkg.styleProfile.globalVisualStyle) errors.push('Missing style profile');
  if (pkg?.schemaVersion !== 1) errors.push('Unsupported schemaVersion');
  if (shots.length !== expected.length) errors.push('Shot count mismatch');
  const ids = new Set();
  const chars = new Set((ctx.characterDesign?.characters || []).map(c => c.id));
  const settings = new Set((ctx.characterDesign?.settings || []).map(c => c.id));
  for (const s of shots) {
    if (!s || typeof s !== 'object') { errors.push('Invalid shot spec'); continue; }
    if (!Array.isArray(s.bindings?.characterIds) || !Array.isArray(s.bindings?.referenceAssetIds)) { errors.push('Missing bindings'); continue; }
    const original = expected.find(x => x.shot_id === s.shotId);
    if (!s.shotId || ids.has(s.shotId) || !original) errors.push(`Invalid or duplicate shot ID: ${s.shotId}`);
    ids.add(s.shotId);
    if (!original || Number(s.duration) !== Number(original.duration ?? 5) || !(s.duration > 0)) errors.push(`Duration mismatch: ${s.shotId}`);
    if (!MODES.includes(s.mode)) errors.push(`Invalid mode: ${s.shotId}`);
    for (const id of s.bindings?.characterIds || []) if (!chars.has(id)) errors.push(`Unknown character: ${id}`);
    if (s.bindings?.settingId && !settings.has(s.bindings.settingId)) errors.push(`Unknown setting: ${s.bindings.settingId}`);
    const validAssets = new Set([...chars].map(id => `${id}.sheet`).concat([...settings].map(id => `${id}.plate`)));
    for (const id of s.bindings?.referenceAssetIds || []) if (!validAssets.has(id)) errors.push(`Unknown reference: ${id}`);
    if (!s.bindings || !Array.isArray(s.bindings.characterIds) || !Array.isArray(s.bindings.referenceAssetIds)) errors.push('Missing bindings');
    if (!s.continuity?.entryState || !s.continuity?.exitState) errors.push('Missing continuity state');
    const entities = [...(ctx.characterDesign?.characters || []).filter(c => s.bindings?.characterIds?.includes(c.id)), ...(ctx.characterDesign?.settings || []).filter(e => e.id === s.bindings?.settingId)];
    for (const e of entities) {
      const anchor = e.visualTag || e.appearance || e.desc || e.name;
      if (anchor && [s.image?.firstFramePrompt, s.video?.visualPrompt, ...(s.mode === 'firstLastFrame' ? [s.image?.lastFramePrompt] : [])].some(p => !p?.includes(anchor))) errors.push('Missing identity/scene anchor: ' + e.id);
    }
    if (!s.image?.negativePrompt || !s.video?.negativePrompt) errors.push('Missing negative prompt');
    const required = [s.image?.firstFramePrompt, s.video?.visualPrompt, s.video?.motionPrompt, s.video?.audioPrompt];
    if (s.mode === 'firstLastFrame') required.push(s.image?.lastFramePrompt);
    if (s.mode === 'referenceImage') required.push(s.image?.referencePrompt);
    if (required.some(v => typeof v !== 'string' || !v.trim())) errors.push(`Missing prompt: ${s.shotId}`);
    if (s.continuity?.previousShotId !== (shots[shots.indexOf(s) - 1]?.shotId ?? null)) errors.push(`Invalid continuity: ${s.shotId}`);
  }
  for (const s of expected) if (!ids.has(s.shot_id)) errors.push(`Missing shot: ${s.shot_id}`);
  // Deliberately loose: any drive-letter path counts, including non-ASCII ones, so a leaked
  // local path is caught even at the cost of a rare false positive on "X:/" inside prose.
  if (/\/api\/media\/|[A-Z]:[\\/]/i.test(JSON.stringify(pkg))) errors.push('Temporary media paths are forbidden');
  return { valid: !errors.length, errors };
}
