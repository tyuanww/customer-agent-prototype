# Unified architecture program · ARC-01 durable record

日期：2026-11-05
分支：`codex/arc-01-contracts`
基线：`origin/main@83a59ed820a19d11a55a6d54d5f2cd5ad196dfdb`

## 本次范围

ARC-01 建立手写的共享合同源 `packages/unified-contracts`。它为后续 ACL、Query、SOP、Dashboard 和 overlay 单元提供一致的 ID、访问决策、查询联合、持久操作、发布身份、窗口快照和授权矩阵。冻结上游 OpenAPI 生成包 `packages/contracts` 不被改写，数据库在运行时仍拥有最终授权判断。

## 边界决策

比较过两种形状：

1. 把手写合同加入 `packages/contracts`。调用路径较短，但会让生成器和业务语义共享写入所有者，生成资产边界也会变模糊。
2. 新建独立 `packages/unified-contracts`，未来用显式 adapter 接入生成合同。该形状多一个包名，但把生成资产、业务语义和数据库运行时权威分开，Query/Dashboard 只能消费窄投影。

采用第二种。状态拥有者如下：

| 状态 / 合同 | 唯一所有者 |
| --- | --- |
| ID、AccessDecision、三种访问投影、QueryOutcome、OperationEnvelope、ReleaseSnapshot、OverlaySnapshot | `packages/unified-contracts/src/index.ts` |
| 授权 role ceiling、派生 ACL 与约束 | `ROLE_CEILING_POLICY` / `AUTHORIZATION_MATRIX`（同一源码文件） |
| JSON / SQL 派生文件 | `scripts/generate-policy-artifacts.mjs`，输入为上述矩阵 |
| 授权最终判定 | 数据库；合同只表达输入、版本组和稳定失败原因 |
| Query / Dashboard / admin 消费面 | 各自后续单元的 adapter；本 PR 不接 UI 或 API |

## 不变量

- 混合 content/SOP 字段、空或超过三条 content 命中、重复 rank/copy handle 和未知 discriminator 在运行时拒绝。
- SOP 分支 ID 与正 step sequence 唯一；每个 branch 的 source 必须指向 decision step，target 必须指向已有 step。
- 操作 ID 重用时 actor、command 或 request hash 改变是 contract error；相同绑定才是 replay；不同 session epoch 是 stale-session。
- accepted/running/unknown 只按显式 transition 表恢复；terminal 状态必须有形状精确、时间有效的回执，`expired` 是显式终态，unknown 不携带回执，recovery deadline 不早于 `updatedAt`。
- release 只有一个 `releaseId`，content 与 SOP 是独立投影；ready 必须有不空 index ID/hash 和正版本，empty 不带身份或条目；overlay 必须绑定 session epoch、角色和 active surface。
- Scope 只允许所属 kind 的字段：tenant 不带品牌/店铺/域/来源，brand 不带店铺/域/来源，shop 不带域/来源。
- `ROLE_CEILING_POLICY` 与 `0057_role_ceiling.sql` 的角色值、业务动作、分配/委托/父导入上限一致；ACL 的 grants/accounts 管理能力由同一 `mayAllocate` 派生。
- 生成 JSON 与 SQL 每次从同一策略确定性生成；静态测试读取 0057 的真实列和 `role` 主键，漂移检查按字节失败。生成 SQL 只是待审核 seed，不代表已应用。

## 验证记录

最终 head 的证据保存在协调器提供的目录：`/Users/hutou/.codex/visualizations/2026/11/05/01a1a9ff-2d68-7120-bbd8-593a7ca908a6/orchestrate/customer-agent-unified/reports/`。最终提交后另写以完整 SHA 命名的 receipt，将 PR head、命令输出、测试计数、静态 schema 测试和 benchmark 绑定到同一精确 head；PR 描述只引用该 head 的 receipt。

基准环境为 Node `v24.19.0`、macOS `darwin arm64`，每类 10,000 次、单个 discriminated result + 1 item/step（content/SOP）或 1 decision + 1 source scope + 1 action（access），错误数均为 0：content p50/p95/p99 = `0.000208/0.000542/0.001542 ms`，SOP = `0.000375/0.000958/0.001708 ms`，access = `0.001542/0.002417/0.003833 ms`。trunk 基线为 `unavailable`，因为 `origin/main@83a59ed8` 尚无该包；限制原因是不能伪造同形基线，仍按 brief 的 p95 `< 2 ms` 和零错误门槛记录 head 结果。

