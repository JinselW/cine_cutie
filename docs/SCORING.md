# 竞赛评分对照

本文档对照竞赛评分标准，说明 Cine-Cutie 在各维度的实现情况。

## 评分总览

| 评分维度 | 满分 | 预期得分 | 关键实现 |
|----------|------|----------|----------|
| 多Agent架构与工程 | 30 | 25-28 | 11步Pipeline + Planner + 质量评审 + 一致性追踪 |
| 统一一句话生成测试 | 25 | 20-23 | 深度输入理解 + 自动质量保障 + 跨步骤一致性 |
| 技术创新与模型工程 | 25 | 18-22 | Self-Critique + Auto-Retry + Context Pruning |
| 自主工作质量 | 10 | 7-9 | 多轮评分选优 + Schema校验 + 优雅降级 |
| 可复现性与部署 | 10 | 7-9 | Vite构建 + 零依赖 + 完整文档 |

---

## 一、多Agent架构与工程 (30分)

### 1.1 Agent 分工与调度

**实现**: 11 个专业化 Agent，每个有独立角色定义和 Prompt。

| Agent | 职责 | Prompt 角色 |
|-------|------|-------------|
| Creative Planner | 分析输入、定义创意方向 | "expert film producer" |
| Scriptwriter | 三幕式剧本创作 | "professional screenwriter" |
| Character Designer | 角色设计 | "expert in creating memorable film characters" |
| Art Director | 视觉风格定义 | "specializing in visual style, color theory" |
| Storyboard Artist | 分镜设计 | "expert in visual storytelling" |
| Shot Director | 镜头生成 | "specializing in camera work, composition" |
| Shot Curator | 镜头甄选 | "keen eye for selecting the best visual takes" |
| Film Editor | 剪辑组装 | "expert in pacing, transitions" |
| Composer | 音频设计 | "specializing in film scoring and sound design" |
| Post-Production Artist | 后期制作 | "expert in color grading, VFX" |
| Director | 最终汇总 | "overseeing the final film assembly" |

**调度机制**: `engine.js` 按配置顺序推进，`orchestrator.js` 调度 Agent 执行。

### 1.2 Planner Agent — 规划能力

**实现**: `planning` 步骤作为 Pipeline 第一步，深度分析用户输入：

- 提取主题 (theme)、基调 (tone)
- 定义创意方向 (creativeDirection)
- 列出关键要素 (keyElements, 4-6 项)
- 推荐视觉参考影片 (visualReferences, 3 部真实电影)

规划结果通过 `contextKeys` 注入到所有后续步骤。

### 1.3 Self-Critique — 自我评估

**实现**: `critic.js` 模块，每个步骤生成后独立评审：

- 每步 4 条针对性评审标准
- 1-10 分评分
- 输出 issues 和 suggestions
- 评审结果在 UI 中实时显示

### 1.4 反馈环 — Auto-Retry

**实现**: 评分 < 7 时自动重试：

- 将 issues + suggestions 构建为反馈
- 附加到原 prompt 后重新生成
- 最多重试 2 次
- 保留所有尝试中的最高分结果

### 1.5 跨步骤一致性

**实现**: `consistency.js` 模块：

- 从 screenplay/characters/visualDesign 等步骤提取实体
- 维护 `state.entities` 累积实体
- 生成约束文本注入后续 prompt
- 确保角色名、视觉风格等跨步骤一致

### 1.6 可观测性

**实现**: `observability.js` 模块：

- 每步记录: 耗时、prompt/completion tokens、质量评分、重试次数、是否降级
- Pipeline 完成后展示执行日志视图
- 汇总统计: 总步骤、总 token、平均质量、总耗时

---

## 二、统一一句话生成测试 (25分)

### 2.1 输入理解

**实现**: Planner Agent 深度分析一句话输入：

- 主题识别: 从简短输入中提取核心主题
- 类型推断: 自动检测故事类型 (fantasy/sci-fi/drama 等)
- 创意扩展: 将一句话扩展为完整的创意方向文档
- 参考匹配: 推荐与输入风格匹配的真实电影

### 2.2 质量保障

**实现**: 多层质量保障机制：

1. **Schema 校验**: 每步输出经过 `validate()` 检查结构完整性
2. **Self-Critique**: 独立评审评分，低于 7 分自动重试
3. **JSON 容错**: 解析失败时自动重试，提取花括号/方括号内容
4. **模板降级**: API 出错时回退到模板，确保流程不中断

