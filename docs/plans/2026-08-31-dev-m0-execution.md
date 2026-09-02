# DEV-M0 产品仓执行记录

> **文档状态：** `APPROVED · EXECUTION RECORD`（记录已授权切片事实，不新增范围授权）
> **状态：** `IN_PROGRESS · DEV-M0`
> **开始日期：** 2026-08-31
> **组织门输入：** `DEC-DDEV-01=PASS`，证据索引 `EVD-DDEV-AUTH-20260831`
> **产品仓开工输入：** 用户已明确授权“开工授权 / DEV-M0 产品仓开工授权”
> **当前切片：** `DEV-M0-W3 · Application API / config bootstrap · COMPLETE · MERGED`
> **W2 开工输入：** 用户于 2026-09-02 明确给出“DEV-M0 合同开发与 codegen/runtime validation 开工授权”；提交、推送、PR、Review、合并与候选分支清理均已按独立授权完成，PR #10 squash 合并头为 `1a77297d51ce3cf3a0a551290675c60c941be4b6`
> **W3 开工输入：** 用户于 2026-09-02 在 W2 有序落地后授权创建下一切片并本地实现/验证；后续提交、推送、PR、Review、合并与候选分支清理又按明确授权完成，PR #11 合并头为 `2758dba5bebefc3fce87fdc73cffb6a7122bbea7`
> **下一切片：** `DEV-M0-W4 · immutable migration / PostgreSQL deep module · NOT STARTED`；仍须单独开工授权
> **W1 开工输入：** 用户于 2026-08-31 明确给出“产品仓 W1 分支创建与开工授权（基于 6111272）”；该授权不包含 W1 提交、推送、PR、合并、部署或后续正式能力切片
> **W0 历史输入：** 用户曾明确给出“产品仓 W0 提交授权”；W0 已通过独立 Git 门完成，不自动扩张到 W1
> **不代表：** 真实数据、飞书运行接入、Pilot、付费调用、自动发送、部署或发布授权；本记录的状态本身不扩张任何 Git 权限

## 1. W0 目标与边界（历史基线）

目标是在不改变现有 Electron 行为的前提下，固定机械迁移前的可重放基线，并建立唯一 Monorepo 的根策略与 `apps/desktop` 目标位。

明确不做：本切片不搬动 `src/`、测试或构建配置，不创建 API / worker / DB 空包，不生成正式 DTO / migration，不激活合同运行时，也不读取另一仓或飞书的运行时状态。

写入所有者是根 workspace 策略、`scripts/workspace-hygiene.mjs` 与迁移前 E2E 证据；现有 Electron main / preload / renderer 的所有权和信任边界不变。

## 2. W0 边界方案

| 方案 | 结果 | 原因 |
| --- | --- | --- |
| A：保留根应用，只声明 workspace globs、固定工具链并创建 `apps/desktop` 目标位 | **采用** | scaffold 与 mechanical move 分离；没有行为变化，也不会出现双入口 |
| B：同时创建 desktop/API/DB package manifest，并让根脚本转发 | 不采用 | 会提前制造空包和 pass-through 层，并把目录迁移、配置改写与正式能力混入同一变更 |

## 3. W0 修改前基线

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

## 4. W0 实现事实

- `pnpm-workspace.yaml` 声明 `apps/*` 与 `packages/*`，但当前可运行应用仍在根目录；不存在第二套运行入口。
- 根 `packageManager` 与 `engines.pnpm` 统一固定为 `pnpm@11.19.0`；Node 继续限定为 24.x。
- `apps/desktop/` 只记录未来桌面包边界，尚无运行代码或 package manifest。
- `workspace:check` 同时验证源码预算、当前 Node 运行时、根工具链、精确 workspace glob 集合、必需目标目录的每一级真实目录，以及所有 glob 根、直接成员和成员 manifest；版本漂移、抵消 glob、重复声明和软链接逃逸均失败关闭。
- 已接收合同仍固定为 `cs-ai-c11-openapi-1.11.0-schema-1.12-1d62e2c85c3c`；本切片保持 `ddev_authorized=false`、`runtime_activated=false`，不把组织开工授权误写成运行时激活。
- 迁移前 E2E 会先确认 Dashboard / Query 的 Electron 原生窗口和 WebContents 均已获得焦点，再验证“关闭当前表面”；空闲 Fox 按产品行为继续由 `showInactive()` 恢复，不伪造焦点。测试快照容忍且仅容忍已确认销毁的并发关窗对象，不修改窗口运行逻辑。

## 5. W0 修改后验证

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

## 6. W1 目标与边界

W1 从已合并的 W0 基线 `6111272faf1adf9b2e457f9d6458c884480d06f6` 开始，只做一次可审查的机械迁移：把现有 Electron 源码、测试、资产、构建配置和打包脚本原样移入 `apps/desktop`，同时保持根命令稳定，并以 W0 同级质量门证明行为等价。

