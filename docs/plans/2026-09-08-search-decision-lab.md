# 合成搜索判定实验工具

> **状态：** `APPROVED · SYNTHETIC EXPERIMENT TOOL ONLY`（PR #44 的历史交付范围）
> 后续否定语义修复及命令迁移见[当前修复计划](2026-09-08-search-negation-repair.md)；以下保留 #44 的原始失败状态。
> 不是正式产品能力、业务验收、007、T6 或 runtime 接入批准。
> 基线：`origin/main@0f9862adfd4a90e5416c1237f0a85c88535c9c2c`。
> 范围：仓内可复现实验/验收工具。不改变 `apps/api/src` 搜索行为。

## 交付

工具源码在 [`apps/api/experiments/search-decision/`](../../apps/api/experiments/search-decision/README.md)。命令：

- `pnpm test:search-decision` — 工具与限定范围，成功 0
- `pnpm test:search-decision:round1` — 首轮关闭范围，成功 0
- `pnpm test:search-decision:acceptance` — 完整 N 验收，N10/N19 非零
- `pnpm test:search-decision:known-fail` — 真实 acceptance CLI + 同次 JSON 的已知失败证明，成功 0

N10/N19 能力未实现。生成报告不入库。
