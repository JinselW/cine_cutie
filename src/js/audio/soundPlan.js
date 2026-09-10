/**
 * Sound plan compilation — derives structured per-shot audio specifications
 * from the script, storyboard, and character design.
 *
 * Reuses the existing audioPrompt from the prompt package (compiled by
 * promptCompiler.js from the LLM draft or storyboard audio_description).
 * This module adds dialogue, narrator, speaker, voice-profile, SFX and
 * music-mood fields on top — it never conflicts with audioPrompt.
 */

const DEFAULT_VOICE_PROFILE = 'neutral-narrator';

function findSegmentForShot(storyboard, shotId) {
  for (const ep of (storyboard?.episodes || [])) {
    for (const seg of (ep.segments || [])) {
      for (const shot of (seg.shots || [])) {
        if (shot.shot_id === shotId) return { segment: seg, episode: ep };
      }
    }
  }
  return { segment: null, episode: null };
}

function extractDialogue(segment, characters) {
  const raw = segment?.dialogue || '';
  if (!raw.trim()) return { dialogue: '', narratorText: '', speakerId: null };
  const match = raw.match(/^([^:：]+)[:：]\s*(.+)$/);
  if (match) {
    const speakerName = match[1].trim();
    const line = match[2].trim();
    const character = (characters || []).find(
      c => c.name === speakerName || c.enName === speakerName
    );
    return {
      dialogue: line,
      narratorText: '',
      speakerId: character?.id || null,
    };
  }
  return { dialogue: '', narratorText: raw.trim(), speakerId: null };
}

function extractSoundEffects(segment) {
  const raw = segment?.sound_effects || '';
  if (!raw.trim()) return [];
  return raw.split(/[,;，；]/).map(s => s.trim()).filter(Boolean);
}

function inferMusicMood(audioPrompt, segment) {
  const text = `${audioPrompt || ''} ${segment?.description || ''}`.toLowerCase();
  if (/tense|suspense|danger|chase|urgent|dramatic/.test(text)) return 'tense';
  if (/happy|joy|celebrat|bright|upbeat/.test(text)) return 'happy';
  if (/sad|melanchol|somber|grief|quiet/.test(text)) return 'melancholy';
  if (/epic|hero|grand|triumph/.test(text)) return 'epic';
  if (/romantic|love|tender|warm/.test(text)) return 'romantic';
  return 'neutral';
}

function inferExpectedAudioSource(shot, dialogueInfo, hasNativeAudio) {
  if (hasNativeAudio) return 'native';
  if (dialogueInfo.dialogue || dialogueInfo.narratorText) return 'tts';
  if (shot.audio_description && shot.audio_description !== 'Natural ambient sound, no dialogue') return 'sfx';
  return 'silence';
}

export function compileSoundPlan(ctx) {
  const storyboard = ctx.storyboard;
  const script = ctx.script;
  const characters = ctx.characterDesign?.characters || ctx.script?.characters || [];
  const shots = (storyboard?.episodes || []).flatMap(ep =>
    (ep.segments || []).flatMap(seg =>
      (seg.shots || []).map(shot => ({ shot, segment: seg, episode: ep }))
    )
  );

  const perShot = shots.map(({ shot, segment }) => {
    const dialogueInfo = extractDialogue(segment, characters);
    const soundEffects = extractSoundEffects(segment);
    const audioPrompt = shot.audio_description || 'Natural ambient sound, no dialogue';
    const musicMood = inferMusicMood(audioPrompt, segment);

    return {
      shotId: shot.shot_id,
      duration: shot.duration ?? 5,
      dialogue: dialogueInfo.dialogue,
      narratorText: dialogueInfo.narratorText,
      speakerId: dialogueInfo.speakerId,
      voiceProfile: dialogueInfo.speakerId
        ? `char-${dialogueInfo.speakerId}`
        : DEFAULT_VOICE_PROFILE,
      ambiencePrompt: audioPrompt,
      soundEffects,
      musicMood,
      expectedAudioSource: inferExpectedAudioSource(shot, dialogueInfo, false),
    };
  });

  return {
    schemaVersion: 1,
    shots: perShot,
    globalMusicMood: perShot.length === 1
      ? perShot[0].musicMood
      : perShot.some(s => s.musicMood === 'tense') ? 'tense' : 'neutral',
  };
}

export function getSoundPlanForShot(soundPlan, shotId) {
  return soundPlan?.shots?.find(s => s.shotId === shotId) || null;
}

export function hasDialogueContent(soundPlan) {
  return soundPlan?.shots?.some(s => s.dialogue || s.narratorText) ?? false;
}

export function hasSoundEffectsContent(soundPlan) {
  return soundPlan?.shots?.some(s => s.soundEffects?.length > 0) ?? false;
}
