const activeTaskIds = new Set();

export function registerBackendTask(taskId) {
  if (taskId) activeTaskIds.add(taskId);
}

export function unregisterBackendTask(taskId) {
  if (taskId) activeTaskIds.delete(taskId);
}

export async function cancelAllBackendTasks() {
  if (activeTaskIds.size === 0) return;

  const ids = [...activeTaskIds];
  activeTaskIds.clear();

  await Promise.all(ids.map(async (id) => {
    try {
      await fetch(`/api/task/${id}/cancel`, { method: 'POST' });
    } catch {
      // Best-effort cancellation; the task will eventually time out on its own.
    }
  }));
}
