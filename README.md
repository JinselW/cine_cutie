# Cine-Cutie

**一句话灵感 → 完整 AI 短片**

Cine-Cutie 是一个端到端的 AI 电影创作系统。输入一句话故事灵感，自动完成剧本、角色设计、分镜、图片生成、视频生成到最终剪辑成片的全流程。

## 特性

- **6 步全自动 Pipeline**：剧本 → 角色&场景设计 → 分镜 → 参考图片 → 视频生成 → 后期合成
- **端到端视频输出**：不只是文本规划——真正调用 DashScope API 生成图片和视频，最终用 ffmpeg 拼接成片
- **角色一致性**：每个角色生成一张规范肖像，所有包含该角色的视频片段复用同一张图作为 i2v 首帧，保持角色外貌贯穿全片
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

点击页面右上角设置按钮，填入 DashScope API Key。系统使用以下模型：

| 用途 | 模型 |
|------|------|
| 图片生成 | `wanx2.1-t2i-turbo` |
| 视频生成 | `wanx2.1-i2v-turbo` |
| 文本生成 | 任意 OpenAI 兼容 API（需自行配置 endpoint + key） |

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
│  2. 角色&场景设计  │  每个角色/场景 → DashScope 文生图 → 规范肖像
│    CharDesign    │  保留 appearance + imageUrl 供后续步骤复用
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
│  4. 参考图片      │  每个镜头 → DashScope 文生图（prompt 含角色外貌描述）
│    RefImages     │  生成首帧参考图 + 公网 URL
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  5. 视频生成      │  匹配角色规范图 → 作为 i2v 首帧（同一角色全片同一张脸）
│    VideoGen      │  无匹配角色时用镜头参考图；自动附加运镜 motion prompt
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

1. **角色设计阶段**：为每个角色生成一张规范肖像（正面、studio lighting），保存 `imagePath`（本地路径）和 `imageUrl`（公网 URL）
2. **参考图片阶段**：镜头 prompt 中注入匹配角色的 `appearance` 描述
3. **视频生成阶段**：解析每个镜头 prompt 中提到的角色名（支持中文名 + enName 匹配），找到该角色的规范图 `imageUrl`，作为 `wanx2.1-i2v-turbo` 的 `img_url` 参数

```
镜头 prompt 提到 "小明" → 匹配到角色 小明 的规范图 → 用该图作为 i2v 首帧
镜头 prompt 提到 "Xiao Ming" → 通过 enName 匹配 → 同一张规范图
镜头 prompt 无角色名 → 使用镜头参考图作为 fallback
```

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
│       ├── agents.js             # Agent 运行器（上下文构建、实体提取）
│       ├── i18n.js               # 国际化（中/英）
│       ├── observability.js      # 执行日志
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
| `/api/generate/image` | POST | 批量文生图（DashScope wanx2.1-t2i-turbo） |
| `/api/generate/video` | POST | 批量图生视频（DashScope wanx2.1-i2v-turbo） |
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
