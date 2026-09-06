# 系统架构

> 本文档与当前代码一致（2026-09 更新）。Pipeline 引擎是 `orchestrator.js`（`engine.js` 仅为转发壳）；
> 质量保障在 `agents/qcAgent.js` / `agents/qcConsistency.js`；流程为 6 步（见 `config.js` 的 `STEPS`）。

## 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        Presentation Layer                        │
│  index.html ─ main.js ─ ui/render.js ─ ui/views.js               │
│  ui/settings.js ─ navigation.js ─ i18n.js ─ mascot-interact.js   │
└──────────────────────────────┬──────────────────────────────────┘
                               │
┌──────────────────────────────┴──────────────────────────────────┐
│                      Orchestration Layer                         │
│  orchestrator.js (Pipeline 推进 / 修订 / 回滚 / 会话恢复)         │
│  engine.js (转发壳: startPipeline / reviseStep / restoreSession) │
│  agents/ (6 个 Agent + QC/重试/IP 合规)                           │
│  orchestrator/ (runState / executionCheckpoint /                 │
│                 cancellationToken / agentRegistry)               │
│  artifacts/ (ArtifactStore 版本化产物)                            │
└──────────────────────────────┬──────────────────────────────────┘
                               │
┌──────────────────────────────┴──────────────────────────────────┐
│                       Provider Layer                             │
│  registry.js ─ llm.js ─ image.js  video.js ─ videoComfy.js     │
│  render.js ─ template.js(离线降级) ─ prompts.js                  │
└──────────┬──────────────────────────────────────────────────────┘
           │
┌──────────┴──────────────────────────────────────────────────────┐
│                    Express Backend (server/, :3006)              │
│  index.js(路由) ─ dashscope.js ─ cache.js ─ tasks.js             │
│  render.js(ffmpeg) ─ ssh-tunnel.js + comfyui.js(远程 ComfyUI)    │
└─────────────────────────────────────────────────────────────────┘
```

## 核心模块详解

### 1. Pipeline 引擎 (`orchestrator.js`)

`Orchestrator` 单例（`getOrchestrator()`）负责 Pipeline 生命周期。`engine.js` 只 re-export
`startPipeline` / `reviseStep` / `restoreSession` 并挂 `window.__reviseStep`，不含逻辑。

- **`startPipeline()`**: 重置 state / ArtifactStore / checkpoint / runState，新建 `CancellationToken`，进入第一步
- **`#advanceStep()`**: 推进索引；越界则 `markCompleted()` + `showCompletion()`
- **`#executeStage(step)`**: 渲染生成动画 → 运行 Agent → `waitForResume()` → 存 `state.data[dataKey]` → 持久化 checkpoint/runState → 渲染步骤视图
- **`reviseStep(stepId, feedback)`**: 带 `ctx.feedback` + `ctx.previousResult` 重跑该步，并 `markDownstreamStale`
- **`rollbackToStep(stepId)`**: 从 checkpoint 恢复该步数据、清空后续步骤
- **`restoreSession()`**: 启动时从 localStorage 恢复 checkpoint/runState（`main.js` 在 boot 调用）
- **`pausePipeline/resumePipeline/stopPipeline`**: 唯一的暂停/停止入口，同时驱动 state 标志与 CancellationToken

Agent 通过 `agentRegistry` 注册与解析（`registerAgent` / `resolveAgent`），是 step→agent 的唯一来源。

步骤视图用 **Renderer Registry** 消除重复：

```js
const RENDERERS = {
  script: (r, cb) => renderScript(r, cb),
  characterDesign: (r, cb) => renderCharacterDesign(r, cb),
  // ... 6 步
};
```

每步输出还经过 **POST_VALIDATORS** 结构校验（如 script 需 `validateScript`、videoGeneration 需 `clips` 数组）。

### 2. Agent (`agents/`)

所有 Agent 继承 `BaseAgent`：`process(ctx, token)` 检查 CancellationToken 后调用 `run(ctx, token)`，
返回 `{ artifacts[], intervention, metadata }`。上下文由 `#buildContext(step)` 按 `contextKeys` 裁剪 + 注入一致性约束。

| Agent | 步骤 | 职责 |
|-------|------|------|
| `ScriptAgent` | script | 剧本生成 + JSON 修复重试 + 结构验证 |
| `CharacterAgent` | characterDesign | 角色/场景规范图 + per-item 重试 |
| `StoryboardAgent` | storyboard | 分镜（集/段/镜头）+ 镜头数按总时长封顶 |
| `ReferenceAgent` | referenceImages | 每镜头参考图 + 角色外貌注入 |
| `VideoAgent` | videoGeneration | i2v/r2v 视频片段 + 运镜 motion prompt + per-item 重试 |
| `EditorAgent` | postProduction | ffmpeg 拼接成片（确定性，不重生成） |

