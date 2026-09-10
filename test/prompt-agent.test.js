import test from 'node:test';
import assert from 'node:assert/strict';
import { STEPS } from '../src/js/config.js';
import { validatePromptPackage } from '../src/js/prompts/promptSchema.js';
import { adaptPromptSpec } from '../src/js/prompts/providerAdapters.js';
import { promptHarness, promptContext } from './helpers/promptHarness.js';
const host = value => structuredClone(value);

test('Prompt service leaves the six visible steps unchanged', () => {
  assert.deepEqual(STEPS.map(s => s.id), ['script', 'characterDesign', 'storyboard', 'referenceImages', 'videoGeneration', 'postProduction']);
});

test('prepare creates a versioned, path-free package and reuses compatible inputs', async () => {
  const h = await promptHarness(); const agent = new h.PromptAgent(); const ctx = promptContext();
  const pkg = await agent.prepareShotPrompts(ctx);
  assert.equal(pkg.kind, 'promptPackage'); assert.equal(pkg.scope, 'auxiliary');
  assert.equal(pkg.version, 1); assert.equal(pkg.provenance.tokens.prompt, 100);
  assert.equal(pkg.provenance.qc.score, 9); assert.equal(pkg.data.shots.length, 2);
  assert.equal(validatePromptPackage(pkg.data, ctx).valid, true);
  assert.ok(!JSON.stringify(pkg.data).includes('/api/media/'));
  const reused = await agent.prepareShotPrompts({ ...ctx, promptPackage: pkg });
  assert.equal(reused.id, pkg.id); assert.equal(h.calls.llm.length, 1);
  assert.equal(agent.compatible(pkg, { ...ctx, sourceArtifactIds: { ...ctx.sourceArtifactIds, storyboard: 'board-v2' } }), false);
  ctx.storyboard.episodes[0].segments[0].shots[0].description = 'Different action';
  assert.equal(agent.compatible(pkg, ctx), false);
});

test('prompt progress stays on one card and ends on the decisive outcome', async () => {
  const h = await promptHarness(); const agent = new h.PromptAgent(); const ctx = promptContext();
  const pkg = await agent.prepareShotPrompts(ctx);
  assert.equal((await agent.prepareShotPrompts({ ...ctx, promptPackage: pkg })).version, 1);
  const statuses = h.calls.keys.filter(entry => entry.key === 'prompt-status');
  assert.ok(statuses.length >= 3);
  assert.equal(statuses.at(-1).text, 'promptAgent.usingPackage');
  assert.ok(h.calls.keys.every(entry => entry.key === 'prompt-status' || entry.key === null));

  const low = new h.PromptAgent({ qcAgent: { process: async () => ({ score: 3, verdict: 'CONDITIONAL_PASS', issues: ['flat lighting'], suggestions: [] }) } });
  const before = h.calls.keys.length;
  await assert.rejects(low.prepareShotPrompts(ctx));
  const rejected = h.calls.keys.slice(before).filter(entry => entry.key === 'prompt-status').at(-1);
  assert.equal(rejected.text, 'promptAgent.qcBlocked');
  assert.equal(rejected.tone, 'danger');
});

test('capability limits read as localized phrases without hiding unknown ones', async () => {
  const { describeDegradation } = await import('../src/js/agents/promptAgent.js');
  const { state } = await import('../src/js/state.js');
  const { t } = await import('../src/js/i18n.js');
  state.lang = 'zh';
  assert.equal(describeDegradation('Image provider item contract does not support negative prompt'), '图像不支持 negative prompt');
  assert.equal(describeDegradation('Provider item contract does not support negative prompt'), '视频不支持 negative prompt');
  assert.equal(describeDegradation('Provider does not support generated audio'), '不支持生成音频');
  assert.equal(describeDegradation('Mode fallback: firstLastFrame → textToVideo'),
    `模式回退 ${t('settings.videoMode.firstLastFrame')} → ${t('settings.videoMode.textToVideo')}`);
  assert.equal(describeDegradation('Some future adapter limitation'), 'Some future adapter limitation');
});

