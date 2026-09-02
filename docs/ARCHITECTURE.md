# 系统架构

## 整体架构

Cine-Cutie 采用分层架构，核心关注点分离为：Pipeline 编排、Agent 运行、Provider 调度、质量保障、可观测性。

```
┌─────────────────────────────────────────────────────────────────┐
│                        Presentation Layer                        │
│  index.html ─ main.js ─ ui/render.js ─ ui/views.js ─ i18n.js  │
└──────────────────────────────┬──────────────────────────────────┘
                               │
┌──────────────────────────────┴──────────────────────────────────┐
│                      Orchestration Layer                         │
│  engine.js (Pipeline 推进/修改/渲染调度)                          │
│  agents.js (Agent 运行/上下文构建/实体提取)                       │
└──────────────────────────────┬──────────────────────────────────┘
                               │
┌──────────────────────────────┴──────────────────────────────────┐
│                       Provider Layer                             │
│  registry.js ─ llm.js ─ template.js ─ prompts.js               │
└──────────┬───────────────────────┬──────────────────────────────┘
           │                       │
┌──────────┴──────────┐ ┌─────────┴──────────────────────────────┐
│  Quality Assurance  │ │         Cross-Cutting Concerns          │
│  critic.js          │ │  observability.js  consistency.js       │
│  (Self-Critique)    │ │  (执行日志)         (一致性追踪)          │
└─────────────────────┘ └────────────────────────────────────────┘
```

## 核心模块详解

### 1. Pipeline 引擎 (`engine.js`)

引擎负责 Pipeline 的生命周期管理：

- **`startPipeline()`**: 初始化状态，重置执行日志，开始第一步
- **`advanceStep()`**: 推进到下一步 — 运行 Agent、存储结果、渲染视图
- **`reviseStep(stepId, feedback)`**: 根据用户反馈重新执行某步

引擎使用 **Renderer Registry** 模式消除重复代码：

```js
const RENDERERS = {
  planning: (r, _sb, cb) => renderPlanning(r, cb),
  screenplay: (r, _sb, cb) => renderScreenplay(r, cb),
  // ...
};

function renderStep(stepId, result, onAdvance) {
  const fn = RENDERERS[stepId];
  if (fn) fn(result, state.data.storyboard, onAdvance);
}
```

`advanceStep` 和 `reviseStep` 共用同一个 `renderStep()`，避免了 switch 块重复。

### 2. Agent 运行器 (`agents.js`)

每个步骤的执行通过 `runAgent(stepId, feedback)` 完成：

1. **查找 Provider**: 根据步骤的 `capability` 从 Registry 获取活跃 Provider
2. **构建上下文**: `buildContext(stepId)` 根据 `contextKeys` 裁剪所需数据
3. **注入一致性约束**: `buildConsistencyConstraints()` 生成实体约束文本
4. **调用生成**: `provider.generate({ step, genre, context })`
5. **收集指标**: `consumeStepMetrics()` 获取 token 使用量等数据
6. **记录日志**: `logStepStart` / `logStepComplete` 记录到执行日志
7. **提取实体**: `extractEntities(stepId, result)` 更新一致性追踪器

#### 上下文裁剪 (Context Pruning)

每个步骤在 `config.js` 中声明 `contextKeys`，`buildContext` 只注入所需数据：

```js
// config.js
{ id: 'characters', contextKeys: ['planning', 'screenplay'], ... }

// agents.js
function buildContext(stepId) {
  const step = STEPS.find(s => s.id === stepId);
  const keys = step?.contextKeys || [];
  const ctx = { userInput, genre, media, constraints };
  for (const key of keys) {
    if (d[key] != null) ctx[key] = d[key];
  }
  return ctx;
}
```

这确保每个步骤只接收相关上下文，减少 token 消耗 30-50%。

### 3. Provider 系统

#### Registry (`registry.js`)

Provider 注册表，支持按 capability 查找和切换：

```js
registerProvider(provider)     // 注册
getActiveProvider(capability)  // 获取当前活跃的 Provider
setActiveProvider(cap, id)     // 切换
```

#### LLM Provider (`llm.js`)

核心 Provider，处理与 OpenAI-compatible API 的交互：

**生成流程**:
1. `buildMessages(step, context)` → 构建 system/user 消息
2. `callChat(messages)` → 调用 API
3. `parseJson(raw)` → 解析 JSON（含容错：提取花括号/方括号内容）
4. `validate(step, data)` → Schema 校验
5. Self-Critique 循环（见下方）
6. 返回最优结果

**错误处理链**:
- JSON 解析失败 → 自动重试一次（提示模型重新输出纯 JSON）
- API 错误 / 校验失败 → 降级到 Template Provider
- 超时 → 90 秒 AbortController

**Token 追踪**:
模块级 `stepUsage` 累加器在每次 `callChat` 后记录 `data.usage`，通过 `consumeStepMetrics()` 在步骤结束时消费并重置。

#### Template Provider (`template.js`)

离线降级方案，当 LLM 未配置或出错时使用预定义模板生成数据。

