export const STEPS = [
  {
    id: 'script', label: 'Script', icon: '📝',
    labelKey: 'steps.script.label', agentKey: 'steps.script.agent',
    genKeys: ['steps.script.gen.0', 'steps.script.gen.1', 'steps.script.gen.2', 'steps.script.gen.3'],
    capability: 'text', accepts: ['text', 'image'],
    agent: 'Scriptwriter',
    contextKeys: [],
    genMessages: ['Analyzing your idea...', 'Developing characters...', 'Structuring scenes...', 'Polishing the script...']
  },
  {
    id: 'characterDesign', label: 'Character & Scene Design', icon: '🎨',
    labelKey: 'steps.characterDesign.label', agentKey: 'steps.characterDesign.agent',
    genKeys: ['steps.characterDesign.gen.0', 'steps.characterDesign.gen.1', 'steps.characterDesign.gen.2', 'steps.characterDesign.gen.3'],
    capability: 'image', accepts: [],
    agent: 'Character Designer',
    contextKeys: ['script'],
    genMessages: ['Writing design specs...', 'Creating three-view model sheets...', 'Generating scene images...', 'Checking visual consistency...']
  },
  {
    id: 'storyboard', label: 'Storyboard', icon: '📋',
    labelKey: 'steps.storyboard.label', agentKey: 'steps.storyboard.agent',
    genKeys: ['steps.storyboard.gen.0', 'steps.storyboard.gen.1', 'steps.storyboard.gen.2', 'steps.storyboard.gen.3'],
    capability: 'text', accepts: [],
    agent: 'Storyboard Artist',
    contextKeys: ['script'],
    genMessages: ['Breaking down scenes...', 'Planning shot sequences...', 'Defining camera angles...', 'Building the storyboard...']
  },
  {
    id: 'referenceImages', label: 'Image Generation', icon: '🖼️',
    labelKey: 'steps.referenceImages.label', agentKey: 'steps.referenceImages.agent',
    genKeys: ['steps.referenceImages.gen.0', 'steps.referenceImages.gen.1', 'steps.referenceImages.gen.2', 'steps.referenceImages.gen.3'],
    capability: 'image', accepts: [],
    agent: 'Image Director',
    contextKeys: ['script', 'storyboard', 'characterDesign'],
    genMessages: ['Combining script, designs and storyboard...', 'Generating frames for the video mode...', 'Evaluating compositions...', 'Finalizing frames...']
  },
  {
    id: 'videoGeneration', label: 'Video Generation', icon: '🎥',
    labelKey: 'steps.videoGeneration.label', agentKey: 'steps.videoGeneration.agent',
    genKeys: ['steps.videoGeneration.gen.0', 'steps.videoGeneration.gen.1', 'steps.videoGeneration.gen.2', 'steps.videoGeneration.gen.3'],
    capability: 'video', accepts: [],
    agent: 'Video Director',
    dataKey: 'videoClips',
    contextKeys: ['script', 'storyboard', 'referenceImages', 'characterDesign'],
    genMessages: ['Setting up shots...', 'Generating video clips...', 'Reviewing motion quality...', 'Finalizing clips...']
  },
  {
    id: 'postProduction', label: 'Post-Production', icon: '🎬',
    labelKey: 'steps.postProduction.label', agentKey: 'steps.postProduction.agent',
    genKeys: ['steps.postProduction.gen.0', 'steps.postProduction.gen.1', 'steps.postProduction.gen.2', 'steps.postProduction.gen.3'],
    capability: 'render', accepts: [],
    agent: 'Post-Production Artist',
    dataKey: 'finalVideo',
    contextKeys: ['script', 'storyboard', 'videoClips'],
    genMessages: ['Assembling clips...', 'Adding transitions...', 'Color grading...', 'Rendering final video...']
  }
];

export const STEP_MAP = Object.fromEntries(STEPS.map((s, i) => [s.id, { ...s, index: i }]));

export function dataKeyOf(step) {
  return step.dataKey || step.id;
}
