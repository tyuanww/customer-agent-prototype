# DEV-M0 产品仓执行记录

> **文档状态：** `APPROVED · EXECUTION RECORD`（记录已授权切片事实，不新增范围授权）
> **状态：** `IN_PROGRESS · DEV-M0`
> **开始日期：** 2026-08-31
> **组织门输入：** `DEC-DDEV-01=PASS`，证据索引 `EVD-DDEV-AUTH-20260831`
> **产品仓开工输入：** 用户已明确授权“开工授权 / DEV-M0 产品仓开工授权”
> **当前切片：** `DEV-M0-W0 · pre-move baseline + workspace scaffold`
> **提交输入：** 用户于 2026-08-31 明确给出“产品仓 W0 提交授权”；该授权不包含推送、PR、合并、部署或 W1
> **不代表：** 真实数据、飞书运行接入、Pilot、付费调用、自动发送、部署或发布授权；本记录的状态本身不扩张任何 Git 权限

## 1. 本切片的目标与边界

目标是在不改变现有 Electron 行为的前提下，固定机械迁移前的可重放基线，并建立唯一 Monorepo 的根策略与 `apps/desktop` 目标位。

明确不做：本切片不搬动 `src/`、测试或构建配置，不创建 API / worker / DB 空包，不生成正式 DTO / migration，不激活合同运行时，也不读取另一仓或飞书的运行时状态。

写入所有者是根 workspace 策略、`scripts/workspace-hygiene.mjs` 与迁移前 E2E 证据；现有 Electron main / preload / renderer 的所有权和信任边界不变。

## 2. 边界方案

| 方案 | 结果 | 原因 |
| --- | --- | --- |
| A：保留根应用，只声明 workspace globs、固定工具链并创建 `apps/desktop` 目标位 | **采用** | scaffold 与 mechanical move 分离；没有行为变化，也不会出现双入口 |
| B：同时创建 desktop/API/DB package manifest，并让根脚本转发 | 不采用 | 会提前制造空包和 pass-through 层，并把目录迁移、配置改写与正式能力混入同一变更 |

## 3. 修改前基线

运行环境：Node.js `v24.19.0`、pnpm `11.19.0`。

| 命令 | 结果 |
| --- | --- |
| `pnpm lint` | PASS；首次与 build 并行时碰到 Electron Vite 瞬时配置文件，构建结束后串行复跑通过，该并发结果不作为代码失败 |
| `pnpm typecheck` | PASS |
| `pnpm test` | PASS，50 files / 493 tests |
| `pnpm build` | PASS |
| `pnpm workspace:check` | PASS，修改前 source budget 6.04 MiB / 32.0 MiB |
| `pnpm test:e2e` | PASS，14 tests |

修改前基线未重新生成安装包；修改后补跑了本地未签名 macOS 包，见第 5 节。签名、公证、Windows 真机和生产验证均未运行，且不能由 macOS 本地构建代替。

## 4. 当前实现事实

- `pnpm-workspace.yaml` 声明 `apps/*` 与 `packages/*`，但当前可运行应用仍在根目录；不存在第二套运行入口。
- 根 `packageManager` 与 `engines.pnpm` 统一固定为 `pnpm@11.19.0`；Node 继续限定为 24.x。
- `apps/desktop/` 只记录未来桌面包边界，尚无运行代码或 package manifest。
- `workspace:check` 同时验证源码预算、当前 Node 运行时、根工具链、精确 workspace glob 集合、必需目标目录的每一级真实目录，以及所有 glob 根、直接成员和成员 manifest；版本漂移、抵消 glob、重复声明和软链接逃逸均失败关闭。
- 已接收合同仍固定为 `cs-ai-c11-openapi-1.11.0-schema-1.12-1d62e2c85c3c`；本切片保持 `ddev_authorized=false`、`runtime_activated=false`，不把组织开工授权误写成运行时激活。
- 迁移前 E2E 会先确认 Dashboard / Query 的 Electron 原生窗口和 WebContents 均已获得焦点，再验证“关闭当前表面”；空闲 Fox 按产品行为继续由 `showInactive()` 恢复，不伪造焦点。测试快照容忍且仅容忍已确认销毁的并发关窗对象，不修改窗口运行逻辑。

## 5. 修改后验证

| 命令 | 结果 |
| --- | --- |
| `pnpm lint` | PASS |
| `pnpm typecheck` | PASS |
| `pnpm test` | PASS，51 files / 504 tests |
| `pnpm build` | PASS |
| `pnpm workspace:check` | Node 24 下 PASS，root policy PASS；source budget 7.17 MiB / 32.0 MiB，`release/` 单独分账；Node 25.8.2 诊断按预期以 `NODE_RUNTIME_MISMATCH` 失败 |
| `pnpm contracts:verify` | PASS；精确合同集、来源 SHA、双哈希通过，`ddev_authorized=false`、`runtime_activated=false` |
| 焦点 / 关闭竞态 E2E 回归 | PASS，最终目标用例 repeat-each 20/20 |
| `pnpm test:e2e` | PASS，14/14 |
| 提交前 E2E 追加复跑 | `INVALID_ENVIRONMENT`；原生 Query 抢焦点后捕获到测试预设外的本机中文 IME 输入，造成焦点与自动收起断言漂移；为避免继续截获用户键盘已停止，不用该受污染结果覆盖此前 14/14 PASS |
| `pnpm package:mac:local` | 本 W0 前序 PASS；生成 universal 未签名 DMG / ZIP 并通过脚本后验；最终审查修正后未重复打包，且始终未签名、未公证、未发布 |

修改后的 E2E 回归依次捕获并修正了三处测试前置问题：`Page.bringToFront()` 与原生焦点不同步；窗口可能在 `BrowserWindow.getAllWindows()` 枚举后、属性读取前被原生关闭；以及空闲 Fox 的 `showInactive()` 行为不应被强行断言为已聚焦。最终只对 Dashboard / Query 等可关闭表面等待原生焦点，空闲 Fox 按真实非激活状态验证 no-op；快照读取仅在窗口或 WebContents 已确认销毁时跳过对象，其他异常继续抛出。期间另有一次无 trace 的测试进程 90 秒 teardown 超时，后续定向与全量复跑未复现；最终可重放结果为目标用例 20/20、全量 14/14。提交前的追加复跑在活动桌面上捕获到测试预设外的本机 IME 输入，因此按环境污染留档，不作为回归失败，也不继续运行会抢占真实键盘的原生焦点测试。

## 6. 下一切片

下一切片是独立的 mechanical move：把当前根 Electron 应用原样迁入 `apps/desktop`，修正导入、脚本与测试配置，并以与第 3 节相同的质量门证明行为等价。完成该结构变更后，才进入合同开发授权、codegen / runtime validation，以及 API/config/DB 的后续 DEV-M0 切片。

本记录只保存产品仓实施事实；项目总进度与授权状态继续由 `ai-赋能立项` 当前真源拥有。
