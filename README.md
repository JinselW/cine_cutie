# Cine-Cutie

**一句话灵感 → 完整 AI 短片**

Cine-Cutie 是一个端到端的 AI 电影创作系统。输入一句话故事灵感，系统自动完成从剧本编写到最终成片的全部工作——6 个独立 Agent 依次执行剧本、角色设计、分镜、图片生成、视频生成和后期合成，真正调用 AI 模型生成画面与视频，而非只做文本规划。

## 核心能力

### 6 步全自动 Pipeline

| 步骤 | Agent | 产出 |
|------|-------|------|
| 1. 剧本生成 | Scriptwriter | 角色列表 + 场景列表 + 故事文本（内置叙事弧约束） |
| 2. 角色&场景设计 | Character Designer | 设计稿 + 三视图定妆图 + 正面肖像 + 场景空镜图 |
| 3. 分镜生成 | Storyboard Artist | 集/段/镜头层级结构，含运镜参数与逐镜时长 |
| 4. 图片生成 | Image Director | 按视频模式产出帧图，融合定妆图作图生图参考 |
| 5. 视频生成 | Video Director | 逐片段视频，自动路由到最佳模型 |
| 6. 后期合成 | Post-Production Artist | ffmpeg 拼接、转场、可选音轨生成与混音、成片技术检查 → 最终 MP4 |

### 角色一致性

每个角色在步骤 2 生成三视图定妆图与正面肖像，后续所有包含该角色的镜头复用同一张图作为参考——图片生成阶段做图生图锁定外貌，视频生成阶段用已锁定的帧图做 i2v 首帧，确保角色形象贯穿全片。支持中/英文名匹配（`enName`），跨语言 prompt 也能正确关联。

### 多模式视频生成

在设置面板统一切换，驱动步骤 4 的帧图规划与步骤 5 的素材选取：

| 模式 | 步骤 4 产出 | 步骤 5 输入 |
|------|------------|------------|
| 首帧生视频 | 每镜 1 张首帧（N 张） | 首帧 → i2v |
| 首尾帧生视频 | 首帧 + 尾帧复用下一镜首帧（N+1 张） | 首帧 + 尾帧 → i2v |
| 参考图生视频 | 每镜 1 张身份参考图（N 张） | 身份参考图组（≤5 张） → r2v |
| 自动选择 | Prompt Agent 逐镜规划所需帧图 | 按镜头在 i2v / r2v 间选择，并记录降级路径 |

远程 ComfyUI 在缺少可用图片时还可降级到文生视频；其参考图工作流上限为 6 张，DashScope r2v 上限为 5 张。

### Auto 智能路由

选择「自动」模式时，系统根据每个镜头的内容（是否含角色、场景复杂度）自动评估并为每个片段选择最佳生成方式，混合调度 i2v / r2v 后端，最大化画面质量。

### 质量保障体系

- **Self-Critique 评分**：每步输出由 LLM 按 4 条针对性标准自评 1–10 分（阈值 7），媒体步骤附加多模态评审（真实图片/视频帧）；一致性检查作为硬门禁（最终分 = min(LLM 分, 结构分)）
- **Per-item 自动重试**：媒体项按失败类型选择策略（RETRY_SAME / REWRITE_PROMPT / CHANGE_SEED / SWAP_REFERENCE / GIVE_UP，最多 3 次），文本步追加 critique 反馈重跑
- **成片技术门禁**：DeliveryQC 检查时长、视频流完整性、黑帧、冻结帧、音频，不合格定位修复
- **IP 合规审查**：内置 IP 库 + 四层证据匹配（exact → alias → fuzzy → keyword）+ 策略裁决（BLOCK/WARN/REVIEW/ALLOW），每步输出过合规门禁
- **视觉合规审查**：本地 Tesseract OCR 检查画面文字、品牌词与常见水印，FFmpeg 对视频和最终成片定时抽帧；视觉相似度与公众人物识别通过可选 provider 接入，未配置时明确要求人工复核
- **跨步骤实体追踪**：自动提取角色名、外貌、场景等实体，注入后续步骤确保一致性

