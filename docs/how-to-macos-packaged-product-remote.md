# How to：macOS 打包态产品主链（远端）

本页给**本机打开 UNSIGNED `.app` 的人**勾选。未看过的行保持 **未观察**。不要把 [M5](how-to-verify-macos-m5.md) 的 `synthetic-local` 勾选抄到本页。

狐狸 / 飞书 / 查询 / 复制须用 **v0.3.7** 及之后的 UNSIGNED `.app`（#153 每次查询前 `refreshAnnounce`，#154 话术库读当前发布）。详情卡标签跟 `ownerRole` 须用 **v0.3.8**。本机：`pnpm package:mac:local`。不要用 `0.3.6` / `7b9dc1a` / `#150` 或更早的包当本页证据：那一包不会在每次查询前对齐当前发布。

过敏售后 SOP 是**合成切片**，不是本页必勾项。查发货不会出现 SOP 入口；问「过敏了怎么办」才能看到「打开过敏售后流程」。本机已确认该问句可召回，不把 SOP 当成产品远端未完成项。

登录只有 **飞书** 和 **账号**。不要在本机为这条主链另装 PostgreSQL。

## 0.3.18 上线切面

当前产品 `main` 是 **0.3.19**。第一版只证明这条链，不扩范围：

1. 管理员发布（话术师发产品/活动仍是立项仓合同，产品仓还是 owner-only）。
2. 坐席飞书或账号登录后查询、复制。
3. 未签名包，没有 `latest.yml`，不自动更新。
4. 缺配置必须弹窗，不能闪退。
5. 不改备案隧道，不把 API / PostgreSQL 打进安装包。

做法：

1. 在产品仓 `main` 上跑 `pnpm package:mac:local`。产物在 `release/local-unsigned/`，文件名含 `UNSIGNED` 和 `0.3.19`。
2. 确认 `https://agent-auth.jianghua.site/health` 为 200。本机不要另装 PostgreSQL。
3. 把下面的 `synthetic-stack.json` 放到 `~/Library/Application Support/客服话术浮窗 Demo/`。打包态忽略 `CUSTOMER_AGENT_DESKTOP_*`。
4. 关掉旧 `.app`，打开这次的 UNSIGNED。按下面表格勾 1–4。账号登录、关窗/断网仍是未观察。
5. 内容发布按 [管理员导入并发布](tutorial-menokin-content-publish.md) 勾 6–7。话术师点发布预期仍是 403。
6. 办公机首轮不要用这份远端配置。离线安装/启动/浮窗/快捷键/卸载见 [办公机首轮](how-to-office-machine-first-round.md)。

未在这台机器上打开 0.3.18 包之前，不要把下表改成通过。

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

2026-09-22 在本机 0.3.18 UNSIGNED、`product-remote` 指向正式库 `rel_20` 时重勾了 1 / 2 / 4：飞书登录后复制出「30秒泡泡面膜 · 面膜红功效」（`upl00006`）。账号登录、关窗/断网、工作台导入发布，以及「面膜紫适用人群」这条查询，仍是未观察。

| # | 步骤 | 预期 | 通过 / 未通过 / 未观察 |
| --- | --- | --- | --- |
| 1 | 打开带 `product-remote` 配置的 UNSIGNED `.app` | 出现狐狸头，不是缺配置退出 | **通过**（2026-09-22，0.3.18） |
| 2 | 飞书登录 | 系统浏览器授权后进会话 | **通过**（2026-09-22，0.3.18） |
| 3 | 账号登录 | POST 打 identity origin | **未观察** |
| 4 | 登录后查询 / 复制 | 不是 leftover `/v1/search` | **通过**（2026-09-22，正式库 `rel_20`，`upl00006`） |
| 5 | 关窗取消、断网 | 网络错误不是「登录已失效」 | **未观察** |
| 6 | 管理员导入仓外 FAQ 并发布 | dual-review 后出现 `releaseId` | **未观察** |
| 7 | 查询「面膜紫适用人群」 | Top 3 来自新发布，不是仓内样例 | **未观察** |

## 不要当作已通过

- 本页存在于仓库里
- M5 `synthetic-local` 历史勾选
- 开发态 `pnpm dev` + export origin
- 签名、公证、外发
- [办公机 Windows 远端页](how-to-office-machine-product-remote.md)
- [Linux 打包态远端页](how-to-linux-packaged-product-remote.md)

步骤 6 / 7 的操作说明见 [管理员导入 MENOKIN FAQ 并发布](tutorial-menokin-content-publish.md)。