test('schema rejects missing, duplicate, unknown IDs, durations, bindings, frames and paths', async () => {
  const h = await promptHarness(); const ctx = promptContext(); h.cfg.videoMode = 'firstLastFrame';
  const original = (await new h.PromptAgent().prepareShotPrompts(ctx)).data;
  const mutations = [p => p.shots.pop(), p => p.shots[1].shotId = 's1', p => p.shots[0].shotId = 'unknown',
    p => p.shots[0].duration = 9, p => p.shots[0].bindings.characterIds = ['bad'], p => p.shots[0].bindings.settingId = 'bad',
    p => p.shots[0].image.lastFramePrompt = '', p => p.shots[0].video.audioPrompt = '', p => p.shots[0].bindings.referenceAssetIds = ['/api/media/a.png'],
    p => p.shots[0].video.visualPrompt = 'missing identity', p => p.shots[1].continuity.previousShotId = 'bad'];
  for (const mutate of mutations) { const pkg = host(original); mutate(pkg); assert.equal(validatePromptPackage(pkg, ctx).valid, false); }
});

test('single-shot revision retains old versions and leaves every other shot byte-identical', async () => {
  const h = await promptHarness(); const agent = new h.PromptAgent(); const ctx = promptContext();
  const v1 = await agent.prepareShotPrompts(ctx); const original = JSON.stringify(v1);
  const v2 = await agent.reviseShotPrompt({ ...ctx, promptPackage: v1, shotId: 's1', reason: 'quality rejected', triggeredBy: 'VideoAgent' });
  assert.equal(v2.version, 2); assert.equal(v2.parentArtifactId, v1.id);
  assert.equal(JSON.stringify(v1), original);
  assert.deepEqual(host(v2.data.shots[1]), host(v1.data.shots[1]));
  assert.match(v2.data.shots[0].video.visualPrompt, /Revised/);
  assert.equal(v2.history[0].id, v1.id); assert.equal(v2.provenance.reason, 'quality rejected');
  assert.equal(v2.provenance.triggeredBy, 'VideoAgent'); assert.equal(v2.provenance.tokens.prompt, 100);
});

test('QC below threshold rejects the revision and preserves the adopted parent', async () => {
  const h = await promptHarness(); const agent = new h.PromptAgent(); const ctx = promptContext();
  const v1 = await agent.prepareShotPrompts(ctx);
  const low = new h.PromptAgent({ qcAgent: { process: async () => ({ score: 3, verdict: 'CONDITIONAL_PASS', suggestions: ['tighten framing'] }) } });
  await assert.rejects(low.reviseShotPrompt({ ...ctx, promptPackage: v1, shotId: 's1', reason: 'quality rejected' }), error => {
    assert.equal(error.promptPackage.adoptionStatus, 'rejected');
    assert.equal(error.promptPackage.provenance.qcGate, 'blocked');
    assert.equal(error.promptPackage.provenance.qc.score, 3);
    return true;
  });
  assert.equal(v1.rejectedRevisions.length, 1); assert.equal(v1.adoptionStatus, 'adopted');
});

test('prompt QC gate blocks structural and semantic failures', async () => {
  const h = await promptHarness();
  assert.equal(h.promptQcGate(null), 'unavailable');
  assert.equal(h.promptQcGate({ score: null, source: 'unavailable' }), 'unavailable');
  assert.equal(h.promptQcGate({ score: 3, verdict: 'CONDITIONAL_PASS' }), 'blocked');
  assert.equal(h.promptQcGate({ score: 9, verdict: 'PASS', feedbackSatisfied: false }), 'blocked');
  assert.equal(h.promptQcGate({ score: 9, verdict: 'PASS' }), 'passed');
});

test('unavailable prompt QC is retained and blocks media generation', async () => {
  const h = await promptHarness();
  const agent = new h.PromptAgent({ qcAgent: { process: async () => null } });
  const result = await new h.ReferenceAgent({ promptAgent: agent }).run(promptContext());
  assert.equal(result.artifacts[0].status, 'failed');
  assert.equal(result.artifacts[0].data.shots.length, 0);
  assert.equal(h.calls.images.length, 0);
  assert.equal(result.artifacts[0].data.promptPackage.adoptionStatus, 'rejected');
  assert.equal(result.artifacts[0].data.promptPackage.provenance.qcGate, 'unavailable');
});

for (const provider of ['dashscope', 'ark', 'video-comfy']) test(`${provider} adapter is deterministic and preserves planned mode`, async () => {
  const h = await promptHarness(); h.cfg.videoMode = 'firstLastFrame';
  const pkg = await new h.PromptAgent().prepareShotPrompts(promptContext());
  const spec = pkg.data.shots[0]; const old = JSON.stringify(spec);
  const request = adaptPromptSpec(spec, { provider, executedMode: 'firstFrame' });
  assert.equal(request.plannedMode, 'firstLastFrame'); assert.equal(request.executedMode, 'firstFrame');
  assert.match(request.fallbackReason, /Mode fallback/); assert.match(request.fallbackReason, /negative prompt/);
  if (provider === 'video-comfy') { assert.match(request.fallbackReason, /audio/); assert.ok(!request.prompt.includes('Footsteps')); }
  else assert.match(request.prompt, /Footsteps/);
  assert.equal(JSON.stringify(spec), old);
});