验证结果：unified 包类型检查、24 个 Vitest 测试、包入口 smoke、生成漂移、读取 0057 的静态 schema 测试、旧 `pnpm test:contract`（24 个测试）、`pnpm contracts:codegen:check`（246 schema）、根 `pnpm typecheck`、`pnpm check:architecture`（527 文件、0 违规）、`pnpm workspace:check` 和 `git diff --check` 均通过。静态测试同时校验 0057 的五列、`role` 主键、七个角色值和策略源。

## 后续交接

下游单元从该分支消费类型和运行时 validator。它们不得把 Query 投影扩展为账号/授权管理能力，不得把矩阵 seed 当作数据库授权替代，也不得手改 `generated/` 文件。ARC-01 没有 UI、API、数据库 migration、真实数据或正式运行激活证据。

### OVL-01 修复决定与证据

- 采用 `packages/unified-contracts` 的 `OverlaySnapshot` 作为唯一 wire contract。桌面本地形状只保留为 `OverlaySnapshotProjection.contract`，构造走 `parseOverlaySnapshot`、接收走 `validateOverlaySnapshot`；删除竞争型本地 wire type / validator。
- 每个 renderer report 都绑定发起时 session epoch、generation、window generation 与 content revision。Main 只比较这些来源值，不把旧 payload 改写成当前身份；window recreation 只接受 `current + 1`。
- reducer 保留原 content 合法迁移，并增加单调 content revision，避免迟到 `COPIED` / `ERROR` / `SEARCH_INPUT` 覆盖较新内容。布局 ACK 只在匹配当前 pending sequence 时消费；同代 drag settle 后的 move 直接拒绝，单个状态不会同时拥有 drag session 和 settle。
- Main 在 effect 队列完全收敛后发布一次最终 snapshot；取消通过 typed `OverlayWorkPort` 执行，默认端口向 Query 发送关闭查询、复制和内容清理命令，后续正式 adapter 可替换同一端口。
- 原生 drag transaction 和 blur recheck 由 session/window identity 隔离；session、window 重建或关闭会清除它们。frame 观测以 `kind:id` 复合键有界记录，指标诚实标为 Main 到 renderer rAF callback，而不是 paint。
- 第二轮独立 verifier 发现 timeout 与直接 renderer command 仍可绕过 reducer。修复后 handoff、layout 和 drag timeout 均携带 captured session/generation/window identity，layout 另带 sequence/content revision；超时先回到 reducer，再由 typed fallback effect 发送 ACK。Query reactivation、display anchor 同步、fallback ACK 和 shortcut status 都改为 `NativeEffect`。
- frame observation key 现在包含完整 origin identity 和 command kind/id；generation、session、window 或 content revision 变化会清除 pending 样本并计入 dropped。window recreation 的 current+1 规则已移到 reducer，cold 指标明确为 first completed observation。
- 第三轮独立 verifier 发现迟到 Query 订阅、rejected layout 副作用、release 回滚、窗口重建 release 丢失、projection 弱校验和 cold 口径问题。修复后 reducer 保存并重放原始 `prepare-search`；rejected layout report 不再修改原生 bounds 或 ACK；release change 使用服务端单调 `releaseSequence`，窗口重建保留 release；projection 使用精确 key、严格 `pendingOpen`/`prepareCommand` 校验；`coldMs` 改为首个完成观测自身的 callback duration。
- 第四轮 verifier 发现 settle commit 后的迟到 move、display timeline 跨生命周期、parked snapshot 未消费、默认 identity、fallback ACK 仍由 executor 手拼、release 本地 revision 可读取新值、projection 嵌套 exact-key 缺口。修复后上一 drag generation 不能重新取得 bounds；display/post-drag timer 捕获 lifecycle 与 drag generation；Query 消费 handoff id 0 的初始 snapshot，无 snapshot 时不生成 identity；fallback ACK 走 `LAYOUT_FALLBACK_APPLIED -> SEND_RENDERER_COMMAND`；release 使用服务端 `releaseSeq`；projection 全部嵌套形状 exact-key 校验。
- 失败方案：为 commit 使用拖拽前 identity 会因 settle 创建时递增 lifecycle generation 而误拒绝；最终改为 settle 创建不推进 lifecycle generation，内容推进由独立 revision 表达。复杂 native setBounds 测试若复用未 commit 的 harness drag，会产生后续 UI drag 被旧 settle 阻断；测试 harness 现按真实 Fox commit 路径收尾。
