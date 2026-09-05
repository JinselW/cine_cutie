import { registerProvider } from './registry.js';
import { addAgentMessage } from '../ui/render.js';
import { t } from '../i18n.js';

const renderProvider = {
  id: 'render',
  name: 'FFmpeg Render',
  capabilities: ['render'],

  async generate({ step, genre, context }) {
    if (step !== 'postProduction') return null;

    const videoClips = context.videoClips;
    const validPaths = (videoClips?.clips || [])
      .filter(c => c.videoPath && c.status === 'complete')
      .map(c => c.videoPath);

    if (validPaths.length === 0) {
      addAgentMessage('⚠️', t('ui.postProdNoClips'));
      return { episodes: [], finalVideo: '', status: 'no-clips' };
    }

    addAgentMessage('🎬', t('ui.postProdRendering'));

    try {
      const res = await fetch('/api/render/final', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoPaths: validPaths })
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        addAgentMessage('⚠️', `Render failed: ${errText.substring(0, 100)}`);
        return { episodes: [], finalVideo: '', status: 'failed' };
      }

      const { taskId } = await res.json();

      let finalPath = '';
      for (let attempt = 0; attempt < 120; attempt++) {
        await new Promise(r => setTimeout(r, 3000));
        const pollController = new AbortController();
        const pollTimeout = setTimeout(() => pollController.abort(), 30000);
        const taskRes = await fetch(`/api/task/${taskId}`, { signal: pollController.signal });
        clearTimeout(pollTimeout);
        const taskData = await taskRes.json();
        if (taskData.status === 'completed') {
          finalPath = taskData.result?.path || '';
          break;
        }
        if (taskData.status === 'failed') {
          addAgentMessage('⚠️', `Render failed: ${taskData.error || 'Unknown error'}`);
          return { episodes: [], finalVideo: '', status: 'failed' };
        }
      }

      addAgentMessage('🎬', t('ui.postProdComplete'));

      return {
        episodes: (context.storyboard?.episodes || []).map(ep => ({ episode: ep.episode })),
        finalVideo: finalPath,
        status: finalPath ? 'complete' : 'failed'
      };
    } catch (err) {
      addAgentMessage('⚠️', `Render error: ${err.message}`);
      return { episodes: [], finalVideo: '', status: 'failed' };
    }
  }
};

registerProvider(renderProvider);
