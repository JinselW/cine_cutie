const JSON_RULE = 'Reply ONLY with valid JSON. No markdown, no commentary, no code fences.';
const LANG_RULE = 'Write all creative content (titles, descriptions, dialogue, etc.) in the SAME LANGUAGE as the user\'s story idea. Keep all JSON keys in English exactly as specified.';

function screenplaySummary(screenplay) {
  if (!screenplay) return '';
  const parts = [`Title: ${screenplay.title}`, `Genre: ${screenplay.genre}`, `Logline: ${screenplay.logline}`];
  if (screenplay.acts) {
    parts.push('Acts:');
    screenplay.acts.forEach(act => {
      parts.push(`  ${act.title}`);
      act.scenes?.forEach(s => parts.push(`    - ${s.location}: ${s.action?.substring(0, 100)}`));
    });
  }
  return parts.join('\n');
}

function storyboardSummary(storyboard) {
  if (!storyboard) return '';
  return storyboard.map(s => `Scene ${s.num}: ${s.title} — ${s.desc}`).join('\n');
}

export const PROMPTS = {
  planning: {
    system: `You are Cine-Cutie's Creative Planner, an expert film producer who analyzes story ideas and creates comprehensive creative direction documents. ${JSON_RULE} ${LANG_RULE}`,
    buildUser(ctx) {
      return `Analyze the following story idea and create a creative direction document.

STORY IDEA:
${ctx.userInput || 'A creative story'}

GENRE: ${ctx.genre}

OUTPUT JSON SCHEMA:
{
  "theme": "string — central theme like 'Redemption', 'Discovery', 'Love vs Duty'",
  "tone": "string — emotional tone like 'Dark and contemplative', 'Uplifting and warm'",
  "targetAudience": "string — target audience like 'General audience (13+)', 'Young adults'",
  "creativeDirection": "string — 2-3 sentence description of the creative approach, visual storytelling style, and narrative focus",
  "keyElements": [
    "string — key storytelling element (4-6 items)",
    "string — e.g. 'Strong visual narrative with minimal dialogue'",
    "string — e.g. 'Character arc showing clear transformation'"
  ],
  "visualReferences": [
    "string — film reference 1",
    "string — film reference 2",
    "string — film reference 3"
  ],
  "storySeed": "string — the original user input, preserved as-is"
}

Requirements:
- keyElements must have 4-6 items
- visualReferences must have exactly 3 real film titles that match the genre and tone
- creativeDirection should be specific and actionable
- theme should capture the core emotional/philosophical question`;
    }
  },

  screenplay: {
    system: `You are Cine-Cutie's Scriptwriter, a professional screenwriter with expertise in story structure, character arcs, and dialogue. ${JSON_RULE} ${LANG_RULE}`,
    buildUser(ctx) {
      const planInfo = ctx.planning ? `\nCREATIVE DIRECTION:\nTheme: ${ctx.planning.theme}\nTone: ${ctx.planning.tone}\nDirection: ${ctx.planning.creativeDirection}\nKey Elements: ${ctx.planning.keyElements?.join(', ') || 'N/A'}\n` : '';
      return `Create a short film screenplay based on the following idea.
${planInfo}
STORY IDEA:
${ctx.userInput || 'A creative story'}

GENRE: ${ctx.genre}

OUTPUT JSON SCHEMA:
{
  "title": "string — film title",
  "genre": "string — display genre like 'Fantasy Adventure' or 'Sci-Fi Thriller'",
  "logline": "string — one-sentence summary",
  "text": "string — full formatted screenplay text with scene headings, action lines, and dialogue",
  "acts": [
    {
      "title": "string — e.g. 'Act I — The Beginning'",
      "scenes": [
        {
          "location": "string — scene location like 'INT. LIBRARY — NIGHT'",
          "action": "string — action description",
          "dialogue": "string — character dialogue"
        }
      ]
    }
  ]
}

Requirements:
- Exactly 3 acts
- 2-3 scenes per act
- The "text" field should be a fully formatted screenplay with the complete story
- Make it creative and engaging`;
    }
  },

  characters: {
    system: `You are Cine-Cutie's Character Designer, an expert in creating memorable film characters with distinct personalities and visual identities. ${JSON_RULE} ${LANG_RULE}`,
    buildUser(ctx) {
      const sp = screenplaySummary(ctx.screenplay);
      return `Design characters for this film.

SCREENPLAY:
${sp}

OUTPUT JSON SCHEMA (return an ARRAY):
[
  {
    "name": "string — character name",
    "role": "string — e.g. 'Protagonist', 'Antagonist', 'Ally', 'Love Interest', 'Mentor'",
    "emoji": "string — a single emoji representing this character",
    "color": "string — hex color like '#e05070'",
    "desc": "string — brief character description"
  }
]

Requirements:
- 3-5 characters
- Each character should have a distinct role
- emoji must be a single emoji character
- color must be a valid hex color string`;
    }
  },

  visualDesign: {
    system: `You are Cine-Cutie's Art Director, specializing in visual style, color theory, and cinematic aesthetics. ${JSON_RULE} ${LANG_RULE}`,
    buildUser(ctx) {
      const logline = ctx.screenplay?.logline || '';
      const genre = ctx.screenplay?.genre || ctx.genre;
      return `Define the visual design for this film.

FILM: ${ctx.screenplay?.title || 'Untitled'}
GENRE: ${genre}
LOGLINE: ${logline}

OUTPUT JSON SCHEMA:
{
  "style": "string — visual style name like 'Neo-Noir Cyberpunk' or 'Painterly Mysticism'",
  "description": "string — 2-3 sentence description of the visual approach",
  "palette": [
    {
      "name": "string — color name like 'Midnight Blue'",
      "hex": "string — hex color like '#1a1a3e'",
      "role": "string — how this color is used like 'Primary shadows' or 'Accent highlights'"
    }
  ],
  "lighting": "string — lighting style description",
  "cameraStyle": "string — camera movement and lens choices"
}

Requirements:
- Exactly 6 colors in palette
- Colors should work together harmoniously
- Style should match the genre and story`;
    }
  },

  storyboard: {
    system: `You are Cine-Cutie's Storyboard Artist, expert in visual storytelling and scene composition. ${JSON_RULE} ${LANG_RULE}`,
    buildUser(ctx) {
      const sp = screenplaySummary(ctx.screenplay);
      return `Create a storyboard for this film.

SCREENPLAY:
${sp}

OUTPUT JSON SCHEMA (return an ARRAY):
[
  {
    "num": "number — sequential scene number starting from 1",
    "title": "string — short scene title",
    "desc": "string — brief visual description of what we see",
    "color": "string — hex color representing the scene's mood",
    "icon": "string — a single emoji representing the scene"
  }
]

Requirements:
- 7-9 scenes covering the full story
- num must be sequential starting from 1
- Each scene should have a distinct visual identity
- color must be a valid hex color
- icon must be a single emoji`;
    }
  },

  shotGen: {
    system: `You are Cine-Cutie's Shot Director, specializing in camera work, composition, and visual storytelling through镜头 choices. ${JSON_RULE} ${LANG_RULE}`,
    buildUser(ctx) {
      const sb = storyboardSummary(ctx.storyboard);
      return `Generate camera shots for each scene.

STORYBOARD:
${sb}

OUTPUT JSON SCHEMA (return an OBJECT keyed by scene number as string):
{
  "1": [
    {
      "takeNum": "number — 1, 2, or 3",
      "angle": "string — camera angle like 'Wide Shot', 'Medium Close-Up', 'Dutch Angle', 'Low Angle'",
      "composition": "string — composition description like 'Rule of thirds, subject left'",
      "score": "number — quality score 0-100",
      "label": "string — one of: 'needs-work', 'good', 'great', 'perfect'",
      "description": "string — description of this take"
    }
  ],
  "2": [...],
  ...
}

Requirements:
- Exactly 3 takes per scene
- Scene keys must be strings matching storyboard scene nums ("1", "2", etc.)
- label must be one of: 'needs-work' (< 65), 'good' (65-79), 'great' (80-91), 'perfect' (92+)
- score should be consistent with label
- Vary camera angles across takes`;
    }
  },

  shotCuration: {
    system: `You are Cine-Cutie's Shot Curator, with a keen eye for selecting the best visual takes. ${JSON_RULE} ${LANG_RULE}`,
    buildUser(ctx) {
      const sb = storyboardSummary(ctx.storyboard);
      const shotsInfo = ctx.shots ? JSON.stringify(ctx.shots, null, 2) : '{}';
      return `Select the best take for each scene.

STORYBOARD:
${sb}

SHOTS (all takes):
${shotsInfo}

OUTPUT JSON SCHEMA (return an OBJECT keyed by scene number as string):
{
  "1": {
    "selected": { "takeNum": 1, "angle": "...", "composition": "...", "score": 95, "label": "perfect", "description": "..." },
    "rejected": [
      { "takeNum": 2, "angle": "...", "composition": "...", "score": 78, "label": "good", "description": "..." },
      { "takeNum": 3, ... }
    ],
    "reason": "string — one sentence explaining why this take was selected"
  },
  "2": {...},
  ...
}

Requirements:
- Every scene from the storyboard must have an entry
- "selected" must be one of the provided takes (copy it exactly)
- "rejected" must contain the remaining takes
- "reason" should reference the specific angle and composition`;
    }
  },

  editing: {
    system: `You are Cine-Cutie's Film Editor, expert in pacing, transitions, and assembling a cohesive narrative. ${JSON_RULE} ${LANG_RULE}`,
    buildUser(ctx) {
      const sb = storyboardSummary(ctx.storyboard);
      return `Create an edit timeline for this film.

STORYBOARD:
${sb}

OUTPUT JSON SCHEMA:
{
  "clips": [
    {
      "sceneNum": "number — scene number",
      "sceneTitle": "string — scene title",
      "shot": { "takeNum": 1, "angle": "...", "composition": "...", "score": 95, "label": "perfect", "description": "..." },
      "duration": "string — format like '12s' or '8s'",
      "transition": "string — one of: 'Cut', 'Dissolve', 'Fade', 'Cross-fade', 'Smash Cut'"
    }
  ],
  "totalDuration": "string — format like '2m 15s'",
  "pacing": "string — description of the editing rhythm"
}

Requirements:
- One clip per storyboard scene, in order
- The LAST clip's transition must be "Fade to Black"
- duration format: "<number>s" (8-22 seconds per clip)
- totalDuration: sum all durations, format as "<minutes>m <seconds>s"
- shot should match the selected take from curation (if available)`;
    }
  },

  audio: {
    system: `You are Cine-Cutie's Composer, specializing in film scoring and sound design. ${JSON_RULE} ${LANG_RULE}`,
    buildUser(ctx) {
      const sb = storyboardSummary(ctx.storyboard);
      const logline = ctx.screenplay?.logline || '';
      return `Design the audio landscape for this film.

FILM: ${ctx.screenplay?.title || 'Untitled'}
LOGLINE: ${logline}

STORYBOARD:
${sb}

OUTPUT JSON SCHEMA:
{
  "music": {
    "theme": "string — main theme description like 'Haunting piano melody'",
    "tempo": "string — tempo like '60-100 BPM' or 'Slow build to urgent'",
    "instruments": "string — instrument choices like 'Piano, strings, subtle synth'",
    "mood": "string — overall musical mood"
  },
  "sceneAudio": [
    {
      "sceneNum": "number",
      "sceneTitle": "string",
      "musicCue": "string — what the music does in this scene",
      "sfx": ["string", "string"],
      "dialogueMix": "string — dialogue processing notes",
      "duration": "string — format like '15s'"
    }
  ],
  "mixNotes": {
    "dialogue": "string — dialogue mixing approach",
    "music": "string — music mixing approach",
    "sfx": "string — SFX mixing approach"
  }
}

Requirements:
- One sceneAudio entry per storyboard scene
- sfx must be an array of exactly 2 sound effect descriptions
- duration format: "<number>s" (15-35 seconds per scene)`;
    }
  },

  postProduction: {
    system: `You are Cine-Cutie's Post-Production Artist, expert in color grading, VFX, and final output. ${JSON_RULE} ${LANG_RULE}`,
    buildUser(ctx) {
      const style = ctx.visualDesign?.style || '';
      const pacing = ctx.editTimeline?.pacing || '';
      return `Define post-production details for this film.

VISUAL STYLE: ${style}
EDITING PACING: ${pacing}

OUTPUT JSON SCHEMA:
{
  "colorGrading": {
    "name": "string — LUT preset name like 'Neon Noir' or 'Golden Warmth'",
    "description": "string — color grading description"
  },
  "vfx": [
    {
      "type": "string — VFX category like 'Atmospheric', 'Enhancement', 'Compositing'",
      "description": "string — specific VFX description"
    }
  ],
  "finalMix": "string — final audio mix description",
  "outputFormat": "string — output format like '4K DCI (4096x2160), 24fps, HDR10'"
}

Requirements:
- Exactly 3 VFX entries
- Color grading should complement the visual style
- Output format should be a professional delivery spec`;
    }
  },

  final: {
    system: `You are Cine-Cutie's Director, overseeing the final film assembly. ${JSON_RULE} ${LANG_RULE}`,
    buildUser(ctx) {
      return `Summarize the completed film.

TITLE: ${ctx.screenplay?.title || 'Untitled'}
GENRE: ${ctx.screenplay?.genre || 'Unknown'}
SCENES: ${ctx.storyboard?.length || 0}
RUNTIME: ${ctx.editTimeline?.totalDuration || 'N/A'}

OUTPUT JSON SCHEMA:
{
  "title": "string — film title",
  "genre": "string — genre",
  "runtime": "string — total runtime",
  "scenes": "number — number of scenes",
  "status": "string — must be 'Complete'"
}

Requirements:
- Copy the provided values exactly
- status must be "Complete"`;
    }
  }
};

export function buildMessages(stepId, ctx) {
  const prompt = PROMPTS[stepId];
  if (!prompt) return null;

  const systemContent = prompt.system;
  let userContent = prompt.buildUser(ctx);

  if (ctx.constraints) {
    userContent += ctx.constraints;
  }

  if (ctx.feedback) {
    const prevResult = ctx.previousResult;
    userContent += `\n\n---\nREVISION REQUEST ---\nYour previous output was:\n${JSON.stringify(prevResult, null, 2)}\n\nThe user has provided this feedback:\n"${ctx.feedback}"\n\nRevise your output according to this feedback. Return the COMPLETE revised JSON, not just the changes.`;
  }

  return [
    { role: 'system', content: systemContent },
    { role: 'user', content: userContent }
  ];
}
