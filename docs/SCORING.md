# 竞赛评分对照

本文档对照竞赛评分标准，说明 Cine-Cutie 在各维度的实现情况。所有条目均以当前代码为准
（6 步 Pipeline + QC/Retry/IP 合规 Agent + 创作历史 Memory），架构细节见 [ARCHITECTURE.md](ARCHITECTURE.md)。

## 评分总览

| 评分维度 | 满分 | 预期得分 | 关键实现 |
|----------|------|----------|----------|
| 多 Agent 架构与工程 | 30 | 25-28 | 6 核心 Agent + QCAgent/RetryAgent/IPComplianceAgent + 一致性追踪 + ArtifactStore |
| 统一一句话生成测试 | 25 | 20-23 | 一句话灵感（可选提示词文件）→ 端到端成片 + 多重质量门禁 + 跨步骤一致性 |
| 技术创新与模型工程 | 25 | 18-22 | Self-Critique + per-item Auto-Retry + 三种视频生成方式 + Context Pruning |
| 自主工作质量 | 10 | 7-9 | 多轮评分选优 + 结构校验 + IP 合规门禁 + 优雅降级 |
| 可复现性与部署 | 10 | 7-9 | Vite 构建 + 零运行时依赖 + Seed 可复现 + Docker + 完整文档 |

---

## 一、多 Agent 架构与工程 (30 分)

### 1.1 Agent 分工与调度

**实现**：所有 Agent 继承 `BaseAgent`（`process(ctx, token)` → `{ artifacts, intervention, metadata }`），
经 `agentRegistry` 注册与解析，是 step→agent 的唯一来源。

| Agent | 步骤 | 职责 |
|-------|------|------|
| `ScriptAgent` | script | 剧本生成（角色/场景/集段）+ JSON 修复重试 + `validateScript` 结构验证 |
| `CharacterAgent` | characterDesign | 两阶段：LLM 写角色/场景设计稿（design/visualTag/palette）→ 生成三视图定妆图 + 正面肖像 + 场景空镜图，per-item 重试 |
| `StoryboardAgent` | storyboard | 分镜（集/段/镜头）+ camera 运镜参数 + 镜头数按总时长封顶 + `validateStoryboard` |
| `ReferenceAgent` | referenceImages | 按 `videoMode` 规划帧图（首帧 N / 首尾帧 N+1 / 参考图 N），融合剧本 beat + visualTag + 分镜 prompt，定妆图作图生图参考 |
| `VideoAgent` | videoGeneration | 按 `videoMode` 取步骤 4 素材，拼运镜 motion prompt，逐片段时长，per-item 重试 |
| `EditorAgent` | postProduction | ffmpeg 拼接成片（确定性，不重生成） |

**质量/合规 Agent（跨步骤介入）**：

| Agent | 职责 |
|-------|------|
| `QCAgent` | 每步输出 LLM 自评 1-10（4 条针对性标准，阈值 7）；媒体步骤附加真实图片/视频帧做多模态评审 |
| `RetryAgent` | per-item 重试策略规划（最多 3 次），文本步追加 critique 反馈重跑 |
| `IPComplianceAgent` | 每步输出过 IP 合规门禁（四层证据匹配 + 策略裁决） |
| `qcConsistency` | 跨步实体提取/合并 + 一致性约束注入 + `checkConsistency` 硬门禁 |

**调度机制**：`orchestrator.js`（`Orchestrator` 单例）负责 Pipeline 生命周期，`engine.js` 仅为转发壳
（re-export `startPipeline` / `reviseStep` / `restoreSession`）。`#executeStage()` 渲染动画 → 运行 Agent →
`#postGate()` 门禁 → 存 `state.data` → 持久化 checkpoint/runState/memory → 渲染步骤视图。

### 1.2 Self-Critique — 自我评估

**实现**：`agents/qcAgent.js`，每步生成后独立评审：

