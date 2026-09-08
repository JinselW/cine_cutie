let runCounter = 0;
let sequence = 0;
let snapshot = emptySnapshot();

function emptySnapshot() {
  return {
    runId: runCounter, sequence: 0, stageId: null,
    phase: 'preparing', mode: 'indeterminate',
    completed: 0, total: 0, attempt: 1, activeItem: 0,
  };
}

function emit() {
  snapshot.sequence = ++sequence;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('pipeline-progress', { detail: { ...snapshot } }));
  }
}

export function startProgressRun() {
  runCounter += 1;
  sequence = 0;
  snapshot = emptySnapshot();
  emit();
}

export function beginStage(stageId) {
  if (snapshot.stageId === stageId) return;
  snapshot = { ...emptySnapshot(), runId: runCounter, stageId };
  emit();
}

export function reportPhase(phase, details = {}) {
  if (!snapshot.stageId) return;
  const next = {
    ...snapshot,
    ...details,
    phase,
    mode: details.mode === 'determinate' ? 'determinate' : 'indeterminate',
  };
  if (next.mode !== 'determinate' || !(next.total > 0)) {
    next.mode = 'indeterminate';
    next.completed = 0;
    next.total = 0;
  } else {
    next.completed = Math.max(0, Math.min(next.total, Number(next.completed) || 0));
  }
  snapshot = next;
  emit();
}

// Task progress comes from the backend. `progress` counts completed items;
// `current` identifies the item that is currently running.
export function reportBatchProgress(phase, task = {}) {
  if (!snapshot.stageId) return;
  const total = Math.max(0, Number(task.total) || snapshot.total || 0);
  if (!total) return reportPhase(phase);
  const fromPercent = Math.floor((Math.max(0, Number(task.progress) || 0) / 100) * total);
  const previousCompleted = snapshot.mode === 'determinate'
    && snapshot.phase === phase && snapshot.total === total
    ? snapshot.completed : 0;
  const completed = task.status === 'completed' ? total : Math.max(previousCompleted, fromPercent);
  reportPhase(phase, {
    mode: 'determinate', total, completed,
    activeItem: Math.max(0, Number(task.current) || Math.min(total, completed + 1)),
  });
}

export function reportPercentProgress(phase, value) {
  if (!snapshot.stageId) return;
  const completed = Math.max(
    snapshot.mode === 'determinate' && snapshot.phase === phase ? snapshot.completed : 0,
    Math.min(100, Math.floor(Number(value) || 0)),
  );
  reportPhase(phase, { mode: 'determinate', total: 100, completed, unit: 'percent', activeItem: 0 });
}

export function reportRetry(attempt) {
  reportPhase('retrying', { mode: 'indeterminate', attempt });
}

export function finishStage() {
  if (!snapshot.stageId) return;
  snapshot = { ...snapshot, phase: 'complete', mode: 'determinate', total: 1, completed: 1, activeItem: 0 };
  emit();
}

export function getProgressSnapshot() {
  return { ...snapshot };
}
