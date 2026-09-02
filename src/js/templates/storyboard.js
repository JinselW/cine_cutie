const sceneIcons = ['🌅','🌃','🏛️','🌊','🏔️','🌌','🏙️','🌿','🔥','🌙'];

const scenePalettes = {
  scifi: ['#0f172a','#1e3a5f','#1a1a3e','#0d1b2a','#1b2838'],
  romance: ['#2d1b2e','#3d2b3e','#1e2d3d','#2e1b2b','#1b2e2d'],
  mystery: ['#0a0a0a','#1a1a2e','#16213e','#0f0f23','#1a1a1a'],
  adventure: ['#1a3c34','#2d4a3e','#1e3a2d','#0f2b1e','#1a3430'],
  comedy: ['#2d2b3e','#3e2b2d','#2b3e2d','#3e3b2d','#2d2e3e'],
  fantasy: ['#1a0a2e','#2e1a3e','#0a1a2e','#2e0a1a','#1a2e0a']
};

export function generateStoryboard(genre, screenplay) {
  const scenes = [];
  const palette = scenePalettes[genre] || scenePalettes.fantasy;
  let sceneNum = 0;
  screenplay.acts.forEach(act => {
    act.scenes.forEach(scene => {
      sceneNum++;
      scenes.push({
        num: sceneNum,
        title: scene.location.split('—')[0].trim(),
        desc: scene.action.substring(0, 100) + '...',
        color: palette[(sceneNum - 1) % palette.length],
        icon: sceneIcons[sceneNum % sceneIcons.length]
      });
    });
  });
  return scenes;
}