- 生成 prompt 与评审 prompt 完全分离（`CRITIQUE_SYSTEM`）
- 每步 4 条针对性评审标准（`CRITERIA`，如 characterDesign 检查三视图同一性、referenceImages 检查帧集与 videoMode 匹配）
- 1-10 分评分，输出 issues 和 suggestions
- 媒体步骤经 `utils/visionMedia.js`（`imageParts` / `videoParts`）附加真实帧做多模态评审
- `combineVerdict()` 让确定性一致性检查成为硬门禁：**最终分 = min(LLM 分, 结构分)**

### 1.3 反馈环 — Per-item Auto-Retry

**实现**：`agents/retryAgent.js`，媒体项按失败类型（`FailureType`）逐条选择策略，最多 3 次（`MAX_ITEM_ATTEMPTS`）：

- `RETRY_SAME`（同参数重试）/ `REWRITE_PROMPT`（重写提示词）/ `CHANGE_SEED`（换随机种子）/ `SWAP_REFERENCE`（换参考图）/ `GIVE_UP`（放弃）
- 文本步追加 critique 反馈重跑（`buildRetryMessages`）
- 决策依据 `itemLineage`（每 item 的尝试历史：seed/prompt/referenceId）
- 保留历史最高分结果，避免越改越差

### 1.4 跨步骤一致性

**实现**：`agents/qcConsistency.js`：

- `extractEntities` / `mergeEntities` 跨步追踪实体，累积到 `state.entities`
- `buildConsistencyConstraints` 生成 "CONSISTENCY CONSTRAINTS" 注入后续 prompt
- `checkConsistency` 检查：缺角色图、镜头缺参考图、帧数与视频生成方式不匹配（非致命 → CONDITIONAL_PASS）、
  片段失败率过高、步骤 4 规划的 mode 与实际片段 mode 不一致（设置在两步间被改过，提示重跑步骤 4）
- 角色名支持中/英文匹配（`enName`），确保跨语言 prompt 正确关联

### 1.5 产物版本化与可观测性

**实现**：`artifacts/artifactStore.js` + `observability.js`：

- **ArtifactStore**：版本化 `commit`、`supersede`、`invalidate`、`markDownstreamStale`(BFS)、snapshot/restore
- **Artifact**：含 `itemLineage`（每 item 尝试历史）与 `metrics`（tokens / qualityScore / retries / fallbackUsed）
- **observability.js**：从 ArtifactStore 派生执行日志（汇总 + 每步表格：耗时、prompt/completion tokens、质量评分、重试次数、是否降级），在 completion 视图展示

### 1.6 会话控制与恢复

**实现**：`orchestrator/`：

- **CancellationToken**：3 态 RUNNING/PAUSED/CANCELLED；`signal`(AbortSignal) 传入 Provider 中止在途 fetch；
  `waitIfPaused()`/`throwIfCancelled()` 在 Agent 边界生效。暂停/停止为单一机制，UI 仅渲染面板
- **ExecutionCheckpoint + RunState**：持久化 localStorage，支持断点续跑（`restoreSession()`）
- **reviseStep / rollbackToStep**：带反馈重跑某步 + 标记下游过期；回滚从 checkpoint 恢复数据、清空后续步骤

---

## 二、统一一句话生成测试 (25 分)

### 2.1 输入理解

**实现**：用户输入一句话灵感（+ 时长/比例/分辨率/风格），可选上传提示词文件（.docx/.txt/.md）：

- 提示词文件经 `/api/upload/prompt` 解析为纯文本（UTF-8→GBK 回退，>20000 字截断），注入 `ctx.promptDoc`
- `ScriptAgent` 依 `genre` + 用户输入 + 提示词文件生成完整剧本，内置叙事弧约束（setup → development → climax → resolution）
- `#buildContext(step)` 按 `contextKeys` 裁剪上游数据 + 注入一致性约束

### 2.2 质量保障

**实现**：多层质量门禁（`#postGate()`）：