### 会话控制

- **暂停/继续/停止**：CancellationToken 统一驱动，AbortSignal 中止在途请求
- **断点续跑**：ExecutionCheckpoint + RunState 持久化进度
- **步骤修订**：对已完成步骤的结果进行编辑后重新执行下游
- **回滚**：回到任意历史检查点

### 可观测性

- **ArtifactStore**：版本化产物追踪，记录 itemLineage（尝试历史）与 metrics
- **执行日志**：Pipeline 完成后展示每步耗时、token 消耗、评分、重试次数、是否降级
- **DGX 实时监控**：选择 ComfyUI 后端后展示 GPU/显存/温度/功耗、系统内存、磁盘、队列及片段进度

### 其他特性

- **提示词文件上传**：支持 .docx/.txt/.md（≤20MB），解析后注入创作
- **逐片段时长**：分镜为每个镜头规划 3–10 秒，服务端按模型支持的档位自动夹取
- **运镜指令**：从分镜提取 camera 参数（pan/tilt/zoom/dolly/tracking），自动转为 motion prompt
- **创作历史 Memory**：自动保存会话与素材引用，支持搜索、预览、重命名、导出（详见 [docs/MEMORY.md](docs/MEMORY.md)）
- **字幕基础设施**：可按最终镜头顺序和时长生成 SRT；当前因视频生成链路默认无对白音轨，烧录开关暂时关闭，避免画面字幕与实际声音不一致
- **Seed 可复现**：图片和视频生成支持 seed 参数
- **优雅降级**：未配置 API Key 时自动使用模板生成，仍可体验完整流程
- **中英双语**：完整 i18n 支持
- **LRU 缓存**：LLM 调用结果缓存，减少重复请求
- **双后端视频生成**：DashScope 通义万相 + 远程 ComfyUI（H3 模型，DGX Spark 经 SSH 隧道）

## 快速开始

### 前置要求

