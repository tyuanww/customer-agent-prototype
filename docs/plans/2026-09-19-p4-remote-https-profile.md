# P4 远端：受控 HTTPS 客户端，API 仍 loopback

> **状态：** 第一刀开工。用户已授权 P4。  
> **不包含：** API 绑 `0.0.0.0`、证书 pinning、办公机实装。

## 拍板

1. 后端继续只听 `127.0.0.1`。公网入口用已有隧道（如 `https://agent-auth.jianghua.site` → `43100`）。
2. 桌面允许 **https + 公网主机名 + 无凭据/无路径** 的 origin；仍拒绝 IP、localhost、http 公网、userinfo。
3. 打包 profile 新 mode：`product-remote`。`synthetic-local` 仍只许 loopback。
4. 会话文件按 `apiOrigin` 哈希分文件（P5），避免把本机 token 发到远端。
5. 口令服务仍只接受 loopback 套接字；经本机 cloudflared 反代时 `Host` 可以是公网名。
6. 不做默认证书 pinning（企业 TLS 检查代理）。

## 明确不做

- 不把 PG 打到公网
- 不削弱 fail-closed、不缺文件当 S0
- 不把任意 URL 当 API
