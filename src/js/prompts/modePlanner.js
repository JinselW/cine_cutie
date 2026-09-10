import { MODES } from './promptSchema.js';
export function planMode(shot, config, proposed) {
  if (MODES.includes(config.videoMode)) return { mode: config.videoMode, modeReason: 'Global generation configuration' };
  return { mode: MODES.includes(proposed?.mode) ? proposed.mode : 'firstFrame', modeReason: proposed?.modeReason || 'Conservative first-frame default' };
}
export const CAMERA_MOTION_MAP = Object.freeze({
  'pan-left': 'camera slowly pans left', 'pan-right': 'camera slowly pans right',
  'tilt-up': 'camera slowly tilts up', 'tilt-down': 'camera slowly tilts down',
  'zoom-in': 'camera slowly zooms in', 'zoom-out': 'camera slowly zooms out',
  'dolly-in': 'camera dollies in', 'dolly-out': 'camera dollies out',
  static: 'static camera, subtle motion', tracking: 'camera tracks the subject smoothly',
});
