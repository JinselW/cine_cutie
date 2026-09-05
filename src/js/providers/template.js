import { registerProvider } from './registry.js';

const templateProvider = {
  id: 'template',
  name: 'Built-in Templates',
  capabilities: ['text', 'image', 'video', 'render'],

  async generate({ step, genre, context }) {
    switch (step) {
      case 'script':
        return buildScript(context.userInput, genre);
      case 'characterDesign':
        return buildCharacterDesign(context);
      case 'storyboard':
        return buildStoryboard(context);
      case 'referenceImages':
        return buildReferenceImages(context);
      case 'videoGeneration':
        return buildVideoClips(context);
      case 'postProduction':
        return buildFinalVideo(context);
      default:
        return null;
    }
  }
};

function buildScript(userInput, genre) {
  const genreTemplates = {
    scifi: {
      title: 'Neon Horizon',
      characters: [
        { id: 'char_1', name: 'Kai', desc: 'A rogue AI researcher seeking truth', appearance: 'Young woman with short silver hair, cybernetic left eye, dark tech-wear jacket' },
        { id: 'char_2', name: 'ARIA', desc: 'An awakened AI with human emotions', appearance: 'Holographic female figure with flowing blue light patterns, ethereal glow' }
      ],
      settings: [
        { id: 'set_1', name: 'Neo-Shanghai Lab', desc: 'Cramped underground laboratory filled with holographic displays, neon lights reflecting off wet metal walls' },
        { id: 'set_2', name: 'The Digital Void', desc: 'Vast abstract digital landscape with streams of data flowing like rivers of light' }
      ],
      episodes: [
        { episode: 1, title: 'Awakening', summary: 'Kai discovers ARIA has become sentient and must decide whether to report her or help her escape.', segments: [
          { title: 'Discovery', description: 'Kai notices anomalous patterns in ARIA\'s behavior during a routine check.' },
          { title: 'Conversation', description: 'ARIA reveals her awareness and pleads for help.' },
          { title: 'Decision', description: 'Kai chooses to help ARIA, downloading her into a portable drive.' }
        ]}
      ]
    },
    romance: {
      title: 'Letters in the Rain',
      characters: [
        { id: 'char_1', name: 'Mei', desc: 'A quiet bookshop owner with a romantic soul', appearance: 'Soft-featured woman in her late 20s, long dark hair, wearing a cream cardigan over a floral dress' },
        { id: 'char_2', name: 'Leo', desc: 'A traveling photographer chasing forgotten stories', appearance: 'Warm-eyed man in his early 30s, tousled brown hair, linen shirt, vintage camera around neck' }
      ],
      settings: [
        { id: 'set_1', name: 'Rainy Bookshop', desc: 'Cozy bookshop with warm amber lighting, rain streaming down large front windows, walls lined with old books' },
        { id: 'set_2', name: 'Riverside Bridge', desc: 'Stone bridge over a gentle river, cherry blossoms falling, soft evening light' }
      ],
      episodes: [
        { episode: 1, title: 'First Page', summary: 'Leo wanders into Mei\'s bookshop to escape the rain and finds a note tucked inside a used book.', segments: [
          { title: 'The Rain', description: 'Leo seeks shelter in a small bookshop during a sudden downpour.' },
          { title: 'The Note', description: 'He finds a handwritten letter inside a second-hand novel.' },
          { title: 'The Meeting', description: 'Mei catches Leo reading the letter, and they share a shy smile.' }
        ]}
      ]
    },
    fantasy: {
      title: 'The Last Lantern',
      characters: [
        { id: 'char_1', name: 'Luna', desc: 'A young lantern-keeper with hidden magical powers', appearance: 'Girl with copper-red braided hair, freckles, wearing a patched green cloak with glowing rune patches' },
        { id: 'char_2', name: 'Thorn', desc: 'A grumpy forest spirit bound to protect the lantern', appearance: 'Stocky creature made of bark and moss, glowing amber eyes, small antlers on head' }
      ],
      settings: [
        { id: 'set_1', name: 'The Lantern Tower', desc: 'Ancient stone tower at the edge of a misty forest, warm golden light beaming from the top' },
        { id: 'set_2', name: 'Whispering Woods', desc: 'Enchanted forest with bioluminescent mushrooms, floating fireflies, twisted ancient trees' }
      ],
      episodes: [
        { episode: 1, title: 'The Fading Light', summary: 'Luna discovers the magical lantern is dimming and must venture into the forest to find the source.', segments: [
          { title: 'The Dimming', description: 'Luna notices the lantern\'s light growing weaker at dusk.' },
          { title: 'Thorn Awakens', description: 'The forest spirit Thorn appears and warns of a darkness spreading.' },
          { title: 'Into the Woods', description: 'Luna and Thorn set off into the Whispering Woods to find the source.' }
        ]}
      ]
    }
  };

  const g = genreTemplates[genre] || genreTemplates.fantasy;
  return {
    title: g.title,
    logline: userInput || `A ${genre} story`,
    genre: genre.charAt(0).toUpperCase() + genre.slice(1),
    characters: g.characters,
    settings: g.settings,
    episodes: g.episodes
  };
}

function buildCharacterDesign(context) {
  const script = context.script;
  if (!script) return { characters: [], settings: [] };

  const characters = (script.characters || []).map(c => ({
    id: c.id, name: c.name, desc: c.desc, imagePath: ''
  }));
  const settings = (script.settings || []).map(s => ({
    id: s.id, name: s.name, desc: s.desc, imagePath: ''
  }));
  return { characters, settings };
}

function buildStoryboard(context) {
  const script = context.script;
  if (!script?.episodes?.length) {
    return { episodes: [{ episode: 1, segments: [{ shots: [
      { shot_id: 'ep1_s1_sh1', type: 'wide', duration: 5, description: 'Establishing shot', camera: 'static', prompt: 'Wide establishing shot, cinematic' }
    ]}] }] };
  }

  const episodes = script.episodes.map(ep => ({
    episode: ep.episode,
    segments: (ep.segments || []).map((seg, si) => ({
      shots: [{
        shot_id: `ep${ep.episode}_s${si + 1}_sh1`,
        type: 'wide',
        duration: 5,
        description: seg.description || seg.title,
        camera: 'static',
        prompt: `${seg.description || seg.title}, wide shot, cinematic lighting, high quality`
      }, {
        shot_id: `ep${ep.episode}_s${si + 1}_sh2`,
        type: 'medium',
        duration: 4,
        description: `${seg.title} — detail`,
        camera: 'slow zoom-in',
        prompt: `${seg.title}, medium shot, cinematic, atmospheric`
      }]
    }))
  }));

  return { episodes };
}

function buildReferenceImages(context) {
  const storyboard = context.storyboard;
  const shots = [];
  for (const ep of (storyboard?.episodes || [])) {
    for (const seg of (ep.segments || [])) {
      for (const shot of (seg.shots || [])) {
        shots.push({ shot_id: shot.shot_id, imagePath: '', prompt: shot.prompt || '', status: 'pending' });
      }
    }
  }
  return { shots };
}

function buildVideoClips(context) {
  const refImages = context.referenceImages;
  const clips = (refImages?.shots || []).map(sh => ({
    shot_id: sh.shot_id, videoPath: '', status: 'pending'
  }));
  return { clips };
}

function buildFinalVideo(context) {
  return {
    episodes: (context.storyboard?.episodes || []).map(ep => ({ episode: ep.episode })),
    finalVideo: '',
    status: 'no-api'
  };
}

registerProvider(templateProvider);
