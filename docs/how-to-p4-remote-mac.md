# P4：本机桌面连受控 HTTPS

API 仍只绑 `127.0.0.1`。桌面可以把 origin 设成隧道 HTTPS。规格：[P4 远端](plans/2026-09-19-p4-remote-https-profile.md)。

## 开发态

```bash
export CUSTOMER_AGENT_DESKTOP_API_ORIGIN=https://agent-auth.jianghua.site
export CUSTOMER_AGENT_DESKTOP_IDENTITY_ORIGIN=https://agent-id.jianghua.site
pnpm --filter @customer-agent/desktop dev
```

两个 origin 必须不同、必须是 `https://` 主机名（不要 IP、不要路径、不要 userinfo）。

账号口令 POST `/password` 打 **identity** origin，callback 打 **API** origin。飞书只走 API 隧道也能完成；要点「账号」，必须有第二条隧道。口令服务仍只听 `127.0.0.1:43101`。

同一条 named tunnel 的 ingress 示例（`~/.cloudflared/customer-agent-local.yml`）：

```yaml
ingress:
  - hostname: agent-auth.jianghua.site
    service: http://127.0.0.1:43100
  - hostname: agent-id.jianghua.site
    service: http://127.0.0.1:43101
  - service: http_status:404
```

DNS 只加一次：

```bash
cloudflared tunnel route dns customer-agent-local agent-id.jianghua.site
```

改完 yml 后重启 `cloudflared tunnel run`。不要把 API 或口令服务绑到 `0.0.0.0`。只测飞书时，identity origin 也必须是合法 https 主机，即使暂时不点账号。

## 打包态

`synthetic-stack.json`：

```json
{
  "mode": "product-remote",
  "apiOrigin": "https://agent-auth.jianghua.site",
  "identityOrigin": "https://agent-id.jianghua.site"
}
```

`synthetic-local` 仍只接受 loopback。会话文件按 API origin 分开，不会把本机 token 发到远端。

## TLS

桌面 ProductHttp、账号 `/password` 和 MiniMax 走 Electron `net.fetch`（系统信任库），不是 Node `fetch`。不要关闭 TLS 校验。API 进程访问飞书仍可能需要 `NODE_EXTRA_CA_CERTS=/etc/ssl/cert.pem`。规格：[P6](plans/2026-09-19-p6-cert-proxy-paths.md)。
