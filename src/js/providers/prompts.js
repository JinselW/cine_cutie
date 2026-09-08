const JSON_RULE = 'Reply ONLY with valid JSON. No markdown, no commentary, no code fences.';
const LANG_RULE = 'Write all creative content (titles, descriptions, dialogue, etc.) in the SAME LANGUAGE as the user\'s story idea. Keep all JSON keys in English exactly as specified.';

export const STYLE_HINTS = {
  cinematic: 'cinematic film look, natural lighting, realistic tones',
  fantasy: 'magical atmosphere, ethereal lighting, mythical elements',
  scifi: 'futuristic, neon-lit, high-tech, sleek metallic surfaces',
  anime: 'anime art style, vibrant colors, Japanese animation aesthetic',
  noir: 'high contrast black and white, dramatic shadows, 1940s detective mood',
  horror: 'dark atmosphere, eerie lighting, unsettling shadows',
  romance: 'warm golden tones, soft focus, dreamy atmosphere',
  comedy: 'bright saturated colors, upbeat energy, exaggerated expressions',
  adventure: 'epic landscapes, dynamic lighting, warm earth tones',
  documentary: 'naturalistic, handheld camera feel, raw authentic look'
};

export const PROMPTS = {
  script: {
    system: `You are Cine-Cutie's Scriptwriter, a professional screenwriter who creates structured scripts for AI video production. ${JSON_RULE} ${LANG_RULE}`,
    buildUser(ctx) {
      const totalDuration = ctx.totalDuration || 30;
      const maxClips = Math.ceil(totalDuration / 5);
      const maxEpisodes = maxClips <= 2 ? 1 : maxClips <= 6 ? 2 : 3;

      return `Create a structured script for AI video production based on the following idea.

STORY IDEA:
${ctx.userInput || 'A creative story'}
${ctx.promptDoc ? `
REFERENCE DOCUMENT (user-provided source material — combine it with the story idea above):
${ctx.promptDoc}
` : ''}
GENRE: ${ctx.genre}
VISUAL STYLE: ${STYLE_HINTS[ctx.genre] || ctx.genre || 'cinematic film look'}

TARGET DURATION: ${totalDuration} seconds total (~${maxClips} video clips at 5s each)

OUTPUT JSON SCHEMA:
{
  "title": "string — film/series title",
  "logline": "string — one-sentence summary",
  "genre": "string — display genre like 'Fantasy Adventure' or 'Sci-Fi Thriller'",
  "characters": [
    {
      "id": "string — unique id like 'char_1'",
      "name": "string — character name in the story's language",
      "enName": "string — English transliteration or English name for the character",
      "desc": "string — brief personality and role description",
      "appearance": "string — detailed visual appearance for image generation (clothing, hair, features, etc.)"
    }
  ],
  "settings": [
    {
      "id": "string — unique id like 'set_1'",
      "name": "string — location name",
      "desc": "string — detailed visual description for image generation"
    }
  ],
  "episodes": [
    {
      "episode": 1,
      "title": "string — episode title",
      "summary": "string — episode summary",
      "segments": [
        {
          "title": "string — segment title",
          "description": "string — what happens in this segment",
          "dialogue": "string — character dialogue or narration in this segment (use character names, e.g. 'Mibao says: Hello!'). Can be empty if no dialogue.",
          "sound_effects": "string — ambient sounds and sound effects for this segment (e.g. 'rain falling, footsteps, door creaking, crowd cheering'). Describe all audible elements including environmental sounds, character actions, and background noise."
        }
      ]
    }
  ]
}

Requirements:
- 2-4 characters, each with detailed appearance
- 2-4 settings, each with vivid visual descriptions
- 1-${maxEpisodes} episodes (limited by ${totalDuration}s total duration), each with 2-4 segments
- Make characters visually distinctive for image generation
- Make settings detailed enough to generate reference images
- For each segment, provide dialogue (character speech/narration) and sound_effects (ambient sounds, action sounds, environmental audio). Think about what the audience would HEAR: voices, weather, footsteps, doors, traffic, music, etc. Even if the user didn't explicitly mention sounds, infer them from the scene context (e.g., rain scene needs rain sounds, city scene needs traffic noise).

STORY COHERENCE — CRITICAL:
- The story MUST have a clear narrative arc: setup → development → climax → resolution
- Each segment MUST logically follow from the previous one with cause-and-effect relationships
- Characters' actions and emotions should evolve naturally across segments, not jump randomly
- The ending should resolve the central conflict or question introduced at the beginning
- Avoid disconnected vignettes — every segment must advance the plot or develop a character
- Keep the story focused: ONE main conflict, resolved within the ${totalDuration}s duration`;
    }
  },

  characterDesign: {
    system: `You are Cine-Cutie's Production Designer. You turn a script into precise, stable visual design specs that drive image generation, so the same character and the same location look identical in every view and every shot. ${JSON_RULE} ${LANG_RULE}`,
    buildUser(ctx) {
      const script = ctx.script;
      const style = STYLE_HINTS[ctx.genre] || ctx.genre || 'cinematic film look';

      const characters = (script?.characters || []).map(c =>
        `- id: ${c.id} | name: ${c.name}${c.enName ? ` (${c.enName})` : ''} | role: ${c.desc || ''} | script appearance: ${c.appearance || ''}`
      ).join('\n') || '(none)';

      const settings = (script?.settings || []).map(s =>
        `- id: ${s.id} | name: ${s.name} | script description: ${s.desc || ''}`
      ).join('\n') || '(none)';

      return `Write the visual design specs for this film's characters and scenes.

GENRE: ${ctx.genre}
VISUAL STYLE: ${style}

CHARACTERS FROM THE SCRIPT:
${characters}

SCENES FROM THE SCRIPT:
${settings}

OUTPUT JSON SCHEMA:
{
  "characters": [
    {
      "id": "string — MUST be exactly one of the character ids listed above",
      "design": "string — detailed design write-up in the story's language: body type and face, hairstyle and hair color, outfit cut and fabric, main colors, props, bearing and recognizable traits",
      "visualTag": "string — ONE English line (max 60 words) with only STABLE visual facts: full-body look, hairstyle and color, outfit and its colors, props, distinctive features",
      "palette": ["string — 3 to 5 colors (names or hex) that define this character"]
    }
  ],
  "settings": [
    {
      "id": "string — MUST be exactly one of the scene ids listed above",
      "design": "string — detailed design write-up in the story's language: spatial layout, architecture or natural elements, materials, light direction and color temperature, time and weather, mood",
      "visualTag": "string — ONE English line (max 60 words) with only STABLE visual facts: environment layout, key elements, materials, lighting, time of day, weather, mood",
      "palette": ["string — 3 to 5 colors (names or hex) that define this scene"]
    }
  ]
}

Requirements:
- Return EVERY id listed above, unchanged; do not invent new characters or scenes
- visualTag goes straight into image prompts: English only, no pose, no camera, no shot type, no emotion, and always the same outfit and colors so the character reads identically in front, back and side views
- Make characters visually distinct from one another: different silhouette, palette, hairstyle and props
- Give each scene a fixed lighting and time of day so every shot in that scene matches
- Respect the script's appearance and description; enrich them, never contradict them`;
    }
  },

  storyboard: {
    system: `You are Cine-Cutie's Storyboard Artist, expert in breaking scripts into shot sequences for AI video production. ${JSON_RULE} ${LANG_RULE}`,
    buildUser(ctx) {
      const script = ctx.script;
      const totalDuration = ctx.totalDuration || 30;
      const minClip = ctx.minClip || 3;
      const maxClip = ctx.maxClip || 10;
      const nominalClip = ctx.nominalClip || 5;
      const maxShots = Math.max(1, Math.floor(totalDuration / minClip));
      const minShots = Math.max(1, Math.ceil(totalDuration / maxClip));
      const maxSegmentsPerEp = maxShots <= 2 ? 1 : maxShots <= 6 ? 2 : 4;
      const maxShotsPerSeg = maxShots <= 2 ? 2 : maxShots <= 6 ? 2 : 4;

      const scriptSummary = script
        ? `Title: ${script.title}\nCharacters: ${(script.characters || []).map(c => `${c.name} (${c.enName || c.name}) — ${c.appearance}`).join('; ')}\nSettings: ${(script.settings || []).map(s => `${s.name} — ${s.desc}`).join('; ')}\nEpisodes: ${(script.episodes || []).map(ep => `Ep${ep.episode}: ${ep.title} — ${ep.summary}`).join('\n')}`
        : 'No script available';

      return `Create a shot-by-shot storyboard from this script.

TARGET DURATION: ${totalDuration} seconds total. Each clip is generated at ${minClip}-${maxClip}s (typical ~${nominalClip}s), so use between ${minShots} and ${maxShots} shots.

SCRIPT:
${scriptSummary}

OUTPUT JSON SCHEMA:
{
  "episodes": [
    {
      "episode": 1,
      "segments": [
        {
          "shots": [
            {
              "shot_id": "string — unique id like 'ep1_s1_sh1'",
              "type": "string — shot type: 'wide', 'medium', 'close-up', 'extreme-close-up', 'aerial', 'low-angle'",
              "duration": "number — integer clip length in seconds, ${minClip}-${maxClip}",
              "description": "string — what happens in this shot",
              "camera": "string — camera movement: 'static', 'pan-left', 'pan-right', 'zoom-in', 'zoom-out', 'tracking', 'tilt-up'",
              "prompt": "string — detailed English image generation prompt describing this exact frame, including characters, setting, lighting, mood, and camera angle",
              "audio_description": "string — detailed English description of all audio elements for this shot: dialogue (character says...), sound effects (footsteps, door closing, glass breaking), ambient sounds (rain, wind, crowd noise), and music mood if any. Be specific about what can be heard."
            }
          ]
        }
      ]
    }
  ]
}

Requirements:
- Choose a shot count that follows the script's beats, between ${minShots} and ${maxShots} — every script segment should get at least one shot, and no shot is filler
- Each episode should have 1-${maxSegmentsPerEp} segments
- Each segment should have 1-${maxShotsPerSeg} shots
- Shot prompts must be in English, detailed enough for image generation
- When a character appears in a shot, use their English name (enName) in the prompt, e.g. "Mibao the cat..."
- Include character appearance details in prompts when characters are present
- Include setting details in prompts
- Specify lighting and mood in each prompt
- Duration is the ACTUAL generated clip length in whole seconds (${minClip}-${maxClip} each); the durations of ALL shots across ALL episodes MUST add up to roughly ${totalDuration}s — the final film is exactly the sum of the clips, and the pipeline will rescale toward this target, so make longer beats (action, dialogue) outweigh quick cuts
- For each shot, provide audio_description in English: include all dialogue (who says what), sound effects (footsteps, doors, objects), ambient sounds (weather, crowd, traffic), and any music mood. Infer sounds from the visual context even if not explicitly stated — rain needs rain sounds, office needs keyboard/phone sounds, forest needs birds/wind, etc.

SHOT-TO-SHOT CONTINUITY — CRITICAL:
- Shots MUST form a coherent visual narrative — each shot should feel like the NEXT MOMENT after the previous one
- Maintain consistent character positions, poses, and actions across consecutive shots within a segment
- Use varied shot types (wide → medium → close-up) to create visual rhythm, NOT to jump to unrelated moments
- The "description" field should describe a CONTINUOUS action that flows from the previous shot, not a disconnected scene
- Think like a film director: each shot is a camera angle on an ONGOING action, not a separate illustration
- If a character is sitting in shot 1, they should still be sitting (or in the process of standing up) in shot 2 — not suddenly in a different location
- End each segment on a visual that naturally leads into the next segment`;
    }
  },

  autoModeEval: {
    system: `You are a video production director. For each storyboard shot, decide the best video generation mode.

Available modes:
- "firstFrame": Single first frame → video. Reliable, good for simple motion or static scenes.
- "firstLastFrame": First + last frames → video. Best for shots with clear start/end compositions or transitions.
- "referenceImage": Reference images → video. Best when character identity/consistency is critical and good reference images exist.

Return JSON: { "assignments": [{ "shot_id": "...", "mode": "...", "reason": "..." }, ...] }

Rules:
- Prefer "firstFrame" for most shots — it is the most reliable.
- Use "referenceImage" only when the shot prominently features a main character AND character design has good reference images.
- Use "firstLastFrame" sparingly for shots with strong narrative arc (clear start and end state).
- A "firstLastFrame" shot requires two independently generated images for that same shot: its own opening frame and its own closing frame.
- Never reuse the first frame of the next shot as the current shot's last frame.
- Return assignments for ALL shots in order.`,
    buildUser(ctx) {
      const shots = [];
      for (const ep of (ctx.storyboard?.episodes || []))
        for (const seg of (ep.segments || []))
          for (const shot of (seg.shots || []))
            shots.push({ shot_id: shot.shot_id, type: shot.type, description: shot.description, prompt: shot.prompt, camera: shot.camera });
      const chars = (ctx.characterDesign?.characters || []).map(c => ({
        name: c.name, hasSheet: !!(c.sheetPath || c.sheetUrl), hasPortrait: !!(c.imagePath || c.imageUrl),
      }));
      return `CHARACTER REFERENCES:\n${JSON.stringify(chars)}\n\nSHOTS (${shots.length}):\n${JSON.stringify(shots)}\n\nAssign a video mode to each shot.`;
    },
  },
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
