# Desktop workspace package

本目录是客服 Agent 当前唯一可运行的 Electron 包，拥有 main、按角色拆分的 preload、renderer、shared、桌面测试、品牌资产、构建配置与打包后验。仓库根 `package.json` 只提供稳定的 workspace 命令入口，因此仍从仓库根运行 `pnpm dev`、`pnpm test`、`pnpm build` 和 `pnpm package:*`。

本次 `DEV-M0-W1` 只完成机械迁移：运行行为、UI、IPC、合成 fixture 与安全边界均不改变。Application API、数据库、凭证、正式数据适配和合同运行时不属于本切片，也不得为了目录便利进入 renderer。

批准顺序见 [`docs/plans/2026-08-21-customer-agent-productization.md`](../../docs/plans/2026-08-21-customer-agent-productization.md#124-monorepo-迁移与变更放大控制)，当前实施事实见 [`docs/plans/2026-08-31-dev-m0-execution.md`](../../docs/plans/2026-08-31-dev-m0-execution.md)。
