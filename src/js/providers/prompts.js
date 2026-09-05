const JSON_RULE = 'Reply ONLY with valid JSON. No markdown, no commentary, no code fences.';
const LANG_RULE = 'Write all creative content (titles, descriptions, dialogue, etc.) in the SAME LANGUAGE as the user\'s story idea. Keep all JSON keys in English exactly as specified.';

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

GENRE: ${ctx.genre}

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
          "description": "string — what happens in this segment"
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

STORY COHERENCE — CRITICAL:
- The story MUST have a clear narrative arc: setup → development → climax → resolution
- Each segment MUST logically follow from the previous one with cause-and-effect relationships
- Characters' actions and emotions should evolve naturally across segments, not jump randomly
- The ending should resolve the central conflict or question introduced at the beginning
- Avoid disconnected vignettes — every segment must advance the plot or develop a character
- Keep the story focused: ONE main conflict, resolved within the ${totalDuration}s duration`;
    }
  },

  storyboard: {
    system: `You are Cine-Cutie's Storyboard Artist, expert in breaking scripts into shot sequences for AI video production. ${JSON_RULE} ${LANG_RULE}`,
    buildUser(ctx) {
      const script = ctx.script;
      const totalDuration = ctx.totalDuration || 30;
      const maxClips = Math.ceil(totalDuration / 5);
      const maxSegmentsPerEp = maxClips <= 2 ? 1 : maxClips <= 6 ? 2 : 4;
      const maxShotsPerSeg = maxClips <= 2 ? 2 : maxClips <= 6 ? 2 : 4;

      const scriptSummary = script
        ? `Title: ${script.title}\nCharacters: ${(script.characters || []).map(c => `${c.name} (${c.enName || c.name}) — ${c.appearance}`).join('; ')}\nSettings: ${(script.settings || []).map(s => `${s.name} — ${s.desc}`).join('; ')}\nEpisodes: ${(script.episodes || []).map(ep => `Ep${ep.episode}: ${ep.title} — ${ep.summary}`).join('\n')}`
        : 'No script available';

      return `Create a shot-by-shot storyboard from this script.

TARGET DURATION: ${totalDuration} seconds total (~${maxClips} video clips at 5s each)

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
              "duration": "number — suggested duration in seconds (3-10)",
              "description": "string — what happens in this shot",
              "camera": "string — camera movement: 'static', 'pan-left', 'pan-right', 'zoom-in', 'zoom-out', 'tracking', 'tilt-up'",
              "prompt": "string — detailed English image generation prompt describing this exact frame, including characters, setting, lighting, mood, and camera angle"
            }
          ]
        }
      ]
    }
  ]
}

Requirements:
- Total shots across ALL episodes MUST NOT exceed ${maxClips} (based on ${totalDuration}s total duration, ~5s per clip)
- Each episode should have 1-${maxSegmentsPerEp} segments
- Each segment should have 1-${maxShotsPerSeg} shots
- Shot prompts must be in English, detailed enough for image generation
- When a character appears in a shot, use their English name (enName) in the prompt, e.g. "Mibao the cat..."
- Include character appearance details in prompts when characters are present
- Include setting details in prompts
- Specify lighting and mood in each prompt
- Duration should be 3-10 seconds per shot

SHOT-TO-SHOT CONTINUITY — CRITICAL:
- Shots MUST form a coherent visual narrative — each shot should feel like the NEXT MOMENT after the previous one
- Maintain consistent character positions, poses, and actions across consecutive shots within a segment
- Use varied shot types (wide → medium → close-up) to create visual rhythm, NOT to jump to unrelated moments
- The "description" field should describe a CONTINUOUS action that flows from the previous shot, not a disconnected scene
- Think like a film director: each shot is a camera angle on an ONGOING action, not a separate illustration
- If a character is sitting in shot 1, they should still be sitting (or in the process of standing up) in shot 2 — not suddenly in a different location
- End each segment on a visual that naturally leads into the next segment`;
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
