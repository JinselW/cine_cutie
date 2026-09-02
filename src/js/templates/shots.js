const cameraAngles = [
  'Wide Shot', 'Medium Close-Up', 'Extreme Close-Up', 'Over-the-Shoulder',
  'Dutch Angle', 'Low Angle', 'High Angle', 'Tracking Shot',
  'Crane Shot', 'POV Shot', 'Two-Shot', 'Insert Shot'
];

const compositions = [
  'Rule of thirds, subject left', 'Centered symmetry', 'Leading lines from foreground',
  'Frame within frame (doorway)', 'Negative space emphasis', 'Diagonal energy',
  'Foreground-background layering', 'Silhouette against light', 'Mirror reflection',
  'Overhead bird\'s eye', 'Low ground level', 'Through obstruction (fence/glass)'
];

const qualityKeys = ['needs-work', 'good', 'great', 'perfect'];

function seededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export function generateShots(storyboard, genre) {
  const shots = {};
  storyboard.forEach((scene, idx) => {
    const rng = seededRandom(idx * 1000 + genre.length * 31);
    const takes = [];
    for (let t = 0; t < 3; t++) {
      const score = Math.round(55 + rng() * 45);
      let labelIdx = score < 65 ? 0 : score < 80 ? 1 : score < 92 ? 2 : 3;
      takes.push({
        takeNum: t + 1,
        angle: cameraAngles[Math.floor(rng() * cameraAngles.length)],
        composition: compositions[Math.floor(rng() * compositions.length)],
        score,
        label: qualityKeys[labelIdx],
        description: `${cameraAngles[Math.floor(rng() * cameraAngles.length)]} capturing the ${scene.title.toLowerCase()} scene with ${compositions[Math.floor(rng() * compositions.length)].toLowerCase()}.`
      });
    }
    shots[scene.num] = takes;
  });
  return shots;
}

export function curateShots(shots) {
  const curated = {};
  for (const [sceneId, takes] of Object.entries(shots)) {
    let best = takes[0];
    for (const take of takes) {
      if (take.score > best.score) best = take;
    }
    curated[sceneId] = {
      selected: best,
      rejected: takes.filter(t => t !== best),
      reason: `Best score (${best.score}/100) — strongest ${best.angle.toLowerCase()} with compelling ${best.composition.toLowerCase().split(',')[0]}.`
    };
  }
  return curated;
}
