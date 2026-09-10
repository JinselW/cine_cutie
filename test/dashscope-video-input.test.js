import test from 'node:test';
import assert from 'node:assert/strict';
import { detectVideoMode, hasVideoUploads, selectClipReferenceImages } from '../server/dashscope.js';

test('video upload detection includes first frame, last frame, and reference images', () => {
  assert.equal(hasVideoUploads({ firstFrame: { localPath: 'first.png' } }), true);
  assert.equal(hasVideoUploads({ lastFrame: { localPath: 'last.png' } }), true);
  assert.equal(hasVideoUploads({ referenceImages: [{ localPath: 'ref.png' }] }), true);
  assert.equal(hasVideoUploads({ firstFrame: null, lastFrame: null, referenceImages: [] }), false);
});

test('a last-frame-only upload is classified as image-to-video rather than legacy', () => {
  const uploads = { lastFrame: { localPath: 'last.png' } };
  assert.equal(hasVideoUploads(uploads), true);
  assert.equal(detectVideoMode(uploads), 'i2v');
});

test('a declared first-frame request ignores the reference candidates it carries along', () => {
  // 每个镜头的候选素材会整份随请求发来，只有声明 r2v 时才能当参考图用，
  // 否则 wan2.6-i2v 这类模型会被误判成 r2v 而整批报"不接受参考图"。
  const clip = { imagePath: '/api/media/first.png', referenceImages: ['/api/media/ref.png'] };
  assert.deepEqual(selectClipReferenceImages(clip, 'firstFrame'), []);
  assert.deepEqual(selectClipReferenceImages(clip, 'firstLastFrame'), []);
  assert.deepEqual(selectClipReferenceImages(clip, 'referenceImage'), ['/api/media/ref.png']);
  assert.deepEqual(selectClipReferenceImages(clip, undefined), ['/api/media/ref.png']);
});
