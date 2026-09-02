export function extractEntities(stepId, data) {
  const entities = {};

  switch (stepId) {
    case 'screenplay': {
      if (!data) break;
      const characterNames = new Set();
      const locations = new Set();

      if (data.acts) {
        for (const act of data.acts) {
          if (act.scenes) {
            for (const scene of act.scenes) {
              if (scene.location) {
                const loc = scene.location.replace(/^(INT\.|EXT\.)\s*/i, '').trim();
                locations.add(loc);
              }
              if (scene.dialogue) {
                const nameMatch = scene.dialogue.match(/^([A-Z][A-Z\s]{1,20}):/gm);
                if (nameMatch) {
                  nameMatch.forEach(m => characterNames.add(m.replace(':', '').trim()));
                }
              }
              if (scene.action) {
                const nameMatches = scene.action.match(/\b([A-Z][a-z]{2,15})\s+(?:walks|runs|looks|turns|stands|sits|opens|closes|picks|puts|takes|gives|says|whispers|shouts)/g);
                if (nameMatches) {
                  nameMatches.forEach(m => {
                    const name = m.split(/\s+(?:walks|runs|looks|turns|stands|sits|opens|closes|picks|puts|takes|gives|says|whispers|shouts)/)[0];
                    characterNames.add(name);
                  });
                }
              }
            }
          }
        }
      }

      if (data.text) {
        const nameMatches = data.text.match(/\b([A-Z][a-z]{2,15})\s+(?:walks|runs|looks|turns|stands|sits|opens|closes|picks|puts|takes|gives|says|whispers|shouts)/g);
        if (nameMatches) {
          nameMatches.forEach(m => {
            const name = m.split(/\s+(?:walks|runs|looks|turns|stands|sits|opens|closes|picks|puts|takes|gives|says|whispers|shouts)/)[0];
            characterNames.add(name);
          });
        }
      }

      entities.characters = [...characterNames].slice(0, 10);
      entities.locations = [...locations].slice(0, 10);
      entities.title = data.title || null;
      entities.genre = data.genre || null;
      break;
    }

    case 'characters': {
      if (!Array.isArray(data)) break;
      entities.characterDetails = data.map(c => ({
        name: c.name,
        role: c.role,
        emoji: c.emoji,
        desc: c.desc?.substring(0, 80)
      }));
      entities.characterNames = data.map(c => c.name);
      break;
    }

    case 'visualDesign': {
      if (!data) break;
      entities.visualStyle = data.style || null;
      entities.palette = (data.palette || []).map(c => `${c.name} (${c.hex})`);
      entities.lighting = data.lighting || null;
      break;
    }

    case 'storyboard': {
      if (!Array.isArray(data)) break;
      entities.sceneTitles = data.map(s => s.title);
      entities.sceneCount = data.length;
      break;
    }

    case 'planning': {
      if (!data) break;
      entities.theme = data.theme || null;
      entities.tone = data.tone || null;
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
  if (entities.theme) {
    parts.push(`Theme: "${entities.theme}"`);
  }
  if (entities.tone) {
    parts.push(`Tone: "${entities.tone}"`);
  }
  if (entities.visualStyle) {
    parts.push(`Visual style: "${entities.visualStyle}"`);
  }

  const charNames = entities.characterNames || entities.characters || [];
  if (charNames.length > 0) {
    parts.push(`Character names (use these exactly): ${charNames.join(', ')}`);
  }

  if (entities.characterDetails) {
    const details = entities.characterDetails
      .map(c => `${c.name} (${c.role})`)
      .join('; ');
    parts.push(`Character details: ${details}`);
  }

  if (entities.locations && entities.locations.length > 0) {
    parts.push(`Story locations: ${entities.locations.join(', ')}`);
  }

  if (entities.palette && entities.palette.length > 0) {
    parts.push(`Color palette: ${entities.palette.join(', ')}`);
  }

  if (entities.lighting) {
    parts.push(`Lighting style: "${entities.lighting}"`);
  }

  if (entities.sceneTitles && entities.sceneTitles.length > 0) {
    parts.push(`Scene titles: ${entities.sceneTitles.join(' → ')}`);
  }

  if (parts.length === 0) return '';

  return `\n\nCONSISTENCY CONSTRAINTS — You MUST follow these:\n${parts.map(p => `- ${p}`).join('\n')}`;
}
