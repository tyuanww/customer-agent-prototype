# 飞书 token 响应超过 4KB 不再当依赖失败

> **状态：** 已实现（`feat/fix-feishu-token-body-limit`）。  
> **不包含：** 改飞书 redirect、动 beian、把远端清单标已观察。

## 拍板

1. `createFeishuIdentityProvider` 读 token / user_info 正文上限从 4KB 提到 32KB。
2. 飞书文档写明 access_token 常 1–2KB 且会随 scope 变长；4KB 会截断真实成功响应，映射成 `DEPENDENCY_UNAVAILABLE`。
3. 不在日志里写 token 正文。
