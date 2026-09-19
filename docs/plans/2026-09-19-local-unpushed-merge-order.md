# 本地未 push 分支合入顺序

> **状态：** 盘点（`feat/local-merge-order`）。相对 `origin/main` `0ab267b`。  
> **不包含：** 授权 push / 开 PR / 合 main / 配隧道。

本机有多条互不跟踪的 feature 线。**不要把两条 P7 都合进去。**

## 两条 P7，只留一条

| 线 | 尖端 | 说明 |
| --- | --- | --- |
| **采用** origin 隔离线 | `feat/p7-publish-desktop-origin` `b04cc79`（13 commit） | 分文件、登录写 BM25/向量、leftover 关闭、origin 进 env |
| **不要合** 早期交付线 | `feat/p7-retrieval-delivery` `92e14ab` → `feat/p7-embeddings-delivery` `8cbe97d` | 登录写索引/向量，但**没有** origin 分文件；与隔离线重叠 |

origin 隔离线已包含登录写 BM25（`b92602c`）和登录补向量（`4e96d37`）。早期线可删，勿 squash 进 main。

## 可并行、从 main 各自 1 commit 的线

合入顺序建议（冲突面小的先）：

1. `feat/p4-account-https` `fac71e8` — 账号 POST 走 HTTPS identity origin
2. `feat/p6-cert-proxy` `075db76` — ProductHttp / 登录 / MiniMax 共用 `net.fetch`
3. `feat/p9-remote-m5` `5f32c78` — product-remote M5 全未观察
4. `feat/windows-yield-focus` `bad4d09` — Windows 收起交还前台（非实机勾选）
5. `feat/p10-no-bundled-stack` `31f6c50` — 缺配置不再叫人装 PG
6. **P7 隔离线尖端** `feat/p7-publish-desktop-origin` `b04cc79`
7. **P10 userData 线尖端** `feat/p10-m5-userdata-note` `9d74722`（含 `d95a5ec` 路径对齐 + Windows/Linux how-to + M5 注）

`feat/p10-no-bundled-stack` 与 P10 userData 线都从 main 分出，合入时可能撞 TODOS/CHANGELOG，按上面 5 再 7 处理。

## 中间 tip 不必单独开 PR

P7 隔离线中间的 `feat/p7-origin-keyed-retrieval` … `feat/p7-origin-no-leftover-search` 已被 `b04cc79` 包含。  
P10 userData 中间的 `feat/p10-desktop-userdata-path` … `feat/p10-linux-userdata-docs` 已被 `9d74722` 包含。

## 仍未做

- push / PR / 合 main（需另授权）
- 第二条隧道 DNS（需「配隧道」）
- 多公司 PG 分库
- NSPanel native
- 包内 PostgreSQL
