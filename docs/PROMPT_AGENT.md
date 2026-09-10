# Internal Prompt Agent

The visible pipeline remains six steps. `PromptAgent` is injected into the image and video agents; it is never registered as a pipeline step.

## Artifact ownership

`referenceImages.data.promptPackage` is a named, formal nested artifact envelope with its own ID, root ID, version, parent, upstream artifact IDs, adoption status, QC, token usage, and history. It does not enter ArtifactStore's adopted-step index. The image artifact owns its lifetime, persistence, and upstream invalidation. Video artifacts retain the exact consumed envelope and any video-stage revisions. Re-running a step can reuse its adopted package; replacing the storyboard invalidates media artifacts and makes their embedded packages unavailable for generation, while keeping history readable.

## Creation and retries

Preparation makes one creative LLM call for all storyboard shots, compiles deterministic identity/style/scene constraints, validates structure, then runs prompt-specific QC. Shot bindings and identity anchors are derived from the storyboard, never taken from the model's draft, so a returned draft cannot drop a character, its reference images or its appearance constraints; a shot inherits the text of its own script episode and segment so unnamed action still binds the right entities, and one-character names are ignored as signals. Structural invalidity, unavailable QC, a below-threshold score, an explicit FAIL, or unsatisfied feedback rejects the candidate and prevents it from reaching the image provider. The exact gate outcome is recorded as `provenance.qcGate`. A rewrite makes a single-shot LLM call with adjacent-shot context. Only that shot changes; previous versions remain in history. Invalid rewrite output is also retained as an addressable rejected version. Video-stage rewrites retain the image instructions that produced the input frames. A blocked revision is recorded in `rejectedRevisions` (last three kept) with `nextVersion` carrying the highest rejected version, so a later revision can never reuse a version number. Media seed/reference retries do not create independent prompts. Stage-level media QC retries vary seeds. The reuse fingerprint covers creative inputs only (upstream artifacts, script/design/storyboard content, language, video mode); switching a provider or model never invalidates an adopted package.

ReferenceAgent expands specs mechanically into first/last/reference image tasks and resolves logical asset IDs to media paths. VideoAgent reuses the package without a new creative call. It prefers a compatible package from the video artifact, then the image artifact; when neither is compatible it rebuilds deterministically from the storyboard (recorded as operation `legacy`) instead of failing the step. Upload-only historical input gets deterministic synthetic shot IDs.

## Provider boundary

Adapters emit the application's existing provider-item format; DashScope/Ark HTTP serialization and ComfyUI workflow submission remain in the provider modules. ComfyUI drops generated audio instructions; unsupported negative prompt fields and execution-mode changes are recorded explicitly. Planned modes remain immutable in the package. Adaptation records, clip metadata, and item attempts preserve executed modes and fallback reasons; re-adapting an unchanged spec is recorded once, and a degradation notice is reported once per provider and media instead of once per shot. The adapter supports capability overrides for future provider contracts.

## Validation

`test/prompt-agent.test.js` exercises actual service/media agents with mocked LLM, QC and media providers, including structural and semantic QC gates, deterministic bindings from segment text, adaptation deduplication across provider capabilities, bounded rejection history, version reuse, valid and invalid single-shot rewrites, first/last sibling regeneration, upload retries, legacy migration, deterministic stale rebuild, persistence/invalidation and degradation tracking. `npm run verify` includes these tests and the production build and smoke tests. Live paid provider calls are not part of this suite.
