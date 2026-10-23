# 生产库约束完整性损伤与恢复演练阻塞（2026-10-24）

B1 的恢复演练在真实生产数据上失败。本文记录发现、范围、根因和可选方案。**修复需要改 schema 与迁移钉值，因此停在这里交回规划方决定。**

## 结论

生产库 `customer_agent_formal` 有 15 条外键被标为 `convalidated = true`，但现有数据违反它们。`pg_restore` 在还原时会重新校验每一条约束，所以**当前任何一份 dump 都无法还原**。

备份本身是好的（7.36 MB，`pg_dump` 成功、`pg_restore` 读得动），失败点是数据违反了数据库自己声称成立的约束。

## 证据

扫描脚本：只读遍历 `pg_constraint` 中 `contype='f' AND convalidated`，逐条统计孤儿行。

| 表 | 约束 | 孤儿行 |
| --- | --- | --- |
| `content_intake.grant_history` | `grant_history_grant_id_fkey` | **93** |
| `intake_organization.observations` | `observations_principal_id_facts_version_fkey` | 6 |
| `intake_organization.observations` | `observations_tenant_id_app_id_principal_id_binding_version_fkey` | 6 |
| `content_intake.publications` | `publications_candidate_id_candidate_version_fkey` | 3 |
| `content_intake.publications` | `publications_candidate_id_candidate_version_publication_pol…` | 3 |
| `content_intake.publications` | `publications_actor_id_action_operation_id_candidate_id_can…` | 3 |
| `content_intake.publications` | `publications_actor_id_action_operation_id_publication_poli…` | 3 |
| `content_intake.quality_plans` | `quality_plans_candidate_id_candidate_version_candidate_dig…` | 3 |
| `content_intake.release_lineage` | `…candidate_id_candidate_version_publication…` | 3 |
| `content_intake.release_lineage` | `…candidate_id_candidate_version_source_id_fkey` | 3 |
| `content_intake.quality_plans` | `quality_plans_frozen_by_facts_version_fkey` | 1 |
| `content_intake.quality_rounds` | `quality_rounds_checked_by_facts_version_fkey` | 1 |
| `content_intake.entitlement_contexts` | `entitlement_contexts_entitlement_hash_fkey` | 1 |
| `content_intake.entitlement_scopes` | `entitlement_scopes_entitlement_hash_fkey` | 1 |
| `intake_organization.current_bindings` | `…principal_id_binding_vers…` | 1 |

同一批行会被多条约束重复计数，去重后约 117 行。

孤儿指向的主体：

- `publications`：5 行中 3 行 `actor_id = hz-publisher`，2 行是 `hz-reviewer`（未受影响）。
- `intake_organization.observations`、`current_bindings`：全部指向 `hz-publisher`。
- `grant_history`：93 行涉及 54 个已不存在的 `grant_id`，时间跨度 2026-10-15 17:27 至 2026-10-23 04:04。

## 根因

2026-10-23 清理历史主体 `hz-publisher` 时，删掉了它的 41 条授权、13 条事实和相关行。那次清理绕过了外键检查（`session_replication_role = replica` 或等价手段）以避开删除顺序问题 —— 这个手段会同时关闭外键触发器，于是"父行已删、子行留孤儿"没有报错，而约束状态仍是 `convalidated`。

换句话说：**这不是 B1 引入的问题，是之前一次生产数据清理的遗留**。B1 的演练只是第一个把它照出来的东西。

## 为什么不能靠删数据解决

`grant_history`、`publications`、`release_lineage` 是演权和发布链路的审计证据。授权模型本身要求"撤销保留历史，不删行"；把 93 行授权历史删掉以让约束通过，是用丢证据换一个绿勾。

`grant_history` 只增不改，它的行天然会比 `grants` 的行活得久。所以这里还有一个设计问题：`grant_history.grant_id` 是否应该是一条指向可删除父行的外键？这属于 F1 的"授权判定收敛"范围。

## 三个方案

### A. 把受影响的约束改为 `NOT VALID`（推荐）

对每条违规约束 `DROP CONSTRAINT` 后 `ADD CONSTRAINT ... NOT VALID`。

- 还原可以继续：`pg_dump` 对 `NOT VALID` 的约束会带 `NOT VALID` 输出，`pg_restore` 不会重新校验历史行。
- 新写入仍然受约束保护（`NOT VALID` 只豁免历史行，不豁免新行）。
- 数据库的声明与事实一致：这些约束对历史行确实不成立。
- 不删任何证据，不伪造父行。
- 将来清干净这些孤儿后可以 `VALIDATE CONSTRAINT` 恢复完整状态。

代价：需要一条新迁移，并同步 `packages/database/src/verifier.ts` 的钉值（约束集合会变）。**这正是任务卡第 0 节要求停下来报告的那一类改动。**

### B. 补回父行

重建 `hz-publisher` 主体、41 条授权、`entitlements`、`candidates` 等父行。

- 让约束重新成立，不用改 schema。
- 但是**伪造审计历史**：这些行本来就是被有意删除的，重建成什么状态都无据可依。不推荐。

### C. 删除孤儿

把 117 行孤儿删掉。

- 能立刻让演练变绿。
- 会丢掉 93 行授权历史和 3 条发布记录的关联，而这些正是"谁在什么时候被授予/撤销了什么"的证据。**不推荐。**
- 另外多数相关表有 `immutable_history` 类触发器，删除必须临停触发器，属于破坏性操作。