1. **结构校验**：`POST_VALIDATORS` 为每步定义结构规则（script 需 `validateScript`、videoGeneration 需 `clips` 数组等）
2. **Self-Critique**：QCAgent 独立评分，低于阈值 7 触发重试
3. **一致性门禁**：`checkConsistency` 硬门禁，最终分 = min(LLM 分, 结构分)
4. **IP 合规门禁**：BLOCK → 该步 FAIL，WARN/REVIEW → CONDITIONAL_PASS 并在 UI 提示
5. **JSON 容错**：解析失败自动重试，提取花括号/方括号内容
6. **模板降级**：API 出错或未配置 Key 时回退 Template Provider，流程不中断

### 2.3 IP 合规

**实现**：`agents/ipComplianceAgent.js` + `compliance/`：

- `ipDatabase.js` 内置角色/品牌 IP 库（含别名与间接描述关键词）
- `ipMatcher.js` 四层证据匹配：exact → alias → fuzzy → keyword（keyword 仅作线索，likeness ≤ MEDIUM）
- 策略驱动裁决：BLOCK / WARN / REVIEW / ALLOW，证据与裁决分离

---

## 三、技术创新与模型工程 (25 分)

### 3.1 三种视频生成方式（videoMode）

**创新点**：设置面板的「视频生成方式」统一驱动步骤 4 产帧规划与步骤 5 取素材/选模型：

- `firstFrame` 首帧生视频（默认 wanx2.1-i2v-plus）：每镜 1 张首帧
- `firstLastFrame` 首尾帧生视频（默认 wan2.7-i2v）：每镜首帧，镜头 i 尾帧复用镜头 i+1 首帧，末镜补 1 张收尾帧（N+1）
- `referenceImage` 参考图生视频（默认 wan2.7-r2v）：每镜 1 张身份参考图（≤5 张）

### 3.2 角色一致性方案（三层锁定）

**创新点**：解决"每镜独立生成导致同一角色长相漂移"：

1. **设计阶段**：LLM 先写 `design`（中文详述）+ `visualTag`（英文稳定标签）+ `palette`，再据此生成三视图定妆图 + 正面肖像 + 场景空镜图
2. **图片阶段**：镜头提示词融合剧本 beat + 分镜 prompt + 命中的 visualTag，并把定妆图作**图生图参考**
3. **视频阶段**：所有含该角色的片段复用同一张图作 i2v 首帧；帧图缺失时才退回按角色名（中文名 + enName）匹配的正面肖像

### 3.3 双后端与模型工程

**实现**：Provider Registry 按 capability（text/image/video/render）分发，模型名全部读设置面板，代码不写死：

- **文本**：任意 OpenAI 兼容 `/chat/completions`（直连或经 server 代理，带 LRU 缓存 + 规避 CORS）
- **图片/视频**：DashScope 通义万相（文生图/图生图/i2v/r2v）
- **视频（备选）**：远程 ComfyUI H3（DGX Spark 经 SSH 隧道）
- **逐片段时长**：分镜规划 3–10 秒，服务端 `clampVideoDuration(model, seconds)` 按模型档位表夹取，表外模型退回 5 秒
- **Seed 可复现**：图片和视频生成支持 seed 参数

### 3.4 上下文优化 (Context Pruning)

**实现**：每步只接收所需上下文：

- `config.js` 中 `contextKeys` 声明依赖
- `#buildContext()` 按需过滤 `state.data`，减少 token 消耗

### 3.5 Token 追踪与 JSON 保障

- **Token 计量**：Artifact `metrics.tokens` 记录 prompt/completion tokens，`observability.js` 汇总展示
- **JSON 输出**：`jsonMode` 强制 `response_format`；解析失败追加消息重试；花括号/方括号提取；不支持 json_object 的模型自动降级

---

## 四、自主工作质量 (10 分)

### 4.1 多轮选优

每个媒体项最多 3 次尝试（1 次初始 + 2 次重试），保留评分最高的结果；文本步基于 critique 反馈重跑。

### 4.2 结构校验

`POST_VALIDATORS` 为每步定义结构校验规则（script/storyboard 有专用 `validate*`，媒体步校验数组结构），
校验失败 → 该步 FAIL。QC 的 `combineVerdict` 让结构分成为硬门禁。

### 4.3 优雅降级

