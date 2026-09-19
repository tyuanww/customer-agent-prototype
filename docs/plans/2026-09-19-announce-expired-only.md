# 查询「版本已失效」只对应租约过期

> **状态：** 已实现（`feat/announce-expired-only`）。本机开发态登录后立刻查询已验证。  
> **不包含：** 改 OpenAPI、把打包清单勾成已观察。

## 拍板

1. `onInvalidated` 只有 `reason === 'expired'` 才显示「当前版本已失效，请重新核验」。
2. `source_gate` / `unavailable` 是内容未就绪或瞬时失败，登录后立刻查询不得画成失效。
3. `replaced` / `signed_out` 仍清错误、不画失效。
