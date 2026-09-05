import { STEPS, dataKeyOf } from './config.js';
import { state } from './state.js';
import { runAgent } from './agents.js';
import { t } from './i18n.js';
import { updatePipeline, showGenerating, addAgentMessage, setGenAnim, clearCurrentMessages, waitForResume, getGenAnim } from './ui/render.js';
import {
  renderScript, renderCharacterDesign, renderStoryboard,
  renderReferenceImages, renderVideoGeneration, renderPostProduction,
} from './ui/views.js';
import { showCompletion } from './navigation.js';
import { sleep } from './utils.js';
import { isConfigured } from './providers/llm.js';
import { resetLog } from './observability.js';

const RENDERERS = {
  script: (r, cb) => renderScript(r, cb),
  characterDesign: (r, cb) => renderCharacterDesign(r, cb),
  storyboard: (r, cb) => renderStoryboard(r, cb),
  referenceImages: (r, cb) => renderReferenceImages(r, cb),
  videoGeneration: (r, cb) => renderVideoGeneration(r, cb),
  postProduction: (r, cb) => renderPostProduction(r, cb),
};

function renderStep(stepId, result, onAdvance) {
  const fn = RENDERERS[stepId];
  if (fn) fn(result, onAdvance);
}

export async function startPipeline() {
  state.currentStep = -1;
  state.viewingStep = null;
  state.stopped = false;
  state.paused = false;
  resetLog();
  await advanceStep();
}

export async function advanceStep() {
  state.currentStep++;
  if (state.currentStep >= STEPS.length) {
    state.viewingStep = null;
    showCompletion();
    return;
  }

  const step = STEPS[state.currentStep];
  clearCurrentMessages();
  updatePipeline(state.currentStep, 'active');

  showGenerating(state.currentStep);
  state.stepRunning = true;

  const delay = isConfigured() ? 0 : (3000 + Math.random() * 2000);
  const [result] = await Promise.all([
    runAgent(step.id),
    sleep(delay)
  ]);

  await waitForResume();
  if (state.stopped) return;

  const currentAnim = getGenAnim();
  if (currentAnim) currentAnim.stop();
  setGenAnim(null);
  state.stepRunning = false;
  state.data[dataKeyOf(step)] = result;
  updatePipeline(state.currentStep, 'done');

  if (state.viewingStep !== null) {
    if (state.mode === 'auto') {
      setTimeout(() => advanceStep(), 2000);
    }
    return;
  }

  const onAdvance = () => advanceStep();
  renderStep(step.id, result, onAdvance);
}

export async function reviseStep(stepId, feedback) {
  const stepIndex = STEPS.findIndex(s => s.id === stepId);
  if (stepIndex < 0) return;

  updatePipeline(stepIndex, 'active');

  const step = STEPS[stepIndex];
  clearCurrentMessages();
  const stepLabel = t(step.labelKey);
  addAgentMessage(step.icon, t('ui.receivedFeedback', { step: stepLabel, feedback }));

  showGenerating(stepIndex);
  state.stepRunning = true;
  const delay = isConfigured() ? 0 : (2500 + Math.random() * 1500);
  const [result] = await Promise.all([
    runAgent(stepId, feedback),
    sleep(delay)
  ]);

  await waitForResume();
  if (state.stopped) return;

  const currentAnim = getGenAnim();
  if (currentAnim) currentAnim.stop();
  setGenAnim(null);
  state.stepRunning = false;

  state.data[dataKeyOf(step)] = result;
  updatePipeline(stepIndex, 'done');

  addAgentMessage(step.icon, t('ui.revisionComplete'));

  const onAdvance = () => advanceStep();
  renderStep(stepId, result, onAdvance);
}

window.__reviseStep = reviseStep;
