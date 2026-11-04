# 如何运行生产烟测

这条命令只读生产公网 health 端点。它不发送凭据，也不查询客户内容。

在仓库根目录运行：

```bash
pnpm test:production:smoke
```

命令使用系统 TLS 根证书调用 `curl`，并限制请求超时和 64 KiB 响应大小。

发布验收时，把检查绑定到候选版本：

```bash
pnpm test:production:smoke -- --expected-version "$(cat VERSION)"
```

以下检查全部通过时，命令退出 `0`：

- API `/health` 返回预期服务和语义版本。
- 可选的 `--expected-version` 与生产 API 版本一致。
- `/ready` 的 `database`、`schema`、`auth`、`storage` 和 `content` 都是 `ok`。
- 身份服务 `/health` 声明 password 服务正常。
- 未认证的 `GET /v1/intake/sources` 和 `GET /v1/events/usage` 返回 `401`。

输出是 JSON。退出 `1` 表示生产漂移或探测失败，退出 `2` 表示参数无效。`probes`
保留每个端点的 HTTP 状态和安全的传输错误码，例如 `CURL_6` 或 `ENOENT`，
但不输出响应正文。

GitHub Actions 的 `Production smoke` 每小时运行同一检查，也可手动启动。workflow 不使用生产密钥。

## 未证明的范围

这条烟测不证明登录、授权、检索质量、内容发布、桌面打包态行为，也不证明尚未合并的提交已经部署。这些检查需要获批账号、合成或获批内容，以及与候选匹配的桌面包。
