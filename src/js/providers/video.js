import { registerProvider } from './registry.js';
import { addAgentMessage } from '../ui/render.js';
import { t } from '../i18n.js';
import { getConfig as getImageConfig } from './image.js';

const videoProvider = {
  id: 'video',
  name: 'DashScope Video Generation',
  capabilities: ['video'],

  async generate({ step, genre, context }) {
    if (step !== 'videoGeneration') return null;

    const dsConfig = getImageConfig();
    if (!dsConfig.apiKey) {
      return buildPlaceholder(context);
    }

    const refImages = context.referenceImages;
    if (!refImages?.shots?.length) {
      return buildPlaceholder(context);
    }

    const total = refImages.shots.length;
    const apiClips = [];
    const clipIndexMap = [];

    const characters = context.characterDesign?.characters || [];
    const storyboard = context.storyboard;
    const allStoryboardShots = [];
    if (storyboard?.episodes) {
      for (const ep of storyboard.episodes) {
        for (const seg of (ep.segments || [])) {
          for (const shot of (seg.shots || [])) allStoryboardShots.push(shot);
        }
      }
    }

    for (let i = 0; i < total; i++) {
      const shot = refImages.shots[i];
      if (!shot.imagePath || !shot.imageUrl) {
        if (!shot.imageUrl) {
          addAgentMessage('️', `Clip ${i + 1}: 没有可用的公网图片 URL，跳过`);
        }
        clipIndexMap.push(-1);
        continue;
      }

      const shotText = ((shot.prompt || '') + ' ' + (shot.description || '')).toLowerCase();
      let matchedChar = null;
      for (const c of characters) {
        if (!c.imageUrl) continue;
        const names = [c.name, c.enName].filter(Boolean).map(n => n.toLowerCase());
        if (names.some(n => n && shotText.includes(n))) {
          matchedChar = c;
          break;
        }
      }

      const imageUrl = matchedChar?.imageUrl || shot.imageUrl;
      const sbShot = allStoryboardShots[i];
      const videoPrompt = buildVideoPrompt(shot, sbShot);

      clipIndexMap.push(apiClips.length);
      apiClips.push({
        prompt: videoPrompt,
        imageUrl,
        shotIndex: i
      });
    }

    addAgentMessage('🎥', t('ui.videoGenGenerating', { current: 1, total: apiClips.length }));

    const clips = new Array(total).fill(null).map((_, i) => ({
      shot_id: refImages.shots[i].shot_id,
      videoPath: '',
      status: clipIndexMap[i] === -1 ? 'skipped' : 'pending'
    }));

    if (apiClips.length > 0) {
      try {
        const res = await fetch('/api/generate/video', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Api-Key': dsConfig.apiKey
          },
          body: JSON.stringify({
            clips: apiClips.map(c => ({ prompt: c.prompt, imageUrl: c.imageUrl })),
            model: dsConfig.videoModel,
            duration: 5,
            resolution: '720P',
            seed: 42
          })
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          addAgentMessage('⚠️', `Video batch failed: ${errText.substring(0, 100)}`);
        } else {
          const { taskId } = await res.json();
          const startTime = Date.now();
          const MAX_WAIT = 20 * 60 * 1000;
          let lastProgress = 1;

          for (let attempt = 0; attempt < 400; attempt++) {
            if (Date.now() - startTime > MAX_WAIT) {
              addAgentMessage('⚠️', 'Video generation timed out');
              break;
            }
            await new Promise(r => setTimeout(r, 5000));

            const ctrl = new AbortController();
            const tid = setTimeout(() => ctrl.abort(), 30000);
            let taskData;
            try {
              const taskRes = await fetch(`/api/task/${taskId}`, { signal: ctrl.signal });
              clearTimeout(tid);
              taskData = await taskRes.json();
            } catch {
              clearTimeout(tid);
              continue;
            }

            if (taskData.current && taskData.current !== lastProgress) {
              lastProgress = taskData.current;
              addAgentMessage('🎥', t('ui.videoGenGenerating', { current: taskData.current, total: taskData.total || apiClips.length }));
            }

            if (taskData.status === 'completed') {
              const results = taskData.result?.clips || [];
              for (const r of results) {
                const apiIdx = r.index;
                const origShotIdx = apiClips[apiIdx]?.shotIndex;
                if (origShotIdx !== undefined) {
                  clips[origShotIdx] = {
                    shot_id: refImages.shots[origShotIdx].shot_id,
                    videoPath: r.path || '',
                    status: r.status === 'ok' ? 'complete' : 'failed'
                  };
                }
              }
              break;
            }
            if (taskData.status === 'failed') {
              addAgentMessage('⚠️', `Video batch failed: ${taskData.error || 'Unknown'}`);
              break;
            }
          }
        }
      } catch (err) {
        addAgentMessage('⚠️', `Video batch error: ${err.message}`);
      }
    }

    for (let i = 0; i < clips.length; i++) {
      if (!clips[i]) {
        clips[i] = { shot_id: refImages.shots[i].shot_id, videoPath: '', status: 'failed' };
      }
    }

    return { clips };
  }
};

function buildVideoPrompt(shot, storyboardShot) {
  const base = shot.prompt || `Scene of ${shot.shot_id}`;
  const camera = storyboardShot?.camera || '';
  const motion = cameraToMotion(camera);
  return `${base}, ${motion}`;
}

function cameraToMotion(camera) {
  const map = {
    'pan-left': 'camera slowly pans left',
    'pan-right': 'camera slowly pans right',
    'tilt-up': 'camera slowly tilts up',
    'tilt-down': 'camera slowly tilts down',
    'zoom-in': 'camera slowly zooms in',
    'zoom-out': 'camera slowly zooms out',
    'dolly-in': 'camera dollies in',
    'dolly-out': 'camera dollies out',
    'static': 'static camera, subtle motion',
    'tracking': 'camera tracks the subject smoothly'
  };
  return map[camera] || 'subtle natural motion';
}

function buildPlaceholder(context) {
  const refImages = context.referenceImages;
  const clips = (refImages?.shots || []).map(sh => ({
    shot_id: sh.shot_id,
    videoPath: '',
    status: 'pending'
  }));
  return { clips };
}

registerProvider(videoProvider);
