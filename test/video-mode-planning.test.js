import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildVideoModeCandidates,
  isVideoModelUnavailableError,
  normalizeShotModeAssignments,
  videoClipPayloadForMode,
} from '../src/js/videoModePlanning.js';

test('auto mode assignments match storyboard shot ids regardless of JSON id type', () => {
  const shots = [{ shot_id: 1 }, { shot_id: 'shot-2' }, { shot_id: 3 }];
  assert.deepEqual(normalizeShotModeAssignments(shots, [
    { shot_id: '1', mode: 'firstLastFrame', reason: 'clear end pose' },
    { shot_id: 'shot-2', mode: 'referenceImage', reason: 'identity' },
    { shot_id: 3, mode: 'invalid' },
  ]), [
    { shot: shots[0], mode: 'firstLastFrame', reason: 'clear end pose' },
    { shot: shots[1], mode: 'referenceImage', reason: 'identity' },
    { shot: shots[2], mode: 'firstFrame', reason: '' },
  ]);
});

test('first-last auto plan uses two independent frames then degrades without reusing another shot', () => {
  const complete = buildVideoModeCandidates('firstLastFrame', {
    imagePath: '/api/media/first.png',
    lastFramePath: '/api/media/last.png',
    referenceImages: ['/api/media/ref.png'],
  });
  assert.deepEqual(complete, ['firstLastFrame', 'firstFrame', 'referenceImage']);

  const missingLast = buildVideoModeCandidates('firstLastFrame', {
    imagePath: '/api/media/first.png',
    referenceImages: [],
  });
  assert.deepEqual(missingLast, ['firstFrame']);
});

test('ComfyUI can fall back to text-to-video when image generation produced no inputs', () => {
  assert.deepEqual(
    buildVideoModeCandidates('referenceImage', {}, { allowText: true }),
    ['textToVideo'],
  );
});

test('each selected API mode receives only the image roles it supports', () => {
  const clip = {
    prompt: 'move', duration: 7, seed: 9,
    imagePath: '/api/media/first.png', lastFramePath: '/api/media/last.png',
    referenceImages: ['/api/media/ref-a.png', '/api/media/ref-b.png'],
  };
  assert.deepEqual(videoClipPayloadForMode(clip, 'firstFrame'), {
    prompt: 'move', duration: 7, seed: 9,
    imagePath: '/api/media/first.png', imageUrl: '',
  });
  assert.deepEqual(videoClipPayloadForMode(clip, 'firstLastFrame'), {
    prompt: 'move', duration: 7, seed: 9,
    imagePath: '/api/media/first.png', imageUrl: '',
    lastFramePath: '/api/media/last.png', lastFrameUrl: '',
  });
  assert.deepEqual(videoClipPayloadForMode(clip, 'referenceImage'), {
    prompt: 'move', duration: 7, seed: 9,
    referenceImages: ['/api/media/ref-a.png', '/api/media/ref-b.png'],
  });
});

test('quota, configuration, permission and unavailable-model errors trigger a mode fallback', () => {
  for (const message of [
    'Not configured',
    'quota exhausted',
    'insufficient balance',
    'HTTP 403 forbidden',
    'model wan-x is unavailable',
    '429 Too Many Requests',
  ]) assert.equal(isVideoModelUnavailableError(message), true, message);
  assert.equal(isVideoModelUnavailableError('temporary network timeout'), false);
});
