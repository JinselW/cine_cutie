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
| `CharacterAgent` | characterDesign | 两阶段：LLM 先写角色/场景设计稿（design/visualTag/palette），再据此生成三视图定妆图 + 正面图 + 场景空镜图，per-item 重试 |
| `StoryboardAgent` | storyboard | 分镜（集/段/镜头）+ 镜头数按总时长封顶 |
| `ReferenceAgent` | referenceImages | 按设置的视频生成方式规划帧图（首帧 N / 首尾帧 N+1，尾帧复用下镜首帧 / 参考图 N）；提示词融合剧本 beat + 命中角色/场景 visualTag + 分镜 prompt，并把定妆图作图生图参考 |
| `VideoAgent` | videoGeneration | 读设置的 `videoMode` 后从步骤4结果取素材（首帧 / 首帧+尾帧，尾帧缺失时按"复用下镜首帧"现算 / 参考图列表 ≤5 张），拼运镜 motion prompt，片段时长取分镜为该镜头规划的 `duration`，per-item 重试 |
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
| `image` | image | DashScope 文生图；条目带 `refs` 且设置中选了图生图模型时逐条走图生图编辑（server `/api/generate/image`） |
| `video` | video | DashScope i2v / r2v（server `/api/generate/video`）；按生成方式选模型——参考图方式读 `models.refVideo`，另两种读 `models.video`，并逐条转发 `imagePath`/`lastFramePath`/`referenceImages` |
| `video-comfy` | video | 远程 ComfyUI（server `/api/generate/video-comfy`，SSH 隧道） |
| `render` | render | server ffmpeg 拼接（`/api/render/final`） |
| `template` | 全部 | 离线降级模板（未配置 API Key 或 LLM 失败时） |

#### 模型配置

模型名在调用点一律读取 localStorage `cine-cutie-settings`：

```js
{
  apiProviders: { openai|deepseek|dashscope|ark|kling|gemini: { endpoint, apiKey } },
  models: { text: {provider, name}, image: {name}, img2img: {name}, video: {name}, refVideo: {name} },
  videoMode: 'firstFrame' | 'firstLastFrame' | 'referenceImage',
  jsonMode: bool,
  useProxy: bool   // true 时 LLM 走 server 代理（带 LRU 缓存 + 规避 CORS）
}
```

`videoMode` 决定设置面板里那个"具体生成方式模型"下拉写入哪个槽位：
`firstFrame`（默认 wanx2.1-i2v-plus）与 `firstLastFrame`（默认 wan2.7-i2v）写 `models.video`，
`referenceImage`（默认 wan2.7-r2v）写 `models.refVideo`；另一个槽位保留原值。
`img2img` 默认 `wan2.6-image`，由 `ReferenceAgent` 在带参考图的条目上走图生图编辑路径。
`videoMode` 同时被 `ReferenceAgent`（决定步骤 4 产出首帧 / 首尾帧 / 参考图）
和 `video` provider（决定步骤 5 读哪个模型槽位、每条片段带哪些素材）读取，图片走 `models.image`。
后端再按片段内容与模型代次决定入参形态：带参考图 → `media` 数组 `reference_image`（仅 `wan2.7` 系列，否则明确报错）；
首/尾帧 → `media` 数组 `first_frame` + `last_frame`（V1 模型只吃 `input.img_url`，尾帧会被忽略并打日志提示换模型）。

片段时长：分镜为每个镜头规划 `duration`（3–10 秒），`VideoAgent` 逐条带给 provider，服务端 `clampVideoDuration(model, seconds)`
按百炼文档的档位表收敛（`wan2.7-*`/`wan2.6-i2v*` 为 2–15 的整数，`wanx2.1-i2v-turbo` 为 3/4/5，`wan2.5-i2v` 为 5/10，
`wan2.6-i2v-us` 为 5/10/15，`wanx2.1-i2v-plus`/`wan2.2-i2v-*` 固定 5 秒）。这张表是按模型名维护的外部约束元数据，
表外模型一律退回 5 秒（所有已知档位都接受的值）并打 warning——换了新模型发现时长不生效时先看这里。

`useProxy` 时请求带 `X-Target-Endpoint` / `X-Api-Key` 头；API Key 不落服务端。

### 5. 质量保障 (`agents/qc*.js` + `retryAgent.js`)

- **QCAgent** (`qcAgent.js`): 每步输出 LLM 自评 1-10（阈值 7）。媒体步骤附加真实图片/视频帧做多模态评审。
  `combineVerdict()` 让确定性一致性检查成为硬门禁：最终分 = min(LLM 分, 结构分)
- **一致性** (`qcConsistency.js`): `extractEntities` / `mergeEntities` 跨步追踪实体；
  `buildConsistencyConstraints` 注入 "CONSISTENCY CONSTRAINTS" 到 prompt；`checkConsistency` 检查缺角色图、镜头缺参考图、帧数与视频生成方式不匹配（缺收尾帧/尾帧，非致命 → CONDITIONAL_PASS）、片段失败率过高、步骤4规划的 mode 与实际片段 mode 不一致（设置在两步之间被改过，非致命提示重跑步骤4）等
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
用户输入(灵感 + 提示词文件 + 时长 + 比例 + 分辨率 + 风格)
        │  contextKeys: []
        ▼
   script ────────── { title, logline, characters, settings, episodes }
        │  contextKeys: ['script']
        ▼
   characterDesign ─ { characters[]: design/visualTag/palette + sheetPath(三视图定妆图) + imagePath/imageUrl(正面图)
                       settings[]: design/visualTag/palette + imagePath/imageUrl(场景空镜) }
        │  contextKeys: ['script']
        ▼
   storyboard ────── { episodes → segments → shots(shot_id, camera, prompt) }
        │  contextKeys: ['script','storyboard','characterDesign']
        ▼
   referenceImages ─ { mode, shots[]: role/主帧 imagePath+imageUrl/refs(该帧用到的定妆图,供步骤5参考图模式复用)/(首尾帧时 lastFramePath 复用上镜首帧) + extraFrames[]: 收尾帧 }
        │  contextKeys: ['script','storyboard','referenceImages','characterDesign']
        ▼
   videoGeneration ─ videoClips: { mode, clips[] }   (按 mode 用步骤4的首帧/首尾帧/参考图保持一致性)
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
  promptDoc: { name, text, chars, truncated } | null,   // 用户上传的提示词文件（≤1 个）
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
| `/api/generate/image` | POST | DashScope 批量生图（文生图 + 逐条图生图编辑，参考图为同源 `/api/media` 路径） |
| `/api/upload/prompt` | POST | 解析提示词文件（.docx/.txt/.md，≤20MB，提取纯文本，UTF-8→GBK 回退，>20000 字截断） |
| `/api/upload` | POST | 图片上传（当前 UI 未使用，保留给视频生成的 uploads 入参） |
| `/api/generate/video` | POST | DashScope 批量图生视频：模型由请求体传入；本地 `/api/media` 帧图转 Base64 data URI；V1 走 `input.img_url`，`wan2.7` 走 `media` 数组（first_frame/last_frame/reference_image）；每条片段的 `duration` 经 `clampVideoDuration` 按模型档位夹取 |
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
