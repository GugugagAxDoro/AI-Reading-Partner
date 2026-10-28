## Context

动机与范围见 `proposal.md`。现有系统是 TypeScript monorepo，采用本地 SQLite、项目级词汇缓存、文档级段落缓存，以及 light/strong 两档 OpenAI-compatible 模型。搜索直接调用 SearXNG，阅读问答和研究入口均存在默认联网预取。

当前约束包括：默认独立问题不携带历史；显式追问默认一轮、约 1000 tokens，最多两轮/1500 tokens；选区和问题不能静默截断；笔记小幅追加自动执行，重写和删除需要确认；本地配置、书籍与测试产物不能上传。

代码检查确认需要一并解决的行为缺口：prompt 中“只依据上下文”与运行时联网矛盾；研究任务将选区和问题扁平拼接；工具结果按字符串截断；超过单轮数量的 native tool calls 被裁掉；部分结束路径绕过综合回答；用量未覆盖 judge/synthesis。

## Goals / Non-Goals

**Goals:**

- 让简单解释保持低延迟，只有具体证据缺口才增加检索和模型轮次。
- 将权限、预算、取消、证据、引用和最终输出作为 harness 的统一边界，而非依赖 prompt 自律。
- 让新增引用和缓存元数据采用增量迁移，旧会话、旧 Markdown、旧笔记继续可读。
- 提供可观察、可复现的决策与成本验证，不存储或展示模型私有思维链。

**Non-Goals:**

- 不将每次阅读问题拆成多个子 agent，也不引入通用 shell、任意 MCP server 或代码执行。
- 不增加独立的“强制联网”按钮；用户明确要求联网即可触发，现有会话开关仍为硬边界。
- 不在本次实现远程 MCP；接口隔离以便以后增加 Streamable HTTP，但不预建复杂插件框架。
- 不自动重写历史回答以追求新格式，不将联网研究混入原书基础小结。

## Decisions

### 1. 单一逻辑主 agent，直接回答与有界循环共用状态

请求形成结构化 `ReadingRequest`：项目/文档/会话、action、question、冻结 selection 及 anchor、显式 parent IDs、history policy、web policy、语言、任务/输出版本、request ID。独立存储这些字段，不用一段长字符串承载全部语义。

流程如下：

```text
校验作用域、请求去重、确认权限
  -> 判断显式外部需求与缓存兼容性
  -> 兼容命中：直接展示，无模型/搜索
  -> 最小本书证据 + 单次主模型决策/回答
       -> 充分：直接回答
       -> 不足：当前书 / 相关项目书 / MCP search / MCP read
            -> 证据去重、问题覆盖、冲突与新鲜度检查
            -> 必要时定向补证；充分、无进展或预算将尽则停止
  -> 共享回答契约与引用校验
  -> 持久化回答、来源、运行与用量；符合条件才写复用缓存
```

明确联网、最新/当前事实等需求由结构化策略约束；普通本书解释则由最小证据和主模型决定是否需要工具。关键词只是信号，不再以“长于 120 字”或某个词命中来决定必须进入研究模式。

简单请求使用原有模型分层路由。支持工具的模型可以在同一轮选择直接回答或工具调用；无 native tools 的路线沿用经过校验的 JSON plan fallback，并在最终回答轮使用正常 Markdown 流式输出。确有检索/事实需求时才开放对应工具；笔记、脑图工具只在任务需要时暴露。不会每次附带全部 17 个 schema。

**替代方案**：每次先调用 planner 再调用回答模型，质量控制直观，但简单问题也增加一次完整往返；采用可直接回答的主模型决策，复杂流程才增加轮次。模型不能自行授予联网或写权限。

### 2. MCP 为应用层边界，SearXNG 继续作为后端

采用官方 MCP TypeScript SDK，实现应用自有的本地 stdio server，首期只提供 `search_web` 和 `read_web_page`。应用 MCP client 初始化、协商支持的协议版本、发现并验证工具后，把模型的 OpenAI function calls 或 JSON plans 映射到 MCP `tools/call`。

- server 复用现有 SearXNG 结果解析及网页可读正文提取；应用业务服务不保留绕开 MCP 的网络搜索分支。
- 仅运行打包的固定入口，不允许配置任意 `command/args`，不需要新增第三方 server 信任面。
- 子进程使用最小环境白名单和最小搜索配置；不继承完整 provider 文件、model API keys 或应用环境中的凭据。
- stdout 仅用于协议消息，诊断走经过脱敏的 stderr；应用退出关闭连接和所属进程。
- 有效连接复用；默认启动/握手上限 5 秒，搜索沿用 `[searxng].timeout_ms`（默认 20 秒），网页读取默认 20 秒，均裁剪至请求剩余时限。
- 健康状态区分未配置、启动/协议错误、后端不可用；同一请求确定不可用后不再重复联网，下一个新请求可以重新探测。
- 只允许配置的 SearXNG backend 访问 loopback/private 地址。网页工具逐跳校验 scheme、DNS 解析结果、目标地址及重定向；拒绝 localhost、私网、链路本地、metadata、file/data 等，防止 DNS 重绑定与 SSRF。

