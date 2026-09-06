# Cine-Cutie

**一句话灵感 → 完整 AI 短片**

Cine-Cutie 是一个端到端的 AI 电影创作系统。输入一句话故事灵感，自动完成剧本、角色设计、分镜、图片生成、视频生成到最终剪辑成片的全流程。

## 特性

- **6 步全自动 Pipeline**：剧本 → 角色&场景设计 → 分镜 → 图片生成 → 视频生成 → 后期合成
- **端到端视频输出**：不只是文本规划——真正调用 DashScope API 生成图片和视频，最终用 ffmpeg 拼接成片
- **角色一致性**：先由 LLM 写出角色/场景设计稿（design + visualTag + palette），再据此生成三视图定妆图（正/背/侧）、正面肖像与场景空镜图；图片生成阶段把命中的定妆图与场景图作为图生图参考，所有包含该角色的视频片段复用同一张正面图作为 i2v 首帧，保持角色外貌贯穿全片
- **跨语言角色匹配**：支持中/英文名匹配（enName），确保角色名在不同语言 prompt 中正确关联
- **运镜指令**：从分镜数据提取 camera 参数（pan/tilt/zoom/dolly/tracking），自动转为视频 motion prompt
- **剧情连贯性约束**：剧本和分镜 prompt 内置叙事弧（setup → climax → resolution）和镜头间连续性要求
- **Self-Critique 质量保障**：每步输出自动评分，低于阈值重试，保留最优结果
- **跨步骤实体追踪**：自动提取角色名、外貌、场景等实体，注入后续步骤确保一致性
- **Seed 可复现**：图片和视频生成支持 seed 参数，相同输入产出稳定
- **优雅降级**：未配置 API Key 时自动使用模板生成，仍可体验完整流程
- **中英双语**：完整 i18n 支持
- **LRU 缓存**：LLM 调用结果缓存，减少重复请求

## 快速开始

### 前置要求

