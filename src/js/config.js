export const STEPS = [
  {
    id: 'planning', label: 'Creative Planning', icon: '🧠',
    labelKey: 'steps.planning.label', agentKey: 'steps.planning.agent',
    genKeys: ['steps.planning.gen.0', 'steps.planning.gen.1', 'steps.planning.gen.2', 'steps.planning.gen.3'],
    capability: 'text', accepts: ['text', 'image'],
    agent: 'Creative Planner',
    contextKeys: [],
    genMessages: ['Analyzing your idea...', 'Identifying themes...', 'Setting creative direction...', 'Building the plan...']
  },
  {
    id: 'screenplay', label: 'Screenplay', icon: '📝',
    labelKey: 'steps.screenplay.label', agentKey: 'steps.screenplay.agent',
    genKeys: ['steps.screenplay.gen.0', 'steps.screenplay.gen.1', 'steps.screenplay.gen.2', 'steps.screenplay.gen.3'],
    capability: 'text', accepts: ['text', 'image'],
    agent: 'Scriptwriter',
    contextKeys: ['planning'],
    genMessages: ['Crafting your story...', 'Developing plot twists...', 'Polishing dialogue...', 'Structuring scenes...']
  },
  {
    id: 'characters', label: 'Character Design', icon: '🎭',
    labelKey: 'steps.characters.label', agentKey: 'steps.characters.agent',
    genKeys: ['steps.characters.gen.0', 'steps.characters.gen.1', 'steps.characters.gen.2', 'steps.characters.gen.3'],
    capability: 'text', accepts: ['image'],
    agent: 'Character Designer',
    contextKeys: ['planning', 'screenplay'],
    genMessages: ['Designing unique characters...', 'Giving them souls...', 'Adding depth...', 'Perfecting details...']
  },
  {
    id: 'visualDesign', label: 'Visual Design', icon: '🎨',
    labelKey: 'steps.visualDesign.label', agentKey: 'steps.visualDesign.agent',
    genKeys: ['steps.visualDesign.gen.0', 'steps.visualDesign.gen.1', 'steps.visualDesign.gen.2', 'steps.visualDesign.gen.3'],
    capability: 'text', accepts: ['image'],
    agent: 'Art Director',
    contextKeys: ['planning', 'screenplay'],
    genMessages: ['Choosing color palette...', 'Setting visual tone...', 'Designing atmosphere...', 'Building mood boards...']
  },
  {
    id: 'storyboard', label: 'Storyboard', icon: '📋',
    labelKey: 'steps.storyboard.label', agentKey: 'steps.storyboard.agent',
    genKeys: ['steps.storyboard.gen.0', 'steps.storyboard.gen.1', 'steps.storyboard.gen.2', 'steps.storyboard.gen.3'],
    capability: 'text', accepts: ['image'],
    agent: 'Storyboard Artist',
    contextKeys: ['planning', 'screenplay', 'characters', 'visualDesign'],
    genMessages: ['Composing visual frames...', 'Setting the mood...', 'Arranging shots...', 'Building atmosphere...']
  },
  {
    id: 'shotGen', label: 'Shot Generation', icon: '🎥',
    labelKey: 'steps.shotGen.label', agentKey: 'steps.shotGen.agent',
    genKeys: ['steps.shotGen.gen.0', 'steps.shotGen.gen.1', 'steps.shotGen.gen.2', 'steps.shotGen.gen.3'],
    capability: 'text', accepts: [],
    agent: 'Shot Director',
    dataKey: 'shots',
    contextKeys: ['planning', 'storyboard'],
    genMessages: ['Setting up camera angles...', 'Rolling Take 1...', 'Adjusting lighting...', 'Capturing Take 3...']
  },
  {
    id: 'shotCuration', label: 'Shot Curation', icon: '🔍',
    labelKey: 'steps.shotCuration.label', agentKey: 'steps.shotCuration.agent',
    genKeys: ['steps.shotCuration.gen.0', 'steps.shotCuration.gen.1', 'steps.shotCuration.gen.2', 'steps.shotCuration.gen.3'],
    capability: 'text', accepts: [],
    agent: 'Shot Curator',
    dataKey: 'curatedShots',
    contextKeys: ['planning', 'storyboard', 'shots'],
    genMessages: ['Reviewing compositions...', 'Evaluating emotional impact...', 'Selecting best takes...', 'Finalizing selections...']
  },
  {
    id: 'editing', label: 'Editing', icon: '✂️',
    labelKey: 'steps.editing.label', agentKey: 'steps.editing.agent',
    genKeys: ['steps.editing.gen.0', 'steps.editing.gen.1', 'steps.editing.gen.2', 'steps.editing.gen.3'],
    capability: 'text', accepts: [],
    agent: 'Film Editor',
    dataKey: 'editTimeline',
    contextKeys: ['planning', 'storyboard', 'curatedShots'],
    genMessages: ['Assembling selected shots...', 'Adding transitions...', 'Adjusting pacing...', 'Fine-tuning cuts...']
  },
  {
    id: 'audio', label: 'Audio Design', icon: '🎵',
    labelKey: 'steps.audio.label', agentKey: 'steps.audio.agent',
    genKeys: ['steps.audio.gen.0', 'steps.audio.gen.1', 'steps.audio.gen.2', 'steps.audio.gen.3'],
    capability: 'text', accepts: ['audio'],
    agent: 'Composer',
    contextKeys: ['planning', 'screenplay', 'storyboard'],
    genMessages: ['Composing main theme...', 'Adding sound effects...', 'Mixing dialogue...', 'Balancing audio levels...']
  },
  {
    id: 'postProduction', label: 'Post-Production', icon: '🎬',
    labelKey: 'steps.postProduction.label', agentKey: 'steps.postProduction.agent',
    genKeys: ['steps.postProduction.gen.0', 'steps.postProduction.gen.1', 'steps.postProduction.gen.2', 'steps.postProduction.gen.3'],
    capability: 'text', accepts: [],
    agent: 'Post-Production Artist',
    contextKeys: ['planning', 'visualDesign', 'editTimeline'],
    genMessages: ['Color grading...', 'Adding visual effects...', 'Final audio mix...', 'Rendering final cut...']
  },
  {
    id: 'final', label: 'Final Film', icon: '🎞️',
    labelKey: 'steps.final.label', agentKey: 'steps.final.agent',
    genKeys: ['steps.final.gen.0', 'steps.final.gen.1', 'steps.final.gen.2', 'steps.final.gen.3'],
    capability: 'text', accepts: [],
    agent: 'Director',
    dataKey: 'video',
    contextKeys: ['screenplay', 'storyboard', 'editTimeline'],
    genMessages: ['Final touches...', 'Encoding video...', 'Adding soundtrack...', 'Almost there...']
  }
];

export const STEP_MAP = Object.fromEntries(STEPS.map((s, i) => [s.id, { ...s, index: i }]));

export function dataKeyOf(step) {
  return step.dataKey || step.id;
}