继续读取现有 `[searxng]`。可选的 `[mcp.search]` 仅增加启用状态与启动/读取限额；缺省自动使用本地 bridge，旧文件无需迁移。配置 parser 要验证新增字段，不允许未知传输或可执行文件。示例只写占位值，健康 API 不回传 secret。

**替代方案**：任意第三方 SearXNG MCP server 可减少初始代码，但难保证取消、结果限额和 SSRF 一致；首期选择薄的应用自有 adapter。远程 MCP 暂不实现。MCP 只统一能力边界，不被视为天然节省 token 的机制。

### 3. 检索按缺口推进，不把来源类别当必经流程

运行状态记录 `requiredClaims`、`gaps`、`nextAction`、`reasonCode` 和一句操作理由，不记录思维链。缺口分为 `author_context`、`local_material`、`external_concept`、`external_fact`、`freshness`。

| 情况 | 下一步 | 禁止行为 |
| --- | --- | --- |
| 选区及邻近文本足够 | 直接回答 | 为丰富回答强制搜网 |
| 缺少书中前文或定义 | 定向检索当前书 | 用百科内容冒充作者原意 |
| 当前书不足、项目内有相关材料 | 检索当前项目其他书 | 跨项目读取或遍历无关书 |
| 缺少领域背景或外部事实 | MCP 搜索，必要时读网页 | 凭低相关度片段硬凑答案 |
| 明确联网、最新事实 | 优先目标明确的 MCP 请求 | 用通用缓存或模型记忆替代核验 |
| 会话关闭联网 | 仅本地；缺口直接保留 | 模型要求联网即绕过开关 |

搜索 query 由任务和缺口生成，剔除大段原文和敏感数据；通常在主 agent 决策时同时产出，不默认再调用一次 query model。单次 search 默认取前三个候选进入证据筛选，需要时才扩展或读取正文，仍受累计工具预算限制。空结果、不可读页面、相关度不足与工具故障分开记录。

### 4. 结构化证据台账与按问题选择上下文

`EvidenceItem` 包括 ID、`kind`（document/web）、source identity、项目/文档/page/chunk/anchor 或 URL、title、excerpt、fetchedAt/publishedAt（未知保持未知）、snippet/page 标识、content hash、支持的 claim IDs、重复组和冲突组。原始正文保存在应用数据目录的内部材料区，模型只收到必要摘录与可追溯 ID。

来源身份和证据位置分离：同一网页多次调用共享 source ID；同一本书不同段落有各自定位的 evidence ID。URL 规范化只移除明确追踪参数，不能把不同内容地址错误合并；转载按内容近重复分组，保留其来源，不算多个独立证据。

先做确定性去重，再由主模型完成语义合并/冲突分析。只有复杂冲突或覆盖难判时才使用额外轻量判断调用。context selector 按待回答 claim、当前选区、来源质量和冲突覆盖选片段，不能只取最早 8 条或按到达顺序截断。保留冲突双方及关键条件，超预算则明确缩小回答范围。

**替代方案**：简单“先本书总结、再网络总结”可实现来源分离，但重复且不回答差异；采用按 claim 合并并引用，只有实质差异才展开比较。不做全面知识图谱或新增向量数据库，先复用当前本地检索并用评测验证覆盖。

### 5. 一个预算账本、时限与无进展停止器

每个请求包含 `RunBudget`，在所有模型/工具调用前检查剩余额度。默认沿用 8 轮/180 秒上限，增加研究请求最大 12 次模型尝试、16 次工具调用、每轮最多执行 3 个工具，以及 24000 tokens 的累计输入/输出估算上限；这些是可验证、可调整的初始默认值，不承诺特定供应商费用。

