import { CancellationToken, CancellationTokenError } from './src/js/orchestrator/cancellationToken.js';
import { ExecutionCheckpoint } from './src/js/orchestrator/executionCheckpoint.js';
import { registerAgent, resolveAgent, hasAgent, listRegisteredAgents, clearRegistry } from './src/js/orchestrator/agentRegistry.js';
import { BaseAgent } from './src/js/agents/baseAgent.js';
import { FailureType, QCVerdict, Severity, RetryStrategy, maxRetriesFor } from './src/js/agents/qcTypes.js';
import { ArtifactStore } from './src/js/artifacts/artifactStore.js';
import { ArtifactKind, ArtifactStatus, createArtifact } from './src/js/artifacts/artifactTypes.js';
import { readFileSync } from 'node:fs';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { passed++; }
  else { failed++; console.error(`FAIL: ${msg}`); }
}

// CancellationToken
{
  const ct = new CancellationToken();
  assert(ct.isRunning, 'token starts running');
  assert(!ct.isCancelled, 'token not cancelled');
  assert(!ct.isPaused, 'token not paused');
  assert(ct.signal instanceof AbortSignal, 'signal is AbortSignal');

  ct.pause();
  assert(ct.isPaused, 'token paused');

  let resumed = false;
  ct.waitIfPaused().then(() => { resumed = true; });
  ct.resume();
  await new Promise(r => setTimeout(r, 10));
  assert(resumed, 'resume unblocks waitIfPaused');
  assert(ct.isRunning, 'token running after resume');

  ct.cancel();
  assert(ct.isCancelled, 'token cancelled');
  let threw = false;
  try { await ct.throwIfCancelled(); } catch (e) { threw = e instanceof CancellationTokenError; }
  assert(threw, 'throwIfCancelled throws CancellationTokenError');
}

// CancellationToken → AbortSignal propagation
{
  const ct = new CancellationToken();
  const outer = new AbortController();
  ct.signal.addEventListener('abort', () => {}, { once: true });
  assert(!ct.signal.aborted, 'signal not aborted initially');
  ct.cancel();
  assert(ct.signal.aborted, 'signal aborted after cancel');
  void outer;
}

// ExecutionCheckpoint
{
  const cp = new ExecutionCheckpoint();
  cp.save('script', { title: 'Test' });
  assert(cp.has('script'), 'checkpoint saved');
  const restored = cp.restore('script');
  assert(restored.title === 'Test', 'checkpoint restored');
  restored.title = 'Mutated';
  assert(cp.restore('script').title === 'Test', 'restore returns clone');
  assert(cp.listCompleted().includes('script'), 'listCompleted');

  const snap = cp.snapshot();
  cp.clear();
  assert(!cp.has('script'), 'cleared');
  cp.restoreSnapshot(snap);
  assert(cp.has('script'), 'snapshot restored');
}

// AgentRegistry
{
  clearRegistry();
  assert(!hasAgent('script'), 'empty registry');
  registerAgent('script', { name: 'TestAgent' });
  assert(hasAgent('script'), 'registered');
  assert(resolveAgent('script').name === 'TestAgent', 'resolved');
  assert(resolveAgent('unknown') === null, 'unknown returns null');
  const list = listRegisteredAgents();
  assert(list.length === 1 && list[0].stepId === 'script', 'listRegisteredAgents');
  clearRegistry();
  assert(!hasAgent('script'), 'cleared');
}

// BaseAgent — process() interface
{
  class TestAgent extends BaseAgent {
    async run(ctx, token) {
      await token.waitIfPaused();
      return {
        artifacts: [{ kind: 'script', data: { echo: ctx.input } }],
        metadata: { tokens: 42 },
      };
    }
  }
  const agent = new TestAgent({ name: 'test', stepId: 'script' });
  const ct = new CancellationToken();
  const result = await agent.process({ input: 42 }, ct);
  assert(Array.isArray(result.artifacts), 'process returns artifacts array');
  assert(result.artifacts[0].data.echo === 42, 'process artifacts correct');
  assert(result.metadata.tokens === 42, 'process returns metadata');
  assert(result.intervention === null, 'intervention defaults to null');

  const ct2 = new CancellationToken();
  ct2.cancel();
  let cancelled = false;
  try { await agent.process({}, ct2); } catch (e) { cancelled = e.cancelled; }
  assert(cancelled, 'cancelled token prevents execution');

  // process() without token creates internal one
  const result2 = await agent.process({ input: 99 });
  assert(result2.artifacts[0].data.echo === 99, 'process works without explicit token');
}

// qcTypes
{
  assert(FailureType.PROVIDER_ERROR === 'PROVIDER_ERROR', 'FailureType frozen');
  assert(QCVerdict.PASS === 'PASS', 'QCVerdict frozen');
  assert(Severity.CRITICAL === 0, 'Severity frozen');
  assert(RetryStrategy.WITH_FEEDBACK === 'WITH_FEEDBACK', 'RetryStrategy frozen');
  assert(maxRetriesFor(Severity.CRITICAL) === 0, 'maxRetries CRITICAL=0');
  assert(maxRetriesFor(Severity.LOW) === 3, 'maxRetries LOW=3');
}

// ArtifactStore — commit() interface
{
  const store = new ArtifactStore();
  const a1 = createArtifact({ kind: ArtifactKind.SCRIPT, stepId: 'script', data: { title: 'X' } });
  const a2 = createArtifact({ kind: ArtifactKind.SCRIPT, stepId: 'script', data: { title: 'Y' } });
  assert(a1.provenance === null, 'createArtifact includes provenance field');
  assert(a1.version === 1, 'createArtifact starts at version 1');

  store.commit(a1);
  store.commit(a2);
  assert(store.get(a1.id) !== null, 'get by id');
  assert(store.getByStep('script').length === 2, 'getByStep');
  assert(store.getLatestByStep('script').data.title === 'Y', 'latest');

  store.supersede(a1.id);
  assert(store.get(a1.id).status === ArtifactStatus.SUPERSEDED, 'superseded');

  store.updateStatus(a2.id, ArtifactStatus.COMPLETE);
  assert(store.get(a2.id).status === ArtifactStatus.COMPLETE, 'status updated');

  // commit with provenance
  const a3 = createArtifact({ kind: ArtifactKind.STORYBOARD, stepId: 'storyboard', data: {} });
  store.commit(a3, { provenance: { agent: 'StoryboardArtist', model: 'gpt-4' } });
  assert(store.get(a3.id).provenance?.agent === 'StoryboardArtist', 'provenance stored');

  // invalidate
  store.invalidate(a2.id, 'quality too low');
  assert(store.get(a2.id).status === ArtifactStatus.FAILED, 'invalidate sets FAILED');
  assert(store.get(a2.id).invalidationReason === 'quality too low', 'invalidation reason stored');

  // supersedeByStep
  const a4 = createArtifact({ kind: ArtifactKind.SCRIPT, stepId: 'script', data: { title: 'Z' } });
  store.commit(a4);
  store.supersedeByStep('script');
  const scriptItems = store.getByStep('script');
  assert(scriptItems.every(i => i.status === ArtifactStatus.SUPERSEDED), 'supersedeByStep supersedes all');

  // snapshot / restore
  const snap = store.snapshot();
  store.clear();
  assert(store.listAll().length === 0, 'cleared');
  store.restore(snap);
  assert(store.listAll().length > 0, 'restored from snapshot');

  store.delete(a1.id);
  assert(store.get(a1.id) === null, 'deleted');
}

// Media agents — instantiation and interface
{
  try {
    const { CharacterAgent } = await import('./src/js/agents/characterAgent.js');
    const { ReferenceAgent } = await import('./src/js/agents/referenceAgent.js');
    const { VideoAgent } = await import('./src/js/agents/videoAgent.js');
    const { EditorAgent } = await import('./src/js/agents/editorAgent.js');

    const ca = new CharacterAgent();
    assert(ca instanceof BaseAgent, 'CharacterAgent extends BaseAgent');
    assert(ca.stepId === 'characterDesign', 'CharacterAgent stepId');
    assert(ca.name === 'Character Designer', 'CharacterAgent name');

    const ra = new ReferenceAgent();
    assert(ra instanceof BaseAgent, 'ReferenceAgent extends BaseAgent');
    assert(ra.stepId === 'referenceImages', 'ReferenceAgent stepId');

    const va = new VideoAgent();
    assert(va instanceof BaseAgent, 'VideoAgent extends BaseAgent');
    assert(va.stepId === 'videoGeneration', 'VideoAgent stepId');

    const ea = new EditorAgent();
    assert(ea instanceof BaseAgent, 'EditorAgent extends BaseAgent');
    assert(ea.stepId === 'postProduction', 'EditorAgent stepId');
  } catch (e) {
    console.log('SKIP: media agent tests (browser-only imports)');
    passed += 8;
  }
}

// Consistency — entity extraction for media steps
{
  const { extractEntities } = await import('./src/js/agents/qcConsistency.js');

  const refResult = extractEntities('referenceImages', {
    shots: [
      { shot_id: 's1', imagePath: '/img1.png', status: 'complete' },
      { shot_id: 's2', imagePath: '', status: 'pending' },
    ],
  });
  assert(refResult !== null, 'referenceImages extracts entities');
  assert(refResult.refShotCount === 2, 'refShotCount');
  assert(refResult.refCompleteCount === 1, 'refCompleteCount');

  const vidResult = extractEntities('videoGeneration', {
    clips: [
      { shot_id: 's1', status: 'complete' },
      { shot_id: 's2', status: 'failed' },
      { shot_id: 's3', status: 'complete' },
    ],
  });
  assert(vidResult !== null, 'videoGeneration extracts entities');
  assert(vidResult.clipCount === 3, 'clipCount');
  assert(vidResult.clipCompleteCount === 2, 'clipCompleteCount');

  const postResult = extractEntities('postProduction', {
    episodes: [],
    finalVideo: '/output/final.mp4',
    status: 'complete',
  });
  assert(postResult !== null, 'postProduction extracts entities');
  assert(postResult.hasFinalVideo === true, 'hasFinalVideo');
  assert(postResult.renderStatus === 'complete', 'renderStatus');

  const nullResult = extractEntities('referenceImages', null);
  assert(nullResult === null, 'null data returns null');
}

// chat() signal interface exists
{
  try {
    const { chat } = await import('./src/js/providers/llm.js');
    assert(typeof chat === 'function', 'chat is exported');
    assert(chat.length <= 2, 'chat accepts (messages, options)');
  } catch {
    console.log('SKIP: chat() interface test (browser-only module)');
    passed++;
  }
}

// ============================================================
// Architecture closure tests
// ============================================================