写入所有者分成两层：`apps/desktop` 唯一拥有桌面运行时、测试、资产、构建和打包知识；根 workspace 只拥有稳定命令门面、合同接收与 workspace 卫生策略。W1 不新增 API、worker、DB、OAuth、遥测、真实数据、UI 行为或 IPC 能力，也不激活正式合同运行时。

## 7. W1 实现事实

- `src/`、`tests/`、`assets/`、`build/`、Electron/Vite/Vitest/Playwright/TypeScript 配置、品牌文件、许可声明与平台打包脚本已迁入 `apps/desktop/`；测试和源码保持同包相对依赖。
- `apps/desktop/package.json` 是唯一桌面产品 manifest 与产品版本写入点，包名为 `@customer-agent/desktop`；根 `package.json` 不再声明版本，只转发稳定开发 / 验证 / 打包命令，并直接拥有仓级 lint、合同与 workspace 工具；`.gstack/package-json-path` 把后续 `/ship` 版本操作固定到桌面产品 manifest。
- Node / pnpm 工具链只由根 manifest 与仓级卫生门拥有，桌面产品 manifest 不复制工具链约束，避免双写漂移。
- Electron 构建输出迁为 `apps/desktop/out/`；本地或正式安装包仍按既有外部产物合同写入根 `release/`，不产生第二套发布目录。
- workspace 卫生门现在验证 `apps/desktop` 的真实目录、manifest、名称、私有属性与无工具链覆盖，以及产品版本清单固定点和根门面无版本约束；同时分别识别当前 app 产物与 W0 根目录遗留可再生成项（含旧 `build/icon.*`）。
- main / preload / renderer / shared 的代码内容、IPC 白名单、sender / role 门禁、sandbox 配置、合成 fixture 和复制语义均未扩张。
- 正式合同仍是 `VERIFIED_NOT_ACTIVATED`，`ddev_authorized=false`、`runtime_activated=false`。

## 8. W1 验证

运行环境：Node.js `v24.19.0`、pnpm `11.19.0`。

| 命令 | 结果 |
| --- | --- |
| `pnpm install --offline` | PASS；2 个 workspace project，0 下载，锁文件与本地依赖图一致 |
| `pnpm lint` | PASS；根级仓库扫描，零 warning |
| `pnpm typecheck` | PASS |
| `pnpm test` | PASS，51 files / 506 tests；包含 macOS / Windows 打包路径合同 |
| `pnpm build` | PASS；输出 `apps/desktop/out/main`、`preload`、`renderer` |
| `pnpm workspace:check` | PASS；root policy PASS，source budget 7.20 MiB / 32.0 MiB |
| `pnpm contracts:verify` | PASS；合同集、来源 SHA 与双哈希通过，仍未激活 |
| `pnpm test:e2e` | PASS，14/14；真实 Electron 窗口、IPC、复制与 Dashboard 路径在迁移后保持等价 |

W1 未生成 DMG、ZIP 或 Windows 安装包；打包路径和资源合同已由全量测试覆盖，但这不等于实际产包、签名、公证、Windows 真机、部署或发布证据。

## 9. W2 / W3 落地与下一切片

W1 已通过独立 Git 门合并为 `6c759c6b317d9382787dcec200f3e828b7a5007d`。W2 已通过 PR #10 squash 合并为 `1a77297d51ce3cf3a0a551290675c60c941be4b6`，候选 worktree 与本地/远端分支均已清理；合同包保持 `runtime_activated=false`。

W3 已从该合并头建立隔离分支并完成实现与验证：只实现 loopback Fastify `/health`、命名 profile 与监听前配置拒启；不注册 `/ready` 或九业务端口，不创建 migration/PostgreSQL、真实数据、Feishu auth、桌面接线或运行时激活。W3 已通过 PR #11 合并为 `2758dba5bebefc3fce87fdc73cffb6a7122bbea7`，候选 worktree 与本地/远端分支均已清理；执行快照见 [`2026-09-02-dev-m0-w3-api-config-bootstrap.md`](2026-09-02-dev-m0-w3-api-config-bootstrap.md)。

下一切片 W4 应建立不可变 migration / PostgreSQL 深模块，覆盖 DDL 来源锁、`status → plan → apply → verify`、PG15 clean install、ACL / SQLSTATE、N-only / N-1 兼容与失败回滚。W4 尚未开工，必须取得单独授权；W2 / W3 合并不自动放行 W4、DEV-M1、真实数据、部署或 Pilot。

本记录只保存产品仓实施事实；项目总进度与授权状态继续由 `ai-赋能立项` 当前真源拥有。