- Node.js >= 18
- DashScope API Key（[阿里云百炼](https://dashscope.console.aliyun.com/) 申请）
- ffmpeg（用于最终视频拼接，`winget install ffmpeg` 或 `brew install ffmpeg`）

### 安装 & 启动

```bash
npm install
npm run build
npm run server
```

打开浏览器访问 `http://localhost:3006`。

### 配置 API

点击页面右上角设置按钮，填入 DashScope API Key。模型全部在设置面板中选择，代码不写死模型名，默认值如下：

| 用途 | 默认模型 |
|------|------|
| 文本及评估 | `qwen-plus`（任意 OpenAI 兼容 API，需自行配置 endpoint + key） |
| 文生图 | `wanx2.1-t2i-turbo` |
| 图生图（角色/场景参考图） | `wan2.6-image` |
| 视频生成 | 按「视频生成方式」选择：首帧 `wanx2.1-i2v-plus`、首尾帧 `wan2.7-i2v`、参考图 `wan2.7-r2v` |

### 开发模式

```bash
npm run dev    # Vite 开发服务器（前端热更新）
npm run server # 另一个终端启动后端 API
```

## Pipeline 流程

```
用户输入（一句话故事 + 时长）
        │
        ▼
┌──────────────────┐
│  1. 剧本生成      │  LLM → 角色列表 + 场景列表 + 故事文本
│     Script        │  内置叙事弧约束：setup → development → climax → resolution
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  2. 角色&场景设计  │  LLM 写设计稿(design/visualTag/palette) → DashScope 文生图
│    CharDesign    │  三视图定妆图 + 正面图 + 场景空镜图，供后续步骤复用
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  3. 分镜生成      │  LLM → 按集/段/镜头层级组织，含 camera 运镜参数
│    Storyboard    │  内置镜头间连续性约束
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  4. 图片生成      │  按设置的视频生成方式产出帧图：首帧→每镜1张，首尾帧→每镜首帧+1张收尾帧（N+1），参考图→每镜1张
│    RefImages     │  命中角色/场景的定妆图作图生图参考，提示词融合剧本 beat + visualTag + 分镜 prompt
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  5. 视频生成      │  按设置的视频生成方式取步骤4的帧图：首帧→i2v 首帧，首尾帧→首帧+尾帧，参考图→身份参考图（≤5张）
│    VideoGen      │  模型取自设置里该方式对应的选项；提示词融合剧本 beat + 分镜 prompt，并附加运镜 motion prompt
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  6. 后期合成      │  ffmpeg 拼接所有视频片段 → 输出最终 MP4
│    PostProd      │
└──────────────────┘
```

## 角色一致性方案

核心问题：每个镜头独立生成图片，同一角色在不同镜头中长相不一致。

解决方案：

1. **角色设计阶段**：LLM 先为每个角色/场景写设计稿（`design` 中文详述 + `visualTag` 英文稳定视觉标签 + `palette`），再用文生图模型按 `visualTag` 生成三视图定妆图（`sheetPath`）、正面肖像（`imagePath`/`imageUrl`）和场景空镜图——同一份标签保证三视图与后续镜头指向同一形象
2. **图片生成阶段**：镜头提示词融合剧本情节（beat）、分镜 prompt 与命中的角色/场景 `visualTag`；同时把命中的定妆图与场景图作为图生图参考，交给设置面板里选择的图生图模型编辑生成，让画面直接继承设计稿的长相
3. **视频生成阶段**：优先把步骤 4 的帧图（已用定妆图做过图生图，长相已锁定）交给视频模型——首帧模式当 i2v 首帧，首尾帧模式再加尾帧，参考图模式直接复用步骤 4 记录的同一组身份参考图；只有帧图缺失时才退回按角色名（中文名 + enName）匹配到的正面肖像

按设置面板的「视频生成方式」决定步骤 4 产出哪些帧：

```
首帧生视频   → 每个分镜 1 张首帧（N 张）
首尾帧生视频 → 每个分镜 1 张首帧；镜头 i 的尾帧直接复用镜头 i+1 的首帧，
              只有最后一个分镜额外生成 1 张收尾帧（共 N+1 张）
参考图生视频 → 每个分镜 1 张角色/场景锁定身份的参考图（N 张）

镜头 prompt 提到 "小明" → 匹配到角色 小明 的定妆图 → 作为图生图参考，并可用该图作 i2v 首帧
镜头 prompt 提到 "Xiao Ming" → 通过 enName 匹配 → 同一张定妆图
镜头 prompt 无角色名 → 仅使用场景空镜图 + 文生图
```

片段时长取自步骤 3 为每个镜头规划的 `duration`（3–10 秒），提交前由服务端按所选模型支持的档位夹取：
`wan2.7` 系列与 `wan2.6-i2v`/`-flash` 接受 2–15 秒的整数，`wanx2.1-i2v-turbo` 只有 3/4/5 秒，
`wan2.5-i2v-preview` 只有 5/10 秒，`wan2.6-i2v-us` 只有 5/10/15 秒，而 `wanx2.1-i2v-plus`（首帧方式的默认模型）
与 `wan2.2-i2v-*` 固定 5 秒不可修改；档位表之外的模型统一按 5 秒提交，避免送出被拒的时长。

## 项目结构

```
cine-cutie/
├── index.html                    # 入口页面
├── vite.config.js                # Vite 构建配置
├── package.json
├── Dockerfile
│
├── server/                       # Express 后端 (port 3006)
│   ├── index.js                  # API 路由：LLM 代理、图片/视频生成、任务管理、媒体服务
│   ├── dashscope.js              # DashScope API 封装：submitImageTask, submitVideoTask, pollTask
│   ├── cache.js                  # LRU 缓存
│   ├── tasks.js                  # 异步任务状态管理
│   └── render.js                 # ffmpeg 视频拼接
│
├── src/
│   ├── css/                      # 样式（base, components, pipeline, animations, responsive）
│   └── js/
│       ├── main.js               # 应用入口
│       ├── config.js             # 6 步 Pipeline 配置（STEPS, contextKeys）
│       ├── state.js              # 全局状态
│       ├── engine.js             # Pipeline 引擎（推进、渲染调度）
│       ├── orchestrator.js       # 编排器（Agent 调度、恢复、回滚）
│       ├── i18n.js               # 国际化（中/英）
│       ├── observability.js      # 执行日志（从 Artifact 派生）
│       ├── agents/               # 6 个 Agent（Script/Storyboard/Character/Reference/Video/Editor）
│       ├── artifacts/            # ArtifactStore + 版本化 + 状态追踪
│       ├── orchestrator/         # ExecutionCheckpoint / RunState / CancellationToken
│       ├── providers/
│       │   ├── registry.js       # Provider 注册与调度
│       │   ├── llm.js            # LLM Provider（OpenAI 兼容 API）
│       │   ├── image.js          # 图片 Provider（DashScope 文生图 + 角色规范图管理）
│       │   ├── video.js          # 视频 Provider（DashScope i2v + 角色图匹配 + 运镜指令）
│       │   ├── template.js       # 模板 Provider（离线降级）
│       │   ├── prompts.js        # 所有步骤的 Prompt 模板
│       │   ├── critic.js         # Self-Critique 质量评审
│       │   ├── consistency.js    # 实体追踪与一致性约束
│       │   └── render.js         # 后期渲染 Provider
│       └── ui/
│           ├── render.js         # UI 渲染工具
│           ├── views.js          # 各步骤视图
│           └── settings.js       # 设置面板
│
└── media/                        # 生成的图片/视频文件存储
```

## API 接口

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/chat/completions` | POST | LLM 代理（转发到 OpenAI 兼容 API，带 LRU 缓存） |
| `/api/generate/image` | POST | 批量生图：无 `refs` 时走文生图，带参考图且设置中选了图生图模型时逐条走图生图编辑 |
| `/api/generate/video` | POST | 批量图生视频：模型由请求体传入（前端读设置里该生成方式对应的模型）；本地 `/api/media` 帧图转 Base64 data URI 后提交——V1 模型走 `input.img_url`（仅首帧），`wan2.7` 系列走 `media` 数组（`first_frame`/`last_frame`/`reference_image`）；每条片段带分镜规划的 `duration`，服务端按该模型支持的档位夹取 |
| `/api/render/final` | POST | ffmpeg 拼接视频片段 |
| `/api/task/:id` | GET | 查询异步任务状态 |
| `/api/media/:filename` | GET | 获取生成的媒体文件 |
| `/api/health` | GET | 健康检查 |

## 技术栈

- **前端**：原生 HTML/CSS/JS (ES Modules)，零框架依赖
- **构建**：Vite 6
- **后端**：Node.js + Express
- **AI 模型**：DashScope（通义万相 wanx2.1 系列）
- **视频处理**：ffmpeg（通过 ffmpeg-static）
- **部署**：Docker 支持

## Docker 部署

```bash
docker build -t cine-cutie .
docker run -p 3006:3006 cine-cutie
```

## 许可证

MIT
