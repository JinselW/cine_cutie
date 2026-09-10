import { startPipeline, reviseStep, rerunStep, restoreSession, continuePipeline, clearSession, stopPipeline, resumeFromHistory, persistWorkflow, applyManualEdit, regenerateCharacterImage, recordReviewDecision } from './orchestrator.js';

window.__reviseStep = reviseStep;
window.__rerunStep = rerunStep;
window.__applyManualEdit = applyManualEdit;
window.__regenerateDesignItem = regenerateCharacterImage;
window.__approveStep = (stepId, callback) => {
  recordReviewDecision(stepId, 'approved');
  callback?.();
};

export { startPipeline, restoreSession, continuePipeline, clearSession, stopPipeline, resumeFromHistory, persistWorkflow };
