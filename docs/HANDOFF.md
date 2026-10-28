# 开发交接：阅读深度、证据与文字对齐

更新时间：2026-10-28。

## 交接状态

本次是未完成变更的开发快照，不是质量验收通过的发布版本。按用户要求提交并推送代码、OpenSpec 和本交接文档，**不归档**，不将 delta specs 同步成已验收的主规范。

- 当前变更：`improve-reading-depth-and-source-alignment`，schema 为 `spec-driven`。
- OpenSpec 进度：25/29。未完成：2.4、7.1、7.2、7.3。
- 最近执行范围：2.4 → 7.3。7.1 完整冒烟／矩阵和 7.2 的 24＋6 真实内容集由用户明确暂缓，不要擅自重跑。
- 2.4 的检索补强和 7.3 的真实联调已经执行，但来源归属和附加推论仍有内容错误，保持未勾选。
- 手机真机验证不在本轮范围；不使用 OCR，不操作用户完整书库。

## 首先阅读

- `openspec/changes/improve-reading-depth-and-source-alignment/tasks.md`：任务状态。
- 同目录 `proposal.md`、`design.md`、`specs/`：已确认目标和设计。
- 同目录 `verification.md`：验收标准。
- 同目录 `verification-results.md`：历史与最终定向结果、失败原因及未覆盖项。
- `docs/agent-harness.md`：此前的 Harness 架构；本轮增量以活动变更及代码为准。

恢复工作时先核对 Git 状态、任务清单和最近报告，接续未完成步骤。不要从头重做已完成阶段，不要以相同输入和配置不断重试。

## 已实现的主要内容

### 回答与证据

- 默认词汇解释为一句话定义后实质展开；深度解读为短段结论后解释机制、前提和边界。用户明确简答时遵从。
- 当前 prompt 版本：`reader-base-v4/evidence-critical-v8/reading-depth-v10/direct-detail-v8`。
- 默认详细输出容量上限 8192 tokens，明确简答 600；仍共享 24000 tokens、180 秒总预算，按剩余额度调整，不要求写满。
- 主 agent 按具体缺口检索；本地充分时不联网。禁网是硬边界，没有新增每问必经的 planner/judge。
- 明确要求联网并读取正文时，在第一次模型分析前读取相关候选。正文失败后同查询最多扩至六条，最多自动尝试两个替代页面，每次调用计入预算。
- 明确指定 URL 时不替换成其他页面；失败原因保留安全分类和 HTTP 状态，不绕过站点访问限制。
- 验证码、无效或不相关正文不算已读证据。实际引用使用真正读取页面的 ID；搜索摘要、正文已读、事实得到支持是不同状态。
- 必需正文未读、失败、取消、预算受限或版本不兼容的结果不作为完整答案复用。运行时结构合格仍不能保证语义合格。

### 位置、引用和阅读标记

- 分块保留真实页／字符映射，跨页范围不再直接沿用章节起始页；旧派生索引修复有备份和幂等保护，不能唯一定位则降级。
- 引用为书本图标加 Pxx／页范围，网页为地球图标加短标题；详情和导出保留完整来源，旧 ID／历史正文兼容。
- 词汇用金色点线、深度解读用蓝实线、自定义问答用灰紫虚线；独立装饰层不拆分原文字节点，不重复画字。
- 已完成记录支持只读打开及刷新恢复，不因此新增模型调用、消息、缓存或笔记。
- 修复已复现的嵌入字体文字层度量差异；不能推广为所有 Type3、缺失字体、连字均已修复。

## 代码入口

| 关注点 | 文件 |
| --- | --- |
| 工具循环、正文预读、降级、预算及可复用条件 | `apps/server/src/services/reading-engine.ts` |
| 输出契约、版本、来源归纳约束 | `apps/server/src/services/prompts.ts` |
| 检索相关性、候选评分、证据账本 | `apps/server/src/services/evidence.ts` |
| MCP 与安全网页读取 | `apps/server/src/services/mcp-search.ts`、`web-fetch.ts`、`apps/server/src/mcp/search-server.ts` |
| 页码／字符位置修复 | `apps/server/src/services/source-positions.ts`、`packages/core/src/processing/chunking.ts` |
| 上下文、缓存、问答出口 | `apps/server/src/services/conversations.ts`、`ai-actions.ts`、`agent.ts` |
| 文字层字体与独立标记 | `apps/web/src/lib/pdf-text-font.ts`、`reading-decorations.ts`、`apps/web/src/pages/ReaderPage.tsx` |
| 引用展示与导出 | `apps/web/src/components/MarkdownContent.tsx`、`packages/core/src/references.ts` |

