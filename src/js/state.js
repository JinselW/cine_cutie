export const state = {
  mode: 'auto',
  currentStep: -1,
  genre: 'fantasy',
  userInput: '',
  totalDuration: 30,
  aspectRatio: '16:9',
  imageSize: '1280*720',
  media: [],
  theme: 'dark',
  lang: 'zh',
  entities: {},
  viewingStep: null,
  stepRunning: false,
  paused: false,
  stopped: false,
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
  state.viewingStep = null;
  state.paused = false;
  state.stopped = false;
  state.stepRunning = false;
  state.genre = 'fantasy';
  state.userInput = '';
  state.totalDuration = 30;
  state.aspectRatio = '16:9';
  state.imageSize = '1280*720';
  state.media = [];
  state.entities = {};
  for (const k of Object.keys(state.data)) state.data[k] = null;
}