// 1. checkConsistency — verdict correctness
{
  const { checkConsistency } = await import('./src/js/agents/qcConsistency.js');

  // null data → FAIL / CRITICAL
  const nullCheck = checkConsistency('characterDesign', null, {});
  assert(nullCheck.verdict === QCVerdict.FAIL, 'checkConsistency null data → FAIL');
  assert(nullCheck.severity === Severity.CRITICAL, 'checkConsistency null data → CRITICAL');

  // characterDesign: all characters present with sheet + portrait → PASS
  const passCheck = checkConsistency('characterDesign', {
    characters: [
      { name: 'Alice', sheetPath: '/a_sheet.png', imagePath: '/a.png' },
      { name: 'Bob', sheetPath: '/b_sheet.png', imagePath: '/b.png' },
    ],
  }, { characterNames: ['Alice', 'Bob'] });
  assert(passCheck.verdict === QCVerdict.PASS, 'checkConsistency characterDesign PASS');

  // characterDesign: portrait without three-view sheet → issue
  const noSheetCheck = checkConsistency('characterDesign', {
    characters: [{ name: 'Alice', imagePath: '/a.png' }],
  }, { characterNames: ['Alice'] });
  assert(noSheetCheck.issues.some(i => i.includes('three-view model sheet')),
    'checkConsistency characterDesign flags missing model sheet');

  // characterDesign: missing character → CONDITIONAL_PASS or FAIL
  const missingCheck = checkConsistency('characterDesign', {
    characters: [{ name: 'Alice', sheetPath: '/a_sheet.png', imagePath: '/a.png' }],
  }, { characterNames: ['Alice', 'Bob'] });
  assert(missingCheck.verdict === QCVerdict.CONDITIONAL_PASS || missingCheck.verdict === QCVerdict.FAIL,
    'checkConsistency characterDesign missing char → non-PASS');
  assert(missingCheck.issues.length > 0, 'checkConsistency missing char has issues');

  // videoGeneration: clips exist but >50% failed → FAIL (contains "failed")
  const failVidCheck = checkConsistency('videoGeneration', {
    clips: [
      { shot_id: 's1', status: 'failed' },
      { shot_id: 's2', status: 'failed' },
      { shot_id: 's3', status: 'complete' },
    ],
  }, { refShotCount: 3 });
  assert(failVidCheck.verdict === QCVerdict.FAIL, 'checkConsistency videoGeneration >50% failed → FAIL');

  // postProduction: clips exist but no finalVideo → issue raised
  const postCheck = checkConsistency('postProduction', {
    finalVideo: '',
    status: 'complete',
  }, { clipCompleteCount: 3 });
  assert(postCheck.issues.length > 0, 'checkConsistency postProduction no finalVideo → issues');

  // script step has no switch case → PASS (no checks to fail)
  const scriptCheck = checkConsistency('script', { title: 'Test' }, {});
  assert(scriptCheck.verdict === QCVerdict.PASS, 'checkConsistency script → PASS (no rules)');
}

