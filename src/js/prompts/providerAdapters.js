// These adapters target the application's provider item contract. Backend-specific
// HTTP serialization remains in the provider; unsupported fields are explicit.
export function adaptPromptSpec(spec, { provider = 'dashscope', executedMode = spec.mode, capabilities = {}, media = 'video', frameRole = 'first_frame' } = {}) {
  if (media === 'image') {
    const prompt = frameRole === 'last_frame' ? spec.image.lastFramePrompt : frameRole === 'reference_image' ? spec.image.referencePrompt : spec.image.firstFramePrompt;
    const degradations = [];
    if (!capabilities.negativePrompt) degradations.push('Image provider item contract does not support negative prompt');
    if (executedMode !== spec.mode) degradations.push(`Mode fallback: ${spec.mode} → ${executedMode}`);
    return { prompt, ...(capabilities.negativePrompt ? { negativePrompt: spec.image.negativePrompt } : {}), plannedMode: spec.mode, executedMode, fallbackReason: degradations.join('; ') || null, degradations };
  }
  const comfy = /comfy/i.test(provider);
  const audio = capabilities.audio ?? !comfy;
  const negative = capabilities.negativePrompt ?? false;
  const degradations = [];
  if (!audio && spec.video.audioPrompt) degradations.push('Provider does not support generated audio');
  if (!negative && spec.video.negativePrompt) degradations.push('Provider item contract does not support negative prompt');
  if (executedMode !== spec.mode) degradations.push(`Mode fallback: ${spec.mode} → ${executedMode}`);
  return { prompt: [spec.video.visualPrompt, spec.video.motionPrompt, audio && spec.video.audioPrompt].filter(Boolean).join(', '),
    ...(negative ? { negativePrompt: spec.video.negativePrompt } : {}), duration: spec.duration,
    plannedMode: spec.mode, executedMode, videoMode: executedMode, fallbackReason: degradations.join('; ') || null, degradations };
}
