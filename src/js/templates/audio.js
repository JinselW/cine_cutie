const musicStyles = {
  scifi: { theme: 'Ambient Electronic', tempo: '70-90 BPM', instruments: 'Synth pads, arpeggiated sequences, sub-bass pulses, processed vocals', mood: 'Contemplative, vast, slightly unsettling' },
  romance: { theme: 'Acoustic Intimacy', tempo: '60-80 BPM', instruments: 'Solo piano, acoustic guitar, strings, soft percussion', mood: 'Warm, tender, bittersweet' },
  mystery: { theme: 'Dark Tension', tempo: '50-70 BPM', instruments: 'Low strings, muted piano, dissonant woodwinds, heartbeat percussion', mood: 'Suspenseful, brooding, claustrophobic' },
  adventure: { theme: 'Epic Orchestral', tempo: '90-120 BPM', instruments: 'Full orchestra, ethnic woodwinds, war drums, French horn calls', mood: 'Triumphant, expansive, daring' },
  comedy: { theme: 'Quirky Pizzicato', tempo: '100-130 BPM', instruments: 'Pizzicato strings, xylophone, kazoo, light percussion, slide whistle', mood: 'Playful, absurd, lighthearted' },
  fantasy: { theme: 'Mystical Choral', tempo: '60-100 BPM', instruments: 'Harp, ethereal choir, Celtic flute, bodhrán, enchanted bells', mood: 'Enchanting, ancient, wondrous' }
};

const sfxTemplates = {
  scifi: ['Quantum processor hum', 'Holographic UI chime', 'Data stream whoosh', 'Neural link activation', 'Satellite uplink tone'],
  romance: ['Book pages turning', 'Rain on window', 'Coffee cup clink', 'Footsteps on cobblestone', 'Camera shutter'],
  mystery: ['Lock clicking', 'Rain hammering glass', 'Footsteps echoing', 'Old door creaking', 'Recording tape hiss'],
  adventure: ['Map unfurling', 'Compass mechanism clicking', 'Ice cracking', 'Ancient stone grinding', 'Wind howling'],
  comedy: ['Fridge beeping', 'Phone notification flood', 'Cat meowing', 'Award show applause', 'Awkward silence crickets'],
  fantasy: ['Storyfire crackling', 'Magic ink flowing', 'Book hovering', 'Censor void hum', 'Citadel gates opening']
};

export function generateAudio(genre, storyboard) {
  const music = musicStyles[genre] || musicStyles.fantasy;
  const sfx = sfxTemplates[genre] || sfxTemplates.fantasy;

  const sceneAudio = storyboard.map((scene, i) => ({
    sceneNum: scene.num,
    sceneTitle: scene.title,
    musicCue: i === 0 ? 'Main theme opens' : i === storyboard.length - 1 ? 'Theme resolution / finale' : `Theme variation ${i}`,
    sfx: [sfx[i % sfx.length], sfx[(i + 2) % sfx.length]],
    dialogueMix: 'Center channel, slight reverb for space',
    duration: `${15 + Math.floor(Math.random() * 20)}s`
  }));

  return {
    music,
    sfxLibrary: sfx,
    sceneAudio,
    mixNotes: {
      dialogue: 'Priority: always clear. Duck music 6dB under speech.',
      music: 'Stereo wide, emotional anchor. Swell at scene transitions.',
      sfx: 'Positioned in stereo field to match on-screen source.'
    }
  };
}