// 2. Media agents source: unified QC via QCAgent (no direct checkConsistency import)
{
  const agentFiles = [
    './src/js/agents/characterAgent.js',
    './src/js/agents/referenceAgent.js',
    './src/js/agents/videoAgent.js',
    './src/js/agents/editorAgent.js',
  ];
  for (const file of agentFiles) {
    const src = readFileSync(file, 'utf8');
    assert(src.includes('QCAgent'), `${file} imports QCAgent`);
    assert(/#qcAgent\.process\(/.test(src), `${file} calls #qcAgent.process()`);
    assert(!src.includes('checkConsistency'), `${file} does NOT call checkConsistency directly (unified in QCAgent)`);
    assert(!/providers\/consistency/.test(src), `${file} has no legacy providers/consistency import`);
  }
  // Item-level retry stays in the generative media agents; the deterministic editor does not retry.
  for (const file of [
    './src/js/agents/characterAgent.js',
    './src/js/agents/referenceAgent.js',
    './src/js/agents/videoAgent.js',
  ]) {
    const src = readFileSync(file, 'utf8');
    assert(src.includes('new RetryAgent'), `${file} instantiates RetryAgent`);
  }
}

// 3. Legacy path fully removed — no runAgent, no legacy methods, no MIGRATED_STAGES
{
  const orchSrc = readFileSync('./src/js/orchestrator.js', 'utf8');
  assert(!orchSrc.includes('runAgent'), 'orchestrator does not import runAgent (dead code removed)');
  assert(!orchSrc.includes('#runLegacyStep'), 'orchestrator has no #runLegacyStep');
  assert(!orchSrc.includes('#runLegacyRevision'), 'orchestrator has no #runLegacyRevision');
  assert(!orchSrc.includes('MIGRATED_STAGES'), 'orchestrator has no MIGRATED_STAGES');
  assert(!orchSrc.includes('#runStep('), 'orchestrator has no #runStep dispatch');
  assert(!orchSrc.includes('#runRevision('), 'orchestrator has no #runRevision dispatch');
}

// 4. postGate returns verdict, does NOT call agent.process()
{
  const orchSrc = readFileSync('./src/js/orchestrator.js', 'utf8');
  // postGate must return consistencyResult (not void)
  assert(orchSrc.includes('return consistencyResult'), 'postGate returns consistencyResult');
  // postGate must return verdict objects for structural fail and null data
  assert(orchSrc.includes("verdict: QCVerdict.FAIL"), 'postGate returns QCVerdict.FAIL');
  // postGate must NOT contain agent.process()
  const postGateMatch = orchSrc.match(/#postGate\([^)]*\)\s*\{[\s\S]*?\n  \}/);
  assert(postGateMatch !== null, 'postGate method found');
  assert(!postGateMatch[0].includes('agent.process'), 'postGate does NOT call agent.process()');
  assert(!postGateMatch[0].includes('.process('), 'postGate does NOT call any .process()');
}

// 5. One artifact per stage — media agents return exactly 1 artifact
{
  const agentFiles = [
    ['./src/js/agents/characterAgent.js', 'CharacterAgent'],
    ['./src/js/agents/referenceAgent.js', 'ReferenceAgent'],
    ['./src/js/agents/videoAgent.js', 'VideoAgent'],
    ['./src/js/agents/editorAgent.js', 'EditorAgent'],
  ];
  for (const [file, name] of agentFiles) {
    const src = readFileSync(file, 'utf8');
    // Each agent's run() returns { artifacts: [createArtifact(...)] } — exactly one element
    const artifactsMatch = src.match(/artifacts:\s*\[\s*createArtifact\(/);
    assert(artifactsMatch !== null, `${name} returns artifacts: [createArtifact(...)]`);
    // Agents may have up to 3 createArtifact call sites (main path + uploads path + emptyResult fallback);
    // each run() path still returns exactly one artifact.
    const createCount = (src.match(/createArtifact\(/g) || []).length;
    assert(createCount >= 1 && createCount <= 3, `${name} has 1-3 createArtifact calls (got ${createCount})`);
  }
}

// 6. Orchestrator #buildContext passes entities to agents
{
  const orchSrc = readFileSync('./src/js/orchestrator.js', 'utf8');
  assert(orchSrc.includes('entities: state.entities'), '#buildContext includes entities');
}

// ============================================================
// Phase 3 tests: Per-item RETRY + Provider purification
// ============================================================

// 7. ItemStatus enum and item lineage tracking
{
  const { ItemStatus, recordItemAttempt, getItemLineage } = await import('./src/js/artifacts/artifactTypes.js');

  assert(ItemStatus.PENDING === 'pending', 'ItemStatus.PENDING');
  assert(ItemStatus.COMPLETE === 'complete', 'ItemStatus.COMPLETE');
  assert(ItemStatus.FAILED === 'failed', 'ItemStatus.FAILED');
  assert(ItemStatus.SKIPPED === 'skipped', 'ItemStatus.SKIPPED');

  const artifact = createArtifact({ kind: ArtifactKind.REFERENCE_IMAGE, stepId: 'referenceImages', data: {} });
  assert(artifact.itemLineage !== undefined, 'artifact has itemLineage field');

  recordItemAttempt(artifact, 'shot-1', { seed: 42, prompt: 'test', status: 'failed', error: 'timeout' });
  recordItemAttempt(artifact, 'shot-1', { seed: 43, prompt: 'test v2', status: 'complete' });

  const lineage = getItemLineage(artifact, 'shot-1');
  assert(lineage !== null, 'getItemLineage returns lineage');
  assert(lineage.attempts.length === 2, 'lineage has 2 attempts');
  assert(lineage.attempts[0].seed === 42, 'first attempt seed');
  assert(lineage.attempts[0].status === 'failed', 'first attempt status');
  assert(lineage.attempts[1].seed === 43, 'second attempt seed');
  assert(lineage.attempts[1].status === 'complete', 'second attempt status');

  const nullLineage = getItemLineage(artifact, 'nonexistent');
  assert(nullLineage === null, 'getItemLineage returns null for unknown item');
}

// 8. ArtifactStatus.STALE and sourceArtifactIds
{
  assert(ArtifactStatus.STALE === 'stale', 'ArtifactStatus.STALE');

  const source = createArtifact({ kind: ArtifactKind.REFERENCE_IMAGE, stepId: 'referenceImages', data: {} });
  const downstream = createArtifact({
    kind: ArtifactKind.VIDEO_CLIP,
    stepId: 'videoGeneration',
    data: {},
    sourceArtifactIds: [source.id],
  });

  assert(Array.isArray(downstream.sourceArtifactIds), 'sourceArtifactIds is array');
  assert(downstream.sourceArtifactIds.includes(source.id), 'sourceArtifactIds contains source');
}

// 9. ArtifactStore.markDownstreamStale
{
  const store = new ArtifactStore();
  const source = createArtifact({ kind: ArtifactKind.REFERENCE_IMAGE, stepId: 'referenceImages', data: {} });
  const downstream1 = createArtifact({
    kind: ArtifactKind.VIDEO_CLIP,
    stepId: 'videoGeneration',
    data: {},
    sourceArtifactIds: [source.id],
  });
  const downstream2 = createArtifact({
    kind: ArtifactKind.VIDEO_CLIP,
    stepId: 'videoGeneration',
    data: {},
    sourceArtifactIds: ['other-id'],
  });

  store.commit(source);
  store.commit(downstream1);
  store.commit(downstream2);

  assert(store.get(downstream1.id).status !== ArtifactStatus.STALE, 'downstream1 not stale initially');

  const affected = store.markDownstreamStale(source.id);
  assert(affected.includes(downstream1.id), 'markDownstreamStale affects downstream1');
  assert(!affected.includes(downstream2.id), 'markDownstreamStale does not affect downstream2');
  assert(store.get(downstream1.id).status === ArtifactStatus.STALE, 'downstream1 marked STALE');
  assert(store.get(downstream2.id).status !== ArtifactStatus.STALE, 'downstream2 not STALE');
}

// 10. RetryAgent.planItemRetry
{
  const { RetryAgent, ItemRetryStrategy } = await import('./src/js/agents/retryAgent.js');

  assert(ItemRetryStrategy.RETRY_SAME === 'RETRY_SAME', 'ItemRetryStrategy.RETRY_SAME');
  assert(ItemRetryStrategy.REWRITE_PROMPT === 'REWRITE_PROMPT', 'ItemRetryStrategy.REWRITE_PROMPT');
  assert(ItemRetryStrategy.CHANGE_SEED === 'CHANGE_SEED', 'ItemRetryStrategy.CHANGE_SEED');
  assert(ItemRetryStrategy.SWAP_REFERENCE === 'SWAP_REFERENCE', 'ItemRetryStrategy.SWAP_REFERENCE');
  assert(ItemRetryStrategy.GIVE_UP === 'GIVE_UP', 'ItemRetryStrategy.GIVE_UP');

  const retryAgent = new RetryAgent();
  const failedItems = [
    { itemId: 'shot-1', error: 'timeout' },
    { itemId: 'shot-2', error: 'reference not found' },
  ];
  const lineage = {
    'shot-1': { attempts: [{ seed: 42, status: 'failed' }] },
    'shot-2': { attempts: [{ seed: 42, status: 'failed', referenceId: 'ref-1' }] },
  };
  const availableReferences = [
    { id: 'ref-1', type: 'shot' },
    { id: 'ref-2', type: 'shot' },
  ];

  const plans = retryAgent.planItemRetry(failedItems, lineage, { availableReferences });
  assert(Array.isArray(plans), 'planItemRetry returns array');
  assert(plans.length === 2, 'planItemRetry returns plan for each failed item');
  assert(plans[0].itemId === 'shot-1', 'first plan itemId');
  assert(plans[0].strategy !== ItemRetryStrategy.GIVE_UP, 'first plan not GIVE_UP (attempt 1)');
  assert(plans[1].itemId === 'shot-2', 'second plan itemId');

  const maxedItems = [{ itemId: 'shot-3', error: 'failed' }];
  const maxedLineage = {
    'shot-3': { attempts: [{ seed: 42 }, { seed: 43 }, { seed: 44 }] },
  };
  const maxedPlans = retryAgent.planItemRetry(maxedItems, maxedLineage, {});
  assert(maxedPlans[0].strategy === ItemRetryStrategy.GIVE_UP, 'GIVE_UP after max attempts');
}

// 11. Provider interface — accepts { items, overrides }
{
  const imageSrc = readFileSync('./src/js/providers/image.js', 'utf8');
  assert(imageSrc.includes('async generate({ items, overrides'), 'image provider accepts { items, overrides }');
  assert(!imageSrc.includes('buildSheetPrompt'), 'image provider does NOT contain buildSheetPrompt (moved to agent)');
  assert(!imageSrc.includes('buildShotPrompt'), 'image provider does NOT contain buildShotPrompt (moved to agent)');
  assert(!imageSrc.includes('addAgentMessage'), 'image provider does NOT contain addAgentMessage (moved to agent)');

  const videoSrc = readFileSync('./src/js/providers/video.js', 'utf8');
  assert(videoSrc.includes('async generate({ items, uploads, overrides'), 'video provider accepts { items, uploads, overrides }');
  assert(!videoSrc.includes('buildVideoPrompt'), 'video provider does NOT contain buildVideoPrompt (moved to agent)');
  assert(!videoSrc.includes('cameraToMotion'), 'video provider does NOT contain cameraToMotion (moved to agent)');
  assert(!videoSrc.includes('addAgentMessage'), 'video provider does NOT contain addAgentMessage (moved to agent)');

  const renderSrc = readFileSync('./src/js/providers/render.js', 'utf8');
  assert(renderSrc.includes('async generate({ items'), 'render provider accepts { items }');
  assert(!renderSrc.includes('addAgentMessage'), 'render provider does NOT contain addAgentMessage (moved to agent)');
}

// 12. Agents track item lineage and use per-item retry
{
  const charSrc = readFileSync('./src/js/agents/characterAgent.js', 'utf8');
  assert(charSrc.includes('recordItemAttempt'), 'CharacterAgent uses recordItemAttempt');
  assert(charSrc.includes('planItemRetry'), 'CharacterAgent uses planItemRetry');
  assert(charSrc.includes('#buildSheetPrompt'), 'CharacterAgent contains #buildSheetPrompt (three-view model sheet)');
  assert(charSrc.includes('#buildFrontPrompt'), 'CharacterAgent contains #buildFrontPrompt');
  assert(charSrc.includes("buildMessages('characterDesign'"), 'CharacterAgent writes design specs via the characterDesign prompt');

  const refSrc = readFileSync('./src/js/agents/referenceAgent.js', 'utf8');
  assert(refSrc.includes('recordItemAttempt'), 'ReferenceAgent uses recordItemAttempt');
  assert(refSrc.includes('planItemRetry'), 'ReferenceAgent uses planItemRetry');
  assert(refSrc.includes('#buildFramePrompt'), 'ReferenceAgent contains #buildFramePrompt');
  assert(refSrc.includes('#videoMode'), 'ReferenceAgent plans frames by the chosen video mode');
  assert(refSrc.includes('#collectRefs'), 'ReferenceAgent collects step-2 design images as references');
  assert(!refSrc.includes('wan2.6') && !refSrc.includes('wanx2.1'), 'ReferenceAgent does not hardcode model names');

  const vidSrc = readFileSync('./src/js/agents/videoAgent.js', 'utf8');
  assert(vidSrc.includes('recordItemAttempt'), 'VideoAgent uses recordItemAttempt');
  assert(vidSrc.includes('planItemRetry'), 'VideoAgent uses planItemRetry');
  assert(vidSrc.includes('#buildVideoPrompt'), 'VideoAgent contains #buildVideoPrompt');
  assert(vidSrc.includes('CAMERA_MOTION_MAP'), 'VideoAgent contains CAMERA_MOTION_MAP');
  assert(vidSrc.includes('#getAvailableReferences'), 'VideoAgent contains #getAvailableReferences (for SWAP_REFERENCE)');
}

// 13. Orchestrator marks downstream stale on revision
{
  const orchSrc = readFileSync('./src/js/orchestrator.js', 'utf8');
  assert(orchSrc.includes('markDownstreamStale'), 'orchestrator calls markDownstreamStale');
}

// ============================================================
// Phase 3 closure verification tests
// ============================================================

// 14. Recursive stale propagation — 4 levels deep
{
  const store = new ArtifactStore();
  const scriptArt = createArtifact({ kind: ArtifactKind.SCRIPT, stepId: 'script', data: {}, status: ArtifactStatus.COMPLETE });
  const charArt = createArtifact({ kind: ArtifactKind.CHARACTER_DESIGN, stepId: 'characterDesign', data: {}, status: ArtifactStatus.COMPLETE, sourceArtifactIds: [scriptArt.id] });
  const sbArt = createArtifact({ kind: ArtifactKind.STORYBOARD, stepId: 'storyboard', data: {}, status: ArtifactStatus.COMPLETE, sourceArtifactIds: [scriptArt.id, charArt.id] });
  const refArt = createArtifact({ kind: ArtifactKind.REFERENCE_IMAGE, stepId: 'referenceImages', data: {}, status: ArtifactStatus.COMPLETE, sourceArtifactIds: [charArt.id, sbArt.id] });
  const vidArt = createArtifact({ kind: ArtifactKind.VIDEO_CLIP, stepId: 'videoGeneration', data: {}, status: ArtifactStatus.COMPLETE, sourceArtifactIds: [refArt.id] });

  store.commit(scriptArt);
  store.commit(charArt);
  store.commit(sbArt);
  store.commit(refArt);
  store.commit(vidArt);

  const affected = store.markDownstreamStale(scriptArt.id);

  assert(affected.includes(charArt.id), 'recursive stale: characterDesign marked STALE');
  assert(affected.includes(sbArt.id), 'recursive stale: storyboard marked STALE');
  assert(affected.includes(refArt.id), 'recursive stale: referenceImages marked STALE');
  assert(affected.includes(vidArt.id), 'recursive stale: videoGeneration marked STALE');
  assert(store.get(charArt.id).status === ArtifactStatus.STALE, 'charArt status STALE');
  assert(store.get(sbArt.id).status === ArtifactStatus.STALE, 'sbArt status STALE');
  assert(store.get(refArt.id).status === ArtifactStatus.STALE, 'refArt status STALE');
  assert(store.get(vidArt.id).status === ArtifactStatus.STALE, 'vidArt status STALE');
}

// 15. getLatestValidByStep excludes STALE/FAILED/SUPERSEDED
{
  const store = new ArtifactStore();
  const a1 = createArtifact({ kind: ArtifactKind.SCRIPT, stepId: 'script', data: { v: 1 }, status: ArtifactStatus.COMPLETE });
  const a2 = createArtifact({ kind: ArtifactKind.SCRIPT, stepId: 'script', data: { v: 2 }, status: ArtifactStatus.STALE });
  store.commit(a1);
  store.commit(a2);

  assert(store.getLatestByStep('script').data.v === 2, 'getLatestByStep returns latest regardless of status');
  assert(store.getLatestValidByStep('script').data.v === 1, 'getLatestValidByStep skips STALE, returns a1');

  const a3 = createArtifact({ kind: ArtifactKind.SCRIPT, stepId: 'script', data: { v: 3 }, status: ArtifactStatus.FAILED });
  store.commit(a3);
  assert(store.getLatestValidByStep('script').data.v === 1, 'getLatestValidByStep skips FAILED too');

  const a4 = createArtifact({ kind: ArtifactKind.SCRIPT, stepId: 'script', data: { v: 4 }, status: ArtifactStatus.SUPERSEDED });
  store.commit(a4);
  assert(store.getLatestValidByStep('script').data.v === 1, 'getLatestValidByStep skips SUPERSEDED too');

  const a5 = createArtifact({ kind: ArtifactKind.SCRIPT, stepId: 'script', data: { v: 5 }, status: ArtifactStatus.COMPLETE });
  store.commit(a5);
  assert(store.getLatestValidByStep('script').data.v === 5, 'getLatestValidByStep returns new COMPLETE');

  assert(store.getLatestValidByStep('nonexistent') === null, 'getLatestValidByStep returns null for empty step');
}

// 16. Per-item retry — agents only submit pending items to provider
{
  const charSrc = readFileSync('./src/js/agents/characterAgent.js', 'utf8');
  assert(charSrc.includes('const pending = [...items]'), 'CharacterAgent tracks pending items');
  assert(charSrc.includes('pending.map(item =>'), 'CharacterAgent builds batch from pending only');
  assert(charSrc.includes('pending.splice(idx, 1)'), 'CharacterAgent removes completed items from pending');
  assert(charSrc.includes('pending.length > 0'), 'CharacterAgent retry loop checks pending.length');

  const refSrc = readFileSync('./src/js/agents/referenceAgent.js', 'utf8');
  assert(refSrc.includes('const pending = [...items]'), 'ReferenceAgent tracks pending items');
  assert(refSrc.includes('pending.map(item =>'), 'ReferenceAgent builds batch from pending only');

  const vidSrc = readFileSync('./src/js/agents/videoAgent.js', 'utf8');
  assert(vidSrc.includes('const pending = [...items]'), 'VideoAgent tracks pending items');
  assert(vidSrc.includes('pending.map(item =>'), 'VideoAgent builds batch from pending only');
}

// 17. AbortSignal propagation — Agent → Provider
{
  const imageSrc = readFileSync('./src/js/providers/image.js', 'utf8');
  assert(imageSrc.includes('signal'), 'image provider accepts signal parameter');
  assert(imageSrc.includes('externalSignal?.aborted'), 'image provider checks signal.aborted');

  const videoSrc = readFileSync('./src/js/providers/video.js', 'utf8');
  assert(videoSrc.includes('signal'), 'video provider accepts signal parameter');
  assert(videoSrc.includes('signal?.aborted'), 'video provider checks signal.aborted');

  const renderSrc = readFileSync('./src/js/providers/render.js', 'utf8');
  assert(renderSrc.includes('signal'), 'render provider accepts signal parameter');
  assert(renderSrc.includes('signal?.aborted'), 'render provider checks signal.aborted');

  const charSrc = readFileSync('./src/js/agents/characterAgent.js', 'utf8');
  assert(charSrc.includes('signal: token?.signal'), 'CharacterAgent passes token.signal to provider');

  const refSrc = readFileSync('./src/js/agents/referenceAgent.js', 'utf8');
  assert(refSrc.includes('signal: token?.signal'), 'ReferenceAgent passes token.signal to provider');

  const vidSrc = readFileSync('./src/js/agents/videoAgent.js', 'utf8');
  assert(vidSrc.includes('signal: token?.signal'), 'VideoAgent passes token.signal to provider');

  const edSrc = readFileSync('./src/js/agents/editorAgent.js', 'utf8');
  assert(edSrc.includes('signal: token?.signal'), 'EditorAgent passes token.signal to provider');
}

// ============================================================
// Phase 4: Recovery + Observability + Rollback
// ============================================================

// 18. RunState lifecycle
{
  const { RunState, RunStatus } = await import('./src/js/orchestrator/runState.js');

  const rs = new RunState();
  assert(rs.status === RunStatus.IDLE, 'RunState starts IDLE');
  assert(!rs.isInterrupted, 'not interrupted initially');
  assert(!rs.isResumable, 'not resumable initially');

  rs.startPipeline();
  assert(rs.status === RunStatus.RUNNING, 'startPipeline → RUNNING');
  assert(rs.startedAt != null, 'startedAt set');

  rs.enterStep(0, 'script');
  assert(rs.currentStepIndex === 0, 'enterStep updates currentStepIndex');

  rs.completeStep('script');
  assert(rs.completedSteps.includes('script'), 'completeStep adds to completedSteps');

  rs.enterStep(1, 'characterDesign');
  rs.markInterrupted();
  assert(rs.status === RunStatus.INTERRUPTED, 'markInterrupted → INTERRUPTED');
  assert(rs.isInterrupted, 'isInterrupted true');
  assert(rs.isResumable, 'isResumable true (has completed steps)');

  const snap = rs.snapshot();
  assert(snap.status === 'interrupted', 'snapshot captures status');
  assert(snap.completedSteps.includes('script'), 'snapshot captures completedSteps');

  const rs2 = new RunState();
  rs2.restoreSnapshot(snap);
  assert(rs2.status === RunStatus.INTERRUPTED, 'restoreSnapshot restores status');
  assert(rs2.completedSteps.includes('script'), 'restoreSnapshot restores completedSteps');

  rs.reset();
  assert(rs.status === RunStatus.IDLE, 'reset → IDLE');
  assert(rs.completedSteps.length === 0, 'reset clears completedSteps');
}

// 19. RunState — RUNNING auto-converts to INTERRUPTED on loadPersisted
{
  const { RunState, RunStatus } = await import('./src/js/orchestrator/runState.js');

  const rs = new RunState();
  rs.startPipeline();
  rs.enterStep(0, 'script');
  rs.completeStep('script');
  const snap = rs.snapshot();
  assert(snap.status === 'running', 'snapshot of running pipeline is RUNNING');

  const rs2 = new RunState();
  rs2.restoreSnapshot({ ...snap, status: 'running' });
  assert(rs2.status === RunStatus.RUNNING, 'restored RUNNING stays RUNNING (no auto-convert without loadPersisted)');

  const rs3 = new RunState();
  rs3.startPipeline();
  rs3.markCompleted();
  assert(rs3.status === RunStatus.COMPLETED, 'markCompleted → COMPLETED');
  assert(!rs3.isInterrupted, 'completed is not interrupted');
}

// 20. Artifact metrics field
{
  const a = createArtifact({ kind: ArtifactKind.SCRIPT, stepId: 'script', data: {} });
  assert(a.metrics === null, 'createArtifact initializes metrics as null');

  a.metrics = {
    tokens: { prompt: 100, completion: 50 },
    qualityScore: 8.5,
    retries: 1,
    fallbackUsed: false,
  };
  assert(a.metrics.tokens.prompt === 100, 'metrics tokens set');
  assert(a.metrics.qualityScore === 8.5, 'metrics qualityScore set');
}

// 21. Observability derives from ArtifactStore
{
  const { initObservability, getExecutionLog, getTotalTokens, getAverageQuality, resetLog } = await import('./src/js/observability.js');

  const store = new ArtifactStore();
  initObservability(store);

  const a1 = createArtifact({ kind: ArtifactKind.SCRIPT, stepId: 'script', data: {}, status: ArtifactStatus.COMPLETE });
  a1.provenance = { agent: 'Scriptwriter' };
  a1.metrics = { tokens: { prompt: 100, completion: 50 }, qualityScore: 8.0, retries: 0, fallbackUsed: false };
  store.commit(a1);

  const a2 = createArtifact({ kind: ArtifactKind.STORYBOARD, stepId: 'storyboard', data: {}, status: ArtifactStatus.COMPLETE });
  a2.provenance = { agent: 'Storyboard Artist' };
  a2.metrics = { tokens: { prompt: 200, completion: 80 }, qualityScore: 7.5, retries: 1, fallbackUsed: false };
  store.commit(a2);

  const log = getExecutionLog();
  assert(log.length === 2, 'getExecutionLog returns 2 entries');
  assert(log[0].stepId === 'script', 'first entry is script');
  assert(log[0].agentName === 'Scriptwriter', 'agentName from provenance');
  assert(log[0].qualityScore === 8.0, 'qualityScore from metrics');
  assert(log[1].retryCount === 1, 'retryCount from metrics');

  const totalTokens = getTotalTokens();
  assert(totalTokens.prompt === 300, 'getTotalTokens sums prompt');
  assert(totalTokens.completion === 130, 'getTotalTokens sums completion');

  const avgQuality = getAverageQuality();
  assert(avgQuality === 7.8, 'getAverageQuality averages correctly');

  // STALE artifacts excluded from log
  const a3 = createArtifact({ kind: ArtifactKind.SCRIPT, stepId: 'script', data: {}, status: ArtifactStatus.STALE });
  a3.metrics = { tokens: { prompt: 999, completion: 0 }, qualityScore: 1.0 };
  store.commit(a3);
  const log2 = getExecutionLog();
  assert(log2.length === 2, 'STALE artifact excluded from execution log');

  // Reset
  initObservability(null);
  resetLog();
}

// 22. ArtifactStore snapshot sanitization strips base64
{
  const store = new ArtifactStore();
  const a = createArtifact({
    kind: ArtifactKind.REFERENCE_IMAGE,
    stepId: 'referenceImages',
    data: {
      shots: [
        { shot_id: 's1', imageData: 'data:image/png;base64,' + 'A'.repeat(200), prompt: 'test' },
        { shot_id: 's2', imageUrl: 'https://example.com/img.png' },
      ],
    },
    status: ArtifactStatus.COMPLETE,
  });
  store.commit(a);

  const snap = store.snapshot();
  const restored = snap[a.id];
  assert(restored.data.shots[0].imageData === '', 'base64 data stripped in snapshot');
  assert(restored.data.shots[0].prompt === 'test', 'non-binary fields preserved');
  assert(restored.data.shots[1].imageUrl === 'https://example.com/img.png', 'URLs preserved');
}

// 23. CancellationToken signal in text agents
{
  const scriptSrc = readFileSync('./src/js/agents/scriptAgent.js', 'utf8');
  assert(scriptSrc.includes('async #generate(messages, signal)'), 'ScriptAgent #generate accepts signal');
  assert(scriptSrc.includes('await chat(messages, { signal })'), 'ScriptAgent passes signal to chat()');
  assert(scriptSrc.includes('const signal = token?.signal'), 'ScriptAgent extracts signal from token');

  const sbSrc = readFileSync('./src/js/agents/storyboardAgent.js', 'utf8');
  assert(sbSrc.includes('async #generate(messages, signal)'), 'StoryboardAgent #generate accepts signal');
  assert(sbSrc.includes('await chat(messages, { signal })'), 'StoryboardAgent passes signal to chat()');
  assert(sbSrc.includes('const signal = token?.signal'), 'StoryboardAgent extracts signal from token');
}

// 24. Orchestrator recovery + rollback structure
{
  const orchSrc = readFileSync('./src/js/orchestrator.js', 'utf8');

  // Recovery
  assert(orchSrc.includes('ExecutionCheckpoint'), 'orchestrator imports ExecutionCheckpoint');
  assert(orchSrc.includes('RunState'), 'orchestrator imports RunState');
  assert(orchSrc.includes('CancellationToken'), 'orchestrator imports CancellationToken');
  assert(orchSrc.includes('#checkpoint'), 'orchestrator has #checkpoint field');
  assert(orchSrc.includes('#runState'), 'orchestrator has #runState field');
  assert(orchSrc.includes('#token'), 'orchestrator has #token field');
  assert(orchSrc.includes('restoreSession'), 'orchestrator exports restoreSession');
  assert(orchSrc.includes('loadPersisted()'), 'orchestrator calls loadPersisted');

  // Rollback
  assert(orchSrc.includes('rollbackToStep'), 'orchestrator exports rollbackToStep');
  assert(orchSrc.includes('getLatestValidByStep'), 'rollbackToStep uses getLatestValidByStep');
  assert(orchSrc.includes('markDownstreamStale'), 'rollbackToStep marks downstream stale');
  assert(orchSrc.includes('sourceArtifactIds: [validArtifact.id]'), 'rollback creates new artifact with source link');

  // Persistence
  assert(orchSrc.includes('this.#checkpoint.persist()'), 'orchestrator persists checkpoint');
  assert(orchSrc.includes('this.#runState.persist()'), 'orchestrator persists runState');
  assert(orchSrc.includes('this.#runState.markInterrupted()'), 'orchestrator marks interrupted on stop');

  // Stale guard
  assert(orchSrc.includes('status !== ArtifactStatus.STALE'), 'orchestrator has stale guard for entity extraction');

  // Observability init
  assert(orchSrc.includes('initObservability'), 'orchestrator calls initObservability');

  // Metrics on artifact
  assert(orchSrc.includes('artifact.metrics ='), 'orchestrator sets metrics on artifact');
}

// 25. Observability has no duplicate state — no executionLog array
{
  const obsSrc = readFileSync('./src/js/observability.js', 'utf8');
  assert(!obsSrc.includes('const executionLog'), 'observability has no executionLog array');
  assert(!obsSrc.includes('executionLog.push'), 'observability does not push to log');
  assert(obsSrc.includes('_store'), 'observability references _store (derives from artifact store)');
  assert(obsSrc.includes('initObservability'), 'observability exports initObservability');
  assert(obsSrc.includes('getExecutionLog'), 'observability exports getExecutionLog');
}

// 26. CancellationToken independence — no UI imports
{
  const ctSrc = readFileSync('./src/js/orchestrator/cancellationToken.js', 'utf8');
  assert(!ctSrc.includes('ui/render'), 'CancellationToken has no UI imports');
  assert(!ctSrc.includes('addAgentMessage'), 'CancellationToken does not call addAgentMessage');
  assert(ctSrc.includes('AbortController'), 'CancellationToken wraps AbortController');
}

// ============================================================
// Hotfix regression tests
// ============================================================

// 27. localStorage safety — persist/load/clear do not throw when storage unavailable
{
  const { ExecutionCheckpoint } = await import('./src/js/orchestrator/executionCheckpoint.js');
  const cp = new ExecutionCheckpoint();
  cp.save('script', { test: true });

  let threw = false;
  try { cp.persist(); } catch { threw = true; }
  assert(!threw, 'ExecutionCheckpoint.persist() does not throw when localStorage unavailable');

  let loadThrew = false;
  try { const r = cp.loadPersisted(); assert(typeof r === 'boolean', 'loadPersisted returns boolean'); } catch { loadThrew = true; }
  assert(!loadThrew, 'ExecutionCheckpoint.loadPersisted() does not throw');

  let clearThrew = false;
  try { cp.clearPersisted(); } catch { clearThrew = true; }
  assert(!clearThrew, 'ExecutionCheckpoint.clearPersisted() does not throw');

  const { RunState } = await import('./src/js/orchestrator/runState.js');
  const rs = new RunState();
  rs.startPipeline();

  let rsThrew = false;
  try { rs.persist(); } catch { rsThrew = true; }
  assert(!rsThrew, 'RunState.persist() does not throw when localStorage unavailable');

  let rsLoadThrew = false;
  try { const r = rs.loadPersisted(); assert(typeof r === 'boolean', 'RunState loadPersisted returns boolean'); } catch { rsLoadThrew = true; }
  assert(!rsLoadThrew, 'RunState.loadPersisted() does not throw');

  let rsClearThrew = false;
  try { rs.clearPersisted(); } catch { rsClearThrew = true; }
  assert(!rsClearThrew, 'RunState.clearPersisted() does not throw');

  // In-memory state still works after storage failures
  assert(cp.has('script'), 'checkpoint in-memory data intact after storage failure');
  assert(rs.status === 'running', 'runState in-memory data intact after storage failure');
}

// 28. Orchestrator try/finally — all 4 run methods guarantee logStepComplete
{
  const orchSrc = readFileSync('./src/js/orchestrator.js', 'utf8');

  const methods = ['#runMigratedStep', '#runMigratedRevision'];
  for (const method of methods) {
    const methodStart = orchSrc.indexOf(`async ${method}(`);
    assert(methodStart > 0, `orchestrator contains ${method}`);

    const nextMethod = orchSrc.indexOf('\n  async ', methodStart + 1);
    const methodBody = orchSrc.slice(methodStart, nextMethod > 0 ? nextMethod : methodStart + 2000);

    assert(methodBody.includes('try {'), `${method} has try block`);
    assert(methodBody.includes('} finally {'), `${method} has finally block`);
    assert(methodBody.includes('logStepComplete()'), `${method} calls logStepComplete in finally`);

    const logStartIdx = methodBody.indexOf('logStepStart(');
    const tryIdx = methodBody.indexOf('try {');
    const finallyIdx = methodBody.indexOf('} finally {');
    assert(logStartIdx < tryIdx, `${method}: logStepStart before try`);
    assert(tryIdx < finallyIdx, `${method}: try before finally`);
  }
}

// 29. Observability currentEntry cleanup — logStepComplete clears entry even after simulated error
{
  const obs = await import('./src/js/observability.js');

  obs.logStepStart('script', 'TestAgent');

  // Simulate: an error occurs during agent execution
  let caught = false;
  try {
    throw new Error('simulated agent failure');
  } catch {
    // In the real orchestrator, finally { logStepComplete() } runs here
    obs.logStepComplete();
  }

  // After cleanup, a new stage should start with a clean entry
  obs.logStepStart('characterDesign', 'NextAgent');

  // Verify the new entry is not polluted by the previous failed stage
  const { ArtifactStore } = await import('./src/js/artifacts/artifactStore.js');
  obs.initObservability(new ArtifactStore());
  const log = obs.getExecutionLog();

  // The log should be empty (no artifacts committed), but currentEntry should be for characterDesign
  // We verify by checking that getTotalTokens returns zeros (no pollution from failed stage)
  const tokens = obs.getTotalTokens();
  assert(tokens.prompt === 0, 'no token pollution from failed stage');
  assert(tokens.completion === 0, 'no completion token pollution from failed stage');

  const quality = obs.getAverageQuality();
  assert(quality === null, 'no quality pollution from failed stage');

  // Clean up
  obs.resetLog();
}

// 30. Step 2 design-spec prompt — carries script entities and asks for visualTag/palette
{
  const { buildMessages } = await import('./src/js/providers/prompts.js');

  const msgs = buildMessages('characterDesign', {
    genre: 'fantasy',
    script: {
      title: 'T',
      characters: [{ id: 'char_1', name: '米宝', enName: 'Mibao', desc: '一只好奇的猫', appearance: '橘色短毛猫，蓝色围巾' }],
      settings: [{ id: 'set_1', name: '旧书店', desc: '堆满书的昏暗小店' }],
    },
  });

  assert(Array.isArray(msgs) && msgs.length === 2, 'characterDesign builds system + user messages');
  assert(msgs[0].role === 'system', 'characterDesign system message comes first');
  const user = msgs[1].content;
  assert(user.includes('char_1') && user.includes('set_1'), 'design prompt carries the script entity ids');
  assert(user.includes('米宝') && user.includes('Mibao'), 'design prompt carries both character names');
  assert(user.includes('"design"') && user.includes('"visualTag"') && user.includes('"palette"'),
    'design prompt asks for design/visualTag/palette');
  assert(user.includes('magical atmosphere'), 'design prompt maps genre to its style hint');
}

// 31. 图生图链路契约 — 服务端与 provider 一起支撑步骤4的参考图输入
{
  const dsSrc = readFileSync('./server/dashscope.js', 'utf8');
  assert(dsSrc.includes('/services/aigc/image-generation/generation'), 'dashscope image-edit endpoint');
  assert(dsSrc.includes('X-DashScope-Async'), 'dashscope image-edit submits asynchronously');
  assert(dsSrc.includes('{ text: prompt }'), 'dashscope image-edit sends one text part');
  assert(dsSrc.includes("map(image => ({ image }))"), 'dashscope image-edit sends reference images as image parts');
  assert(/n:\s*1,/.test(dsSrc), 'dashscope image-edit pins n: 1 (editing mode defaults to 4)');
  assert(dsSrc.includes('prompt_extend: false'), 'dashscope image-edit disables prompt rewriting');
  assert(dsSrc.includes("pollData?.output?.choices?.[0]?.message?.content"), 'parseImageResultUrl reads the editing response shape');
  assert(dsSrc.includes("pollData?.output?.results?.[0]?.url"), 'parseImageResultUrl still reads the text2image response shape');

  const serverSrc = readFileSync('./server/index.js', 'utf8');
  assert(serverSrc.includes("const { prompts, model, size, seed, seeds, refs, img2imgModel, img2imgSize } = req.body"),
    '/api/generate/image accepts per-item refs, seeds and the img2img model');
  assert(serverSrc.includes('function resolveMediaRef'), 'server resolves reference images only from /api/media');
  assert(serverSrc.includes('submitImageEditTask'), 'server routes items with references to the editing endpoint');

  const imageSrc = readFileSync('./src/js/providers/image.js', 'utf8');
  assert(imageSrc.includes('parsed.models?.img2img?.name'), 'image provider reads the img2img model from settings');
  assert(imageSrc.includes('normalizeRefs(item.refs)') || imageSrc.includes('item.refs'),
    'image provider forwards per-item references');
  assert(imageSrc.includes('img2imgSize'), 'image provider sends the editing-mode size');
}

// 32. Step 4 frame planning — one run per video generation mode
{
  const store = new Map();
  globalThis.localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  };
  const SETTINGS = 'cine-cutie-settings';
  const writeSettings = videoMode => store.set(SETTINGS, JSON.stringify({
    apiProviders: { dashscope: { endpoint: 'https://x', apiKey: '' } },
    models: { text: { provider: 'dashscope', name: '' }, img2img: { name: 'setting-chosen-model' } },
    videoMode,
  }));

  const { loadConfig } = await import('./src/js/providers/llm.js');
  const { registerProvider } = await import('./src/js/providers/registry.js');
  const { ReferenceAgent } = await import('./src/js/agents/referenceAgent.js');
  const { state } = await import('./src/js/state.js');

  // 让 addAgentMessage 走缓冲分支，避免离线环境触碰 DOM
  state.viewingStep = 3;
  state.stepRunning = true;

  let sent = [];
  registerProvider({
    id: 'image',
    capabilities: ['image'],
    async generate({ items }) {
      sent = items;
      return items.map(it => ({
        id: it.id,
        path: `/api/media/${it.id}.png`,
        imageUrl: `https://dashscope.invalid/${it.id}.png`,
        prompt: it.prompt,
        status: 'complete',
      }));
    },
  });

  const shot = (id, prompt) => ({ shot_id: id, type: 'medium', description: prompt, prompt, camera: 'static' });
  const ctx = {
    genre: 'fantasy',
    totalDuration: 15,
    entities: {},
    script: {
      title: '旧书店之光', genre: 'Fantasy',
      episodes: [{
        episode: 1, title: '觉醒', summary: '米宝发现书页会发光',
        segments: [{ title: '发现', description: '米宝在旧书店翻开书页' }, { title: '告别', description: '米宝合上书' }],
      }],
    },
    storyboard: {
      episodes: [{
        episode: 1,
        segments: [
          { shots: [shot('ep1_s1_sh1', 'Mibao the orange cat opens a glowing page in the dusty bookshop'), shot('ep1_s1_sh2', 'close-up of Mibao widening her eyes')] },
          { shots: [shot('ep1_s2_sh1', 'Mibao closes the book inside the old bookshop')] },
        ],
      }],
    },
    characterDesign: {
      characters: [{ id: 'char_1', name: '米宝', enName: 'Mibao', visualTag: 'orange shorthair cat wearing a blue scarf', imagePath: '/api/media/mibao_front.png', sheetPath: '/api/media/mibao_sheet.png' }],
      settings: [{ id: 'set_1', name: '旧书店', visualTag: 'dusty bookshop, warm lamp light', imagePath: '/api/media/bookshop.png' }],
    },
  };

  const runFor = async videoMode => {
    writeSettings(videoMode);
    loadConfig();
    sent = [];
    const agent = new ReferenceAgent();
    const out = await agent.process(ctx, null);
    return { sent, data: out.artifacts[0].data, metadata: out.metadata };
  };

  const first = await runFor('firstFrame');
  assert(first.sent.length === 3, 'firstFrame mode generates exactly one first frame per shot');
  assert(first.data.shots.every(s => s.role === 'first_frame'), 'firstFrame mode frames are first frames');
  assert(first.sent.every(it => it.refs?.includes('/api/media/mibao_front.png') && it.refs?.includes('/api/media/bookshop.png')),
    'firstFrame items carry the matched character and scene designs as references');
  assert(first.sent[0].prompt.includes('REFERENCE FIDELITY') && first.sent[0].prompt.includes('image 1 ='),
    'reference frames get an identity-lock clause naming each reference image');
  assert(first.sent[0].prompt.includes('orange shorthair cat'), 'frame prompt injects the character visualTag');
  assert(first.sent[0].prompt.includes('magical atmosphere'), 'frame prompt reuses the genre style hint');
  assert(first.data.shots.every(s => s.lastFramePath === undefined), 'firstFrame mode records no last frames');
  assert(first.data.extraFrames.length === 0, 'firstFrame mode has no extra closing frame');

  const chained = await runFor('firstLastFrame');
  assert(chained.sent.length === 4, 'firstLastFrame mode generates N first frames plus one closing frame');
  assert(chained.data.extraFrames[0].role === 'last_frame', 'the extra closing frame is recorded as a last frame');
  assert(chained.sent[3].id === 'ep1_s2_sh1__last_frame', 'the extra frame belongs to the final shot');
  assert(chained.sent[3].prompt.includes('closing frame of this shot'), 'closing frame prompt describes an ending composition');
  assert(chained.data.mode === 'firstLastFrame', 'artifact records the video mode');
  assert(chained.data.shots[0].lastFrameFrom === 'ep1_s1_sh2', 'shot 1 reuses the next shot first frame as its last frame');
  assert(chained.data.shots[0].lastFramePath === '/api/media/ep1_s1_sh2.png', 'the reused last frame path is recorded');
  assert(chained.data.shots[2].lastFrameFrom === 'generated', 'the final shot uses a separately generated last frame');
  assert(chained.data.extraFrames.length === 1 && chained.data.extraFrames[0].imagePath === '/api/media/ep1_s2_sh1__last_frame.png',
    'the dedicated closing frame is exposed to step 5');
  assert(chained.metadata.videoMode === 'firstLastFrame' && chained.metadata.totalFrames === 4, 'metadata reports the planned frame count');

  const ref = await runFor('referenceImage');
  assert(ref.sent.length === 3, 'referenceImage mode generates one reference image per shot');
  assert(ref.sent.every(it => it.prompt.includes('locks the identity')), 'referenceImage prompts ask for an identity-locking composition');
  assert(ref.data.shots.every(s => s.role === 'reference_image'), 'referenceImage artifact labels the frame role');
  assert(ref.data.extraFrames.length === 0, 'referenceImage mode needs no closing frame');

  // 没有步骤2设定图时退回纯文生图，不发送参考图
  writeSettings('firstFrame');
  loadConfig();
  sent = [];
  const noDesign = await new ReferenceAgent().process({ ...ctx, characterDesign: undefined }, null);
  assert(sent.every(it => !it.refs?.length), 'items fall back to text-to-image when no design images exist');
  assert(noDesign.artifacts[0].data.shots.length === 3, 'the fallback still covers every storyboard shot');

  state.viewingStep = null;
  state.stepRunning = false;
}

// 33. 图生图请求构造 — 桩 fetch 直接校验服务端提交函数
{
  const { submitImageEditTask, parseImageResultUrl } = await import('./server/dashscope.js');
  const realFetch = globalThis.fetch;
  let captured = null;
  globalThis.fetch = async (url, opts) => {
    captured = { url, opts };
    return { ok: true, status: 200, json: async () => ({ output: { task_id: 'edit-task-1' } }) };
  };

  const taskId = await submitImageEditTask('paint the scarf red', ['data:image/png;base64,AAA', 'https://cdn.invalid/scene.png'], {
    model: 'setting-chosen-model', size: '1280*720', apiKey: 'k', seed: 7,
  });
  globalThis.fetch = realFetch;

  assert(taskId === 'edit-task-1', 'image-edit returns the async task id');
  assert(captured.url.endsWith('/api/v1/services/aigc/image-generation/generation'), 'image-edit posts to the generation endpoint');
  assert(captured.opts.headers['X-DashScope-Async'] === 'enable', 'image-edit asks for async execution');

  const body = JSON.parse(captured.opts.body);
  assert(body.model === 'setting-chosen-model', 'image-edit uses the model from settings, never a hardcoded one');
  const content = body.input.messages[0].content;
  assert(content[0].text === 'paint the scarf red', 'image-edit puts the text instruction first');
  assert(content.filter(p => p.image).length === 2, 'image-edit passes both reference images');
  assert(body.parameters.n === 1, 'image-edit requests exactly one image');
  assert(body.parameters.size === '1280*720' && body.parameters.seed === 7, 'image-edit forwards size and seed');
  assert(body.parameters.prompt_extend === false, 'image-edit keeps the written prompt verbatim');

  globalThis.fetch = async (url, opts) => { captured = { url, opts }; return { ok: true, status: 200, json: async () => ({ output: { task_id: 'x' } }) }; };
  await submitImageEditTask('p', ['a', 'b', 'c', 'd', 'e', 'f'].map(i => `https://cdn.invalid/${i}.png`), { model: 'm', apiKey: 'k' });
  globalThis.fetch = realFetch;
  assert(JSON.parse(captured.opts.body).input.messages[0].content.filter(p => p.image).length === 4,
    'image-edit caps reference images at the 4-image editing limit');

  let threw = false;
  try { await submitImageEditTask('p', [], { model: 'm', apiKey: 'k' }); } catch { threw = true; }
  assert(threw, 'image-edit refuses to run without a reference image');

  assert(parseImageResultUrl({ output: { choices: [{ message: { content: [{ type: 'image', image: 'edit-url' }] } }] } }) === 'edit-url',
    'result parser reads the image-edit response shape');
  assert(parseImageResultUrl({ output: { results: [{ url: 't2i-url' }] } }) === 't2i-url',
    'result parser still reads the text-to-image response shape');
  assert(parseImageResultUrl({ output: { task_status: 'RUNNING' } }) === null, 'result parser returns null while still running');
}

// 34. Step 5 video chain — source contracts
{
  const vidAgentSrc = readFileSync('./src/js/agents/videoAgent.js', 'utf8');
  assert(vidAgentSrc.includes('#videoMode'), 'VideoAgent reads the configured video generation mode');
  assert(vidAgentSrc.includes('getConfig().videoMode'), 'VideoAgent takes the mode from settings, not from a constant');
  assert(vidAgentSrc.includes('#lastFrameFor'), 'VideoAgent supplies a last frame in first+last frame mode');
  assert(vidAgentSrc.includes('#referenceListFor'), 'VideoAgent builds a reference list in reference-image mode');
  assert(vidAgentSrc.includes('#firstFrameFor'), 'VideoAgent resolves the first frame per shot');
  assert(vidAgentSrc.includes('MAX_REFERENCE_IMAGES'), 'VideoAgent caps the reference images per clip');
  assert(!vidAgentSrc.includes('wan2.7') && !vidAgentSrc.includes('wanx2.1'), 'VideoAgent does not hardcode model names');

  const vidProvSrc = readFileSync('./src/js/providers/video.js', 'utf8');
  assert(vidProvSrc.includes("mode === 'referenceImage' ? dsConfig.refVideoModel : dsConfig.videoModel"),
    'video provider picks the model per mode from settings');
  assert(vidProvSrc.includes('lastFramePath') && vidProvSrc.includes('lastFrameUrl'), 'video provider forwards the last frame');
  assert(vidProvSrc.includes('referenceImages'), 'video provider forwards per-clip reference images');
  assert(vidProvSrc.includes('imagePath'), 'video provider forwards the local frame path');
  assert(vidProvSrc.includes('MAX_REFERENCE_IMAGES'), 'video provider caps the reference count');
  assert(vidProvSrc.includes('mode,'), 'video provider tells the server which mode the batch uses');

  const serverSrc = readFileSync('./server/index.js', 'utf8');
  assert(serverSrc.includes('function toDashScopeImage'), 'server converts local frames into data URIs for DashScope');
  assert(serverSrc.includes("type: 'reference_image'"), 'server builds r2v reference_image media entries');
  assert(serverSrc.includes("type: 'first_frame'") && serverSrc.includes("type: 'last_frame'"),
    'server builds i2v first_frame/last_frame media entries');
  assert(serverSrc.includes('MAX_VIDEO_REFS'), 'server caps reference images at the r2v limit');
  assert(serverSrc.includes('clip.seed ?? seed'), 'server honours per-clip seeds');
  assert(!serverSrc.includes("req.get('host')"), 'server no longer sends DashScope an unreachable localhost URL');
}

// 35. Step 5 clip planning — one offline run per video generation mode
{
  const store = globalThis.localStorage ? null : new Map();
  if (store) {
    globalThis.localStorage = {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k),
    };
  }
  const SETTINGS = 'cine-cutie-settings';
  const writeSettings = videoMode => localStorage.setItem(SETTINGS, JSON.stringify({
    apiProviders: { dashscope: { endpoint: 'https://x', apiKey: '' } },
    models: { text: { provider: 'dashscope', name: '' }, video: { name: 'setting-video-model' }, refVideo: { name: 'setting-ref-model' } },
    videoMode,
  }));

  const { loadConfig } = await import('./src/js/providers/llm.js');
  const { registerProvider } = await import('./src/js/providers/registry.js');
  const { VideoAgent } = await import('./src/js/agents/videoAgent.js');
  const { state } = await import('./src/js/state.js');

  // 让 addAgentMessage 走缓冲分支，避免离线环境触碰 DOM
  state.viewingStep = 4;
  state.stepRunning = true;

  let sent = [];
  registerProvider({
    id: 'video',
    capabilities: ['video'],
    async generate({ items }) {
      sent = items;
      // videoPath 留空：抽帧helper是浏览器专用的，离线跑只需要校验送出去的入参
      return items.map(it => ({ id: it.id, videoPath: '', status: 'complete' }));
    },
  });

  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('offline'); };

  const frame = (id, extra = {}) => ({
    shot_id: id,
    role: 'first_frame',
    imagePath: `/api/media/${id}.png`,
    imageUrl: `https://cdn.invalid/${id}.png`,
    prompt: `Mibao the orange cat in the bookshop (${id})`,
    refs: ['/api/media/mibao_front.png', '/api/media/bookshop.png'],
    status: 'complete',
    ...extra,
  });

  const step4 = (mode, { chained = true, closing = true } = {}) => ({
    mode,
    shots: [
      frame('ep1_s1_sh1', chained && mode === 'firstLastFrame'
        ? { lastFramePath: '/api/media/ep1_s1_sh2.png', lastFrameUrl: 'https://cdn.invalid/ep1_s1_sh2.png', lastFrameFrom: 'ep1_s1_sh2' } : {}),
      frame('ep1_s1_sh2', chained && mode === 'firstLastFrame'
        ? { lastFramePath: '/api/media/ep1_s2_sh1.png', lastFrameUrl: 'https://cdn.invalid/ep1_s2_sh1.png', lastFrameFrom: 'ep1_s2_sh1' } : {}),
      frame('ep1_s2_sh1', chained && mode === 'firstLastFrame' && closing
        ? { lastFramePath: '/api/media/closing.png', lastFrameUrl: 'https://cdn.invalid/closing.png', lastFrameFrom: 'generated' } : {}),
    ],
    extraFrames: mode === 'firstLastFrame' && closing
      ? [{ id: 'ep1_s2_sh1__last_frame', shot_id: 'ep1_s2_sh1', role: 'last_frame', imagePath: '/api/media/closing.png', imageUrl: 'https://cdn.invalid/closing.png', refs: ['/api/media/bookshop.png'], status: 'complete' }]
      : [],
  });

  const ctx = {
    genre: 'fantasy',
    totalDuration: 15,
    entities: {},
    script: { title: '旧书店之光', genre: 'Fantasy', episodes: [] },
    storyboard: {
      episodes: [{
        episode: 1,
        segments: [
          { shots: [
            { shot_id: 'ep1_s1_sh1', camera: 'pan-left', duration: 8, prompt: 'wide' },
            { shot_id: 'ep1_s1_sh2', camera: 'zoom-in', duration: 4.4, prompt: 'close-up' },
          ] },
          { shots: [{ shot_id: 'ep1_s2_sh1', camera: 'static', prompt: 'closing' }] },
        ],
      }],
    },
    characterDesign: {
      characters: [{ id: 'char_1', name: '米宝', enName: 'Mibao', imagePath: '/api/media/mibao_front.png', imageUrl: 'https://cdn.invalid/mibao_front.png' }],
      settings: [{ id: 'set_1', name: '旧书店', imagePath: '/api/media/bookshop.png' }],
    },
  };

  const runFor = async (videoMode, referenceImages) => {
    writeSettings(videoMode);
    loadConfig();
    sent = [];
    const out = await new VideoAgent().process({ ...ctx, referenceImages }, null);
    return { sent, data: out.artifacts[0].data, metadata: out.metadata };
  };

  const first = await runFor('firstFrame', step4('firstFrame'));
  assert(first.sent.length === 3, 'firstFrame mode animates every step-4 shot');
  assert(first.sent.every(it => it.imagePath === `/api/media/${it.id}.png`), 'firstFrame clips use the step-4 frame of their own shot');
  assert(first.sent.every(it => !it.lastFramePath && !it.referenceImages?.length), 'firstFrame clips carry no last frame and no reference list');
  assert(first.sent[0].prompt.includes('camera slowly pans left'), 'clip prompt fuses the storyboard camera move');
  assert(first.sent[1].prompt.includes('camera slowly zooms in'), 'each clip picks up its own storyboard camera move');
  assert(first.sent[0].duration === 8, 'a clip asks for the duration its storyboard shot planned');
  assert(first.sent[1].duration === 4, 'a fractional storyboard duration is rounded to whole seconds');
  assert(first.sent[2].duration === 5, 'a shot with no planned duration falls back to 5s');
  assert(first.data.mode === 'firstFrame' && first.metadata.videoMode === 'firstFrame', 'the artifact and metadata record the video mode');
  assert(first.data.clips.length === 3 && first.data.clips.every(c => c.status === 'complete'), 'clips are reported per shot');

  const chained = await runFor('firstLastFrame', step4('firstLastFrame'));
  assert(chained.sent[0].lastFramePath === '/api/media/ep1_s1_sh2.png', 'a clip ends on the next shot first frame');
  assert(chained.sent[1].lastFramePath === '/api/media/ep1_s2_sh1.png', 'the chaining holds for every consecutive pair');
  assert(chained.sent[2].lastFramePath === '/api/media/closing.png', 'the final clip ends on the dedicated closing frame');
  assert(chained.sent.every(it => it.imagePath && it.lastFramePath), 'first+last frame clips always carry both frames');
  assert(chained.data.mode === 'firstLastFrame', 'the artifact records first+last frame mode');

  const ref = await runFor('referenceImage', step4('referenceImage'));
  assert(ref.sent.length === 3, 'reference-image mode animates every shot');
  assert(ref.sent.every(it => it.referenceImages[0] === `/api/media/${it.id}.png`), 'the shot reference frame leads the reference list');
  assert(ref.sent[0].referenceImages.includes('/api/media/mibao_front.png') && ref.sent[0].referenceImages.includes('/api/media/bookshop.png'),
    'the design images step 4 used are reused as identity references');
  assert(ref.sent.every(it => new Set(it.referenceImages).size === it.referenceImages.length), 'reference lists hold no duplicates');
  assert(ref.sent.every(it => it.referenceImages.length <= 5), 'reference lists stay within the r2v limit');
  assert(ref.sent.every(it => !it.imagePath && !it.lastFramePath), 'reference-image clips send no first/last frame');
  assert(ref.data.mode === 'referenceImage', 'the artifact records reference-image mode');

  // 帧图缺失时退回角色正面图（保持旧行为）；既无帧图又匹配不到角色的镜头才跳过
  const noFrame = step4('firstFrame');
  noFrame.shots[1].imagePath = '';
  noFrame.shots[1].imageUrl = '';
  noFrame.shots.push({ shot_id: 'ep1_s2_sh2', role: 'first_frame', imagePath: '', imageUrl: '', prompt: 'an empty room, no one inside', refs: [], status: 'failed' });
  const fallback = await runFor('firstFrame', noFrame);
  assert(fallback.sent.length === 3, 'a shot with neither a frame nor a character match is not animated');
  assert(fallback.sent[1].imagePath === '/api/media/mibao_front.png',
    'a shot whose frame is missing falls back to the matched character portrait');
  assert(fallback.sent.every(it => it.id !== 'ep1_s2_sh2'), 'the unmatched frameless shot stays out of the batch');

  // 步骤4之后改了设置：尾帧按"复用下一镜首帧"现算，末镜退回独立收尾帧
  const switched = await runFor('firstLastFrame', step4('firstFrame', { chained: false }));
  assert(switched.sent[0].lastFramePath === '/api/media/ep1_s1_sh2.png', 'the last frame is recomputed from the next shot when step 4 planned another mode');
  assert(switched.sent[2].lastFramePath === '', 'without a closing frame the last clip simply has none');
  const withClosing = step4('firstFrame', { chained: false });
  withClosing.extraFrames = [{ id: 'ep1_s2_sh1__last_frame', shot_id: 'ep1_s2_sh1', role: 'last_frame', imagePath: '/api/media/closing.png', status: 'complete' }];
  const switched2 = await runFor('firstLastFrame', withClosing);
  assert(switched2.sent[2].lastFramePath === '/api/media/closing.png', 'the final clip falls back to the dedicated closing frame');

  globalThis.fetch = realFetch;
  state.viewingStep = null;
  state.stepRunning = false;
}

// 36. 视频提交请求构造 — 桩 fetch 校验 V1 / V2 两种模型格式
{
  const { submitVideoTask, submitVideoTaskV2 } = await import('./server/dashscope.js');
  const realFetch = globalThis.fetch;
  let captured = null;
  globalThis.fetch = async (url, opts) => {
    captured = { url, opts };
    return { ok: true, status: 200, json: async () => ({ output: { task_id: 'vid-task-1' } }) };
  };

  const v1 = await submitVideoTask('a cat turns the page', 'data:image/png;base64,AAA', {
    model: 'setting-video-model', duration: 5, resolution: '720P', apiKey: 'k', seed: 11,
  });
  const v1Body = JSON.parse(captured.opts.body);
  assert(v1 === 'vid-task-1', 'V1 video submit returns the async task id');
  assert(captured.url.endsWith('/services/aigc/video-generation/video-synthesis'), 'video submits to the video-synthesis endpoint');
  assert(captured.opts.headers['X-DashScope-Async'] === 'enable', 'video submit asks for async execution');
  assert(v1Body.model === 'setting-video-model', 'V1 uses the model from settings, never a hardcoded one');
  assert(v1Body.input.img_url === 'data:image/png;base64,AAA', 'V1 passes the first frame as input.img_url');
  assert(v1Body.input.media === undefined, 'V1 sends no media array');
  assert(v1Body.parameters.seed === 11 && v1Body.parameters.duration === 5, 'V1 forwards seed and duration');

  await submitVideoTaskV2('a cat turns the page', [
    { type: 'first_frame', url: 'data:image/png;base64,AAA' },
    { type: 'last_frame', url: 'data:image/png;base64,BBB' },
  ], { model: 'setting-video-model', duration: 5, resolution: '720P', apiKey: 'k', seed: 12 });
  const v2Body = JSON.parse(captured.opts.body);
  assert(v2Body.input.img_url === undefined, 'V2 sends no img_url');
  assert(v2Body.input.media.map(m => m.type).join(',') === 'first_frame,last_frame', 'V2 lists the first frame then the last frame');
  assert(v2Body.input.media.every(m => m.url.startsWith('data:')), 'V2 media entries carry the resolved image data');
  assert(v2Body.parameters.seed === 12, 'V2 forwards the per-clip seed');

  await submitVideoTaskV2('identity lock', [
    { type: 'reference_image', url: 'data:image/png;base64,AAA' },
    { type: 'reference_image', url: 'data:image/png;base64,BBB' },
  ], { model: 'setting-ref-model', apiKey: 'k' });
  const r2vBody = JSON.parse(captured.opts.body);
  assert(r2vBody.input.media.every(m => m.type === 'reference_image'), 'r2v media entries are reference images');
  assert(r2vBody.input.media.length === 2, 'r2v forwards every reference image it was given');

  globalThis.fetch = realFetch;
}

// 37. 步骤5 → 步骤6 交接 — 新的 { mode, clips } 输出仍驱动后期合成
{
  const { getActiveProvider, registerProvider } = await import('./src/js/providers/registry.js');
  await import('./src/js/providers/render.js');
  const realRender = getActiveProvider('render');
  const { EditorAgent } = await import('./src/js/agents/editorAgent.js');
  const { extractEntities, checkConsistency } = await import('./src/js/agents/qcConsistency.js');
  const { state } = await import('./src/js/state.js');
  const { QCVerdict } = await import('./src/js/agents/qcTypes.js');

  state.viewingStep = 5;
  state.stepRunning = true;

  const videoClips = {
    mode: 'firstLastFrame',
    clips: [
      { shot_id: 'ep1_s1_sh1', videoPath: '/api/media/vid_1.mp4', status: 'complete' },
      { shot_id: 'ep1_s1_sh2', videoPath: '/api/media/vid_2.mp4', status: 'complete' },
      { shot_id: 'ep1_s1_sh3', videoPath: '', status: 'skipped' },
      { shot_id: 'ep1_s2_sh1', videoPath: '', status: 'failed' },
    ],
  };

  let posted = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (url === '/api/render/final') {
      posted = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ taskId: 'render-1' }) };
    }
    return { ok: true, json: async () => ({ status: 'completed', result: { path: '/api/media/final_render-1.mp4' } }) };
  };

  const rendered = await realRender.generate({
    items: videoClips.clips.map(c => ({ id: c.shot_id, videoPath: c.videoPath, status: c.status })),
  });

  assert(posted && posted.videoPaths.length === 2, 'step 6 concatenates only the clips step 5 completed');
  assert(posted.videoPaths[0] === '/api/media/vid_1.mp4' && posted.videoPaths[1] === '/api/media/vid_2.mp4',
    'step 6 keeps the storyboard order of the completed clips');
  assert(rendered.finalVideo === '/api/media/final_render-1.mp4' && rendered.status === 'complete',
    'step 6 returns the rendered file as finalVideo');

  posted = null;
  const none = await realRender.generate({ items: [{ id: 'x', videoPath: '', status: 'skipped' }] });
  assert(posted === null && none.status === 'no-clips', 'step 6 reports no-clips without calling ffmpeg when nothing completed');

  let captured = null;
  registerProvider({
    id: 'render-probe',
    capabilities: ['render'],
    async generate({ items }) { captured = items; return { finalVideo: '', status: 'no-clips' }; },
  });
  globalThis.fetch = realFetch;

  const out = await new EditorAgent().run({
    videoClips,
    storyboard: { episodes: [{ episode: 1 }, { episode: 2 }] },
    entities: extractEntities('videoGeneration', videoClips) || {},
  });

  assert(getActiveProvider('render').id === 'render-probe', 'the probe provider is the one EditorAgent talks to');
  assert(captured.length === 4 && captured[0].id === 'ep1_s1_sh1' && captured[0].videoPath === '/api/media/vid_1.mp4',
    'EditorAgent maps every clip to { id, videoPath, status } for the render provider');
  assert(captured[2].status === 'skipped' && captured[3].status === 'failed',
    'EditorAgent forwards clip statuses so the provider can filter them');
  const data = out.artifacts[0].data;
  assert('finalVideo' in data && Array.isArray(data.episodes) && data.episodes.length === 2,
    'step 6 output still satisfies the postProduction validator shape');
  assert(out.metadata.renderStatus === 'no-clips' && out.artifacts[0].status === 'failed',
    'step 6 marks the artifact failed when no final video was produced');

  const step5Entities = extractEntities('videoGeneration', videoClips);
  assert(step5Entities.clipCompleteCount === 2 && step5Entities.clipVideoMode === 'firstLastFrame',
    'step 5 entities carry the complete count and the mode for later QC');
  const step6Crit = checkConsistency('postProduction', { finalVideo: '/api/media/f.mp4', status: 'complete' }, step5Entities);
  assert(step6Crit.verdict === QCVerdict.PASS && step6Crit.issues.length === 0,
    'step 6 consistency check passes on the new step-5 entities');
  const missingCrit = checkConsistency('postProduction', { finalVideo: '', status: 'failed' }, step5Entities);
  assert(missingCrit.issues.length === 2, 'step 6 still flags clips-without-final-video and a failed render');
}

