# 登录后不闪失效，胶囊显示姓名

> **状态：** 已实现（`feat/login-session-display`）。本机开发态飞书登录已验证。  
> **不包含：** OpenAPI 加 display_name 字段、改 beian。

## 拍板

1. 登录换 `sessionEpoch` 时 announce 丢旧租约，reason 为 `replaced`，查询窗不当成「版本已失效」。
2. 胶囊按钮为「{姓名} · 退出」。飞书用 user_info 的 `name` 写入仓外 `operator-display-names.json`；没有姓名时去掉 `usr_` 前缀。
3. 不把角色 `owner` / `agent` 当作显示名。
