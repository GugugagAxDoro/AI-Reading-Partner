# AI Reading Partner

本地优先的 AI 阅读工作台：PDF 导入与解析、连续滚动阅读、项目级缓存、选中文本问答、章节/全书小结、Markdown 笔记、脑图与受限 Agent 研究。

## 状态

MVP 的 OpenSpec 变更 `build-ai-reading-agent-mvp` 已归档，行为规范保存在 `openspec/specs/`。当前支持：

- PDF 上传、去重、文本层提取、封面、目录、分块和 SQLite FTS 索引。
- 项目/书库管理、进度保存、处理状态与重试。
- 三栏阅读器、连续滚动、页面跳转、选区锚定与低文本提示。
- 项目级词汇缓存、段落级内容缓存和可见缓存标记。
- 全书/章节/项目小结、Markdown 笔记、Markmap 脑图。
- OpenAI-compatible 模型接入、轻量/强模型路由、工具调用与 JSON plan fallback。
- 当前文档 -> 项目 -> SearXNG 的受限 Agent 检索，安全网页抓取和运行记录。
- 持久化书籍会话、流式回答、停止／重新生成、会话隔离草稿与历史消息分页。
- 桌面选区气泡名词解释／深度解读，完整引用快照、单行中间省略与原文页码跳转。
- 统一安全 Markdown/GFM 展示、笔记阅读／编辑切换、可调侧栏与移动抽屉。

体验优化变更 `refine-reading-workspace-experience` 已归档，行为规范已同步至 `openspec/specs/`。手机真机验证留待后续迭代。

翻译快捷操作、TXT/EPUB 导入和多书向量检索暂不在一期范围。

## 开发

```bash
npm install
npm run dev:server
npm run dev:web
```

服务器监听 `127.0.0.1:8787`，前端监听 `127.0.0.1:5173` 并把 `/api` 代理到服务器。

常用检查：

```bash
npm run typecheck --workspace apps/server --workspace apps/web --workspace packages/core
npm run build --workspace apps/server --workspace apps/web --workspace packages/core
npm run spec:validate
```

测试代码、素材、报告及本地工具配置不随仓库发布；相关 npm 测试命令仅供保留这些文件的本地工作区使用。

## 会话与上下文

右侧会话记录保存在 SQLite，关闭页面不取消后台生成；刷新后恢复已有回答，停止按钮才会取消上游请求。重新生成保留旧消息并创建新的 attempt。不同会话可独立生成，草稿按会话保存在当前浏览器的 sessionStorage。

默认“智能关联”不会将历史问答全部发送给模型；选中原文或独立问题为零历史，点击回答的“追问”才关联该轮。上下文设置支持“不携带历史”和“最近一轮”，默认上限为 1 轮／1000 估算 token，可设 0..2 轮／0..1500 token；任意上限为 0 即关闭历史。比较两个回答需要显式关联并将轮数设为 2。只使用已完成回答，历史超限有省略提示。

模板输入预算为 3000，普通问答为 6000 估算 token，另预留输出 1200 和安全余量 512；同时受所配模型窗口约束。先保护当前问题和完整原文，按预算加入本书相关片段和小结，再加入有界历史，不上传全书。未知供应商没有精确 tokenizer 保证。关闭会话的联网开关会同时禁用搜索和网页抓取。

Markdown 原文不改写，展示禁用 raw HTML、危险链接和自动远程图片；长代码、宽表格在自身区域滚动。阅读／取消笔记编辑不写新版本，保存才沿用原版本机制写入。

## 模型与 SearXNG 配置

复制 `config/providers.example.toml` 到数据目录的 `config/providers.toml` 后手动填写：

- OpenAI-compatible `base_url`、`api_key`、轻量/强模型和上下文窗口。
- `supports_tool_calling` 决定 Agent 使用原生 tool calling，还是 JSON plan fallback。
- `quality_mode` 支持 `fast | balanced | quality`。
- SearXNG 必须是你自建或明确信任的实例，并启用 JSON API。

默认数据目录：

- macOS: `~/Library/Application Support/AI Reading Partner`
- Windows: `%APPDATA%/AI Reading Partner`
- Linux: `~/.local/share/ai-reading-partner`

也可以用环境变量 `AI_READING_PARTNER_DATA_DIR` 覆盖。

## 本地数据布局

```text
{dataRoot}/
  app.db
  backups/before-schema-v2-*.db
  config/providers.toml
  documents/{documentId}/source.pdf
  projects/{projectId}/
    artifacts/notes/*.md
    artifacts/mindmaps/*.html
    agent-runs/{runId}.jsonl
```

SQLite 存书库、解析结果、FTS 索引、缓存、笔记元数据、版本、Agent 运行状态与阅读进度。用户可直接阅读的 Markdown/HTML 产物放在 `artifacts/`；Agent 中间事件放在 `agent-runs/`。

首次从 schema v1 升级时先备份数据库，再事务添加会话／消息／偏好表；已有 PDF、缓存、笔记、小结和进度不重写，也不自动伪造历史消息。服务重启会将未完成回答标为可重试失败并保留已落盘片段。回退时保留新增表和升级后数据，不直接覆盖数据库。

## 缓存与隐私

- 词汇解释按项目缓存；段落解释按文档、页码、规范化文本和动作/指令哈希缓存。
- Agent 网页缓存默认 180 天，过期后优先刷新或降权。
- Agent 只向 SearXNG 发送生成的查询，不发送全书内容或选中文本。
- 网页抓取限制协议、重定向、超时、大小、内容类型，并阻止私网/回环地址。
- API key 只在本地配置文件中，不会进入数据库、日志或 Agent 时间线。

## 许可

源代码按 MIT 许可发布，参见 `LICENSE`，贡献说明见 `CONTRIBUTING.md`。第三方依赖保留其各自许可。不要把 `providers.toml`、本地电子书、测试截图、数据库快照或 `.codex/` 提交到仓库；这些本机文件已配置 Git 忽略规则。
