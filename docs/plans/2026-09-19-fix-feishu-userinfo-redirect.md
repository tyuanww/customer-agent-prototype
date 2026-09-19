# 飞书 user_info 跳转超时

> **状态：** 已实现（`feat/fix-feishu-userinfo-redirect`）。  
> **不包含：** 改 beian、把打包清单勾成已观察。

## 拍板

1. 仅 `user_info` GET 允许一跳飞书 HTTPS（`redirect: manual` 后再 GET，host 只允许 `open.feishu.cn` / `accounts.feishu.cn`）。token POST 保持 `redirect: error`。
2. 最终 URL 必须是 https、默认 443。空 URL 失败关闭。
3. 写 `operator-display-names.json` 失败不得让登录失败。
4. 运输日志记 name / code / cause.message（去 URL），不写 token / 授权码。
5. fetch 成功后不得 abort signal，否则读 body 变成 `AbortError 20`。
6. 飞书 `code` / `state` 一次性。失败后必须重新点「飞书」，不能刷新 callback URL。