### 4. Self-Critique 质量保障 (`critic.js`)

每个步骤生成后，进行独立的质量评审：

```
生成结果 → critiqueOutput() → 评分
    │                          │
    │    score >= 7             │ score < 7
    ├─→ 接受 ✓                 ├─→ 构建反馈 → 重新生成（最多 2 次）
    │                          │
    └─→ 保留最高分结果 ←────────┘
```

**评审标准** (每个步骤 4 条，1-10 分):

| 步骤 | 评审维度 |
|------|----------|
| screenplay | 结构完整性、角色声音、场景描写、与创意方向一致 |
| characters | 角色区分度、描写生动性、故事服务性、名字记忆度 |
| visualDesign | 色彩和谐性、风格独特性、灯光匹配度、色彩角色定义 |
| storyboard | 故事弧覆盖、视觉区分度、描写具体性、视觉节奏 |
| ... | 每步都有针对性的 4 条标准 |

评审结果通过 `reportScore()` 和 `reportRetry()` 在 UI 中显示。

### 5. 一致性追踪 (`consistency.js`)

维护跨步骤的实体一致性：

**实体提取** (`extractEntities`):
- `planning` → theme, tone
- `screenplay` → 角色名（正则匹配动作描写和对白）、地点、标题、类型
- `characters` → 角色详情（名字、角色、emoji、描述）
- `visualDesign` → 视觉风格、色彩方案、灯光
- `storyboard` → 场景标题

**约束生成** (`buildConsistencyConstraints`):
将提取的实体转换为约束文本，注入到后续步骤的 prompt 末尾：

```
CONSISTENCY CONSTRAINTS — You MUST follow these:
- Film title: "The Last Library"
- Theme: "Discovery"
- Character names (use these exactly): Lily, Mr. Finch, Emma
- Visual style: "Painterly Mysticism"
- Color palette: Midnight Blue (#1a1a3e), Gold (#d4a574), ...
```

### 6. 可观测性 (`observability.js`)

记录每个步骤的执行指标：

```js
{
  stepId: 'screenplay',
  agentName: 'Scriptwriter',
  startTime: 1700000000000,
  duration: 3.2,           // 秒
  tokens: { prompt: 1250, completion: 890 },
  qualityScore: 8.5,       // Self-Critique 评分
  retryCount: 1,           // 自动重试次数
  fallbackUsed: false      // 是否降级到模板
}
```

Pipeline 完成后，用户可查看执行日志视图，包含：
- 汇总统计：完成步骤数、总 token、平均质量分、总耗时
- 详细表格：每步的 Agent、耗时、token、质量分、重试次数

### 7. Prompt 工程 (`prompts.js`)

每个步骤有独立的 system prompt 和 `buildUser(ctx)` 函数：

- **System Prompt**: 定义 Agent 角色 + JSON 输出规则 + 语言规则
- **buildUser**: 根据上下文动态构建用户消息，包含 JSON Schema 定义
- **约束注入**: `ctx.constraints`（一致性约束）追加到用户消息末尾
- **反馈注入**: `ctx.feedback`（修改反馈）追加修订请求

所有 prompt 遵循统一模式：
1. 角色定义
2. 上下文信息（上游步骤结果摘要）
3. JSON Schema 定义（精确到字段类型和约束）
4. 输出要求列表

## 数据流

```
用户输入 → state.userInput
              │
              ▼
        ┌── planning ──┐
        │  { theme,     │
        │    tone,      │
        │    ... }      │
        └──────┬───────┘
               │ contextKeys: []
               ▼
        ┌── screenplay ─┐
        │  { title,      │
        │    acts,       │
        │    text }      │
        └──────┬────────┘
               │ contextKeys: ['planning']
               ▼
        ┌── characters ──┐
        │  [ { name,     │──→ extractEntities → state.entities
        │     role, ...}]│
        └──────┬─────────┘
               │ contextKeys: ['planning', 'screenplay']
               ▼
           ... (每个步骤类似)
               │
               ▼
        ┌── final ───────┐
        │  { title,       │
        │    status:      │
        │    'Complete' } │
        └─────────────────┘
               │
               ▼
        showCompletion() → renderExecutionLog()
```

## 状态管理 (`state.js`)

全局状态对象：

```js
{
  mode: 'auto' | 'interactive',
  currentStep: -1,          // 当前步骤索引
  genre: 'fantasy',         // 自动检测的类型
  userInput: '',            // 用户输入
  media: [],                // 上传的文件
  entities: {},             // 一致性追踪实体
  data: {
    planning: null,         // 每步的输出结果
    screenplay: null,
    characters: null,
    // ... 共 11 个数据槽
  }
}
```

## 国际化 (`i18n.js`)

中英双语支持，通过 `t(key, params)` 获取翻译文本：

```js
t('steps.screenplay.agent')                    // "Scriptwriter" / "编剧"
t('ui.receivedFeedback', { step, feedback })   // 带参数替换
```

字典包含 ~100 个 key，覆盖 UI、步骤名称、生成消息、错误信息等。
