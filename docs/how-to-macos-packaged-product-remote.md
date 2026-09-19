# How to：macOS 打包态产品主链（远端，未观察）

本页给**本机打开 UNSIGNED `.app` 的人**勾选。全部行保持 **未观察**，直到真人看过窗口。不要把 [M5](how-to-verify-macos-m5.md) 的 `synthetic-local` 勾选抄到本页。

**还不能用当前 main 上的 UNSIGNED 包当本页证据。** 须先按 [本地合入顺序](plans/2026-09-19-local-unpushed-merge-order.md) 把 P4 / P7 origin 隔离线合进再打新包。本页不授权现在执行 `pnpm package:mac:local`。

登录只有 **飞书** 和 **账号**。不要在本机为这条主链另装 PostgreSQL。

## 准备

1. 合入后的 UNSIGNED `.app`（文件名含 `UNSIGNED`）。
2. 需要网络。
3. 把 `synthetic-stack.json` 放到 `~/Library/Application Support/客服话术浮窗 Demo/synthetic-stack.json`：

```json
{
  "mode": "product-remote",
  "apiOrigin": "https://agent-auth.jianghua.site",
  "identityOrigin": "https://agent-id.jianghua.site"
}
```

两个 origin 必须不同、必须是 `https://` 主机名。打包态忽略 `CUSTOMER_AGENT_DESKTOP_*` 环境变量。

## 勾选（全部未观察）

| # | 步骤 | 预期 | 通过 / 未通过 / 未观察 |
| --- | --- | --- | --- |
| 1 | 打开带 `product-remote` 配置的 UNSIGNED `.app` | 出现狐狸头，不是缺配置退出 | **未观察** |
| 2 | 飞书登录 | 系统浏览器授权后进会话 | **未观察** |
| 3 | 账号登录 | POST 打 identity origin | **未观察** |
| 4 | 登录后查询 / 复制 | 不是 leftover `/v1/search` | **未观察** |
| 5 | 关窗取消、断网 | 网络错误不是「登录已失效」 | **未观察** |

## 不要当作已通过

- 本页存在于仓库里
- M5 `synthetic-local` 历史勾选
- 开发态 `pnpm dev` + export origin
- 签名、公证、外发
- [办公机 Windows 远端页](how-to-office-machine-product-remote.md)
- [Linux 打包态远端页](how-to-linux-packaged-product-remote.md)
