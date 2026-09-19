# P6：两条网络栈共用 Chromium TLS / 代理

> **状态：** 实现中（`feat/p6-cert-proxy`）。  
> **不包含：** 默认证书 pinning、改 Node API 进程的 Feishu fetch、把口令服务绑到 `0.0.0.0`。

## 拍板

1. 实际 HTTPS 路径只有两条：Electron `net.fetch`（ProductHttp、登录 `/password`、MiniMax）和登录隔离 session（只加载 chooser HTML，不打 API）。
2. 给 defaultSession 加证书钩子**不会**覆盖隔离 partition，也覆盖不了 Node `fetch`。因此产品 HTTPS 统一走 `desktopFetch` → `electron.net.fetch`。
3. 登录隔离 session 使用与 defaultSession 相同的 `applySessionSecurity`。Chooser 的 `onBeforeRequest` 仍只放行本地 HTML。
4. 不做默认 pinning（企业 TLS 检查代理、证书轮换）。
5. 单元测试没有 Electron `net.fetch` 时回退全局 `fetch`。

## 明确不做

- 不关闭 TLS 校验
- 不把 `NODE_EXTRA_CA_CERTS` 写进产品主链（那是 API / Node 进程的 Feishu 问题）
- 不假设 Clash `HTTPS_PROXY` 对 Chromium `net.fetch` 生效