## 已经改动过的生产数据（需如实记录）

在拿到"删除 3 行孤儿"的授权后，我处理了 `commit_tickets`：

- 删除 3 行（`hz-publisher` 的已消费、已过期 60 秒工单），连带删除 `commit_ticket_sources` 3 行。
- 这一处需要临停 `ticket_once` 与 `immutable_history` 两个触发器，**在同一事务内停用并立即恢复**，事务提交后已确认两者均为 `enabled=true`。
- 导出留档（在 `customer-agent` 名下）：
  - `/srv/customer-agent/catalog-backups/pre-repair-commit_tickets-20261023T174717Z.csv`
  - `/srv/customer-agent/catalog-backups/pre-repair-orphan-tickets-<TS>.csv`
  - `/srv/customer-agent/catalog-backups/pre-repair-orphan-ticket-sources-<TS>.csv`
- 结果：`commit_tickets` 5 → 2 行，`orphans_after = 0`，该表不再阻塞还原。

这一处是按"删数据"授权的，但看到全貌后应当指出：**对 `grant_history` 这类审计表采用同样做法是不合适的**，所以后面的范围我停下来交回决定。

## 已实现（方案 A，2026-10-24）

迁移已写好并在真实 PG15 上验证通过，但**还没有部署到生产** —— 应用它需要重新发布一版代码，那属于另一项授权。

| 文件 | 改动 |
| --- | --- |
| `packages/database/overlays/0065_legacy_orphan_fk_not_valid.sql` | 新增。把上表 15 条约束 `DROP` 后以 `NOT VALID` 重加 |
| `packages/database/scripts/generate-migrations.mjs` | 注册 `[65, '0065_legacy_orphan_fk_not_valid']` |
| `packages/database/src/planner.ts` | 新增 0065 的后继步骤 |
| `packages/database/src/verifier.ts` | 新增 length 65 的 suffix、inventory、ACL 钉值 |
| `scripts/customer-agent-contract-set.mjs` | 可接受账本长度 39–64 → 39–65、40–64 → 40–65 |
| `packages/database/tests/*.integration.test.ts`、`planner.test.ts` | 64 → 65 |

迁移的三条设计约束：

1. **显式清单，不运行时发现。** 如果它会自动把当时凡是坏掉的约束都改掉，那么「哪些约束被削弱」就取决于迁移的运行时机。
2. **幂等。** 已经是 `NOT VALID` 的跳过，不会把后来修好的约束再退回去。
3. **自检。** 末尾重扫所有仍为 `convalidated` 的外键，只要还剩孤儿就 `RAISE`。清单漏一条会在部署时失败，而不是发出一份还原不了的备份。

实测钉值（length 65）：

| 项 | 值 |
| --- | --- |
| 迁移数 | 65 |
| 表 / 视图 / 函数 | 109 / 7 / 284 |
| object manifest | 3399 条，`054b28a7858de4b7957202a9704235aad53a0dcbf606e9c5b39998a67e069eed` |
| function manifest | 284 条，`026b4488…`（未变） |
| ACL manifest | 641 条，`fa54a9fb…`（未变：约束不产生 ACL） |

只有 object manifest 变了，因为这 15 条约束的定义文本多了 `NOT VALID`。

本地验证：65 条迁移在一次性 PG15 集群上应用成功，`verifyMigrationCatalogue` 返回 `PASS / migrationCount 65`；`check:generated`、`pnpm lint`、`pnpm typecheck`、`pnpm build`、数据库包单测全部通过。

**未完成**：`pnpm --filter @customer-agent/database test:integration` 在本机跑不完 —— 宿主的 SysV 共享内存段被反复中断的 `initdb` 耗尽（`could not create shared memory segment: No space left on device`），而 `ipcs` / `ipcrm` 在当前沙箱里被拒绝，无法清理。需要在普通终端里 `ipcrm` 或重启后重跑。这是环境问题，不是迁移问题：同一批迁移已经完整应用并验证过一次。

## 复现

```bash
# 扫全部已校验外键的孤儿（只读）
sudo -u customer-agent env PATH=/opt/pg15/usr/lib/postgresql/15/bin:/usr/bin:/bin \
  psql -h /srv/customer-agent/stack/data/pg15-socket -p 43199 \
       -d customer_agent_formal -U stack_owner -f /tmp/scan-fk-orphans.sql

# 恢复演练（当前会失败在上表任一条）
sudo -u customer-agent env PATH=/opt/pg15/usr/lib/postgresql/15/bin:/usr/bin:/bin \
  CUSTOMER_AGENT_PG15_BIN=/opt/pg15/usr/lib/postgresql/15/bin \
  CUSTOMER_AGENT_BACKUP_ROOT=/srv/customer-agent/catalog-backups \
  CUSTOMER_AGENT_STACK_ROOT=/srv/customer-agent/stack \
  CUSTOMER_AGENT_READY_URL=http://127.0.0.1:43115/ready \
  bash /srv/customer-agent/scripts/customer-agent-restore-drill.sh
```

扫描脚本正文见提交说明；它只执行 `SELECT`。

## 需要决定的事

1. 采用 A / B / C 哪一条。
2. 若采用 A：授权新增一条迁移（会改迁移账本长度与 verifier 钉值），并确认这套钉值更新由谁执行、在哪个 PR。
3. 是否顺带在 F1 里评估「`grant_history.grant_id` 是否应引用可删除的父行」。
