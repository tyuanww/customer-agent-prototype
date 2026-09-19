# Mac 开发机剩余项收口（2026-09-18）

> **状态：** 本机可做的三项已拍板收口。不引入 native addon，不打开 P4 / 真飞书，不搞 Windows。  
> **相关：** [办公机交付路径](2026-09-17-office-machine-delivery-path-decision.md)、`TODOS.md` Overlay NSPanel / P7 / P9、[桌面检索](../reference-desktop-retrieval.md)、[M5 清单](../how-to-verify-macos-m5.md)。

本页只冻结 **这台 Mac 开发机** 上还能做、且不碰 Windows 的三条。不是 M5 完成戳，也不是办公机验收。

## 1. NSPanel 隐身 — 本轮不做 native

当前收起交还焦点已经够用日常开发：闲置狐狸 `setFocusable(false)`；仅当 Dashboard / 登录 / SOP 都不可见时才 `app.hide()`，再 `showInactive` 狐狸。Electron `type: 'panel'` 只加了 NonactivatingPanel 掩码。

真正 Spotlight 级「点浮窗也不把本 App 推到前台」要 AppKit `becomesKeyOnlyIfNeeded` / `_setPreventsActivation`。那会牵动公证、打包和 Electron 版本。

**拍板：** 本轮 **不** 引入新 native addon。IME 级隐身仍挂在 `TODOS.md`，等产品明确要「微信输入框完全不丢焦点」再开。不要把现在的 panel 写成已经隐身。

## 2. P7 检索资产 — 本机路径冻结

桌面主链索引 **不进 git、不打进安装包**。本机约定：

| 文件 | 默认路径 | 谁写 |
| --- | --- | --- |
| BM25 索引 | `~/.customer-agent-synthetic-stack/retrieval-index.json` | `pnpm retrieval:questions` 等仓外脚本 |
| 正文向量 | `~/.customer-agent-synthetic-stack/retrieval-embeddings.json` | `pnpm retrieval:embeddings` |
| hydrate 原文 | `~/.customer-agent-synthetic-stack/retrieval-hydrate.json` | 胶囊「登录」按 `content_current` 对齐；或 `pnpm retrieval:hydrate` |

打包态 / 带 loopback origin 的 `pnpm dev`：`packaged-retrieval-paths.ts` 只在文件 **已经存在** 时挂 env。文件不在就没有桌面主链（会落到 leftover `/v1/search` 或无命中），**不** 从包内解压一份。

新机器要主链：拷这几个仓外文件，或在本机栈已跑时再跑 `retrieval:*` 并点「登录」。不要把真实客户原文写进 git。

**明确不做：** 索引打进 extraResources；登录后从远端拉索引（那是 P4）；离线 `{ "mode": "synthetic-offline" }` 冒充有主链（P3 只验浮窗，没有 API）。

## 3. P9 离线 profile 下重验 M5 — P3 不适用主链

`synthetic-offline` 是显式 S0：只有狐狸/查询壳，没有 loopback API，不能登录、不能查话术、不能复制命中。因此 **不能** 用离线 profile 重走 M5 的登录 / 查询 / 复制 / STALE。

| 模式 | M5 主链（登录/查询/复制） | 记录 |
| --- | --- | --- |
| 开发态 `synthetic-local` + 本机栈 | 适用 | 关窗取消已于 2026-09-18 记入 M5 第 7 节 |
| M4 UNSIGNED + `synthetic-local` | 适用 | 2026-09-16 已记打包态登录/查询/复制 |
| 打包空 userData → seed `synthetic-offline` | **不适用** 主链 | 只证明 S0 浮窗能起来 |
| `AUTH_MODE=feishu` / P4 远端 | 以后才适用 | 未授权，P9 对 P4 仍 OPEN |

> **2026-09-19 注：** `product-remote` 的 M5 主链重验表已写在 [how-to M5 §7.1](../how-to-verify-macos-m5.md) 与 [P9](2026-09-19-p9-remote-m5.md)。行全部是 **未观察**，不是通过。本页仍不授权再打 `package:mac:local`。

**拍板：** P3 引入后，P9 对离线 profile 记 **不适用**，不要拿 S0 勾 M5。P4 若落地，P9 再开。本页不授权再打 `package:mac:local`。

## 本机卫生（同日已做）

- 主仓 `checkout --detach origin/main` → `ce2670d`（含 #127）
- `wt-m5-login` 已拆；日常跑应用仍用 `wt-dashboard-live`
