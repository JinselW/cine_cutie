import { STEPS, dataKeyOf } from './config.js';
import { state } from './state.js';
import { runAgent } from './agents.js';
import { t } from './i18n.js';
import { updatePipeline, showGenerating, setMascot, addAgentMessage } from './ui/render.js';
import {
  renderPlanning, renderScreenplay, renderCharacters, renderVisualDesign, renderStoryboard,
  renderShotGen, renderShotCuration, renderEditing, renderAudio,
  renderPostProduction, renderFinalFilm, showCompletion
} from './ui/views.js';
import { sleep } from './utils.js';
import { isConfigured } from './providers/llm.js';
import { resetLog } from './observability.js';

const RENDERERS = {
  planning: (r, _sb, cb) => renderPlanning(r, cb),
  screenplay: (r, _sb, cb) => renderScreenplay(r, cb),
  characters: (r, _sb, cb) => renderCharacters(r, cb),
  visualDesign: (r, _sb, cb) => renderVisualDesign(r, cb),
  storyboard: (r, _sb, cb) => renderStoryboard(r, cb),
  shotGen: (r, sb, cb) => renderShotGen(r, sb, cb),
  shotCuration: (r, sb, cb) => renderShotCuration(r, sb, cb),
  editing: (r, _sb, cb) => renderEditing(r, cb),
  audio: (r, _sb, cb) => renderAudio(r, cb),
  postProduction: (r, _sb, cb) => renderPostProduction(r, cb),
  final: (r, _sb, cb) => renderFinalFilm(r, cb),
};

function renderStep(stepId, result, onAdvance) {
  const fn = RENDERERS[stepId];
  if (fn) fn(result, state.data.storyboard, onAdvance);
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

  const delay = isConfigured() ? 0 : (step.id === 'shotGen' ? 4000 : 3000 + Math.random() * 2000);
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
  const delay = isConfigured() ? 0 : (stepId === 'shotGen' ? 3500 : 2500 + Math.random() * 1500);
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
