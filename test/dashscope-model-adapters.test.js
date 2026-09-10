import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFirstFrameVideoTaskRequest,
  buildImageEditTaskRequest,
  buildImageTaskRequest,
  buildLegacyReferenceVideoTaskRequest,
  buildV2VideoTaskRequest,
  clampVideoDuration,
  imageTaskEndpoint,
  referenceVideoSize,
} from '../server/dashscope.js';
import { computeImageSize, dsVideoResolution, getVideoDurationRange } from '../src/js/utils/resolution.js';

test('settings expose only the requested Wan media presets', async () => {
  globalThis.localStorage = { getItem: () => null, setItem: () => {} };
  const { IMAGE_PRESETS, IMG2IMG_PRESETS, VIDEO_MODES } = await import('../src/js/providers/llm.js');
  assert.deepEqual(IMAGE_PRESETS, ['wan2.6-t2i', 'wan2.5-t2i-preview']);
  assert.deepEqual(IMG2IMG_PRESETS, ['wan2.7-image', 'wan2.6-image']);
  assert.deepEqual(VIDEO_MODES.find(mode => mode.id === 'firstFrame').presets, ['wan2.6-i2v', 'wan2.6-i2v-flash']);
  assert.deepEqual(VIDEO_MODES.find(mode => mode.id === 'firstLastFrame').presets, ['wan2.7-i2v']);
  assert.deepEqual(VIDEO_MODES.find(mode => mode.id === 'referenceImage').presets, ['wan2.6-r2v', 'wan2.7-r2v']);
});

test('wan2.6-t2i uses the messages protocol and wan2.5 preview uses the legacy prompt protocol', () => {
  const modern = buildImageTaskRequest('cat', { model: 'wan2.6-t2i', size: '1696*960', seed: 7 });
  assert.deepEqual(modern.input.messages[0].content, [{ text: 'cat' }]);
  assert.equal(modern.parameters.prompt_extend, true);
  assert.match(imageTaskEndpoint('wan2.6-t2i'), /image-generation\/generation$/);

  const preview = buildImageTaskRequest('cat', { model: 'wan2.5-t2i-preview', size: '1696*960', seed: 7 });
  assert.deepEqual(preview.input, { prompt: 'cat' });
  assert.equal('messages' in preview.input, false);
  assert.match(imageTaskEndpoint('wan2.5-t2i-preview'), /text2image\/image-synthesis$/);
  assert.equal(computeImageSize('16:9', '720P'), '1696*960');
  assert.equal(computeImageSize('9:16', '1080P'), '960*1696');
});

test('wan2.6-image and wan2.7-image use their documented edit limits and parameters', () => {
  const refs = Array.from({ length: 10 }, (_, i) => `data:image/png;base64,${i}`);
  const v26 = buildImageEditTaskRequest('edit', refs, { model: 'wan2.6-image', size: '1K', seed: 3 });
  assert.equal(v26.input.messages[0].content.filter(part => part.image).length, 4);
  assert.deepEqual(v26.input.messages[0].content.at(-1), { text: 'edit' });
  assert.equal(v26.parameters.enable_interleave, false);
  assert.equal(v26.parameters.prompt_extend, false);

  const v27 = buildImageEditTaskRequest('edit', refs, { model: 'wan2.7-image', size: '2K', seed: 3 });
  assert.equal(v27.input.messages[0].content.filter(part => part.image).length, 9);
  assert.equal('enable_interleave' in v27.parameters, false);
  assert.equal('prompt_extend' in v27.parameters, false);
});

test('wan2.6 first-frame models use img_url and only flash receives the audio switch', () => {
  for (const model of ['wan2.6-i2v', 'wan2.6-i2v-flash']) {
    const request = buildFirstFrameVideoTaskRequest('move', 'data:image/png;base64,x', {
      model, duration: 8, resolution: '1080P', seed: 9, audio: true,
    });
    assert.equal(request.input.img_url, 'data:image/png;base64,x');
    assert.equal(request.parameters.resolution, '1080P');
    assert.equal(request.parameters.duration, 8);
    assert.equal(request.parameters.audio, model.endsWith('-flash') ? true : undefined);
    assert.equal('aspect_ratio' in request.parameters, false);
  }
});

test('wan2.7-i2v sends first and last frames through media without legacy parameters', () => {
  const media = [
    { type: 'first_frame', url: 'first' },
    { type: 'last_frame', url: 'last' },
  ];
  const request = buildV2VideoTaskRequest('transition', media, {
    model: 'wan2.7-i2v', duration: 10, resolution: '720P', aspectRatio: '9:16', seed: 4,
  });
  assert.deepEqual(request.input.media, media);
  assert.equal(request.parameters.resolution, '720P');
  assert.equal('ratio' in request.parameters, false);
  assert.equal('audio' in request.parameters, false);
  assert.equal('size' in request.parameters, false);
});

test('wan2.6-r2v uses reference_urls and pixel size while wan2.7-r2v uses media and ratio', () => {
  const legacy = buildLegacyReferenceVideoTaskRequest('walks forward', ['ref1', 'ref2'], {
    model: 'wan2.6-r2v', duration: 10, resolution: '1080P', aspectRatio: '9:16', seed: 5, audio: true,
  });
  assert.deepEqual(legacy.input.reference_urls, ['ref1', 'ref2']);
  assert.match(legacy.input.prompt, /character1, character2/);
  assert.equal(legacy.parameters.size, '1080*1920');
  assert.equal('resolution' in legacy.parameters, false);
  assert.equal('audio' in legacy.parameters, false);
  assert.equal(clampVideoDuration('wan2.6-r2v', 15), 10);

  const media = [{ type: 'reference_image', url: 'ref1' }, { type: 'reference_image', url: 'ref2' }];
  const modern = buildV2VideoTaskRequest('walks forward', media, {
    model: 'wan2.7-r2v', duration: 12, resolution: '1080P', aspectRatio: '9:16', seed: 5,
  });
  assert.deepEqual(modern.input.media, media);
  assert.match(modern.input.prompt, /Image 1, Image 2/);
  assert.equal(modern.parameters.ratio, '9:16');
  assert.equal(modern.parameters.resolution, '1080P');
  assert.equal(referenceVideoSize('720P', '4:3'), '1088*832');
  assert.deepEqual(getVideoDurationRange('wan2.6-r2v'), { min: 2, max: 10, fallback: 5 });
  assert.equal(dsVideoResolution('480P', 'wan2.6-r2v'), '720P');
});