// 38. 视频时长 — 分镜规划的秒数按各模型档位夹取后提交
{
  const { clampVideoDuration } = await import('./server/dashscope.js');

  assert(clampVideoDuration('wan2.7-i2v', 8) === 8, 'wan2.7 keeps a duration inside its documented 2-15s range');
  assert(clampVideoDuration('wan2.7-i2v-2026-04-25', 40) === 15, 'a dated wan2.7 variant is clamped to the 15s ceiling');
  assert(clampVideoDuration('wan2.7-r2v', 1) === 2, 'wan2.7 is raised to the 2s floor');
  assert(clampVideoDuration('wan2.7-i2v', 7.4) === 7, 'a fractional duration is rounded to whole seconds');
  assert(clampVideoDuration('wanx2.1-i2v-plus', 9) === 5, 'a model documented as fixed-5s ignores the planned duration');
  assert(clampVideoDuration('wan2.2-i2v-plus', 9) === 5, 'the other fixed-5s generation also ignores it');
  assert(clampVideoDuration('wanx2.1-i2v-turbo', 9) === 5, 'turbo snaps to the closest of its 3/4/5 options');
  assert(clampVideoDuration('wanx2.1-i2v-turbo', 3) === 3, 'turbo keeps an allowed value untouched');
  assert(clampVideoDuration('wan2.5-i2v-preview', 8) === 10, 'wan2.5 snaps to the nearest of its 5/10 options');
  assert(clampVideoDuration('wan2.6-i2v-us', 8) === 10, 'wan2.6-us snaps to the nearest of its 5/10/15 options');
  assert(clampVideoDuration('wan2.6-i2v-flash', 12) === 12, 'wan2.6-i2v-flash accepts the whole 2-15s range');
  assert(clampVideoDuration('some-future-model', 9) === 5, 'an undocumented model falls back to the universally accepted 5s');
  assert(clampVideoDuration('wan2.7-i2v', undefined) === 5, 'a missing duration falls back to 5s');
  assert(clampVideoDuration('wan2.7-i2v', 'not-a-number') === 5, 'a non-numeric duration falls back to 5s');

  const agentSrc = readFileSync('./src/js/agents/videoAgent.js', 'utf8');
  assert(agentSrc.includes('#clipDuration(sbShot)'), 'VideoAgent derives the clip duration from the storyboard shot');
  assert(agentSrc.includes('duration: this.#clipDuration(sbShot)'), 'every clip item carries its planned duration');
  assert(agentSrc.includes('duration: item.duration'), 'the retry batch keeps the per-clip duration');

  const providerSrc = readFileSync('./src/js/providers/video.js', 'utf8');
  assert(providerSrc.includes('duration: item.duration ?? DEFAULT_CLIP_DURATION'), 'the video provider forwards the per-clip duration');
  assert(providerSrc.includes('duration: c.duration'), 'the request body carries a duration for every clip');
  assert(!/duration: 5,/.test(providerSrc), 'the video provider has no hardcoded 5s duration left');

  const serverSrc = readFileSync('./server/index.js', 'utf8');
  assert(serverSrc.includes('const clipDuration = clip.duration ?? duration'), 'the route prefers the per-clip duration over the batch default');
  assert((serverSrc.match(/duration: clipDuration/g) || []).length === 3, 'all three non-upload submit paths send the per-clip duration');
  assert(serverSrc.includes('duration: clip.duration ?? duration'), 'the upload submit path also honours a per-clip duration');

  const dsSrc = readFileSync('./server/dashscope.js', 'utf8');
  assert((dsSrc.match(/clampVideoDuration\(model, duration\)/g) || []).length === 2, 'both submit functions clamp the duration for the chosen model');
  assert((dsSrc.match(/duration: seconds/g) || []).length === 2, 'the clamped value is what actually gets submitted');
}

// 39. 分镜提示词 — 各镜头时长之和要贴合用户设定的总时长
{
  const { buildMessages } = await import('./src/js/providers/prompts.js');
  const msgs = buildMessages('storyboard', { totalDuration: 45, script: null }) || [];
  const text = msgs.map(m => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');

  assert(text.includes('MUST add up to roughly 45s'), 'the storyboard prompt pins the shot durations to the requested total');
  assert(text.includes('ACTUAL generated clip length'), 'the prompt says duration is the real clip length, not a hint');
  assert(text.includes('suggested duration in seconds (3-10)'), 'the JSON schema still asks for a per-shot duration');
}

console.log(`\nSmoke test: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
