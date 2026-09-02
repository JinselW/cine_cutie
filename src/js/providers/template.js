import { registerProvider } from './registry.js';
import { generateScreenplay } from '../templates/screenplays.js';
import { generateCharacters } from '../templates/characters.js';
import { generateVisualDesign } from '../templates/visualDesign.js';
import { generateStoryboard } from '../templates/storyboard.js';
import { generateShots, curateShots } from '../templates/shots.js';
import { generateAudio } from '../templates/audio.js';

const templateProvider = {
  id: 'template',
  name: 'Built-in Templates',
  capabilities: ['text'],

  async generate({ step, genre, context }) {
    switch (step) {
      case 'planning':
        return buildPlanning(context.userInput, genre);
      case 'screenplay':
        return generateScreenplay(context.userInput, genre);
      case 'characters':
        return generateCharacters(genre);
      case 'visualDesign':
        return generateVisualDesign(genre);
      case 'storyboard':
        return generateStoryboard(genre, context.screenplay);
      case 'shotGen':
        return generateShots(context.storyboard, genre);
      case 'shotCuration':
        return curateShots(context.shots);
      case 'editing':
        return buildEditTimeline(context.storyboard, context.curatedShots);
      case 'audio':
        return generateAudio(genre, context.storyboard);
      case 'postProduction':
        return buildPostProduction(genre, context);
      case 'final':
        return buildFinalFilm(context);
      default:
        return null;
    }
  }
};

function buildEditTimeline(storyboard, curatedShots) {
  const transitions = ['Cut', 'Dissolve', 'Fade', 'Cross-fade', 'Smash Cut'];
  const clips = storyboard.map((scene, i) => ({
    sceneNum: scene.num,
    sceneTitle: scene.title,
    shot: curatedShots[scene.num]?.selected || null,
    duration: `${8 + Math.floor(Math.random() * 15)}s`,
    transition: i < storyboard.length - 1 ? transitions[Math.floor(Math.random() * transitions.length)] : 'Fade to Black'
  }));

  const totalDuration = clips.reduce((sum, c) => sum + parseInt(c.duration), 0);
  return { clips, totalDuration: `${Math.floor(totalDuration / 60)}m ${totalDuration % 60}s`, pacing: 'Moderate — building tension through middle, resolving gently' };
}

function buildPostProduction(genre, context) {
  const lutPresets = {
    scifi: { name: 'Neon Noir', description: 'Pushed teal shadows, cyan highlights, desaturated skin tones' },
    romance: { name: 'Golden Warmth', description: 'Lifted blacks, amber midtones, soft highlights' },
    mystery: { name: 'Cold Shadow', description: 'Crushed blacks, desaturated except selective warm tones' },
    adventure: { name: 'Epic Natural', description: 'Rich greens, warm earth tones, vibrant sky' },
    comedy: { name: 'Bright Pop', description: 'High saturation, clean whites, warm skin tones' },
    fantasy: { name: 'Enchanted Glow', description: 'Rich jewel tones, ethereal bloom, deep shadows' }
  };

  return {
    colorGrading: lutPresets[genre] || lutPresets.fantasy,
    vfx: [
      { type: 'Atmospheric', description: 'Volumetric fog, dust particles, light rays' },
      { type: 'Enhancement', description: 'Lens flares, anamorphic streaks, film grain' },
      { type: 'Compositing', description: 'Seamless scene transitions, environment extensions' }
    ],
    finalMix: '5.1 surround — dialogue center, music L/R wide, SFX positioned',
    outputFormat: '4K DCI (4096×2160), 24fps, HDR10'
  };
}

function buildFinalFilm(context) {
  return {
    title: context.screenplay?.title || 'Untitled Film',
    genre: context.screenplay?.genre || 'Unknown',
    runtime: context.editTimeline?.totalDuration || 'N/A',
    scenes: context.storyboard?.length || 0,
    status: 'Complete'
  };
}

function buildPlanning(userInput, genre) {
  const genreThemes = {
    scifi: { theme: 'Humanity vs Technology', tone: 'Contemplative and awe-inspiring', visualReferences: ['Blade Runner 2049', 'Arrival', 'Ex Machina'] },
    romance: { theme: 'Love Against All Odds', tone: 'Warm and emotionally rich', visualReferences: ['Her', 'Before Sunrise', 'Call Me by Your Name'] },
    mystery: { theme: 'Hidden Truths', tone: 'Tense and atmospheric', visualReferences: ['Se7en', 'Prisoners', 'Zodiac'] },
    adventure: { theme: 'The Hero\'s Journey', tone: 'Exciting and inspiring', visualReferences: ['Indiana Jones', 'The Mummy', 'Pirates of the Caribbean'] },
    comedy: { theme: 'Finding Joy in Chaos', tone: 'Lighthearted and witty', visualReferences: ['The Grand Budapest Hotel', 'Little Miss Sunshine', 'Superbad'] },
    fantasy: { theme: 'Discovery and Transformation', tone: 'Magical and epic', visualReferences: ['Pan\'s Labyrinth', 'Spirited Away', 'The Shape of Water'] }
  };
  const g = genreThemes[genre] || genreThemes.fantasy;

  return {
    theme: g.theme,
    tone: g.tone,
    targetAudience: 'General audience (13+)',
    creativeDirection: `A ${genre} short film exploring ${g.theme.toLowerCase()}. The story will unfold through visual storytelling with minimal dialogue, emphasizing atmosphere and emotion.`,
    keyElements: [
      `Strong visual narrative inspired by ${g.visualReferences[0]}`,
      `Emotional character arc with clear transformation`,
      `Distinct visual style with cohesive color palette`,
      `Immersive sound design complementing the mood`
    ],
    visualReferences: g.visualReferences,
    storySeed: userInput || 'A creative story idea'
  };
}

registerProvider(templateProvider);
