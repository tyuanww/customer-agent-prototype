# Desktop workspace target

`DEV-M0` 的 workspace scaffold 只在这里固定未来桌面包的落点。当前可运行的 Electron 应用仍完整位于仓库根目录；在独立的 mechanical-move changeset 完成前，本目录不放运行代码、不建立第二套配置，也不改变任何 UI 或 IPC 行为。

机械迁移完成后，本目录将拥有 Electron main、按角色拆分的 preload、renderer、桌面测试与打包输入。Application API、数据库、凭证和正式数据适配不属于这个包，也不得为了迁移方便进入 renderer。

权威迁移顺序见 [`docs/plans/2026-08-21-customer-agent-productization.md`](../../docs/plans/2026-08-21-customer-agent-productization.md#124-monorepo-迁移与变更放大控制)。
