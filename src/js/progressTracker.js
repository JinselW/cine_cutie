const STAGE_WEIGHTS = {
  script: 5,
  characterDesign: 15,
  storyboard: 5,
  referenceImages: 15,
  videoGeneration: 50,
  postProduction: 10,
};

const TOTAL_WEIGHT = Object.values(STAGE_WEIGHTS).reduce((a, b) => a + b, 0);

const completedStages = new Set();
let currentStage = null;
let totalItems = 0;
let completedItems = 0;

export function initProgressTracker() {
  completedStages.clear();
  currentStage = null;
  totalItems = 0;
  completedItems = 0;
}

export function setStageTotal(stageId, items) {
  currentStage = stageId;
  totalItems = Math.max(1, items);
  completedItems = 0;
  dispatch();
}

export function addCompleted(count = 1) {
  if (!currentStage) return;
  completedItems = Math.min(totalItems, completedItems + count);
  dispatch();
}

export function setStageProgress(pct) {
  if (!currentStage) return;
  const clamped = Math.min(1, Math.max(0, pct));
  completedItems = Math.round(clamped * totalItems);
  dispatch();
}

export function markStageComplete(stageId) {
  completedStages.add(stageId);
  if (currentStage === stageId) {
    completedItems = totalItems;
  }
  dispatch();
}

export function getProgress() {
  const stageProgress = currentStage && totalItems > 0
    ? completedItems / totalItems
    : 0;

  let weighted = 0;
  for (const [stageId, weight] of Object.entries(STAGE_WEIGHTS)) {
    if (completedStages.has(stageId)) {
      weighted += weight;
    } else if (stageId === currentStage) {
      weighted += weight * stageProgress;
    }
  }

  return {
    stage: currentStage,
    totalItems,
    completedItems,
    stageProgress,
    overallProgress: TOTAL_WEIGHT > 0 ? weighted / TOTAL_WEIGHT : 0,
  };
}

function dispatch() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('pipeline-progress', { detail: getProgress() }));
  }
}
