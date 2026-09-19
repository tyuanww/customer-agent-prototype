# How to：办公机产品主链（远端，未观察）

本页给**办公机操作员**勾选。开发机不得代填。全部行保持 **未观察**，直到真人在那台 Windows 上看过窗口。

**还不能用当前 main 上的安装包当本页证据。** 须先按 [本地合入顺序](plans/2026-09-19-local-unpushed-merge-order.md) 把 P4 / P7 origin 隔离线合进再打新的 `UNSIGNED` 包。首轮离线勾选仍走 [办公机首轮](how-to-office-machine-first-round.md)，两页不要混填。

不要在办公机安装 PostgreSQL、Node、合成栈。产品主链走远端 HTTPS；检索由登录交付到 `%APPDATA%\客服话术浮窗 Demo` 旁的仓外目录。登录只有 **飞书** 和 **账号**。

安装包仍禁止外发、未签名。

## 准备

1. 新的 UNSIGNED Windows 安装包（合入后再打，文件名含 `UNSIGNED`）。
2. 办公机**需要网络**（与首轮断网相反）。
3. 把 `synthetic-stack.json` 放到 `%APPDATA%\客服话术浮窗 Demo\synthetic-stack.json`：

```json
{
  "mode": "product-remote",
  "apiOrigin": "https://agent-auth.jianghua.site",
  "identityOrigin": "https://agent-pass.jianghua.site"
}
```

两个 origin 必须不同、必须是 `https://` 主机名。不要 IP、不要路径、不要 userinfo。不要在本机装数据库来「补主链」。

## 勾选（全部未观察）

| # | 步骤 | 预期 | 通过 / 未通过 / 未观察 |
| --- | --- | --- | --- |
| 1 | 安装并启动带 `product-remote` 配置的 UNSIGNED 包 | 出现狐狸头，不是「请先装数据库」 | **未观察** |
| 2 | 飞书登录 | 系统浏览器授权后进会话，不是 CAPABILITY_DENIED JSON 糊在胶囊里 | **未观察** |
| 3 | 账号登录 | POST 打 identity origin，不是 API origin | **未观察** |
| 4 | 登录后查询 | 有 Top 3 / 复制；不是 leftover `/v1/search` 慢查询 | **未观察** |
| 5 | 关窗取消、断网 | 网络错误不是「登录已失效」 | **未观察** |

## 不要当作已通过

- 本页存在于仓库里
- 开发机 unit / CI 绿
- 首轮离线勾选
- Authenticode、M5 设备清单、包内 PostgreSQL
- [macOS 打包态远端页](how-to-macos-packaged-product-remote.md)
- [Linux 打包态远端页](how-to-linux-packaged-product-remote.md)
