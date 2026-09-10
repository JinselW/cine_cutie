import { registerBackendTask, unregisterBackendTask } from '../providers/activeTasks.js';

export async function generateAudioOverlay({ tracks, signal } = {}) {
  if (!Array.isArray(tracks) || tracks.length === 0) return null;

  const body = { tracks: tracks.map(t => ({
    type: t.type || 'sfx',
    text: t.text || null,
    prompt: t.prompt || null,
    duration: Math.max(0.1, Math.min(60, Number(t.duration) || 5)),
    voiceProfile: t.voiceProfile || null,
    speakerId: t.speakerId || null,
    offset: Number(t.offset) || 0,
  }))};

  let taskId = null;
  try {
    const res = await fetch('/api/audio/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;

    const { taskId: tid } = await res.json();
    taskId = tid;
    registerBackendTask(taskId);

    const MAX_WAIT = 3 * 60 * 1000;
    const startTime = Date.now();
    for (let attempt = 0; attempt < 60; attempt++) {
      if (signal?.aborted) return null;
      if (Date.now() - startTime > MAX_WAIT) return null;
      await new Promise(r => setTimeout(r, 2000));

      try {
        const taskRes = await fetch(`/api/task/${taskId}`, { signal });
        if (!taskRes.ok) return null;
        const taskData = await taskRes.json();

        if (taskData.status === 'completed') {
          return {
            mixedAudioPath: taskData.result?.mixedAudioPath || null,
            trackResults: taskData.result?.tracks || [],
            success: taskData.result?.success || 0,
            total: taskData.result?.total || 0,
          };
        }
        if (taskData.status === 'failed' || taskData.status === 'cancelled') return null;
      } catch {
        if (signal?.aborted) return null;
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    unregisterBackendTask(taskId);
  }
}
