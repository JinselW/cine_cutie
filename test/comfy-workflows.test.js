import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildWorkflow, collectVideoOutputs, ComfyVideoMode, isPromptRunning, MAX_COMFY_REFERENCE_IMAGES, selectWorkflowMode,
} from '../server/comfyui.js';
import { selectComfyWorkflow } from '../src/js/providers/comfyWorkflowMode.js';

function nodes(workflow, classType) {
  return Object.entries(workflow).filter(([, node]) => node.class_type === classType);
}

function generator(workflow) {
  return nodes(workflow, 'MiniMaxH3ImageToVideo')[0] || nodes(workflow, 'MiniMaxH3ReferenceToVideo')[0];
}

function promptValue(workflow) {
  const [, gen] = generator(workflow);
  if (typeof gen.inputs.prompt === 'string') return gen.inputs.prompt;
  return workflow[gen.inputs.prompt[0]].inputs.value;
}

function configuredWorkflow(mode, imageFiles = []) {
  return buildWorkflow({
    mode,
    imageFiles,
    prompt: 'replacement prompt',
    seed: 123456,
    duration: 9,
    aspectRatio: '9:16',
    megapixels: 0.9,
    enableLightning: true,
  });
}

test('client maps each step-5 media shape to its matching ComfyUI workflow', () => {
  assert.deepEqual(selectComfyWorkflow({}), { mode: 'textToVideo', images: [] });
  assert.deepEqual(
    selectComfyWorkflow({ imagePath: '/api/media/first.png' }),
    { mode: 'firstFrame', images: ['/api/media/first.png'] },
  );
  assert.deepEqual(
    selectComfyWorkflow({ imagePath: '/api/media/first.png', lastFramePath: '/api/media/last.png' }),
    { mode: 'firstLastFrame', images: ['/api/media/first.png', '/api/media/last.png'] },
  );
  assert.deepEqual(
    selectComfyWorkflow({ referenceImages: ['/api/media/a.png', '/api/media/b.png'] }),
    { mode: 'referenceImage', images: ['/api/media/a.png', '/api/media/b.png'] },
  );
  assert.deepEqual(
    selectComfyWorkflow({
      videoMode: 'firstFrame',
      imagePath: '/api/media/first.png',
      lastFramePath: '/api/media/last.png',
      referenceImages: ['/api/media/ref.png'],
    }),
    { mode: 'firstFrame', images: ['/api/media/first.png'] },
  );
  assert.deepEqual(
    selectComfyWorkflow({ videoMode: 'textToVideo', imagePath: '/api/media/first.png' }),
    { mode: 'textToVideo', images: [] },
  );
});

test('server degrades missing frame inputs without selecting an invalid workflow', () => {
  assert.equal(selectWorkflowMode(ComfyVideoMode.TEXT, 4), ComfyVideoMode.TEXT);
  assert.equal(selectWorkflowMode(ComfyVideoMode.FIRST, 0), ComfyVideoMode.TEXT);
  assert.equal(selectWorkflowMode(ComfyVideoMode.FIRST_LAST, 0), ComfyVideoMode.TEXT);
  assert.equal(selectWorkflowMode(ComfyVideoMode.FIRST_LAST, 1), ComfyVideoMode.FIRST);
  assert.equal(selectWorkflowMode(ComfyVideoMode.FIRST_LAST, 2), ComfyVideoMode.FIRST_LAST);
  assert.equal(selectWorkflowMode(ComfyVideoMode.REFERENCE, 0), ComfyVideoMode.TEXT);
});

for (const [mode, files, expectedClass] of [
  [ComfyVideoMode.TEXT, [], 'MiniMaxH3ImageToVideo'],
  [ComfyVideoMode.FIRST, ['first.png'], 'MiniMaxH3ImageToVideo'],
  [ComfyVideoMode.FIRST_LAST, ['first.png', 'last.png'], 'MiniMaxH3ImageToVideo'],
  [ComfyVideoMode.REFERENCE, ['ref1.png', 'ref2.png', 'ref3.png'], 'MiniMaxH3ReferenceToVideo'],
]) {
  test(`${mode} workflow receives prompt, timing, resolution, seed, images and video output`, () => {
    const workflow = configuredWorkflow(mode, files);
    const [, gen] = generator(workflow);
    assert.equal(gen.class_type, expectedClass);
    assert.equal(promptValue(workflow), 'replacement prompt');
    assert.equal(nodes(workflow, 'RandomNoise')[0][1].inputs.noise_seed, 123456);
    assert.equal(nodes(workflow, 'PrimitiveFloat')[0][1].inputs.value, 9);
    assert.deepEqual(nodes(workflow, 'ResolutionSelector')[0][1].inputs, {
      aspect_ratio: '9:16 (Portrait Widescreen)', megapixels: 0.9, multiple: 32,
    });
    assert.equal(nodes(workflow, 'PrimitiveBoolean')[0][1].inputs.value, true);
    assert.deepEqual(nodes(workflow, 'LoadImage').map(([, node]) => node.inputs.image), files);

    const [saveId, save] = nodes(workflow, 'SaveVideo')[0];
    const createId = save.inputs.video[0];
    assert.equal(saveId, '92');
    assert.equal(workflow[createId].class_type, 'CreateVideo');
  });
}

