import { registerProvider } from './registry.js';
import { addAgentMessage } from '../ui/render.js';
import { t } from '../i18n.js';

const CFG_KEY = 'cine-cutie-dashscope';

let config = { apiKey: '', imageModel: 'wanx2.1-t2i-turbo', videoModel: 'wanx2.1-i2v-turbo' };

function loadConfig() {
  try {
    const saved = localStorage.getItem(CFG_KEY);
    if (saved) config = { ...config, ...JSON.parse(saved) };
  } catch {}
}

function saveConfig(cfg) {
  config = { ...config, ...cfg };
  try {
    localStorage.setItem(CFG_KEY, JSON.stringify(config));
  } catch {}
}

function isConfigured() {
  return !!config.apiKey;
}

function getConfig() {
  return { ...config };
}

loadConfig();

function buildCharacterPrompt(character, script) {
  const style = script?.genre || 'cinematic';
  return `Character portrait of ${character.name}, ${character.appearance || character.desc || ''}, ${style} style, detailed face and costume, studio lighting, high quality, 4k`;
}

function buildSettingPrompt(setting, script) {
  const style = script?.genre || 'cinematic';
  return `Scene environment of ${setting.name}, ${setting.desc || ''}, ${style} style, wide angle establishing shot, atmospheric lighting, cinematic composition, high quality, 4k`;
}

function buildShotPrompt(shot, characters, genre) {
  const style = genre || 'cinematic';
  let base = shot.prompt || `${shot.description}, ${shot.type} shot`;

  if (characters?.length) {
    const shotText = base.toLowerCase();
    for (const c of characters) {
      const names = [c.name, c.enName].filter(Boolean).map(n => n.toLowerCase());
      if (names.some(n => n && shotText.includes(n)) && c.appearance) {
        base += `, ${c.appearance}`;
        break;
      }
    }
  }

  return `${style} style, ${base}, high quality, 4k`;
}

const imageProvider = {
  id: 'image',
  name: 'DashScope Image Generation',
  capabilities: ['image'],

  async generate({ step, genre, context }) {
    if (!isConfigured()) {
      return buildPlaceholder(step, context);
    }

    let prompts = [];
    let ids = [];

    if (step === 'characterDesign') {
      const script = context.script;
      if (!script) return buildPlaceholder(step, context);

      for (const char of (script.characters || [])) {
        ids.push(char.id);
        prompts.push(buildCharacterPrompt(char, script));
      }
      for (const setting of (script.settings || [])) {
        ids.push(setting.id);
        prompts.push(buildSettingPrompt(setting, script));
      }

      addAgentMessage('🎨', t('ui.charDesignGenerating', { total: prompts.length }));

      const results = await generateImages(prompts, ids, true);

      const characters = (script.characters || []).map((char, i) => ({
        id: char.id,
        name: char.name,
        enName: char.enName || '',
        desc: char.desc,
        appearance: char.appearance || '',
        imagePath: results[i]?.path || '',
        imageUrl: results[i]?.imageUrl || ''
      }));
      const settings = (script.settings || []).map((setting, i) => ({
        id: setting.id,
        name: setting.name,
        desc: setting.desc,
        imagePath: results[script.characters.length + i]?.path || '',
        imageUrl: results[script.characters.length + i]?.imageUrl || ''
      }));

      return { characters, settings };
    }

    if (step === 'referenceImages') {
      const storyboard = context.storyboard;
      if (!storyboard) return buildPlaceholder(step, context);

      const shots = [];
      for (const ep of (storyboard.episodes || [])) {
        for (const seg of (ep.segments || [])) {
          for (const shot of (seg.shots || [])) {
            shots.push(shot);
          }
        }
      }

      const maxClips = Math.ceil((context.totalDuration || 30) / 5);
      if (shots.length > maxClips) {
        shots.length = maxClips;
      }

      const characters = context.characterDesign?.characters || [];
      prompts = shots.map(sh => buildShotPrompt(sh, characters, genre));
      ids = shots.map(sh => sh.shot_id);

      const results = await generateImages(prompts, ids);

      const shotResults = shots.map((sh, i) => ({
        shot_id: sh.shot_id,
        imagePath: results[i]?.path || '',
        imageUrl: results[i]?.imageUrl || '',
        prompt: prompts[i],
        status: results[i]?.path ? 'complete' : 'failed'
      }));

      return { shots: shotResults };
    }

    return buildPlaceholder(step, context);
  }
};

async function generateImages(prompts, ids, skipFirstMessage = false) {
  try {
    if (!skipFirstMessage) {
      addAgentMessage('🖼️', t('ui.refImagesGenerating', { current: 1, total: prompts.length }));
    }

    const res = await fetch('/api/generate/image', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': config.apiKey
      },
      body: JSON.stringify({
        prompts,
        model: config.imageModel,
        size: '1024*1024',
        seed: 42
      })
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      addAgentMessage('⚠️', `Image batch failed: ${errText.substring(0, 100)}`);
      return prompts.map((_, i) => ({ path: '', imageUrl: '', id: ids[i] }));
    }

    const { taskId } = await res.json();
    const results = [];
    const startTime = Date.now();
    const MAX_WAIT = 10 * 60 * 1000;
    let lastProgress = 0;

    for (let attempt = 0; attempt < 200; attempt++) {
      if (Date.now() - startTime > MAX_WAIT) {
        addAgentMessage('⚠️', 'Image generation timed out');
        break;
      }
      await new Promise(r => setTimeout(r, 3000));

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
        addAgentMessage('️', t('ui.refImagesGenerating', { current: taskData.current, total: taskData.total || prompts.length }));
      }

      if (taskData.status === 'completed') {
        const images = taskData.result?.images || [];
        for (let i = 0; i < prompts.length; i++) {
          const img = images.find(e => e.index === i);
          results.push({
            path: img?.path || '',
            imageUrl: img?.imageUrl || '',
            id: ids[i]
          });
        }
        break;
      }
      if (taskData.status === 'failed') {
        addAgentMessage('⚠️', `Image batch failed: ${taskData.error || 'Unknown'}`);
        break;
      }
    }

    while (results.length < prompts.length) {
      results.push({ path: '', imageUrl: '', id: ids[results.length] });
    }
    return results;
  } catch (err) {
    addAgentMessage('⚠️', `Image batch error: ${err.message}`);
    return prompts.map((_, i) => ({ path: '', imageUrl: '', id: ids[i] }));
  }
}

function buildPlaceholder(step, context) {
  if (step === 'characterDesign') {
    const script = context.script;
    const characters = (script?.characters || []).map(c => ({
      id: c.id, name: c.name, enName: c.enName || '', desc: c.desc, appearance: c.appearance || '',
      imagePath: '', imageUrl: ''
    }));
    const settings = (script?.settings || []).map(s => ({
      id: s.id, name: s.name, desc: s.desc,
      imagePath: '', imageUrl: ''
    }));
    return { characters, settings };
  }

  if (step === 'referenceImages') {
    const storyboard = context.storyboard;
    const shots = [];
    for (const ep of (storyboard?.episodes || [])) {
      for (const seg of (ep.segments || [])) {
        for (const shot of (seg.shots || [])) {
          shots.push({ shot_id: shot.shot_id, imagePath: '', prompt: shot.prompt || '', status: 'pending' });
        }
      }
    }
    return { shots };
  }

  return null;
}

registerProvider(imageProvider);

export { saveConfig, getConfig, isConfigured };
