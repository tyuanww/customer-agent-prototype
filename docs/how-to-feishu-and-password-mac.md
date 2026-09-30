# 方案 C：本机飞书 + 产品自管账号

飞书走官方 OAuth（系统浏览器）。账号走产品自己的口令服务（本窗表单、哈希、一次性 code、失败锁定）。不要用 Logto。#129 / #130 已关。本页对应已合入的 #131。

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

口令服务在 `43101`。**账号文件是必需的，没有它就起不来**——这是有意的：早先的版本在没有账号文件时会用硬编码的 `synthetic-password` 播种全部合成身份（**包括 owner**），那个默认口令已经彻底删除，仓库里不再有任何默认密码。

首次使用先生成一次（密码随机，只打印这一次，文件里只存 scrypt 哈希）：

```
pnpm identity:accounts:init          # 拒绝覆盖已存在的文件
pnpm identity:accounts:init --force  # 重新生成（旧账号密码全部失效）
```

文件落在 `~/.customer-agent-synthetic-stack/password-accounts.json`（`username` / `bindingId` / `salt` / `hash` / `role` / `label`），权限 `0600`。**不要把明文密码提交进 git。**

`bindingId` 必须是 `synthetic_…`（冻结表的 provider 档只有 `synthetic` | `feishu`）。

### 准入判据看 Host，不看来源地址

两个身份服务都按**请求的 Host 头**判断是否放行，默认只允许 `127.0.0.1` / `localhost` / `[::1]`（可带端口）。这很重要：Cloudflare 隧道从本机回环转发，**来源地址恒为 `127.0.0.1`**，所以旧版「只看来来源地址」的判据在隧道下等于没判——带着公网 Host 的请求会被当成本机请求放行。

要临时加一个探针主机名，用 `CUSTOMER_AGENT_IDENTITY_ALLOWED_HOSTS`（逗号分隔）。**绝不要把生产主机名加进去。**

## 启动

有 `feishu.env` 时 `stack.ts start` 会：API `AUTH_MODE=feishu`、口令服务替换原来的自动放行 `/authorize`、预置飞书 `open_id`。先停当前 mock 栈再 start。

## 登录

选择器文案仍是「飞书」和「账号」。飞书 `code` / `state` 一次性：失败后重新点「飞书」，不要刷新 callback URL。

API 跟随 `user_info` GET 的 HTTPS 跳转，最终地址只接受 `open.feishu.cn` 与 `accounts.feishu.cn`（https、默认 443）。token POST 不跟随跳转。空地址或非 HTTPS 失败关闭。写仓外 `operator-display-names.json` 失败不会让登录失败。

规格：[飞书 user_info 跳转](plans/2026-09-19-fix-feishu-userinfo-redirect.md)。