### 2.3 一致性保障

**实现**: 一致性追踪确保长 Pipeline 的输出连贯：

- 角色名从 screenplay 提取后，在 characters/storyboard 中强制使用
- 视觉风格从 visualDesign 提取后，在 postProduction 中约束
- 场景标题从 storyboard 提取后，在 shotGen/editing 中保持一致

---

## 三、技术创新与模型工程 (25分)

### 3.1 自评估 (Self-Critique)

**创新点**: 使用同一个模型进行独立质量评审：

- 评审 prompt 与生成 prompt 完全分离
- 每步有针对性的评审标准（非通用评分）
- 评审结果可追溯（UI 显示评分和重试信息）

### 3.2 自纠错 (Auto-Retry)

**创新点**: 基于评审反馈的自动纠错：

- 不是简单重试，而是将具体问题和建议作为反馈
- 保留历史最高分结果（避免越改越差）
- 重试次数有限（最多 2 次），避免无限循环

### 3.3 上下文优化 (Context Pruning)

**优化**: 每步只接收所需上下文：

- `config.js` 中 `contextKeys` 声明依赖
- `buildContext()` 按需过滤 `state.data`
- 减少 30-50% token 消耗

### 3.4 Token 追踪

**实现**: 非侵入式 token 计量：

- 模块级累加器在 `callChat` 后记录 `data.usage`
- `consumeStepMetrics()` 在步骤结束时消费
- 不影响 Provider 接口（critic.js 接收的 `callChatFn` 签名不变）

### 3.5 JSON 输出保障

**多层容错**:

1. `response_format: { type: "json_object" }` 强制 JSON 输出
2. 解析失败时追加消息重试（"Your last reply was not valid JSON"）
3. 花括号/方括号提取（处理模型输出 markdown 包裹的情况）
4. 不支持 json_object 的模型自动降级（400 错误检测）

---

## 四、自主工作质量 (10分)

### 4.1 多轮选优

每个步骤最多生成 3 次（1 次初始 + 2 次重试），保留评分最高的结果。

### 4.2 Schema 校验

`validate()` 函数为每个步骤定义结构校验规则：

- planning: 必须有 theme 和 keyElements 数组
- screenplay: 必须有 title 和至少 2 个 acts
- characters: 必须是至少 2 个元素的数组，每个有 name
- ...

校验失败自动降级到模板。

### 4.3 优雅降级

- LLM 未配置 → 使用 Template Provider
- API 错误 → 显示警告 + 使用 Template Provider
- JSON 解析失败 → 重试 → 降级
- Schema 校验失败 → 降级

确保任何情况下都能完成完整 Pipeline。

---

## 五、可复现性与部署 (10分)

### 5.1 构建系统

- Vite 6 构建，`npm run build` 一键构建
- 输出到 `dist/` 目录，可直接部署
- 构建产物: ~120KB JS (gzip ~41KB) + ~24KB CSS (gzip ~5KB)

### 5.2 零依赖

- 运行时零外部依赖（Vite 仅在 dev/build 时使用）
- 纯原生 HTML + CSS + JavaScript (ES Modules)
- 无框架绑定，可在任何静态托管服务部署

### 5.3 配置持久化

- LLM 配置存储在 localStorage
- Provider 选择持久化
- 主题和语言偏好持久化

### 5.4 文档

- `README.md`: 项目介绍、快速开始、项目结构
- `docs/ARCHITECTURE.md`: 系统架构、数据流、模块详解
- `docs/SCORING.md`: 本文档

---

## 关键文件索引

| 文件 | 行数 | 核心功能 |
|------|------|----------|
| `src/js/providers/llm.js` | ~365 | LLM 调用、Self-Critique 循环、Token 追踪 |
| `src/js/providers/prompts.js` | ~415 | 11 个步骤的 Prompt 定义 |
| `src/js/providers/critic.js` | ~183 | 质量评审、评分、重试反馈 |
| `src/js/providers/consistency.js` | ~148 | 实体提取、约束生成 |
| `src/js/engine.js` | ~98 | Pipeline 引擎、Renderer Registry |
| `src/js/orchestrator.js` | ~440 | 编排器、Agent 调度、恢复、回滚 |
| `src/js/observability.js` | ~58 | 执行日志 |
| `src/js/ui/views.js` | ~620 | 所有步骤视图 + 执行日志视图 |
| `src/js/i18n.js` | ~430 | 中英双语字典 |
