# How to：Linux 打包态产品主链（远端，未观察）

本页给**在 Linux 上打开打包客户端的人**勾选。全部行保持 **未观察**。登录只有 **飞书** 和 **账号**。不要在本机为这条主链另装 PostgreSQL。

**当前仓库没有与 `package:win` / `package:mac:local` 对等的 Linux UNSIGNED 产物脚本。** 本页不能当成 Linux 包已交付。配置路径仍须写明：Electron Linux userData 是 `~/.config/客服话术浮窗 Demo/synthetic-stack.json`。

须先按 [本地合入顺序](plans/2026-09-19-local-unpushed-merge-order.md) 合入 P4 / P7。有 Linux 包之后才填本页。

## 准备

`synthetic-stack.json`：

```json
{
  "mode": "product-remote",
  "apiOrigin": "https://agent-auth.jianghua.site",
  "identityOrigin": "https://agent-id.jianghua.site"
}
```

放到 `~/.config/客服话术浮窗 Demo/synthetic-stack.json`。两个 origin 必须不同、必须是 `https://` 主机名。

## 勾选（全部未观察）

| # | 步骤 | 预期 | 通过 / 未通过 / 未观察 |
| --- | --- | --- | --- |
| 1 | 打开带 `product-remote` 配置的 Linux 打包客户端 | 出现狐狸头，不是缺配置退出 | **未观察** |
| 2 | 飞书登录 | 系统浏览器授权后进会话 | **未观察** |
| 3 | 账号登录 | POST 打 identity origin | **未观察** |
| 4 | 登录后查询 / 复制 | 不是 leftover `/v1/search` | **未观察** |
| 5 | 关窗取消、断网 | 网络错误不是「登录已失效」 | **未观察** |

## 不要当作已通过

- 本页存在于仓库里
- 有 `package:linux` 脚本
- [macOS 打包态远端页](how-to-macos-packaged-product-remote.md)
- [办公机 Windows 远端页](how-to-office-machine-product-remote.md)
