import { QCVerdict, Severity } from './qcTypes.js';

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
        appearance: (c.visualTag || c.appearance)?.substring(0, 200),
        desc: c.desc?.substring(0, 80),
        hasImage: !!(c.sheetPath || c.imagePath)
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

    case 'referenceImages': {
      if (!data) break;
      const shots = data.shots || [];
      entities.refShotCount = shots.length;
      entities.refCompleteCount = shots.filter(s => s.status === 'complete' || s.imagePath).length;
      entities.refVideoMode = data.mode || null;
      entities.refFrameCount = shots.length + (data.extraFrames || []).length;
      break;
    }

    case 'videoGeneration': {
      if (!data) break;
      const clips = data.clips || [];
      entities.clipCount = clips.length;
      entities.clipCompleteCount = clips.filter(c => c.status === 'complete').length;
      entities.clipVideoMode = data.mode || null;
      break;
    }

    case 'postProduction': {
      if (!data) break;
      entities.hasFinalVideo = !!data.finalVideo;
      entities.renderStatus = data.status || null;
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

export function checkConsistency(stepId, data, entities) {
  const issues = [];

  if (!data) {
    return { verdict: QCVerdict.FAIL, issues: ['No data produced'], severity: Severity.CRITICAL };
  }

  switch (stepId) {
    case 'characterDesign': {
      const scriptChars = entities?.characterNames || [];
      const designChars = (data.characters || []).map(c => c.name);
      const missing = scriptChars.filter(n => !designChars.includes(n));
      if (missing.length > 0) {
        issues.push(`Missing character designs for: ${missing.join(', ')}`);
      }
      const chars = data.characters || [];
      const noImage = chars.filter(c => !c.imagePath && !c.imageUrl && !c.sheetPath && !c.sheetUrl);
      if (noImage.length > 0 && chars.length > 0) {
        issues.push(`${noImage.length} character(s) have no image`);
      }
      const noSheet = chars.filter(c => !c.sheetPath && !c.sheetUrl && (c.imagePath || c.imageUrl));
      if (noSheet.length > 0) {
        issues.push(`${noSheet.length} character(s) missing the three-view model sheet`);
      }
      break;
    }

    case 'referenceImages': {
      const expectedShots = entities?.shotCount || 0;
      const actualShots = (data.shots || []).length;
      if (expectedShots > 0 && actualShots < expectedShots * 0.5) {
        issues.push(`Only ${actualShots}/${expectedShots} storyboard shots have reference images`);
      }
      const pending = (data.shots || []).filter(s => !s.imagePath && s.status !== 'complete');
      if (pending.length > actualShots * 0.5 && actualShots > 0) {
        issues.push(`${pending.length}/${actualShots} reference images not generated`);
      }
      if (data.mode === 'firstLastFrame') {
        const extras = data.extraFrames || [];
        const closing = extras.find(f => f.imagePath || f.imageUrl);
        if (!closing) {
          issues.push('No dedicated closing frame for the last shot');
        }
        const noLast = (data.shots || []).filter(s => !s.lastFramePath && !s.lastFrameUrl);
        if (noLast.length > 0) {
          issues.push(`${noLast.length}/${actualShots} shots have no last frame for first-last-frame video`);
        }
      }
      break;
    }

    case 'videoGeneration': {
      const expectedClips = entities?.refShotCount || 0;
      const actualClips = (data.clips || []).length;
      if (expectedClips > 0 && actualClips < expectedClips * 0.5) {
        issues.push(`Only ${actualClips}/${expectedClips} reference shots have video clips`);
      }
      const failed = (data.clips || []).filter(c => c.status === 'failed');
      if (failed.length > actualClips * 0.5 && actualClips > 0) {
        issues.push(`${failed.length}/${actualClips} video clips failed to generate`);
      }
      const plannedMode = entities?.refVideoMode;
      if (plannedMode && data.mode && plannedMode !== data.mode) {
        issues.push(`Step 4 frames were planned for ${plannedMode} but the clips were generated in ${data.mode} mode — rerun step 4 or restore the Settings choice`);
      }
      break;
    }

    case 'postProduction': {
      const hasClips = (entities?.clipCompleteCount || 0) > 0;
      const hasFinal = !!data.finalVideo;
      if (hasClips && !hasFinal) {
        issues.push('Video clips exist but no final video was produced');
      }
      if (data.status === 'failed') {
        issues.push('Post-production render failed');
      }
      break;
    }
  }

  if (issues.length === 0) {
    return { verdict: QCVerdict.PASS, issues: [], severity: null };
  }

  const hasFatal = issues.some(i =>
    i.includes('No data') || i.includes('CRITICAL') || i.includes('failed')
  );

  return {
    verdict: hasFatal ? QCVerdict.FAIL : QCVerdict.CONDITIONAL_PASS,
    issues,
    severity: hasFatal ? Severity.HIGH : Severity.MEDIUM,
  };
}
