# 实现与验证记录

## 实现范围

- 结构化阅读请求、统一预算与取消、按需检索、受限工具暴露、native/JSON 协议完整性、运行恢复和笔记幂等写入。
- 应用自有 stdio MCP 搜索 server，SearXNG 搜索和安全网页读取，连接复用与重连、超时、取消、最小子进程环境。
- 按来源／问题组织证据，保留互补与候选冲突，转载分组、追踪 URL 规范化和不相关候选过滤。
- 分层版本化 Prompt，简洁直接的默认契约，统一引用校验与精确别名解析，可选一次有预算的引用修复。
- schema v3 语义词汇变体及旧数据保全，网页新鲜度与正文保留上限分离。
- 回答、缓存、摘要、笔记与脑图出处；BookOpen/Globe 图标，安全跳转、键盘焦点和不被窄侧栏裁剪的来源浮层。

配置、架构与迁移说明见 README.md 和 docs/agent-harness.md。未归档、未提交、未推送。

## 验证入口

源测试和报告按既有用户要求留在忽略目录，不随公开仓库提交。

| 场景组 | 本地证据 |
| --- | --- |
| R01–R08 | reading-engine、conversations、retrieval-security、真实 live-web-search 和 24 条质量评测 |
| M01–M06 | agent-harness、mcp-failures、web-fetch-security、真实 MCP page read |
| H01–H08 | reading-engine、agent-harness、model-client、conversations 的取消、预算、配对、重复请求、SIGKILL 恢复与 note_operation 测试 |
| A01–A06 | agent-harness、reading-engine、markdown、e2e、质量原始回答及人工复核 |
| C01–C05 | conversations、repositories、workspace-migration、workspace 浏览器本地数据快照 |
| U01–U06 | markdown、workspace-smoke、harness-ui 的截图、DB 增量、文件哈希及脑图来源 |
| D01–D03 | 配置测试、v1/v2 迁移备份、MCP 配置限制、安全测试及 Git 私有文件／真实密钥审计 |

12 项冒烟由上述小范围测试与引用专项覆盖，再运行全量仓库测试。完整浏览器工作流包含 54 组，引用专项另覆盖 1440×900 / 420px、1100×800 / 300px。仅桌面浏览器视口，不声称手机真机或真实 IME 通过。

真实模型＋真实 SearXNG 的本地解释与深度解读均为一次模型、零网络工具；明确联网核验经过 MCP 搜索并保留本地／外部来源；另成功读取真实网页正文，非 snippet 冒充全文。固定资料的 24 条质量评测与真实互联网联调分开报告。

截图与隔离数据库／文件验证位于本机 docs/testing/artifacts/agent-harness/ 和 workspace-*。书籍只用合成中文短 PDF，不读写用户书库；未使用 OCR。

## 最终回归记录（2026-10-28）

- `npm test`：163/163 通过（server 130、web 11、ai 5、core 8、db 9）。MCP 故障夹具原先统一使用 100ms，负载下会在后端收到请求前误超时；现将 HTTP／非法 JSON／引擎错误设为 3000ms，挂起用例设为 1000ms，保留后端实际收到一次请求的断言，定向及全量测试均通过。
- 浏览器完整工作流：54/54 组通过，证据目录 `docs/testing/artifacts/workspace-2026-10-28T04-44-36-032Z`；另有 `docs/testing/artifacts/agent-harness/ui/report.json` 与桌面／窄侧栏截图。
- 引用专项：消息 +2、笔记 +1、搜索 +1；笔记文件与数据库一致，外键检查为空；保存、刷新、引用键盘操作与脑图来源验证通过。
- 真实模型质量评测：24/24 自动契约检查通过；供应商报告 45357 tokens，24 次模型调用，采样首段可见时间 p50 675ms／p95 1237ms。此时间来自持久化快照采样，不等同精确 SSE 首 token 延迟。逐条语义复核和残余问题保存在本机 `docs/testing/artifacts/agent-harness/quality/human-review.md`。
- 真实 MCP＋SearXNG：本书解释／解读均一次模型、零外部工具；明确联网请求经过 MCP 搜索，另读到 14967 字符网页正文。真实互联网联调与固定网络资料质量评测分别记录。
- `npm run typecheck`、`npm run build`、`npm run spec:validate` 均成功；严格规范校验 9/9。构建仅保留现有大 chunk 告警。
- 交付审计检查 128 个已追踪及非忽略候选文件，真实配置密钥零命中，私有文件路径零命中；`git diff --check` 通过。全部 42 项实现任务已完成，不表示模型语义质量无残余风险。

## 结果边界

- 自动格式、权限、调用次数、证据 ID 检查不等于语义证明。24 条评测保留原始回答与逐条人工复核；部分供应商回答仍有来源口播冗余、过度保守，以及高胜率案例末句限定条件不严谨等风险，未以正则删句掩盖。
- 当前词义隔离和 claim 覆盖是保守启发式，非通用知识图谱；数字差异仅为候选冲突信号，不能自动断定事实矛盾。
- 文件系统与 SQLite 不构成跨资源事务。已提交笔记操作可防重，故障后应核对文件与数据库版本，不自动重放。
- 浏览器构建保留现有大 chunk 告警；不属于本次 Agent 行为变更，未顺带重构。
- 检查 Git 已追踪及非忽略候选文件，真实本机 API key 零命中，.codex、私有配置、PDF、DB、测试和报告零待提交路径。
