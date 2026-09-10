// A one-character name matches almost any text, so such tokens are not used as signals.
function matchEntities(list, corpus) {
  return list.filter(entity => [entity.id, entity.name, entity.enName]
    .filter(Boolean)
    .some(name => String(name).toLowerCase().length > 1 && corpus.includes(String(name).toLowerCase())));
}

// Storyboard shots often describe action without naming the characters in it, so a shot
// also inherits the text of its script episode and segment.
export function shotBeatTexts(ctx) {
  const texts = new Map();
  const scriptEpisodes = ctx.script?.episodes || [];
  (ctx.storyboard?.episodes || []).forEach((episode, episodeIndex) => {
    const scriptEpisode = scriptEpisodes.find(e => e.episode === episode.episode) || scriptEpisodes[episodeIndex];
    (episode.segments || []).forEach((segment, segmentIndex) => {
      const scriptSegment = scriptEpisode?.segments?.[segmentIndex];
      const text = [scriptEpisode?.title, scriptEpisode?.summary, scriptSegment?.title, scriptSegment?.description].filter(Boolean).join(' ');
      for (const shot of (segment.shots || [])) texts.set(shot.shot_id, text);
    });
  });
  return texts;
}

export function bindEntities(shot, ctx, beatText = '') {
  const design = ctx.characterDesign || {};
  const corpus = [shot.description, shot.prompt, shot.settingId, ...(shot.characterIds || []), beatText].join(' ').toLowerCase();
  const characters = matchEntities(design.characters || [], corpus);
  const settings = matchEntities(design.settings || [], corpus);
  if (!characters.length && design.characters?.length === 1) characters.push(design.characters[0]);
  if (!settings.length && design.settings?.length === 1) settings.push(design.settings[0]);
  return { characterIds: characters.map(e => e.id), settingId: settings[0]?.id ?? null,
    referenceAssetIds: [...characters.map(e => `${e.id}.sheet`), ...settings.slice(0, 1).map(e => `${e.id}.plate`)] };
}
export function boundEntities(bindings, ctx) {
  return [...(ctx.characterDesign?.characters || []).filter(c => bindings.characterIds.includes(c.id)),
    ...(ctx.characterDesign?.settings || []).filter(s => s.id === bindings.settingId)];
}
