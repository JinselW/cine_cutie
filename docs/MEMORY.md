# 创作历史（Memory v1）

右上角 🕘 打开创作历史。每次新创作单独建档，自动保存输入、提示词文件提取文本、修订反馈、Agent 消息、六步结果、Artifact 版本及尝试记录、检查点、实体与模型选择。支持全文搜索、重命名、媒体预览、JSON 导出及单条删除。保存失败会显示可重试提示。

## 存储与使用

- 更新后重启 `npm run server`；开发前端由 Vite 自动刷新。生产部署运行 `npm run build`。
- 元数据在 `data/memory/<UUID>.json`，使用临时文件加 rename 写入；重启服务器和更换浏览器后仍可读取。
- 图片/视频沿用 `media/`，记录保存引用。备份或迁移必须同时保留 `data/` 和 `media/`。JSON 导出不包含媒体二进制文件。
- 删除永久移除该条历史记录，保留磁盘媒体，避免误删共享素材；当前页面正在运行或暂停的创作需先停止再删除。
- 设置快照只选取模型配置与视频模式，不保存 API Key、SSH 密码或其他连接凭据。
- 本版用于现有本地单用户应用，没有新增账号系统；同一后端的访问者共享历史。
- 历史打开为独立预览，不会修改当前任务。当前不支持从历史断点继续执行，也不会自动把历史内容注入新任务。
- 历史从功能启用后的新任务开始记录；旧版本没有保存的历史会话无法重建。旧检查点恢复仍保留原行为。
- 页面被关闭时尚在执行的任务可能保留“运行中 / 上次执行未结束”状态；已保存阶段可以查看，这不代表后台会继续整个流程。
- 所谓完整快照指应用当前生成的数据、消息和产物历史，不包括没有被应用记录的模型内部推理或远端服务日志。

Docker 持久化示例：`docker run -p 3006:3006 -v cine-data:/app/data -v cine-media:/app/media cine-cutie`。

## API

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/memory?q=关键词` | 摘要列表与全文搜索 |
| POST | `/api/memory` | 创建记录 |
| GET | `/api/memory/:id` | 读取完整档案 |
| PUT | `/api/memory/:id` | 保存完整快照；不存在时返回 404 |
| PATCH | `/api/memory/:id` | 重命名 |
| DELETE | `/api/memory/:id` | 删除元数据 |

后端沿用 10MB JSON 请求限制；此版本适用于本地短片记录规模，不是多进程数据库或持久任务调度器。

## 设计参考

- [VideoClaw](https://github.com/HITsz-TMG/VideoClaw)：会话、任务元数据与生成产物分开持久化，按 ID 关联。
- [Open WebUI 历史管理](https://docs.openwebui.com/features/chat-conversations/chat-features/history-search/)：自动保存、历史搜索、重命名、导出与删除。此次借鉴管理方式，没有引入其代码或运行依赖。

验证：`node --test test/memory.test.js`；可选浏览器测试 `node test/memory-browser.mjs <Playwright模块绝对路径>`（使用本机 Edge）。浏览器测试使用独立临时服务和数据，不操作实际历史。
