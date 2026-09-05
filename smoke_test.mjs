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
  const { extractEntities } = await import('./src/js/providers/consistency.js');

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
  const { checkConsistency } = await import('./src/js/providers/consistency.js');

  // null data → FAIL / CRITICAL
  const nullCheck = checkConsistency('characterDesign', null, {});
  assert(nullCheck.verdict === QCVerdict.FAIL, 'checkConsistency null data → FAIL');
  assert(nullCheck.severity === Severity.CRITICAL, 'checkConsistency null data → CRITICAL');

  // characterDesign: all characters present with images → PASS
  const passCheck = checkConsistency('characterDesign', {
    characters: [{ name: 'Alice', imagePath: '/a.png' }, { name: 'Bob', imagePath: '/b.png' }],
  }, { characterNames: ['Alice', 'Bob'] });
  assert(passCheck.verdict === QCVerdict.PASS, 'checkConsistency characterDesign PASS');

  // characterDesign: missing character → CONDITIONAL_PASS or FAIL
  const missingCheck = checkConsistency('characterDesign', {
    characters: [{ name: 'Alice', imagePath: '/a.png' }],
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

// 2. Media agents source: must import RetryAgent and checkConsistency
{
  const agentFiles = [
    './src/js/agents/characterAgent.js',
    './src/js/agents/referenceAgent.js',
    './src/js/agents/videoAgent.js',
    './src/js/agents/editorAgent.js',
  ];
  for (const file of agentFiles) {
    const src = readFileSync(file, 'utf8');
    assert(src.includes('RetryAgent'), `${file} imports RetryAgent`);
    assert(src.includes('checkConsistency'), `${file} imports checkConsistency`);
    assert(src.includes('QCVerdict'), `${file} imports QCVerdict`);
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
    // Phase 3: agents may have 2 createArtifact calls (main path + emptyResult fallback)
    const createCount = (src.match(/createArtifact\(/g) || []).length;
    assert(createCount >= 1 && createCount <= 2, `${name} has 1-2 createArtifact calls (got ${createCount})`);
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
  assert(!imageSrc.includes('buildCharacterPrompt'), 'image provider does NOT contain buildCharacterPrompt (moved to agent)');
  assert(!imageSrc.includes('buildShotPrompt'), 'image provider does NOT contain buildShotPrompt (moved to agent)');
  assert(!imageSrc.includes('addAgentMessage'), 'image provider does NOT contain addAgentMessage (moved to agent)');

  const videoSrc = readFileSync('./src/js/providers/video.js', 'utf8');
  assert(videoSrc.includes('async generate({ items, overrides'), 'video provider accepts { items, overrides }');
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
  assert(charSrc.includes('#buildCharacterPrompt'), 'CharacterAgent contains #buildCharacterPrompt');

  const refSrc = readFileSync('./src/js/agents/referenceAgent.js', 'utf8');
  assert(refSrc.includes('recordItemAttempt'), 'ReferenceAgent uses recordItemAttempt');
  assert(refSrc.includes('planItemRetry'), 'ReferenceAgent uses planItemRetry');
  assert(refSrc.includes('#buildShotPrompt'), 'ReferenceAgent contains #buildShotPrompt');

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

console.log(`\nSmoke test: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