test('image and video agents consume the same package without a second creative LLM call', async () => {
  const h = await promptHarness(); const ctx = promptContext(); const agent = new h.PromptAgent();
  const image = await new h.ReferenceAgent({ promptAgent: agent }).run(ctx);
  const data = image.artifacts[0].data;
  const video = await new h.VideoAgent({ promptAgent: agent }).run({ ...ctx, referenceImages: data });
  assert.equal(video.artifacts[0].data.promptPackage.id, data.promptPackage.id);
  assert.equal(h.calls.llm.length, 1); assert.equal(h.calls.images[0].length, 2);
  assert.ok(h.calls.videos[0][0].prompt.includes(data.promptPackage.data.shots[0].video.visualPrompt));
  assert.equal(video.artifacts[0].itemLineage.s1.attempts[0].promptPackageId, data.promptPackage.id);
});

for (const stage of ['image', 'video']) test(`${stage} REWRITE_PROMPT calls PromptAgent only for the failing shot`, async () => {
  const failure = (items, attempt) => items.map(i => attempt === 1 && i.id === 's1' ? { id: i.id, status: 'failed', error: 'prompt quality rejected' } : { id: i.id, status: 'complete', path: '/api/media/a.png', videoPath: '/api/media/a.mp4' });
  const h = await promptHarness(stage === 'image' ? { imageGenerate: failure } : { videoGenerate: failure });
  const ctx = promptContext(); const agent = new h.PromptAgent();
  const image = await new h.ReferenceAgent({ promptAgent: agent }).run(ctx);
  const result = stage === 'image' ? image : await new h.VideoAgent({ promptAgent: agent }).run({ ...ctx, referenceImages: image.artifacts[0].data });
  const pkg = result.artifacts[0].data.promptPackage;
  assert.equal(pkg.version, 2); assert.deepEqual(host(pkg.provenance.shotIds), ['s1']);
  assert.equal(h.calls.llm.length, 2); assert.equal(result.artifacts[0].itemLineage.s1.attempts[1].promptPackageVersion, 2);
});

test('provider model fallback is visible in clip and lineage without overwriting package', async () => {
  const h = await promptHarness({ videoGenerate: (items, n) => items.map(i => n === 1 ? { id: i.id, status: 'failed', error: 'model unavailable' } : { id: i.id, status: 'complete', videoPath: '/api/media/v.mp4' }) });
  const ctx = promptContext(); const agent = new h.PromptAgent(); const image = await new h.ReferenceAgent({ promptAgent: agent }).run(ctx);
  const result = await new h.VideoAgent({ promptAgent: agent }).run({ ...ctx, referenceImages: image.artifacts[0].data });
  const clip = result.artifacts[0].data.clips[0];
  assert.equal(clip.plannedMode, 'firstFrame'); assert.notEqual(clip.executedMode, clip.plannedMode); assert.match(clip.fallbackReason, /Mode fallback/);
  assert.equal(result.artifacts[0].data.promptPackage.data.shots[0].mode, 'firstFrame');
});

test('legacy video migration uses storyboard prompts and audio without invoking LLM', async () => {
  const h = await promptHarness({ videoId: 'video-dashscope' }); const ctx = promptContext();
  const result = await new h.VideoAgent().run({ ...ctx, referenceImages: { shots: [{ shot_id: 's1', imagePath: '/api/media/a.png' }, { shot_id: 's2', imagePath: '/api/media/b.png' }] } });
  assert.equal(result.artifacts[0].data.promptPackage.data.legacy, true);
  assert.equal(h.calls.llm.length, 0); assert.match(h.calls.videos[0][0].prompt, /Footsteps/);
});

test('stale package is rebuilt deterministically instead of aborting the video step', async () => {
  const h = await promptHarness(); const ctx = promptContext(); const agent = new h.PromptAgent();
  const image = await new h.ReferenceAgent({ promptAgent: agent }).run(ctx);
  ctx.sourceArtifactIds.storyboard = 'board-v2';
  const result = await new h.VideoAgent({ promptAgent: agent }).run({ ...ctx, referenceImages: image.artifacts[0].data });
  const pkg = result.artifacts[0].data.promptPackage;
  assert.equal(pkg.data.legacy, true); assert.equal(pkg.provenance.operation, 'legacy');
  assert.ok(h.calls.logs.some(message => String(message).includes('promptAgent.videoPackageRebuilt')));
  assert.ok(h.calls.videos.length > 0);
});

