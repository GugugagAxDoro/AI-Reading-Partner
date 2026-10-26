# Security

- API key 只放在本地 `{dataRoot}/config/providers.toml`，不写入数据库、日志或 Agent 时间线。
- 本地服务默认只监听 loopback。
- Agent 网页抓取只接受 HTTP/HTTPS，限制重定向、大小、内容类型和超时，并阻止回环/私网地址。
- 不提交或分享包含 API key、个人书籍或笔记的文件。
- 如果发现安全问题，请先不要公开披露，联系维护者。
