# 合入顺序记录

> **状态：** 已合入 `origin/main` `58dfac4`（PR #135–#141、#143）。#142 因 how-to 基线分支被删关掉，由 #143 承接。
> **仍不要合：** `feat/p7-embeddings-delivery`。
> **仍未做：** 配隧道、Linux 实机打包装、打包态远端勾选。

本机有多条互不跟踪的 feature 线。**不要把两条 P7 都合进去。**

## 两条 P7，只留一条

| 线 | 尖端 | 说明 |
| --- | --- | --- |
| **采用** origin 隔离线 | `feat/p7-semantic-origin-path` `3878e4b` | 分文件、登录写 BM25/向量、leftover 关闭、origin 进 env、种子拷贝 best-effort、运行时不回落 leftover、补向量门闩、保大目录、BM25 fallback 走 keyed |
| **不要合** 早期交付线 | `feat/p7-retrieval-delivery` `92e14ab` → `feat/p7-embeddings-delivery` `8cbe97d` | 登录写索引/向量，但**没有** origin 分文件；与隔离线重叠 |

origin 隔离线已包含登录写 BM25（`b92602c`）、登录补向量（`4e96d37`）以及其后 hardening（`e087265` … `3878e4b`）。早期线可删，勿 squash 进 main。

## 可并行、从 main 各自 1 commit 的线

合入顺序建议（冲突面小的先）：

1. `feat/p4-account-https` `fac71e8` — 账号 POST 走 HTTPS identity origin
2. `feat/p6-cert-proxy` `075db76` — ProductHttp / 登录 / MiniMax 共用 `net.fetch`
3. `feat/p9-remote-m5` `5f32c78` — product-remote M5 全未观察
4. `feat/windows-yield-focus` `bad4d09` — Windows 收起交还前台（非实机勾选）
5. `feat/p10-no-bundled-stack` `31f6c50` — 缺配置不再叫人装 PG
6. **P7 隔离线尖端** `feat/p7-semantic-origin-path` `3878e4b`（含 `feat/p7-publish-desktop-origin` `b04cc79`）
7. **P10 userData + 三端远端 how-to 尖端** `feat/linux-packaged-remote-howto` `59396a2`（含 `d95a5ec` 路径对齐、Windows/Linux how-to、M5 注、合入顺序、办公机/macOS/Linux 远端清单）
8. **P10 Linux local-unsigned + CI + XDG 尖端** `feat/merge-order-p7-linux-tips`（含 `feat/p10-linux-xdg-userdata` `4f12bfc`、`9a1b519` UNSIGNED AppImage artifact）。Overlay smoke 仍启动打包 `out/`，不是 AppImage。

`feat/p10-no-bundled-stack` 与本 userData 线都从 main 分出，合入时可能撞 TODOS/CHANGELOG，按上面 5 再 7 再 8 处理。

## 中间 tip 不必单独开 PR

P7 隔离线中间的 `feat/p7-origin-keyed-retrieval` … `feat/p7-publish-desktop-origin` `b04cc79` … `feat/p7-persist-no-shrink` `4d320a3` 已被 `3878e4b` 包含。  
P10 userData 中间的 `feat/p10-desktop-userdata-path`、`feat/p10-m5-userdata-note` … `feat/macos-packaged-remote-howto` 已被 `59396a2` 包含。  
P10 Linux 打包中间的 `feat/p10-package-linux-local` … `feat/p10-linux-e2e-deps` `cfc4bed` … `feat/p10-linux-ci-artifact` `9a1b519` … `feat/p10-linux-xdg-userdata` `4f12bfc` 已被 `feat/merge-order-p7-linux-tips` 包含。

## 仍未做

- push / PR / 合 main（需另授权）
- 第二条隧道 DNS（需「配隧道」）
- 多公司 PG 分库
- NSPanel native
- 包内 PostgreSQL
- 在 Linux 实机跑 `package:linux` 并勾选远端主链