- LLM 未配置 → 使用 Template Provider
- API 错误 → 显示警告 + 使用 Template Provider
- JSON 解析失败 → 重试 → 降级
- 结构校验失败 → FAIL 并在 UI 提示

确保任何情况下都能走完 Pipeline 或明确失败原因。

---

## 五、可复现性与部署 (10 分)

### 5.1 构建系统与零依赖

- Vite 6 构建，`npm run build` 一键输出到 `dist/`
- 运行时零外部框架依赖，纯原生 HTML + CSS + JavaScript (ES Modules)，可在任何静态托管部署

### 5.2 配置持久化

- 模型配置、Provider 选择、视频生成方式、主题、语言偏好持久化到 localStorage
- 创作历史档案持久化到 `data/memory/<UUID>.json`；媒体落盘 `media/`
- **凭据不落服务端**：API Key 逐请求经 `X-Api-Key` 传入，Memory 快照刻意排除 Key / SSH 密码

### 5.3 部署

- Docker 支持：`docker run -p 3006:3006 -v cine-data:/app/data -v cine-media:/app/media cine-cutie`
- 远程 GPU：DGX Spark (GB10) 经 SSH 隧道运行 ComfyUI

### 5.4 文档与测试

- `README.md`：项目介绍、特性、快速开始、项目结构、API
- `docs/ARCHITECTURE.md`：系统架构、数据流、模块详解
- `docs/MEMORY.md`：创作历史使用与备份说明
- `docs/SCORING.md`：本文档
- 测试：`test/ip-compliance.test.js`、`test/memory.test.js`、`test/orchestrator-gate.test.js`、`smoke_test.mjs`

### 5.5 可提交的复现与审计证据

| 证据 | 入口 | 可验证内容 |
|------|------|------------|
| 统一验证 | `npm run verify` | 构建、全量单测和 smoke test |
| 固定基准 | `npm run benchmark` | 工作流 SHA-256、精度/量化声明、确定性编译延迟 |
| Notebook | `notebooks/reproduce_and_benchmark.ipynb` | 从干净环境执行验证、生成报告并独立复核哈希 |
| 推理配置 | `config/inference-profiles.json` | fast/balanced/quality 档位和并发上限 |
| 审核证据 | Artifact `provenance.review` | 人工批准决定、时间、操作者与审核模式 |
| 生成 lineage | Artifact `itemLineage[].attempts[]` | provider/model/workflow/input/output 哈希和任务关联 |
| 最终合规报告 | `finalVideo.complianceReport` | 文本扫描、素材权利提示、限制、结论与报告哈希 |

演示时建议先运行 `npm run verify` 和 `npm run benchmark`，再在 Co-Create 模式逐步批准一次完整任务，最后展示执行日志、lineage 与最终合规报告。GPU 性能数字必须来自目标 DGX 实测；仓库不会以本地编译耗时替代推理吞吐。

---

## 关键文件索引

| 文件 | 核心功能 |
|------|----------|
| `src/js/orchestrator.js` | 编排器：Agent 调度、`#postGate` 门禁、恢复、回滚、暂停/停止 |
| `src/js/config.js` | 6 步 Pipeline 配置（STEPS, contextKeys） |
| `src/js/agents/*.js` | 6 核心 Agent + qcAgent/qcConsistency/qcTypes/retryAgent/ipComplianceAgent |
| `src/js/artifacts/*.js` | ArtifactStore 版本化 + ArtifactStatus/itemLineage/metrics |
| `src/js/compliance/*.js` | ipDatabase（IP 库）+ ipMatcher（四层证据匹配） |
| `src/js/orchestrator/*.js` | agentRegistry / executionCheckpoint / runState / cancellationToken |
| `src/js/providers/*.js` | registry / llm / image / video / videoComfy / render / template / prompts |
| `src/js/memory.js` + `server/memory.js` | 创作历史（前端建档/快照 + 后端档案读写） |
| `src/js/observability.js` | 执行日志（从 ArtifactStore 派生） |
| `server/dashscope.js` | DashScope 客户端 + `clampVideoDuration` 档位夹取 |
| `server/render.js` | ffmpeg 拼接（copy 失败回退重编码） |
