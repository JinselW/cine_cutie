export function extractEntities(stepId, data) {
  const entities = {};

  switch (stepId) {
    case 'script': {
      if (!data) break;
      entities.title = data.title || null;
      entities.genre = data.genre || null;
      entities.characterNames = (data.characters || []).map(c => c.name);
      entities.characterDetails = (data.characters || []).map(c => ({
        name: c.name,
        desc: c.desc?.substring(0, 80),
        appearance: c.appearance?.substring(0, 200)
      }));
      entities.settingNames = (data.settings || []).map(s => s.name);
      break;
    }

    case 'characterDesign': {
      if (!data) break;
      entities.characterImages = (data.characters || []).map(c => ({
        name: c.name,
        appearance: c.appearance?.substring(0, 200),
        desc: c.desc?.substring(0, 80),
        hasImage: !!c.imagePath
      }));
      break;
    }

    case 'storyboard': {
      if (!data) break;
      const shotCount = (data.episodes || []).reduce((n, ep) =>
        n + (ep.segments || []).reduce((m, seg) => m + (seg.shots?.length || 0), 0), 0);
      entities.episodeCount = (data.episodes || []).length;
      entities.shotCount = shotCount;
      break;
    }
  }

  return Object.keys(entities).length > 0 ? entities : null;
}

export function mergeEntities(existing, newEntities) {
  if (!newEntities) return existing || {};
  return { ...existing, ...newEntities };
}

export function buildConsistencyConstraints(entities) {
  if (!entities || Object.keys(entities).length === 0) return '';

  const parts = [];

  if (entities.title) {
    parts.push(`Film title: "${entities.title}"`);
  }
  if (entities.genre) {
    parts.push(`Genre: "${entities.genre}"`);
  }

  const charNames = entities.characterNames || [];
  if (charNames.length > 0) {
    parts.push(`Character names (use these exactly): ${charNames.join(', ')}`);
  }

  if (entities.characterDetails) {
    const details = entities.characterDetails
      .map(c => `${c.name}: ${c.desc}`)
      .join('; ');
    parts.push(`Character details: ${details}`);
  }

  if (entities.characterImages) {
    const visuals = entities.characterImages
      .filter(c => c.appearance)
      .map(c => `${c.name}: ${c.appearance}`)
      .join('; ');
    if (visuals) {
      parts.push(`Character visual appearance (MUST match): ${visuals}`);
    }
  }

  if (entities.settingNames && entities.settingNames.length > 0) {
    parts.push(`Story settings: ${entities.settingNames.join(', ')}`);
  }

  if (parts.length === 0) return '';

  return `\n\nCONSISTENCY CONSTRAINTS — You MUST follow these:\n${parts.map(p => `- ${p}`).join('\n')}`;
}
