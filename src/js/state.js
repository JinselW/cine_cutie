export const state = {
  mode: 'auto',
  currentStep: -1,
  genre: 'fantasy',
  userInput: '',
  media: [],
  theme: 'dark',
  lang: 'zh',
  entities: {},
  settings: {
    providers: {}
  },
  data: {
    planning: null,
    screenplay: null,
    characters: null,
    visualDesign: null,
    storyboard: null,
    shots: null,
    curatedShots: null,
    editTimeline: null,
    audio: null,
    postProduction: null,
    video: null
  }
};

export function resetState() {
  state.currentStep = -1;
  state.genre = 'fantasy';
  state.userInput = '';
  state.media = [];
  state.entities = {};
  for (const k of Object.keys(state.data)) state.data[k] = null;
}
