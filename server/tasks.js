const tasks = new Map();
let nextId = 1;

export function createTask(type, metadata = {}) {
  const id = `task_${nextId++}`;
  const task = {
    id,
    type,
    status: 'pending',
    progress: 0,
    total: 0,
    current: 0,
    result: null,
    error: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...metadata
  };
  tasks.set(id, task);
  return task;
}

export function getTask(id) {
  return tasks.get(id) || null;
}

export function updateTask(id, patch) {
  const task = tasks.get(id);
  if (!task) return null;
  Object.assign(task, patch, { updatedAt: Date.now() });
  return task;
}

export function listTasks() {
  return [...tasks.values()].sort((a, b) => b.createdAt - a.createdAt);
}

export function cleanupTasks(maxAge = 3600000) {
  const now = Date.now();
  for (const [id, task] of tasks) {
    if (now - task.updatedAt > maxAge && (task.status === 'completed' || task.status === 'failed')) {
      tasks.delete(id);
    }
  }
}
