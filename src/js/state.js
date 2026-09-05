export const state = {
  mode: 'auto',
  currentStep: -1,
  genre: 'fantasy',
  userInput: '',
  totalDuration: 30,
  media: [],
  theme: 'dark',
  lang: 'zh',
  entities: {},
  settings: {
    providers: {}
  },
  data: {
    script: null,
    characterDesign: null,
    storyboard: null,
    referenceImages: null,
    videoClips: null,
    finalVideo: null
  }
};

export function resetState() {
  state.currentStep = -1;
  state.genre = 'fantasy';
  state.userInput = '';
  state.totalDuration = 30;
  state.media = [];
  state.entities = {};
  for (const k of Object.keys(state.data)) state.data[k] = null;
}