- Node.js >= 18
- DashScope API Key（[阿里云百炼](https://dashscope.console.aliyun.com/) 申请）
- ffmpeg（`ffmpeg-static` 通常随依赖安装；也可用 `FFMPEG_BIN` 指向系统 ffmpeg）

### 安装 & 启动

```bash
npm install
npm run build
npm run server
```

打开浏览器访问 `http://localhost:3006`。

### 开发模式

```bash
npm run dev     # Vite 开发服务器（前端热更新，端口 3000）
npm run server  # 另一个终端启动后端 API（3006）
```

### 配置

点击页面右上角设置按钮，填入 API Key。所有模型在设置面板中选择，代码不写死模型名。

| 用途 | 默认模型 |
|------|---------|
| 文本及评估 | `qwen-plus`（任意 OpenAI 兼容 API，需自行配置 endpoint + key） |
| 文生图 | `wan2.6-t2i` |
| 图生图 | `wan2.6-image` |
| 视频生成 | 按模式选择：首帧 `wan2.6-i2v`、首尾帧 `wan2.7-i2v`、参考图 `wan2.7-r2v` |

## Pipeline 流程

```
用户输入（一句话故事 + 时长）
        │
        ▼
┌──────────────────┐
│  1. 剧本生成      │  LLM → 角色列表 + 场景列表 + 故事文本
│     Script        │  内置叙事弧：setup → development → climax → resolution
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  2. 角色&场景设计  │  LLM 写设计稿(design/visualTag/palette)
│    CharDesign    │  → 文生图：三视图定妆图 + 正面肖像 + 场景空镜
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  3. 分镜生成      │  LLM → 集/段/镜头层级，含 camera 运镜 + 逐镜时长
│    Storyboard    │  内置镜头间连续性约束
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  4. 图片生成      │  按视频模式产出帧图
│    RefImages     │  命中角色的定妆图作图生图参考，融合 visualTag + 分镜 prompt
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  5. 视频生成      │  按视频模式取帧图，路由到 i2v / r2v 模型
│    VideoGen      │  提示词融合 beat + 分镜 prompt + 运镜 motion
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  6. 后期合成      │  ffmpeg 拼接/转场 + 可用音轨混音 → 最终 MP4
│    PostProd      │  技术 QC；不满足转场条件时回退纯拼接
└──────────────────┘
```

## 项目结构

```
cine-cutie/
├── index.html                       # 入口页面
├── vite.config.js                   # Vite 构建配置
├── package.json
├── Dockerfile                       # 多阶段构建（适配魔搭创空间）
├── .env.example                     # 环境变量说明
│
├── server/                          # Express 后端 (默认 port 3006)
│   ├── index.js                     # API 路由：LLM 代理、图片/视频、任务、媒体、Memory
│   ├── dashscope.js                 # DashScope API 封装：submitImageTask, submitVideoTask, pollTask
│   ├── comfyui.js                   # 远程 ComfyUI 客户端（workflow 补丁式改写）
│   ├── ssh-tunnel.js                # 到 DGX Spark 的 SSH 隧道
│   ├── memory.js                    # 创作历史档案读写
│   ├── cache.js                     # LRU 缓存
│   ├── tasks.js                     # 异步任务向后兼容层（委托 TaskStore）
│   ├── task-store.js                # TaskStore 接口 + InMemory / File 持久化实现
│   ├── task-controller.js           # 任务调度：并发控制、幂等提交、重启恢复、取消、清理
│   ├── render.js                    # ffmpeg 拼接、转场、BGM 与字幕处理
│   ├── audio-mix.js                 # TTS/SFX 生成、时间线混音与 lineage
│   ├── audio-providers.js           # 服务端音频 Provider 注册表
│   ├── visual-compliance.js         # OCR、视频抽帧与可选视觉检查器
│   ├── ark.js                       # 火山方舟图片/视频任务适配
│   ├── inference-profiles.js        # 推理档位加载与约束
│   └── workflows/                   # ComfyUI H3 工作流模板（t2v / 首帧 / 首尾帧 / 参考图）
│
├── src/
│   ├── css/                         # 样式
│   │   ├── base.css                 # 基础样式与 CSS 变量
│   │   ├── components.css           # 通用组件
│   │   ├── pipeline.css             # Pipeline 视图
│   │   ├── animations.css           # 动画
│   │   ├── history.css              # 创作历史面板
│   │   └── responsive.css           # 响应式适配
│   │
│   └── js/
│       ├── main.js                  # 应用入口
│       ├── config.js                # 6 步 Pipeline 定义（STEPS, contextKeys）
│       ├── state.js                 # 全局状态
│       ├── engine.js                # 转发壳（startPipeline / reviseStep / restoreSession）
│       ├── orchestrator.js          # 编排器：Agent 调度、门禁、恢复、回滚、暂停/停止
│       ├── memory.js                # 创作历史前端（自动建档、快照、搜索、导出）
│       ├── observability.js         # 执行日志（从 ArtifactStore 派生）
│       ├── i18n.js                  # 国际化（中/英）
│       ├── navigation.js            # 视图导航
│       ├── mascot-interact.js       # 吉祥物交互
│       │
│       ├── agents/                  # 核心 Agent
│       │   ├── baseAgent.js         # BaseAgent 基类（CancellationToken 边界）
│       │   ├── scriptAgent.js       # 剧本生成 + JSON 修复
│       │   ├── characterAgent.js    # 角色&场景设计稿 + 定妆图 + 场景空镜
│       │   ├── storyboardAgent.js   # 分镜（集/段/镜头）+ 时长收敛
│       │   ├── referenceAgent.js    # 按 videoMode 规划帧图 + 图生图参考
│       │   ├── videoAgent.js        # 按 videoMode 路由取素材 + 运镜 motion
│       │   ├── editorAgent.js       # 拼接、声音规划/混音与成片交付
│       │   ├── promptAgent.js       # 图片/视频共用的内部 Prompt 服务
│       │   ├── qcAgent.js           # Self-Critique 评分 + 硬门禁
│       │   ├── deliveryQCAgent.js   # 成片技术门禁 + 多模态创意评审
│       │   ├── deliveryQC.js        # 时长/视频流/黑帧/冻结帧阈值判定
│       │   ├── qcConsistency.js     # 实体提取/合并 + 一致性约束
│       │   ├── qcTypes.js           # QCVerdict / Severity / FailureType
│       │   ├── retryAgent.js        # per-item 重试策略规划
│       │   └── ipComplianceAgent.js # IP 合规筛查
│       │
│       ├── artifacts/               # ArtifactStore 版本化产物追踪
│       ├── compliance/              # IP 数据库 + 四层证据匹配
│       ├── audio/                   # 声音规划、客户端与 TTS/SFX Provider
│       ├── prompts/                 # Prompt schema、编译、模式规划与适配
│       ├── orchestrator/            # agentRegistry / checkpoint / runState / cancellationToken
│       │
│       ├── providers/               # 后端 Provider 层
│       │   ├── registry.js          # Provider 注册与 capability 调度
│       │   ├── llm.js               # LLM（OpenAI 兼容 API）
│       │   ├── image.js             # 图片（DashScope 文生图 + 图生图编辑）
│       │   ├── video.js             # 视频（DashScope i2v / r2v）
│       │   ├── videoComfy.js        # 视频（远程 ComfyUI H3）
│       │   ├── render.js            # 后期渲染（ffmpeg）
│       │   ├── template.js          # 模板（离线降级）
│       │   └── prompts.js           # 所有步骤的 Prompt 模板
│       │
│       ├── utils/                   # 分辨率 + 多模态帧采样
│       │
│       └── ui/
│           ├── render.js            # UI 渲染工具 + Pipeline 控制回调
│           ├── views.js             # 各步骤视图 + 执行日志
│           ├── settings.js          # 设置面板（模型/视频模式/代理/SSH）
│           ├── history.js           # 创作历史面板
│           ├── lightbox.js          # 图片灯箱
│           ├── structuredEditor.js  # 结构化编辑器
│           └── comfyMonitor.js      # DGX 实时监控面板
│
├── test/                            # 单元测试（node:test）
├── docs/                            # 补充文档（ARCHITECTURE / MEMORY / SCORING）
├── data/memory/                     # 创作历史档案（<UUID>.json）
└── media/                           # 生成的图片/视频文件
```

## API 接口

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/chat/completions` | POST | LLM 代理（OpenAI 兼容，带 LRU 缓存） |
| `/api/generate/image` | POST | 批量生图（无 refs 走文生图，有 refs 走图生图编辑） |
| `/api/generate/video` | POST | 批量图生视频（V1 走 img_url，wan2.7 走 media 数组） |
| `/api/generate/video-comfy` | POST | 远程 ComfyUI 生成（H3，经 SSH 隧道） |
| `/api/upload/prompt` | POST | 解析提示词文件（.docx/.txt/.md，≤20MB） |
| `/api/audio/generate` | POST | 生成 TTS/SFX 音频并返回 lineage；不可用时明确降级 |
| `/api/upload/bgm` | POST | 上传后期使用的 BGM 文件 |
| `/api/render/final` | POST | ffmpeg 拼接/转场，并按请求混入音频、BGM或烧录字幕 |
| `/api/compliance/visual` | POST | 对仓库媒体执行 OCR、抽帧及可选视觉检查 |
| `/api/memory` | GET/POST | 创作历史：摘要列表 + 全文搜索 / 创建记录 |
| `/api/memory/:id` | GET/PUT/PATCH/DELETE | 读取 / 保存快照 / 重命名 / 删除 |
| `/api/comfyui/status` | GET | SSH 隧道 + GPU 状态 |
| `/api/comfyui/monitor` | GET | DGX 实时监控（GPU/显存/磁盘/队列） |
| `/api/task/:id` | GET | 查询异步任务状态 |
| `/api/task/:id/cancel` | POST | 取消排队中或运行中的任务 |
| `/api/tasks` | GET | 列出全部任务（按创建时间倒序） |
| `/api/tasks/health` | GET | 任务调度诊断（并发/队列/恢复） |
| `/api/media/:filename` | GET | 获取媒体文件 |
| `/api/cache/stats` · `/clear` | GET/POST | LLM 缓存统计 / 清空 |
| `/api/health` | GET | 健康检查 |

## 环境变量

通过 `.env` 文件或环境变量配置，完整说明见 [.env.example](.env.example)：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `HOST` | `127.0.0.1` | 服务监听地址 |
| `PORT` | `3006` | 服务端口 |
| `COMFY_SSH_PASSWORD` | （空） | DGX Spark SSH 密码，不设则 ComfyUI 能力关闭 |
| `COMFY_SSH_HOST` | （空） | SSH 目标地址 |
| `COMFY_SSH_PORT` | `6078` | SSH 端口 |
| `COMFY_SSH_USER` | `Developer` | SSH 用户 |
| `COMFY_SSH_COMFY_PORT` | `8188` | ComfyUI 端口 |
| `MEDIA_DIR` | `./media` | 生成素材存储目录 |
| `MEMORY_DIR` | `./data/memory` | 创作历史存储目录 |
| `FFMPEG_BIN` | （空） | 指定后 ffmpeg-static 不下载，直接用该路径 |
| `TASK_STORE_DIR` | `./data/tasks` | 持久化任务存储目录（不设则用内存存储） |
| `TASK_MAX_CONCURRENCY` | `4` | 全局最大并行任务数 |
| `TASK_PER_OWNER_LIMIT` | `2` | 单个 owner 最大并行任务数 |
| `TASK_RETENTION_HOURS` | `1` | 已完成任务保留时长（小时），超时自动清理 |

## 测试

```bash
npm test          # 自动发现并运行全部 test/*.test.js
npm run test:smoke # 快速验证构建产物、Pipeline 和字幕链路
npm run verify     # 构建 + 全量测试 + smoke test
npm run benchmark  # 生成工作流哈希、量化证据与本地编译基准
```

真实 ComfyUI/H3 benchmark 需在已配置 DGX SSH 环境显式设置 `CINE_BENCH_REAL=1`；支持四种视频模式、fast/balanced/quality 档位、受 profile 上限约束的有界并发、GPU/内存/磁盘采样及输出哈希。缺少合法图像输入会记录跳过原因，未连接 GPU 会记录 `measured=false`，不会写入估算数据。精确命令和字段定义见 [模型工程说明](docs/MODEL_ENGINEERING.md)。

测试覆盖：ArtifactStore 依赖与持久化、DeliveryQC 门禁、审核决定、最终合规报告、生成 lineage、Prompt Agent、ComfyUI 工作流、DashScope 视频输入、视频模式规划、文本与视觉合规、Memory、重试策略、进度追踪、转场、字幕与 BGM。视觉合规的部署方式和门禁语义见 [视觉合规说明](docs/VISUAL_COMPLIANCE.md)。

复现与模型工程证据见 [模型工程说明](docs/MODEL_ENGINEERING.md)、[复现 Notebook](notebooks/reproduce_and_benchmark.ipynb) 和生成的 [benchmark 报告](reports/benchmark.json)。Co-Create 模式同时承担逐阶段人工审核，并把批准记录固化到 Artifact provenance；最终页会展示带限制声明和哈希的合规报告。

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | 原生 HTML/CSS/JS (ES Modules)，零框架依赖 |
| 构建 | Vite 6 |
| 后端 | Node.js + Express |
| AI 模型 | 任意 OpenAI 兼容 API（文本）、DashScope 通义万相（图片/视频）、ComfyUI H3（视频） |
| 视频处理 | ffmpeg（通过 ffmpeg-static 或系统安装） |
| 远程 GPU | DGX Spark (GB10) 经 SSH 隧道运行 ComfyUI |
| 部署 | Docker 多阶段构建 |

## Docker 部署

镜像内默认监听 `0.0.0.0:7860`（魔搭创空间的固定端口要求），本地运行需映射端口：

```bash
docker build -t cine-cutie .
docker run -p 3006:7860 -v cine-cutie-work:/mnt/workspace cine-cutie
# 浏览器访问 http://localhost:3006
```

如需换回 3006 作为容器内端口：`docker run -e PORT=3006 -p 3006:3006 cine-cutie`。

## 部署到魔搭创空间

官方文档：[Docker 创空间介绍](https://modelscope.cn/docs/studios/docker)。

### 前置条件

- 魔搭账号已绑定阿里云并完成实名认证（Docker 创空间仅对实名用户开放）
- 本地安装 Git 与 Git LFS
- 不需要本地安装 Docker（平台侧构建）

### 步骤

1. **创建创空间**：登录后点击右上角头像 →「创建创空间」，接入 SDK 选 **Docker**，按需选 CPU 资源规格，创建空仓库。

2. **克隆仓库**（带令牌免后续认证）：

   ```bash
   git lfs install
   git clone https://oauth2:<你的访问令牌>@www.modelscope.cn/studios/<账号>/<空间名>.git
   ```

   访问令牌在「个人中心 → 访问令牌」获取。

3. **拷入项目文件**：将 `src/`、`server/`、`index.html`、`vite.config.js`、`package.json`、`package-lock.json`、`Dockerfile`、`.dockerignore` 复制进克隆目录。不要提交 `.env`、`node_modules/`、`dist/`、`media/`、`data/`。

4. **保留平台 README 头部**：创空间的 `README.md` YAML 头（`domain` / `license` / `tags` 等）被平台解析。请把本项目 README 正文并到平台 YAML 头**之下**，不要整体覆盖。

5. **提交推送**：

   ```bash
   git add -A && git commit -m "deploy: cine-cutie docker studio" && git push
   ```

6. **上线**：创空间详情页 →「设置」→「上线」。构建日志与运行日志在「查看日志」抽屉里。

### 部署注意事项

- **端口**：服务必须监听 `0.0.0.0:7860`（不可改），容器内 `8080` 被平台进程占用。Dockerfile 已配好。
- **环境变量**：仅在设置页配置，**运行时注入**（Beta 阶段构建期拿不到），改完需「重启创空间」。
- **持久化**：容器文件系统重启即清空，只有 `/mnt/workspace` 是持久卷。Dockerfile 已将 `MEDIA_DIR` 和 `MEMORY_DIR` 指向该路径。
- **保留头**：`Authorization`、`X-modelscope-*`、`X-studio-*` 被平台占用（本项目的出站 DashScope 请求不受影响）。
- **ComfyUI**：创空间无法访问内网 DGX Spark。保持不设 `COMFY_SSH_PASSWORD`，视频生成使用 DashScope 后端。
- **用户 Key**：访问者在设置面板填自己的 DashScope Key，存在各自的 localStorage，不随代码泄露。
- **构建优化**：镜像用 `registry.npmmirror.com` 拉依赖，apt 安装 ffmpeg + `FFMPEG_BIN` 绕开 GitHub 下载。若基础镜像 `node:20-bookworm` 拉取慢，可换为魔搭 ACR 内的等价镜像。

## 许可证

MIT
