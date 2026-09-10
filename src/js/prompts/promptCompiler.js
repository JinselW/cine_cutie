import { STYLE_HINTS } from '../providers/prompts.js';
import { storyboardShots, validatePromptPackage } from './promptSchema.js';
import { bindEntities, boundEntities, shotBeatTexts } from './entityBindings.js';
import { planMode, CAMERA_MOTION_MAP } from './modePlanner.js';
import { compileSoundPlan } from '../audio/soundPlan.js';
export function compilePromptPackage(ctx, draft, config = {}, { legacy = false } = {}) {
  const originals = storyboardShots(ctx);
  if (!legacy) {
    const ids = draft?.shots?.map(s => s.shotId) || [];
    if (ids.length !== originals.length || new Set(ids).size !== ids.length || originals.some(s => !ids.includes(s.shot_id))) throw new Error('Prompt draft must contain exactly one spec per storyboard shot');
  }
  const genre = ctx.genre || ctx.script?.genre || '';
  const styleProfile = { genre, globalVisualStyle: STYLE_HINTS[genre] || genre || 'cinematic film look', negativePrompt: 'watermark, logo, copyrighted characters, conflicting appearance, costume changes', language: ctx.lang || ctx.language || 'zh' };
  const beatTexts = shotBeatTexts(ctx);
  const shots = originals.map((shot, index) => {
    const d = draft?.shots?.find(s => s.shotId === shot.shot_id) || {};
    const mode = planMode(shot, config, d);
    if (!legacy) {
      const fields = [d.image?.firstFramePrompt, d.video?.visualPrompt, d.video?.motionPrompt, d.video?.audioPrompt];
      if (mode.mode === 'firstLastFrame') fields.push(d.image?.lastFramePrompt);
      if (mode.mode === 'referenceImage') fields.push(d.image?.referencePrompt);
      if (fields.some(v => typeof v !== 'string' || !v.trim())) throw new Error('Missing creative prompt fields: ' + shot.shot_id);
    }
    // Bindings are derived from the storyboard, never taken from the draft: the model must
    // not be able to drop an identity anchor by returning empty bindings.
    const bindings = bindEntities(shot, ctx, beatTexts.get(shot.shot_id) || '');
    const entities = boundEntities(bindings, ctx);
    const identityConstraints = entities.filter(e => bindings.characterIds.includes(e.id)).map(e => e.visualTag || e.appearance || e.desc || e.name);
    const sceneConstraints = entities.filter(e => e.id === bindings.settingId).map(e => e.visualTag || e.desc || e.name);
    const constraints = [...identityConstraints, ...sceneConstraints, 'Preserve face, hairstyle, outfit, colors, proportions, scene layout and lighting; no extra characters'];
    const inject = text => [text, ...[styleProfile.globalVisualStyle, ...constraints].filter(c => c && !String(text).includes(c))].filter(Boolean).join(', ');
    const base = shot.prompt || shot.description || `Scene ${shot.shot_id}`;
    const entryState = d.continuity?.entryState || shot.entryState || shot.description || base;
    const exitState = d.continuity?.exitState || shot.exitState || entryState;
    return { shotId: shot.shot_id, duration: shot.duration ?? 5, ...mode, bindings,
      image: { firstFramePrompt: inject(d.image?.firstFramePrompt || `${base}, opening frame: ${entryState}`),
        lastFramePrompt: mode.mode === 'firstLastFrame' ? inject(d.image?.lastFramePrompt || `${base}, closing frame: ${exitState}`) : null,
        referencePrompt: mode.mode === 'referenceImage' ? inject(d.image?.referencePrompt || base) : null,
        negativePrompt: styleProfile.negativePrompt },
      video: { visualPrompt: inject(d.video?.visualPrompt || base), motionPrompt: d.video?.motionPrompt || CAMERA_MOTION_MAP[shot.camera] || 'subtle natural motion',
        audioPrompt: d.video?.audioPrompt || shot.audio_description || 'Natural ambient sound, no dialogue', negativePrompt: styleProfile.negativePrompt },
      continuity: { previousShotId: originals[index - 1]?.shot_id ?? null, entryState, exitState, identityConstraints, sceneConstraints } };
  });
  const pkg = { schemaVersion: 1, videoMode: config.videoMode || 'auto', styleProfile, legacy, shots };
  pkg.soundPlan = compileSoundPlan(ctx);
  const check = validatePromptPackage(pkg, ctx);
  if (!check.valid) throw new Error(check.errors.join('; '));
  return pkg;
}
