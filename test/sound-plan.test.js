import test from 'node:test';
import assert from 'node:assert/strict';
import { compileSoundPlan, getSoundPlanForShot, hasDialogueContent, hasSoundEffectsContent } from '../src/js/audio/soundPlan.js';

const ctx = {
  script: {
    characters: [{ id: 'char_1', name: 'Ada', enName: 'Ada' }],
    episodes: [{
      episode: 1,
      segments: [{
        dialogue: 'Ada: Hello world!',
        sound_effects: 'rain falling, footsteps',
        description: 'A tense chase through dark alleys',
        shots: [
          { shot_id: 's1', duration: 5, audio_description: 'Rain pattering on cobblestone' },
          { shot_id: 's2', duration: 3 },
        ],
      }, {
        dialogue: 'Narrator walks through the scene',
        sound_effects: '',
        shots: [{ shot_id: 's3', duration: 4 }],
      }],
    }],
  },
  storyboard: {
    episodes: [{
      episode: 1,
      segments: [{
        dialogue: 'Ada: Hello world!',
        sound_effects: 'rain falling, footsteps',
        description: 'A tense chase through dark alleys',
        shots: [
          { shot_id: 's1', duration: 5, audio_description: 'Rain pattering on cobblestone' },
          { shot_id: 's2', duration: 3 },
        ],
      }, {
        dialogue: 'Narrator walks through the scene',
        sound_effects: '',
        shots: [{ shot_id: 's3', duration: 4 }],
      }],
    }],
  },
  characterDesign: { characters: [{ id: 'char_1', name: 'Ada' }] },
};

test('compileSoundPlan produces per-shot entries for every storyboard shot', () => {
  const plan = compileSoundPlan(ctx);
  assert.equal(plan.schemaVersion, 1);
  assert.equal(plan.shots.length, 3);
  assert.deepEqual(plan.shots.map(s => s.shotId), ['s1', 's2', 's3']);
});

test('compileSoundPlan extracts character dialogue and maps speaker', () => {
  const plan = compileSoundPlan(ctx);
  const s1 = plan.shots[0];
  assert.equal(s1.dialogue, 'Hello world!');
  assert.equal(s1.speakerId, 'char_1');
  assert.equal(s1.voiceProfile, 'char-char_1');
});

test('compileSoundPlan falls back to narratorText when no character matches', () => {
  const plan = compileSoundPlan(ctx);
  const s3 = plan.shots[2];
  assert.equal(s3.narratorText, 'Narrator walks through the scene');
  assert.equal(s3.speakerId, null);
  assert.equal(s3.voiceProfile, 'neutral-narrator');
});

test('compileSoundPlan extracts sound effects from comma/semicolon list', () => {
  const plan = compileSoundPlan(ctx);
  assert.deepEqual(plan.shots[0].soundEffects, ['rain falling', 'footsteps']);
});

test('compileSoundPlan infers music mood from keywords', () => {
  const plan = compileSoundPlan(ctx);
  assert.equal(plan.shots[0].musicMood, 'tense');
  assert.equal(plan.globalMusicMood, 'tense');
});

test('compileSoundPlan uses default ambience when audio_description missing', () => {
  const plan = compileSoundPlan(ctx);
  assert.equal(plan.shots[1].ambiencePrompt, 'Natural ambient sound, no dialogue');
});

test('getSoundPlanForShot returns the correct shot entry', () => {
  const plan = compileSoundPlan(ctx);
  const shot = getSoundPlanForShot(plan, 's2');
  assert.equal(shot.shotId, 's2');
  assert.equal(shot.duration, 3);
});

test('getSoundPlanForShot returns null for unknown shot', () => {
  const plan = compileSoundPlan(ctx);
  assert.equal(getSoundPlanForShot(plan, 'nonexistent'), null);
});

test('hasDialogueContent returns true when dialogue exists', () => {
  const plan = compileSoundPlan(ctx);
  assert.equal(hasDialogueContent(plan), true);
});

test('hasSoundEffectsContent returns true when effects exist', () => {
  const plan = compileSoundPlan(ctx);
  assert.equal(hasSoundEffectsContent(plan), true);
});

test('compileSoundPlan handles empty storyboard gracefully', () => {
  const plan = compileSoundPlan({ storyboard: {}, script: {} });
  assert.equal(plan.shots.length, 0);
  assert.equal(hasDialogueContent(plan), false);
  assert.equal(hasSoundEffectsContent(plan), false);
});

test('compileSoundPlan sets expectedAudioSource based on content type', () => {
  const plan = compileSoundPlan(ctx);
  assert.equal(plan.shots[0].expectedAudioSource, 'tts');
  assert.equal(plan.shots[2].expectedAudioSource, 'tts');
});
