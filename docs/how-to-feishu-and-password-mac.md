# 方案 C：本机飞书 + 产品自管账号

飞书走官方 OAuth（系统浏览器）。账号走产品自己的口令服务（本窗表单、哈希、一次性 code、失败锁定）。不要用 Logto。不要合 #129 / #130。

规格：[方案 C](plans/2026-09-18-identity-c-password-and-feishu.md)。

## 飞书

`~/.customer-agent-synthetic-stack/feishu.env`（`chmod 600`）：

```
AUTH_MODE=feishu
FEISHU_APP_ID=cli_你的
FEISHU_APP_SECRET=你的secret
FEISHU_REDIRECT_URI=https://你的隧道主机/v1/auth/callback
FEISHU_BINDINGS=ou_你的open_id:agent
```

隧道转到 **产品 API** `127.0.0.1:43100`，不是 Logto。飞书控制台重定向 URL 必须和 `FEISHU_REDIRECT_URI` 完全一致。

## 账号

口令服务在 `43101`。默认种子仍是合成绑定用户名（如 `synthetic_agent`），密码先用本机非机密 `synthetic-password` 的哈希。外包生产账号应改 `~/.customer-agent-synthetic-stack/password-accounts.json`（`username` / `bindingId` / `salt` / `hash`），不要把明文密码提交进 git。

`bindingId` 必须是 `synthetic_…`（冻结表的 provider 档只有 `synthetic` | `feishu`）。

## 启动

有 `feishu.env` 时 `stack.ts start` 会：API `AUTH_MODE=feishu`、口令服务替换原来的自动放行 `/authorize`、预置飞书 `open_id`。先停当前 mock 栈再 start。