### 3. 恢复、回滚与控制 (`orchestrator/`)

- **ExecutionCheckpoint** (`executionCheckpoint.js`): 每步结果快照，localStorage `cine-cutie-checkpoint`
- **RunState** (`runState.js`): 生命周期 IDLE → RUNNING → INTERRUPTED/COMPLETED，localStorage `cine-cutie-runstate`
- **CancellationToken** (`cancellationToken.js`): 3 态 RUNNING/PAUSED/CANCELLED；`signal`(AbortSignal) 传入 Provider 中止在途 fetch；`waitIfPaused()`/`throwIfCancelled()` 在 Agent 边界生效。不依赖任何 UI 模块
- **agentRegistry** (`agentRegistry.js`): step→agent 注册表，Orchestrator 构造时注册、执行时解析

**暂停/停止为单一机制**：`ui/render.js` 的按钮通过 `setPipelineControls()` 注入的回调委托给
Orchestrator 的 `pausePipeline/resumePipeline/stopPipeline`，UI 只负责渲染暂停面板/复位界面。

### 4. Provider 系统 (`providers/`)

#### Registry (`registry.js`)

```js
registerProvider(provider)     // 模块加载时自注册
getActiveProvider(capability)  // 按 capability(text/image/video/render) 取活跃 Provider
setActiveProvider(cap, id)     // 切换（localStorage `cine-cutie-providers`）
```

| Provider | capability | 后端 |
|----------|-----------|------|
| `llm` | text | 任意 OpenAI 兼容 `/chat/completions`（直连或经 server 代理） |
| `image` | image | DashScope 文生图（server `/api/generate/image`） |
| `video` | video | DashScope i2v / r2v（server `/api/generate/video`） |
| `video-comfy` | video | 远程 ComfyUI（server `/api/generate/video-comfy`，SSH 隧道） |
| `render` | render | server ffmpeg 拼接（`/api/render/final`） |
| `template` | 全部 | 离线降级模板（未配置 API Key 或 LLM 失败时） |

#### 模型配置

模型名在调用点一律读取 localStorage `cine-cutie-settings`：

```js
{
  apiProviders: { openai|deepseek|dashscope|ark|kling|gemini: { endpoint, apiKey } },
  models: { text: {provider, name}, image: {name}, video: {name}, refVideo: {name} },
  jsonMode: bool,
  useProxy: bool   // true 时 LLM 走 server 代理（带 LRU 缓存 + 规避 CORS）
}
```

`useProxy` 时请求带 `X-Target-Endpoint` / `X-Api-Key` 头；API Key 不落服务端。

### 5. 质量保障 (`agents/qc*.js` + `retryAgent.js`)

- **QCAgent** (`qcAgent.js`): 每步输出 LLM 自评 1-10（阈值 7）。媒体步骤附加真实图片/视频帧做多模态评审。
  `combineVerdict()` 让确定性一致性检查成为硬门禁：最终分 = min(LLM 分, 结构分)
- **一致性** (`qcConsistency.js`): `extractEntities` / `mergeEntities` 跨步追踪实体；
  `buildConsistencyConstraints` 注入 "CONSISTENCY CONSTRAINTS" 到 prompt；`checkConsistency` 检查缺角色图、镜头缺参考图、片段失败率过高等
- **重试** (`retryAgent.js`): 文本步追加 critique 反馈重跑；媒体项按错误选策略
  `SWAP_REFERENCE / REWRITE_PROMPT / CHANGE_SEED / RETRY_SAME / GIVE_UP`（最多 3 次）
- **类型** (`qcTypes.js`): `QCVerdict`(PASS/FAIL/CONDITIONAL_PASS)、`Severity`、`maxRetriesFor`

### 6. IP 合规 (`agents/ipComplianceAgent.js` + `compliance/`)

`ipDatabase.js` 内置角色/品牌 IP 库（含别名与间接描述关键词）；`ipMatcher.js` 四层证据匹配
（exact → alias → fuzzy → keyword）。Orchestrator 的 `#postGate()` 对每步输出筛查：
BLOCK→该步 FAIL，WARN/REVIEW→CONDITIONAL_PASS 并在 UI 提示。

