# Contributing

请先查看 `README.md` 了解项目范围、数据目录和当前 MVP 限制。

提交前请运行：

```bash
npm run typecheck --workspace apps/server --workspace apps/web --workspace packages/core
npm run build --workspace apps/server --workspace apps/web --workspace packages/core
npm run spec:validate
```

规则：

- 不要提交本地 `providers.toml`、电子书、脑图或 Agent 运行文件。
- 涉及 Agent 或网络抓取时，保持最小上下文、显式工具边界和私有地址保护。
- 保持 OpenSpec 规格与实现一致；行为变化先改规格，再改代码。
- 不要把用户书籍或下载的 PDF 作为自动化 fixture 提交。
