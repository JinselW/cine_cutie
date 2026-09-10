import test from 'node:test';
import assert from 'node:assert/strict';
import { loadInferenceProfiles, resolveInferenceOptions, resolveInferenceProfile } from '../server/inference-profiles.js';

test('all documented inference profiles have bounded executable settings', () => {
  const config = loadInferenceProfiles();
  assert.ok(config.profiles[config.defaultProfile]);
  for (const profile of Object.values(config.profiles)) {
    assert.equal(typeof profile.enableLightning, 'boolean');
    assert.ok(profile.megapixels >= 0.1 && profile.megapixels <= 2);
    assert.equal(profile.maxConcurrentGpuJobs, 1);
  }
});

test('request settings override profile defaults and remain bounded', () => {
  assert.equal(resolveInferenceProfile('fast').name, 'fast');
  assert.equal(resolveInferenceProfile('unknown').name, 'balanced');
  assert.deepEqual(resolveInferenceOptions({ enableLightning: false, megapixels: 99 }, 'fast'), {
    profile: 'fast', enableLightning: false, megapixels: 2, maxConcurrentGpuJobs: 1,
  });
});
