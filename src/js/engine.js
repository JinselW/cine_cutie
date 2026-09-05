import { STEPS, dataKeyOf } from './config.js';
import { state } from './state.js';
import { runAgent } from './agents.js';
import { t } from './i18n.js';
import { updatePipeline, showGenerating, setMascot, addAgentMessage } from './ui/render.js';
import {
  renderScript, renderCharacterDesign, renderStoryboard,
  renderReferenceImages, renderVideoGeneration, renderPostProduction,
  showCompletion
} from './ui/views.js';
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

let genAnim = null;

export async function startPipeline() {
  state.currentStep = -1;
  resetLog();
  await advanceStep();
}

export async function advanceStep() {
  state.currentStep++;
  if (state.currentStep >= STEPS.length) {
    showCompletion();
    return;
  }

  const step = STEPS[state.currentStep];
  updatePipeline(state.currentStep, 'active');

  genAnim = showGenerating(state.currentStep);

  const delay = isConfigured() ? 0 : (3000 + Math.random() * 2000);
  const [result] = await Promise.all([
    runAgent(step.id),
    sleep(delay)
  ]);

  genAnim.stop();
  state.data[dataKeyOf(step)] = result;
  updatePipeline(state.currentStep, 'done');

  const onAdvance = () => advanceStep();

  renderStep(step.id, result, onAdvance);
}

export async function reviseStep(stepId, feedback) {
  const stepIndex = STEPS.findIndex(s => s.id === stepId);
  if (stepIndex < 0) return;

  updatePipeline(stepIndex, 'active');

  const step = STEPS[stepIndex];
  const stepLabel = t(step.labelKey);
  addAgentMessage(step.icon, t('ui.receivedFeedback', { step: stepLabel, feedback }));

  genAnim = showGenerating(stepIndex);
  const delay = isConfigured() ? 0 : (2500 + Math.random() * 1500);
  const [result] = await Promise.all([
    runAgent(stepId, feedback),
    sleep(delay)
  ]);
  genAnim.stop();

  state.data[dataKeyOf(step)] = result;
  updatePipeline(stepIndex, 'done');

  addAgentMessage(step.icon, t('ui.revisionComplete'));

  const onAdvance = () => advanceStep();

  renderStep(stepId, result, onAdvance);
}

window.__reviseStep = reviseStep;
