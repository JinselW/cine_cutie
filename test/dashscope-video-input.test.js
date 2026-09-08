import test from 'node:test';
import assert from 'node:assert/strict';
import { detectVideoMode, hasVideoUploads } from '../server/dashscope.js';

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
