# 登录后查询 UNAVAILABLE

> **状态：** 已实现（`feat/query-source-gate-silent`）。现场失败是 ACK 403；304 无头仍作为防护留下。

## 拍板

1. 「查询未完成」是 Query ERROR 壳；「服务暂不可用，请重试」来自 announce `drop('unavailable')`。
2. 登录成功后会立刻再 refresh 一次（onSessionChanged / sessionStatus）。第二次 `/v1/announce/current` 常为 304。
3. 304 若没有 `x-snapshot-lease` / `x-snapshot-lease-expires`（HTTPS 代理或 Electron 会丢自定义头），旧逻辑抛 UNAVAILABLE 并清租约，查询无法继续。
4. 304 时沿用本地已持有的 lease token；服务端 304 表示租约仍有效。
