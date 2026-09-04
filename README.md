# Cine-Cutie6666

AI Movie Creation Agent -- 一句话灵感，完整短片制作。

Cine-Cutie 是一个基于多 Agent 协作的 AI 电影创作系统。用户只需输入一句话的故事灵感，系统便会自动完成从创意规划、剧本编写、角色设计、视觉风格、分镜、镜头生成与甄选、剪辑、音频设计、后期制作到最终成片的完整电影制作流程。

## 核心特性

- **11 步专业 Pipeline**: 模拟真实电影制作流程，每步由专属 Agent 负责
- **Self-Critique 质量保障**: 每个步骤自动评分，低于阈值自动重试（最多 2 次），保留最优结果
- **跨步骤一致性追踪**: 自动提取角色名、视觉风格等实体，注入后续步骤确保一致性
- **上下文裁剪**: 每个步骤只接收所需上下文，减少 30-50% token 消耗
- **可观测性**: 完整的执行日志，记录每步耗时、token 消耗、质量评分、重试次数
- **双模式**: Auto Pilot（全自动）和 Co-Create（逐步协作）
- **中英双语**: 完整 i18n 支持
- **优雅降级**: LLM 未配置或出错时自动回退到模板生成

## 快速开始

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 构建生产版本
npm run build
```

打开浏览器访问开发服务器地址，点击设置按钮配置你的 LLM API：
- **API Endpoint**: OpenAI 兼容的 API 地址（默认 `https://api.openai.com/v1`）
- **API Key**: 你的 API 密钥
- **Model**: 模型名称（如 `gpt-4o-mini`、`deepseek-chat` 等）

也可以不配置 API，使用内置模板体验完整流程。

## 技术栈

- **前端**: 原生 HTML + CSS + JavaScript (ES Modules)
- **构建**: Vite 6
- **API**: OpenAI-compatible Chat Completions API
- **存储**: localStorage（配置持久化）
- **无框架依赖**: 零运行时依赖，极轻量

## 项目结构

```
cine-cutie/
├── index.html                  # 入口页面
├── vite.config.js              # Vite 构建配置
├── src/
│   ├── css/
│   │   ├── base.css            # CSS 变量、主题、基础样式
│   │   ├── animations.css      # 动画定义
│   │   ├── components.css      # 组件样式（模态框、按钮等）
│   │   ├── pipeline.css        # Pipeline 和步骤内容样式
│   │   └── responsive.css      # 响应式适配
│   └── js/
│       ├── main.js             # 应用入口，事件绑定
│       ├── config.js           # Pipeline 步骤配置（STEPS）
│       ├── state.js            # 全局状态管理
│       ├── engine.js           # Pipeline 引擎（推进、修改、渲染调度）
│       ├── agents.js           # Agent 运行器（上下文构建、实体提取）
│       ├── observability.js    # 执行日志与可观测性
│       ├── i18n.js             # 国际化（中/英）
│       ├── media.js            # 文件上传处理
│       ├── utils.js            # 工具函数
│       ├── providers/
│       │   ├── registry.js     # Provider 注册与调度
│       │   ├── llm.js          # LLM Provider（API 调用、重试、评分）
│       │   ├── template.js     # 模板 Provider（离线降级）
│       │   ├── prompts.js      # 所有步骤的 Prompt 模板
│       │   ├── critic.js       # Self-Critique 质量评审
│       │   └── consistency.js  # 实体追踪与一致性约束
│       ├── ui/
│       │   ├── render.js       # UI 渲染工具（pipeline 进度条、吉祥物等）
│       │   ├── views.js        # 各步骤的视图渲染 + 执行日志视图
│       │   └── settings.js     # 设置面板逻辑
│       └── templates/          # 离线模板数据
└── docs/
    ├── ARCHITECTURE.md         # 系统架构文档
    └── SCORING.md              # 竞赛评分对照
```

## 架构概览

```
用户输入
    │
    ▼
┌─────────────────────────────────────────────────────┐
│                   Engine (engine.js)                 │
│  startPipeline → advanceStep → renderStep → next    │
└──────────┬──────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────┐
│              Agent Runner (agents.js)                │
│  buildContext → provider.generate → extractEntities  │
└──────────┬──────────────────────────────────────────┘
           │
     ┌─────┴─────┐
     ▼           ▼
┌─────────┐ ┌──────────┐
│  LLM    │ │ Template │   ← Provider Registry
│Provider │ │ Provider │
└────┬────┘ └──────────┘
     │
     ├─→ buildMessages (prompts.js)
     ├─→ callChat (API)
     ├─→ critiqueOutput (critic.js)  ← Self-Critique
     ├─→ validate (schema check)
     └─→ consumeStepMetrics → observability.js
```

详细架构说明请查看 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## Pipeline 步骤

| # | 步骤 | Agent | 说明 |
|---|------|-------|------|
| 1 | Creative Planning | Creative Planner | 分析用户输入，生成创意方向文档 |
| 2 | Screenplay | Scriptwriter | 编写三幕式剧本 |
| 3 | Character Design | Character Designer | 设计 3-5 个角色 |
| 4 | Visual Design | Art Director | 定义视觉风格、色彩方案 |
| 5 | Storyboard | Storyboard Artist | 创建 7-9 个场景的分镜 |
| 6 | Shot Generation | Shot Director | 每场景生成 3 个镜头 |
| 7 | Shot Curation | Shot Curator | 为每场景选择最佳镜头 |
| 8 | Editing | Film Editor | 组装剪辑时间线 |
| 9 | Audio Design | Composer | 设计音乐和音效 |
| 10 | Post-Production | Post-Production Artist | 调色、VFX、最终混音 |
| 11 | Final Film | Director | 汇总成片信息 |

## 许可证

MIT