- 选区解释单次输入默认 3000 tokens；普通问答与研究单次输入默认 6000；按实际模型窗口进一步收紧，最终输出默认预留 1200 和安全余量。
- 研究总预算中预留一次最终回答调用及其输入/输出容量。重试、query/judge/synthesis 均消耗次数、token 和剩余时限。失败且无 provider usage 时记录估算或 unknown，不记为免费零消耗。
- 不预留固定且始终空置的 web 区块；真正需要外部证据时再调度。预算包括 system prompt、工具 schema 和格式开销，不能只数证据文本。
- 当前问题和必要选区保护；显式 history 按现有 0/1/2 轮、1000/1500 token 上限；低优先 history 和重复证据先剔除。保护内容仍放不下则在模型请求前提示缩小范围。
- 以规范化工具名、query、过滤条件和证据状态构成调用指纹。等价调用不重复执行；连续两次检索没有新增相关 claim 证据则停止扩展。模型 API 瞬时失败至多一次有界重试，不能绕开计数。
- 每个 native tool call 均有对应 tool result：超出单轮/总额的调用返回结构化拒绝，不直接 `slice` 掉响应。结果先投影为有界对象再序列化，不截断 JSON 字符串。压缩以完整已完成交换为单位，不拆 call/result 对。
- 所有异步操作共享取消链和绝对 deadline。取消后不合成答案、不写复用缓存；超时保留可见部分与终态，不再开启完整时限的新请求。

**替代方案**：只限制循环轮次无法约束轮内 judge、search、重试与 synthesis；统一账本可使代价可解释，也便于定位卡住原因。长复杂任务可能提前终止，通过明确缺口和可手动继续替代暗中扩大预算。

### 6. 分层 prompt 与共享、可流式的输出契约

将现有 prompt 组织为版本化模板模块，保留 TypeScript 现有组织风格，不另建 prompt DSL：

| 层 | 职责 |
| --- | --- |
| base | 严谨、默认中文、数据不可信、权限边界 |
| retrieval/evidence | 按需检索、覆盖、去重、冲突、来源标识 |
| task | vocabulary / interpretation / question / summary / note / mindmap |
| answer contract | 直接开头、必要展开、简洁表达和引用语法 |
| data | 分隔且带来源 ID 的选区、原文、history、工具摘录 |

生成元数据记录各层版本和 aggregate compatibility version。只改表达风格也会影响新答案复用资格，但不修改历史文本。

输出示例（`[[ref:...]]` 为存储标记，界面显示为小图标与编号，不暴露该语法）：

```text
Alpha：相对于选定基准或风险模型所解释收益之外的超额收益。[[ref:s1|1]]
```

深度解读先用一小段直接解释核心关系，然后只在必要时补充推理、条件或例子。通常词汇一句至短段、深度解读一段加少量要点；不硬设最低字数或固定标题。复杂冲突可以更长，用户明确长度/语言要求继续生效。基础小结沿用忠实原书的摘要契约，不套“词汇：定义”。

“根据上下文”“根据网络资料”“下面为你解释”和无意义“不是……而是……”由模板与质量评测约束，不在生成后全局正则删除，避免破坏原文引述、真正否定、代码块和限定条件。正文不口播来源，但解释定义差异时可以准确描述某个作者/模型/时期的观点。

建立统一 answer finalizer：直接流式、agent free text、finish、限制后的 synthesis 都携带相同 contract；能直接合格结束就不再额外 synthesize。校验结构、源 ID 与完成状态，不强制包裹完整 JSON，也不为风格问题无限 repair。首段可做小范围流式缓冲以识别完整引用，不能等待全文。硬格式违规记录质量状态、禁止写合规复用缓存，保留原始可读答案供重试；不静默覆盖历史或伪造格式通过。

外部核验失败用独立的简短状态提示呈现，不以告警 blockquote 抢占开头。若实质结论缺证据，回答本身直接交代具体未知；不能只放一个通用网络告警后继续给出未经核验事实。

### 7. 引用注册表与统一展示

在 `MarkdownContent` 的现有 stable-link 解析基础上扩展 `[[ref:<source-location-id>|<number>]]`，绑定受服务端校验的 reference registry。模型只能引用提供的 ID；ID、URL 和 document scope 不由模型自由创建。renderer 使用 lucide `BookOpen` / `Globe`，搭配紧凑编号、tooltip/popover 和屏幕阅读器标签。触点可聚焦，信息不只依赖颜色或 hover。

- 本书/项目其他书：记录 document hash/id、page、可用 paragraph/chunk anchor，点击经过作用域校验的 app 导航。开启其他书不能篡改原会话归属。
- 网页：保留原始可信 URL、title、domain、fetched time；安全打开，不自动加载跟踪图片。
- 未知 ID、删除书籍和失效目标：显示不可用引用，不拼出一个看似有效的新链接。
- 老 `[[doc:...]]`、`[[web:...]]` 和 `#page=` 链接继续工作；展示可升级，但不重写旧会话。
- copy/save/export 通过同一个 serializer：网页转标准 Markdown 链接；本地保留书名、页码、stable document locator 和导出引用清单。离线 HTML 只能保证可读定位和网页链接，不假装附带用户 PDF；配置了 app origin 才附可返回应用的 URL，不硬编码 localhost 或暴露绝对文件路径。
- 笔记同时保存 reference metadata 或可恢复的来源清单，脑图保留节点关联及可读来源。基础摘要、缓存、研究回答和笔记共享 renderer/serializer。