### 7. 产物与可观测性 (`artifacts/` + `observability.js`)

- **ArtifactStore**: 版本化 commit、`supersede`、`invalidate`、`markDownstreamStale`(BFS)、snapshot/restore
- **Artifact**: 含 `itemLineage`（每 item 的尝试历史：seed/prompt/referenceId，供 RetryAgent 决策）与 `metrics`(tokens/qualityScore/retries/fallbackUsed)
- **observability.js**: 从 ArtifactStore 派生执行日志（汇总 + 每步表格），在 completion 视图展示

### 8. Prompt 工程 (`providers/prompts.js`)

每步独立 system prompt + `buildUser(ctx)`：角色定义、上游摘要、JSON Schema、输出要求；
`ctx.constraints`（一致性）与 `ctx.feedback`（修订）追加到用户消息末尾。

## 数据流（6 步）

```
用户输入(灵感 + 时长 + 比例 + 分辨率 + 风格 + 上传图)
        │  contextKeys: []
        ▼
   script ────────── { title, logline, characters, settings, episodes }
        │  contextKeys: ['script']
        ▼
   characterDesign ─ { characters[]/settings[] + imageUrl/imagePath }
        │  contextKeys: ['script']
        ▼
   storyboard ────── { episodes → segments → shots(shot_id, camera, prompt) }
        │  contextKeys: ['script','storyboard','characterDesign']
        ▼
   referenceImages ─ { shots[] + 首帧参考图 URL }
        │  contextKeys: ['script','storyboard','referenceImages','characterDesign']
        ▼
   videoGeneration ─ videoClips: { clips[] }   (角色规范图作 i2v 首帧保持一致性)
        │  contextKeys: ['script','storyboard','videoClips']
        ▼
   postProduction ── finalVideo: { finalVideo }  (ffmpeg 拼接)
        │
        ▼
   showCompletion() → renderExecutionLog()
```

## 状态管理 (`state.js`)

```js
{
  mode: 'auto' | 'interactive',
  currentStep: -1, viewingStep: null,
  genre / visualStyle / customStyle, userInput,
  totalDuration: 30, aspectRatio: '16:9', imageSize, resolution: '720P',
  uploads: { firstFrame, lastFrame, referenceImages[] },
  theme, lang, entities: {},
  stepRunning / paused / stopped,
  data: { script, characterDesign, storyboard, referenceImages, videoClips, finalVideo }
}
```

**localStorage 键**：`cine-cutie-settings`、`cine-cutie-providers`、`cine-cutie-theme`、
`cine-cutie-lang`、`cine-cutie-comfy-ssh`、`cine-cutie-runstate`、`cine-cutie-checkpoint`
（旧键 `cine-cutie-llm` / `cine-cutie-dashscope` 仅做只读迁移）。

## 后端 (`server/`, 端口 3006)

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/chat/completions` | POST | LLM 代理（LRU 缓存，`X-Cache` 头） |
| `/api/generate/image` | POST | DashScope 批量文生图 |
| `/api/upload` | POST | 上传图片（≤10MB） |
| `/api/generate/video` | POST | DashScope i2v / V2 media-array(r2v) |
| `/api/render/final` | POST | ffmpeg 拼接（copy 失败回退重编码） |
| `/api/generate/video-comfy` | POST | 远程 ComfyUI 生成 |
| `/api/upload/comfy` | POST | 上传到 ComfyUI input |
| `/api/comfyui/status` | GET | 隧道 + GPU 状态 |
| `/api/comfyui/tunnel/close` | POST | 关闭 SSH 隧道 |
| `/api/task/:id` | GET | 轮询异步任务 |
| `/api/media/:filename` | GET | 取生成媒体 |
| `/api/cache/stats` / `/api/cache/clear` | GET/POST | LLM 缓存 |
| `/api/health` | GET | 健康检查 |

- `dashscope.js`: DashScope REST 客户端，Key 经 `X-Api-Key` 逐请求传入
- `ssh-tunnel.js` + `comfyui.js`: 经 SSH 隧道访问远程 ComfyUI（密码来自 env `COMFY_SSH_PASSWORD`），补丁式修改 workflow 节点
- `render.js`: ffmpeg-static 拼接；先 `-c copy`，混编码失败时回退 libx264/aac 重编码
- 静态托管 `dist/` + SPA catch-all；媒体落盘 `media/`

## 国际化 (`i18n.js`)

中英双语，`t(key, params)` 带 `{param}` 插值，`applyLang()` 替换所有 `[data-i18n]` 元素。
