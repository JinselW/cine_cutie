import vm from 'node:vm';
import path from 'node:path';
import { readFileSync } from 'node:fs';
export async function promptHarness({ videoId = 'video-comfy', imageGenerate, videoGenerate } = {}) {
  const cfg = { videoMode: 'auto', models: { text: { name: 'test-model' } } };
  const calls = { llm: [], images: [], videos: [], logs: [] };
  const qc = { score: 9, verdict: 'PASS', suggestions: [] };
  const context = vm.createContext({ console, structuredClone, AbortController, setTimeout, clearTimeout, Date, Map, Set });
  const stubs = {
    'src/js/providers/llm.js': { getConfig: () => cfg, peekTokenUsage: () => ({ prompt: calls.llm.length * 100, completion: calls.llm.length * 50 }), parseJson: JSON.parse, HEAVY_TEXT_TIMEOUT_MS: 300000,
      chat: async messages => { calls.llm.push(messages); const req = JSON.parse(messages[1].content);
        if (req.template) { const data = req.template; data.legacy = false; return JSON.stringify(data); }
        req.shot.video.visualPrompt = 'Revised visual action'; req.shot.image.firstFramePrompt = 'Revised opening action';
        return JSON.stringify(req.shot);
      } },
    'src/js/providers/prompts.js': { STYLE_HINTS: { cinematic: 'cinematic film look' } },
    'src/js/providers/image.js': { getConfig: () => ({ apiKey: 'fake', videoModel: 'v', lastFrameVideoModel: 'v', refVideoModel: 'v' }) },
    'src/js/providers/registry.js': { getActiveProvider: type => type === 'image' ? { id: 'image-test', generate: async ({ items }) => {
      calls.images.push(structuredClone(items)); return imageGenerate ? imageGenerate(items, calls.images.length) : items.map(i => ({ id: i.id, path: '/api/media/' + i.id + '.png', status: 'complete' }));
    } } : { id: videoId, generate: async ({ items }) => { calls.videos.push(structuredClone(items)); return videoGenerate ? videoGenerate(items, calls.videos.length) : items.map(i => ({ id: i.id, videoPath: '/api/media/' + i.id + '.mp4', status: 'complete' })); } } },
    'src/js/ui/render.js': { addAgentMessage: (_, text) => calls.logs.push(text) },
    'src/js/i18n.js': { t: key => key },
    'src/js/utils.js': { escapeHtml: x => String(x) },
    'src/js/progressTracker.js': { reportPhase() {} },
    'src/js/agents/qcAgent.js': { QCAgent: class { async process() { return { ...qc }; } }, SCORE_THRESHOLD: 7, reportScore() {}, reportRetry() {} },
  };
  const cache = new Map();
  async function load(file) {
    file = file.replaceAll('\\', '/');
    if (cache.has(file)) return cache.get(file);
    const exports = stubs[file];
    const mod = exports ? new vm.SyntheticModule(Object.keys(exports), function () { for (const [k,v] of Object.entries(exports)) this.setExport(k,v); }, { context, identifier: file })
      : new vm.SourceTextModule(readFileSync(file, 'utf8'), { context, identifier: file });
    cache.set(file, mod);
    await mod.link((specifier, parent) => load(path.posix.normalize(path.posix.join(path.posix.dirname(parent.identifier), specifier))));
    return mod;
  }
  const modules = {};
  for (const name of ['promptAgent', 'referenceAgent', 'videoAgent']) { const m = await load('src/js/agents/' + name + '.js'); await m.evaluate(); Object.assign(modules, m.namespace); }
  return { ...modules, calls, cfg, qc, load };
}
export const promptContext = () => ({ genre: 'cinematic', lang: 'zh', totalDuration: 10,
  sourceArtifactIds: { script: 'script-v1', characterDesign: 'design-v1', storyboard: 'board-v1' },
  script: { title: 'Arrival', episodes: [] },
  characterDesign: { characters: [{ id: 'char_1', name: 'Ada', visualTag: 'red jacket, short black hair', imagePath: '/api/media/ada.png' }], settings: [{ id: 'set_1', name: 'Station', visualTag: 'blue tiled station', imagePath: '/api/media/station.png' }] },
  storyboard: { episodes: [{ segments: [{ shots: [{ shot_id: 's1', duration: 5, description: 'Ada enters Station', prompt: 'Ada at Station', camera: 'pan-left', audio_description: 'Footsteps' }, { shot_id: 's2', duration: 5, description: 'Ada waits at Station', prompt: 'Ada waits', camera: 'static' }] }] }] },
});