test('switching the provider model keeps an adopted package reusable', async () => {
  const h = await promptHarness(); const ctx = promptContext(); const agent = new h.PromptAgent();
  const image = await new h.ReferenceAgent({ promptAgent: agent }).run(ctx);
  const pkg = image.artifacts[0].data.promptPackage;
  h.cfg.models.text.name = 'qwen-max';
  const video = await new h.VideoAgent({ promptAgent: agent }).run({ ...ctx, referenceImages: image.artifacts[0].data });
  assert.equal(video.artifacts[0].data.promptPackage.id, pkg.id);
  assert.equal(video.artifacts[0].data.promptPackage.data.legacy, false);
  assert.equal(h.calls.llm.length, 1);
});

test('shot bindings use segment and episode text and ignore one-character names', async () => {
  const h = await promptHarness();
  const ctx = {
    genre: 'cinematic', lang: 'zh', totalDuration: 5,
    sourceArtifactIds: { script: 'a', characterDesign: 'b', storyboard: 'c' },
    script: { title: 'Arrival', episodes: [{ episode: 1, title: 'Bo returns', summary: '', segments: [{ title: 'Bo at the station', description: '' }] }] },
    characterDesign: {
      characters: [
        { id: 'char_1', name: 'Ada', visualTag: 'red jacket', imagePath: '/api/media/ada.png' },
        { id: 'char_2', name: 'Bo', visualTag: 'green coat', imagePath: '/api/media/bo.png' },
        { id: 'char_3', name: 'B', visualTag: 'blue hat' },
      ],
      settings: [],
    },
    storyboard: { episodes: [{ episode: 1, segments: [{ shots: [{ shot_id: 's1', duration: 5, description: 'a figure enters the station', prompt: 'figure enters the station', camera: 'static' }] }] }] },
  };
  const pkg = await new h.PromptAgent().prepareShotPrompts(ctx);
  assert.deepEqual(pkg.data.shots[0].bindings.characterIds, ['char_2']);
  assert.ok(pkg.data.shots[0].image.firstFramePrompt.includes('green coat'));
});

test('draft bindings cannot drop an identity anchor', async () => {
  const h = await promptHarness();
  const generate = async messages => {
    const template = JSON.parse(messages[1].content).template;
    return JSON.stringify({ ...template, shots: template.shots.map(shot => ({ ...shot, bindings: { characterIds: [], settingId: null, referenceAssetIds: [] } })) });
  };
  const pkg = await new h.PromptAgent({ generate }).prepareShotPrompts(promptContext());
  assert.deepEqual(pkg.data.shots.map(shot => shot.bindings.characterIds), [['char_1'], ['char_1']]);
  assert.ok(pkg.data.shots[0].image.firstFramePrompt.includes('red jacket, short black hair'));
});

test('repeated adaptation is recorded and reported once per provider state', async () => {
  const h = await promptHarness();
  const agent = new h.PromptAgent();
  const pkg = await agent.prepareShotPrompts(promptContext());
  const args = { promptPackage: pkg, shotId: 's1', provider: 'dashscope', media: 'video', executedMode: 'firstFrame' };
  agent.adaptForProvider(args); agent.adaptForProvider(args);
  assert.equal(pkg.adaptations.length, 1);
  assert.ok(h.calls.keys.every(entry => entry.key === 'prompt-status'));
  assert.match(h.calls.keys.at(-1).text, /promptAgent\.capabilityNotes/);
  agent.adaptForProvider({ ...args, media: 'image', frameRole: 'first_frame' });
  assert.equal(pkg.adaptations.length, 2);
  agent.adaptForProvider({ ...args, executedMode: 'textToVideo' });
  assert.equal(pkg.adaptations.length, 3);
  assert.ok(pkg.adaptations.every(adaptation => adaptation.executedMode === 'firstFrame' || adaptation.executedMode === 'textToVideo'));
});

