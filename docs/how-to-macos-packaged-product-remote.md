# How to：macOS 打包态产品主链（远端）

本页给**本机打开 UNSIGNED `.app` 的人**勾选。未看过的行保持 **未观察**。不要把 [M5](how-to-verify-macos-m5.md) 的 `synthetic-local` 勾选抄到本页。

狐狸 / 飞书 / 查询 / 复制须用 **v0.3.7** 及之后的 UNSIGNED `.app`（#153 每次查询前 `refreshAnnounce`，#154 话术库读当前发布）。详情卡标签跟 `ownerRole` 须用 **v0.3.8**。本机：`pnpm package:mac:local`。不要用 `0.3.6` / `7b9dc1a` / `#150` 或更早的包当本页证据：那一包不会在每次查询前对齐当前发布。

过敏售后 SOP 是**合成切片**，不是本页必勾项。查发货不会出现 SOP 入口；问「过敏了怎么办」才能看到「打开过敏售后流程」。本机已确认该问句可召回，不把 SOP 当成产品远端未完成项。

登录只有 **飞书** 和 **账号**。不要在本机为这条主链另装 PostgreSQL。

## 准备

1. 合入后的 UNSIGNED `.app`（文件名含 `UNSIGNED`）。
2. 需要网络。
3. 把 `synthetic-stack.json` 放到 `~/Library/Application Support/客服话术浮窗 Demo/synthetic-stack.json`：

```json
{
  "mode": "product-remote",
  "apiOrigin": "https://agent-auth.jianghua.site",
  "identityOrigin": "https://agent-pass.jianghua.site"
}
```

两个 origin 必须不同、必须是 `https://` 主机名。打包态忽略 `CUSTOMER_AGENT_DESKTOP_*` 环境变量。

## 勾选

本机 v0.3.7 UNSIGNED（`52a16db` / #154 包）于 2026-09-20 核对：狐狸 → 飞书 → 查询 → 复制（下表 1 / 2 / 4）。话术库列表来源为「当前发布」（hydrate `rel_18`）。顶栏「演示数据」仍在：VOC / 工单 / KPI 是合成样本。v0.3.8 只补详情卡标签与「来源」同为 `ownerRole`，不推翻 1 / 2 / 4。过敏 SOP 为合成可选，不列入本表。账号登录与关窗/断网仍未观察。

| # | 步骤 | 预期 | 通过 / 未通过 / 未观察 |
| --- | --- | --- | --- |
| 1 | 打开带 `product-remote` 配置的 UNSIGNED `.app` | 出现狐狸头，不是缺配置退出 | **通过** |
| 2 | 飞书登录 | 系统浏览器授权后进会话 | **通过** |
| 3 | 账号登录 | POST 打 identity origin | **未观察** |
| 4 | 登录后查询 / 复制 | 不是 leftover `/v1/search` | **通过** |
| 5 | 关窗取消、断网 | 网络错误不是「登录已失效」 | **未观察** |

## 不要当作已通过

- 本页存在于仓库里
- M5 `synthetic-local` 历史勾选
- 开发态 `pnpm dev` + export origin
- 签名、公证、外发
- [办公机 Windows 远端页](how-to-office-machine-product-remote.md)
- [Linux 打包态远端页](how-to-linux-packaged-product-remote.md)
