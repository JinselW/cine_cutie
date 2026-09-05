import { $ } from './utils.js';
import { STEPS, dataKeyOf } from './config.js';
import { state } from './state.js';
import {
  showGenerating, getGenAnim, flushBufferedMessages,
  renderCurrentMessages
} from './ui/render.js';
import {
  renderScript, renderCharacterDesign, renderStoryboard,
  renderReferenceImages, renderVideoGeneration, renderPostProduction,
  showCompletion, cancelAutoAdvance
} from './ui/views.js';

export function onNodeClick(index) {
  const node = $(`#pipe${index}`);
  if (!node) return;
  if (state.paused || state.stopped) return;

  const isDone = node.classList.contains('done');
  const isCurrentReturn = index === state.currentStep && state.viewingStep !== null;
  const isViewingToggle = index === state.viewingStep;
  if (!isDone && !isCurrentReturn && !isViewingToggle) return;

  cancelAutoAdvance();

  if (isCurrentReturn || isViewingToggle) {
    state.viewingStep = null;
    restoreCurrentView();
    updatePipelineClickable();
  } else if (index < state.currentStep && index !== state.viewingStep) {
    state.viewingStep = index;
    showStepReadOnly(index);
    updatePipelineClickable();
  } else if (index === state.currentStep && state.viewingStep === null) {
    return;
  }
}

export function showStepReadOnly(index) {
  const step = STEPS[index];
  const result = state.data[dataKeyOf(step)];
  if (!result) return;

  const renderFn = {
    script: renderScript,
    characterDesign: renderCharacterDesign,
    storyboard: renderStoryboard,
    referenceImages: renderReferenceImages,
    videoGeneration: renderVideoGeneration,
    postProduction: renderPostProduction,
  }[step.id];

  if (renderFn) renderFn(result, null, true);
}

function restoreCurrentView() {
  if (isPipelineComplete()) {
    showCompletion();
    return;
  }
  const genAnim = getGenAnim();
  if (genAnim) {
    showGenerating(state.currentStep);
  } else {
    showStepReadOnly(state.currentStep);
  }
  renderCurrentMessages();
  flushBufferedMessages();
}

export function updatePipelineClickable() {
  for (let i = 0; i < STEPS.length; i++) {
    const node = $(`#pipe${i}`);
    if (!node) continue;
    node.classList.remove('clickable', 'viewing');
    if (node.classList.contains('done')) {
      if (i < state.currentStep) node.classList.add('clickable');
      if (i === state.viewingStep) node.classList.add('viewing');
    }
    if (i === state.currentStep && state.viewingStep !== null) node.classList.add('clickable');
  }
}

export function isPipelineComplete() {
  return state.currentStep >= STEPS.length;
}

export { showCompletion };