test('provider capability changes create a distinct adaptation record', async () => {
  const h = await promptHarness();
  const agent = new h.PromptAgent();
  const pkg = await agent.prepareShotPrompts(promptContext());
  const args = { promptPackage: pkg, shotId: 's1', provider: 'dashscope', media: 'video', executedMode: 'firstFrame' };
  agent.adaptForProvider({ ...args, capabilities: { negativePrompt: false } });
  agent.adaptForProvider({ ...args, capabilities: { negativePrompt: true } });
  assert.equal(pkg.adaptations.length, 2);
  assert.equal(pkg.adaptations[0].negativePrompt, undefined);
  assert.match(pkg.adaptations[1].negativePrompt, /watermark/);
});

test('invalid single-shot rewrite is retained and consumes a unique version', async () => {
  const h = await promptHarness();
  const ctx = promptContext();
  const good = new h.PromptAgent();
  const v1 = await good.prepareShotPrompts(ctx);
  const invalid = new h.PromptAgent({ generate: async () => '{not json' });
  await assert.rejects(invalid.reviseShotPrompt({ ...ctx, promptPackage: v1, shotId: 's1', reason: 'provider rejected prompt' }), error => {
    assert.equal(error.promptPackage.version, 2);
    assert.equal(error.promptPackage.adoptionStatus, 'rejected');
    assert.equal(error.promptPackage.provenance.operation, 'revise');
    assert.deepEqual(Array.from(error.promptPackage.provenance.shotIds), ['s1']);
    return true;
  });
  assert.equal(v1.nextVersion, 2);
  assert.equal(v1.rejectedRevisions[0].version, 2);
  const v3 = await good.reviseShotPrompt({ ...ctx, promptPackage: v1, shotId: 's1', reason: 'retry' });
  assert.equal(v3.version, 3);
});

test('Prompt LLM failures retain rejected prepare and revise artifacts', async () => {
  const h = await promptHarness();
  const ctx = promptContext();
  const good = new h.PromptAgent();
  const v1 = await good.prepareShotPrompts(ctx);
  const failing = new h.PromptAgent({ generate: async () => { throw new Error('rate limited'); } });
  await assert.rejects(failing.prepareShotPrompts({ ...ctx, promptPackage: v1, feedback: 'retry all' }), error => {
    assert.equal(error.promptPackage.version, 2);
    assert.equal(error.promptPackage.provenance.qc.source, 'generation');
    assert.equal(error.promptPackage.adoptionStatus, 'rejected');
    return true;
  });
  await assert.rejects(failing.reviseShotPrompt({ ...ctx, promptPackage: v1, shotId: 's1' }), error => {
    assert.equal(error.promptPackage.version, 3);
    assert.equal(error.promptPackage.provenance.qc.source, 'generation');
    assert.equal(error.promptPackage.adoptionStatus, 'rejected');
    return true;
  });
  assert.equal(v1.nextVersion, 3);
});

test('blocked revisions keep version numbers unique and stay bounded', async () => {
  const h = await promptHarness();
  const agent = new h.PromptAgent();
  const ctx = promptContext();
  const v1 = await agent.prepareShotPrompts(ctx);
  for (let i = 0; i < 5; i++) {
    const invalid = structuredClone(v1.data);
    invalid.shots[0].duration = 99;
    await assert.rejects(agent.save(ctx, invalid, v1, 'prepare', null, null), error => {
      assert.equal(error.promptPackage.adoptionStatus, 'rejected');
      return true;
    });
  }
  assert.equal(v1.version, 1); assert.equal(v1.nextVersion, 6);
  assert.deepEqual(Array.from(v1.rejectedRevisions, revision => revision.version), [4, 5, 6]);
  const revised = await agent.reviseShotPrompt({ ...ctx, promptPackage: v1, shotId: 's1', reason: 'still failing' });
  assert.equal(revised.version, 7);
});

test('image adapter reports the mode it was actually asked to execute', async () => {
  const h = await promptHarness();
  const pkg = await new h.PromptAgent().prepareShotPrompts(promptContext());
  const spec = pkg.data.shots[0];
  assert.equal(adaptPromptSpec(spec, { media: 'image', frameRole: 'first_frame' }).executedMode, spec.mode);
  const fallback = adaptPromptSpec(spec, { media: 'image', frameRole: 'first_frame', executedMode: 'firstLastFrame' });
  assert.equal(fallback.executedMode, 'firstLastFrame');
  assert.match(fallback.fallbackReason, /Mode fallback/);
});

