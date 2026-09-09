import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLanguageDirective, buildMessages } from '../src/js/providers/prompts.js';
import { createHarness } from './helpers/orchestratorHarness.js';

test('prompt language is explicitly controlled by the current UI language', () => {
  assert.match(buildLanguageDirective('zh'), /Simplified Chinese/);
  assert.match(buildLanguageDirective('en'), /English/);
  const messages = buildMessages('script', {
    lang: 'zh', userInput: 'An English story from history', genre: 'cinematic', totalDuration: 30,
  });
  assert.match(messages[0].content, /OUTPUT LANGUAGE \(CURRENT UI\): Simplified Chinese/);
  assert.match(messages[0].content, /overrides the language of the story idea/);
});

test('agent context always receives the live UI language', async () => {
  const h = await createHarness();
  h.state.lang = 'en';
  await h.api.startPipeline();
  assert.equal(h.calls.contexts[0].ctx.lang, 'en');
});

test('resuming English history does not overwrite the current Chinese UI language', async () => {
  const h = await createHarness();
  await h.api.startPipeline();
  const snapshot = {
    ...h.lastSnapshot(),
    input: { userInput: 'An old English workflow', genre: 'cinematic', mode: 'auto', lang: 'en' },
  };
  h.state.lang = 'zh';
  await h.api.resumeFromHistory(snapshot, 'history-1');
  assert.equal(h.state.lang, 'zh');
});