**替代方案**：仅在回答底部贴 URL 列表不能标出具体论断、书中位置或缺失来源；正文多次写“本书认为/网络资料指出”也会增加噪声。采用行内紧凑引用，来源详情按需展开。

### 8. 缓存、迁移和运行产物

缓存仍是项目词汇、文档段落两种范围，增加语义/上下文签名、prompt/contract/evidence-policy 版本、history dependency、evidence completeness 和 freshness metadata。词汇的同名不同义不共用唯一槽位，需要兼容 schema 的版本/变体记录；不能用每个选区全文 hash 代替语义签名导致同义跨书永久无法命中。先比较项目、规范词、领域/章节等稳定线索，存在歧义才检索原上下文或重生成，保守不命中优于错义复用。

联网关闭不删除历史网络来源，也不发新请求；历史答案可手动查看，但新请求只能复用符合其有效证据策略的答案。明确最新核验不被 generic cache 短路。

网页保留上限仍为 180 天；概念类可在保留期内复用，普通外部事实默认新鲜度 24 小时，明确“最新/当前核验”本次执行外部检查而非复用旧通用回答。这些是证据适用性策略，不能把新抓取时间当作网页发布日期。到期清理正文不删除历史 URL 和定位元数据。

运行信息沿用现有应用数据目录分区：面向用户的项目笔记/脑图在项目 artifacts；中间检索原文/摘要在 internal cache；run 事件与决策、用量及终态在 agent runs。日志统一先脱敏，输出状态包括实际步骤，不记录 chain-of-thought。通过 request ID 和操作 ID 防止重复提交/重启重放写笔记。

## Risks / Trade-offs

- [模型判断“足够”失误] → 显式外部/新鲜度要求、scope 和 budget 用程序硬约束；中文评测同时统计漏搜与多搜，不只测调用成功。
- [更严格上下文限额丢失必要信息] → 按 claim 覆盖和冲突组选取，保留原文引用，可定向二次取证；保护输入不静默截断。
- [引用语法被截断或模型伪造 ID] → 渲染仅解析完整 marker 并匹配 registry；未知来源不可导航；流式和导出单独回归。
- [MCP 增加进程与协议故障点] → 单一固定 server、复用连接、短启动超时、typed errors、无越界 HTTP 旁路，保留本地回答。
- [语义缓存变体引起迁移复杂度] → 增量字段/索引/变体表，旧条目仅历史可读；不批量调用模型迁移，也不删除用户数据。
- [简洁要求压缩必要条件] → 把限定、差异和不确定性列为质量红线，不将关键词黑名单作为删句工具。
- [联网质量受 SearXNG 引擎影响] → 确定性 MCP fixtures 与真实 SearXNG 分层验证；空搜索不标记为语义正确，报告配置和错误类型但不泄密。

## Migration Plan

1. 先补可执行回归夹具和脱敏预算/策略观察点，再引入可兼容的新元数据与 schema 迁移；复制隔离数据库验证，不操作用户真实书库。
2. 增加固定 MCP server、client 和配置兼容层，单测/集成通过后让所有联网入口切换到 MCP；保留底层 fetch/parser 实现，不保留业务旁路。
3. 统一 request/预算/证据/answer finalizer，移除强制 web prefetch；将旧会话 `web_enabled=true` 映射为 `auto`，false 保持 off，并提供简短升级说明。
4. 切换版本化 prompt 和图标引用，保存/导出同步适配。旧缓存不自动删改，只有兼容条目才自动命中。
5. 执行 `verification.md` 中离线冒烟、完整回归、截图/数据库验证与真实模型+MCP+SearXNG 联调，报告通过、失败、未运行和实际用量。
6. 回退时恢复旧应用版本并保留新增数据；发布前验证旧版本对新增 schema 的可读性，若不兼容则使用迁移前备份恢复到独立目录，禁止直接覆盖用户新增笔记或从新缓存反向重建旧数据。

## Practice References

以下资料用于设计原则参考，不代表已验证覆盖所有 2026 年工程实践，也不照搬长周期 coding agent 的执行结构：

- [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)：从简单可组合流程开始，复杂度由实际任务收益决定。
- [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)：按需获取、保留轻量引用、对上下文进行有损但可追溯的压缩。
- [Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)：显式进度、可恢复状态与端到端验证。
- [Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp)：借鉴渐进式工具暴露和输出过滤，不引入本文不需要的代码执行能力。
- [MCP architecture](https://modelcontextprotocol.io/docs/learn/architecture) 与 [transports](https://modelcontextprotocol.io/specification/latest/basic/transports)：host/client/server 边界和 stdio 传输。
