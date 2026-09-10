import { startPipeline, reviseStep, restoreSession, continuePipeline, clearSession, stopPipeline, resumeFromHistory, persistWorkflow, applyManualEdit, regenerateCharacterImage, recordReviewDecision } from './orchestrator.js';

window.__reviseStep = reviseStep;
window.__applyManualEdit = applyManualEdit;
window.__regenerateDesignItem = regenerateCharacterImage;
window.__approveStep = (stepId, callback) => {
  recordReviewDecision(stepId, 'approved');
  callback?.();
};

export { startPipeline, restoreSession, continuePipeline, clearSession, stopPipeline, resumeFromHistory, persistWorkflow };