词面相关性／候选评分只是检索排序，不能当作可信度、独立佐证或论断支持评分。

## 验证证据

最终代码的定向测试为 74/74：reading-engine 38、source-positions 4、mcp-failures 6、web-fetch-security 26。server typecheck、OpenSpec strict、diff 空白检查通过。

此前全量回归服务端 160、网页 12、core 10、AI 5、数据库 9，以及 build 的通过结果属于较早代码快照，不能当作最终检索改动的完整回归。此前固定内容集人工接受仅 17/30，不能以结构 30/30 声称质量通过；本次没有重新运行该集。

真实联调采用隔离临时数据目录、真实模型、MCP stdio、SearXNG，没有模拟搜索或预置网页缓存。书籍输入为合成存储页文本，不是 PDF 提取测试。测试结束清理临时配置和数据库，没有修改用户配置或书库。

最终三个场景的执行结果：

| 场景 | 耗时 | 模型／工具 | 结论 |
| --- | --- | --- | --- |
| 本地定义充分 | 29.231 秒 | 1／0 | 未联网，边界通过 |
| 正 alpha 是否保证实际赚钱 | 82.868 秒 | 1／4 | 真实正文已读并引用，核心反驳正确，附加归纳未通过 |
| 禁网但用户要求核验 | 24.210 秒 | 2／1 | 只读本地页，明确未完成外部核验，来源归属仍有错误 |

本机私有报告保留在 `docs/testing/artifacts/live-evidence/`，包括 09-38-28、09-47-38、09-50-44 三次尝试；后两次各有 `manual-review.md`。这些原始报告不随 Git 上传。

## 当前阻断与续接方向

1. 网络链路已打通：百度正文实际返回 403；有界扩大候选后，通过 MCP 读到 `https://www.sjsfund.com/fund-research/stalpha.mf`。其“缺陷”段明确支持正 alpha 与负总收益并存；页面公式是图片，未 OCR，不能声称核验了原公式。
2. 剩余问题在论断与来源归属：模型把仅明示简单超额收益的本地片段补写成风险调整定义；声称模型口径存在“唯一差异”，但没有穷尽性证据；还把待反驳原文引用在反驳结论旁。
3. 核心反驳正确、算术正确、引用 ID 合法和正文确实读到，均不足以覆盖这些错误。`quality.valid`／`reusable` 当前不是通用语义验证器。
4. 一次通用来源支持范围修订后仍复现，不要继续追加金融个例纠错表或同配置抽样直到偶然通过。下一步需分析来源限定在输入、归纳和输出引用中如何丢失，设计通用论断支持／归属约束，并用已保留反例定向验证；不要未经确认新增每次请求的强制评审模型。
5. 来源口播、重复结论仍不稳定，需与内容正确性分别记录。2.4、7.3 达到人工内容门槛后再勾选；7.1、7.2 等待用户重新安排。

## 本地运行与测试边界

运行依赖及模型配置见 README 和 `config/providers.example.toml`。真实配置仅在应用数据目录的 `config/providers.toml`，手动填写；不要将密钥复制到本文件、日志或命令行。SearXNG 是搜索服务，不需要模型 key。

```bash
npm install
npm run dev:server
npm run dev:web
npm run typecheck --workspace apps/server
openspec instructions apply --change improve-reading-depth-and-source-alignment --json
openspec validate improve-reading-depth-and-source-alignment --strict
```

默认前端 5173、后端 8787，SearXNG 使用受信任的本地实例。先检查已有进程，不要停止用户服务或启动重复实例。

测试代码、夹具、PDF、原始报告和本地工具配置依照既有发布要求被 Git 忽略，干净克隆不含这些文件，不能直接复现本机测试数量。只有已保留本地测试文件的工作区才能运行：

```bash
npm run test --workspace apps/server -- tests/reading-engine.test.ts tests/source-positions.test.ts tests/mcp-failures.test.ts tests/web-fetch-security.test.ts --maxWorkers=1 --testTimeout=25000
npx tsx apps/server/tests/live-evidence.ts
```

真实联调会调用已配置模型并消耗费用。后者只针对 7.3 的三个场景，不是完整冒烟／内容矩阵。不要在测试或联调运行期间编辑被测模块，避免新测试／旧模块混用。

## 提交与安全边界

本次提交包括当前实现、活动 OpenSpec 全部规划／验证说明和本交接文档；不归档，不把未完成任务改成完成。提交不是验收通过。

沿用 `.gitignore` 排除真实 providers、环境密钥、`.codex`、测试资料、PDF、数据库、截图和运行产物；不要 force-add 被忽略的私有内容。推送前核对暂存区及待推送提交，既检查新文件，也检查已跟踪文件中的实际密钥值。
