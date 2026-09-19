# 合入后：合入顺序记录改为已合入

> **状态：** 已实现（`feat/docs-landed-merge-order`）。  
> **不包含：** 配隧道、改 VERSION、把远端清单标成已观察。

## 拍板

1. `docs/plans/2026-09-19-local-unpushed-merge-order.md` 写成已合入 `58dfac4`（#135–#141、#143）。
2. README 入口不再写「本地未 push」。
3. AGENTS 写明 `pnpm package:linux` 必须在 Linux 上跑。
4. 仍不要合 `feat/p7-embeddings-delivery`。