test('first/last frame expansion retries both frames of a revised shot', async () => {
  const h = await promptHarness({ imageGenerate: (items, n) => items.map(i => n === 1 && i.id === 's1__last_frame' ? { id: i.id, status: 'failed', error: 'prompt quality' } : { id: i.id, status: 'complete', path: '/api/media/a.png' }) });
  h.cfg.videoMode = 'firstLastFrame';
  const result = await new h.ReferenceAgent().run(promptContext());
  assert.equal(h.calls.images[0].length, 4);
  assert.deepEqual(h.calls.images[1].map(i => i.id).sort(), ['s1', 's1__last_frame']);
  assert.equal(result.artifacts[0].data.promptPackage.version, 2);
  assert.equal(result.artifacts[0].data.shots[0].lastFramePath, '/api/media/a.png');
});

test('structurally invalid preparation persists a rejected package and never calls the image provider', async () => {
  const h = await promptHarness();
  const agent = new h.PromptAgent({ generate: async () => JSON.stringify({ shots: [] }) });
  const result = await new h.ReferenceAgent({ promptAgent: agent }).run(promptContext());
  assert.equal(result.artifacts[0].status, 'failed');
  assert.equal(result.artifacts[0].data.promptPackage.adoptionStatus, 'rejected');
  assert.equal(result.artifacts[0].data.promptPackage.provenance.qcGate, 'blocked');
  assert.equal(result.artifacts[0].data.promptPackage.provenance.qc.source, 'structural');
  assert.equal(h.calls.images.length, 0);
});

test('uploaded media uses the package, preserves duration and routes prompt retries', async () => {
  const h = await promptHarness({ videoGenerate: (items, n) => items.map(i => n === 1 && i.id === 'upload_clip_0' ? { id: i.id, status: 'failed', error: 'prompt quality' } : { id: i.id, status: 'complete', videoPath: '/api/media/u.mp4' }) });
  const result = await new h.VideoAgent().run({ ...promptContext(), uploads: { firstFrame: { serverPath: '/api/media/u.png' } } });
  assert.equal(result.artifacts[0].data.promptPackage.version, 2);
  assert.equal(result.artifacts[0].data.clips[0].promptShotId, 's1');
  assert.equal(h.calls.videos[0][0].duration, 5); assert.equal(h.calls.llm.length, 1);
});

test('upload-only legacy data retains synthetic shot identity and produces clips', async () => {
  const h = await promptHarness();
  const result = await new h.VideoAgent().run({ totalDuration: 5, uploads: { firstFrame: { serverPath: '/api/media/u.png' } } });
  assert.equal(result.artifacts[0].data.clips.length, 1);
  assert.equal(result.artifacts[0].data.promptPackage.data.legacy, true);
});

test('nested package survives persistence and loses consumability with stale parent', async () => {
  const { ArtifactStore } = await import('../src/js/artifacts/artifactStore.js');
  const { createArtifact, ArtifactStatus } = await import('../src/js/artifacts/artifactTypes.js');
  const h = await promptHarness(); const pkg = await new h.PromptAgent().prepareShotPrompts(promptContext());
  const store = new ArtifactStore();
  const board = createArtifact({ kind: 'storyboard', stepId: 'storyboard', data: {}, status: ArtifactStatus.COMPLETE });
  store.commit(board); store.replaceAcceptedArtifact(board.id);
  const image = createArtifact({ kind: 'referenceImage', stepId: 'referenceImages', data: { promptPackage: host(pkg) }, status: ArtifactStatus.COMPLETE, sourceArtifactIds: [board.id] });
  store.commit(image); store.replaceAcceptedArtifact(image.id);
  const video = createArtifact({ kind: 'videoClip', stepId: 'videoGeneration', data: { promptPackage: host(pkg) }, status: ArtifactStatus.COMPLETE, sourceArtifactIds: [image.id] });
  store.commit(video); store.replaceAcceptedArtifact(video.id);
  const restored = new ArtifactStore(); restored.restore(JSON.parse(JSON.stringify(store.snapshot()))); restored.restoreAccepted(JSON.parse(JSON.stringify(store.snapshotAccepted())));
  assert.equal(restored.getAcceptedByStep('referenceImages').id, image.id);
  assert.equal(restored.getAcceptedByStep('referenceImages').data.promptPackage.id, pkg.id);
  const next = createArtifact({ kind: 'storyboard', stepId: 'storyboard', data: {}, status: ArtifactStatus.COMPLETE }); restored.commit(next); restored.replaceAcceptedArtifact(next.id);
  assert.equal(restored.getAcceptedByStep('referenceImages'), null);
  assert.equal(restored.getAcceptedByStep('videoGeneration'), null);
  assert.equal(restored.get(image.id).data.promptPackage.id, pkg.id);
});