test('reference workflow has exactly the supplied images and caps the supported count', () => {
  const files = Array.from({ length: MAX_COMFY_REFERENCE_IMAGES + 2 }, (_, i) => `ref${i}.png`);
  const workflow = configuredWorkflow(ComfyVideoMode.REFERENCE, files);
  const [, gen] = generator(workflow);
  const bindings = Object.keys(gen.inputs).filter(key => key.startsWith('ref_images.ref_image_'));
  assert.equal(bindings.length, MAX_COMFY_REFERENCE_IMAGES);
  assert.deepEqual(nodes(workflow, 'LoadImage').map(([, node]) => node.inputs.image), files.slice(0, MAX_COMFY_REFERENCE_IMAGES));
  assert.equal(JSON.stringify(workflow).includes('red_superboy_on_city_roof.png'), false);
  assert.equal(JSON.stringify(workflow).includes('mecha_dragon_lightning.png'), false);
});

test('ComfyUI workflow assets stay isolated from the API video provider', () => {
  const settings = readFileSync(new URL('../src/js/ui/settings.js', import.meta.url), 'utf8');
  const registry = readFileSync(new URL('../src/js/providers/registry.js', import.meta.url), 'utf8');
  const apiProvider = readFileSync(new URL('../src/js/providers/video.js', import.meta.url), 'utf8');
  const comfyProvider = readFileSync(new URL('../src/js/providers/videoComfy.js', import.meta.url), 'utf8');
  assert.match(settings, /setActiveProvider\('video', useComfy \? 'video-comfy' : 'video'\)/);
  assert.match(settings, /llmModels\[slot\.configKey\] = \{ name: COMFY_MODEL \}/);
  assert.doesNotMatch(settings, /dashScopeConfig\.(videoModel|refVideoModel|lastFrameVideoModel)\s*=\s*COMFY_MODEL/);
  assert.match(registry, /DEFAULT_PROVIDER_IDS = Object\.freeze\(\{ video: 'video' \}\)/);
  assert.match(apiProvider, /fetch\('\/api\/generate\/video'/);
  assert.doesNotMatch(apiProvider, /video-comfy|h3_.*_to_video\.json/);
  assert.match(comfyProvider, /fetch\('\/api\/generate\/video-comfy'/);
});

test('ComfyUI history output selection ignores preview images', () => {
  const video = { filename: 'result.mp4', type: 'output' };
  assert.deepEqual(collectVideoOutputs({
    preview: { images: [{ filename: 'preview.png', type: 'temp' }] },
    save: { videos: [video] },
  }), [video]);
  assert.deepEqual(collectVideoOutputs({ preview: { images: [{ filename: 'preview.png' }] } }), []);
});

test('ComfyUI 0.34 reports SaveVideo files under images with an animated flag', () => {
  const saved = { filename: 'MiniMax_H3_00257_.mp4', subfolder: 'video', type: 'output' };
  assert.deepEqual(
    collectVideoOutputs({ 92: { images: [saved], animated: [true] } }),
    [saved],
  );
  assert.deepEqual(
    collectVideoOutputs({ 92: { gifs: [{ filename: 'clip.gif', subfolder: 'video', type: 'output' }] } }),
    [{ filename: 'clip.gif', subfolder: 'video', type: 'output' }],
  );
});

test('remote cancellation interrupts only the matching running prompt', () => {
  const queue = {
    queue_running: [[7, 'running-prompt', {}, {}, []]],
    queue_pending: [[8, 'pending-prompt', {}, {}, []]],
  };
  assert.equal(isPromptRunning(queue, 'running-prompt'), true);
  assert.equal(isPromptRunning(queue, 'pending-prompt'), false);
});

test('API video remains the default until the user explicitly selects ComfyUI', async () => {
  const previous = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => null, setItem: () => {} };
  try {
    const registry = await import(`../src/js/providers/registry.js?default-provider-test=${Date.now()}`);
    registry.registerProvider({ id: 'video', capabilities: ['video'] });
    registry.registerProvider({ id: 'video-comfy', capabilities: ['video'] });
    assert.equal(registry.getActiveProvider('video').id, 'video');
    registry.setActiveProvider('video', 'video-comfy');
    assert.equal(registry.getActiveProvider('video').id, 'video-comfy');
  } finally {
    if (previous === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous;
  }
});
