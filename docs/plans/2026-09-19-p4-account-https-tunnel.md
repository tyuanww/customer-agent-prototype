# P4 第二刀：账号口令 HTTPS 隧道

> **状态：** 实现中（`feat/p4-account-https`）。叠在已合入的 P4 第一刀之上。  
> **不包含：** API / 口令服务绑 `0.0.0.0`、证书 pinning、办公机实装、改飞书 redirect。

## 拍板

1. 飞书走 `https://agent-auth.jianghua.site` → `127.0.0.1:43100`（已有）。
2. 账号 POST `/password` 走 **另一个** 公网主机，例如 `https://agent-pass.jianghua.site` → `127.0.0.1:43101`。两个 origin 必须不同。不要覆盖别的隧道已占用的主机名。
3. 口令服务仍只接受 loopback 套接字。cloudflared 在本机连过来时 `remoteAddress` 是 `127.0.0.1`；`Host` 可以是公网名。
4. API 侧 `/exchange` 仍打本机 `http://127.0.0.1:43101`，不经公网。
5. 登录口令 POST 与 callback GET 的超时按隧道放宽到 15s。不阻塞、不重试。

## 明确不做

- 不把 PG 打到公网
- 不把口令服务绑到非 loopback
- 不在本刀改 Cloudflare DNS（操作步骤写在 how-to；要配隧道需单独授权）
