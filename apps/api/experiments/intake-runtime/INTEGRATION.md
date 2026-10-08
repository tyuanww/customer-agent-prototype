# 正式接线建议

本文件只描述差异。不要把实验 SQL 复制进 `packages/database/migrations`，不要改 `authority.ts`、0030、共用 `content-intake.integration.test.ts`、seed、host、`contract-set.lock` 或正式 snapshot。新的角色、DEFINER 切换和用途 ACL 需要先在治理仓版本化冻结、export、intake，之后才能进入正式迁移和生产消费。当前授权不覆盖这批未知字节的自动冻结。

## 已证明

一次性非超级用户角色上：

- `createPurposePrivilegeProbe` 在 usage 角色上完成窄锁、资格写入探针、空目录 keyset 读和 `authorize('query')` 授权探针。这些不是实际 snapshot 或复制消费者。返回值没有 `osl_` 租约明文。上下文里的 session hash 等于认证私有对象。
- 现有 `createContentIntakeService(usagePool)` 仍在 `lockProductSession` 的 `FOR SHARE` 处得到 `42501`，对外是 `INTERNAL_ERROR` / `COMMIT_UNKNOWN` / `rolled_back`。
- business 对未确认或带 `approvalEvidenceVersion` 的直发、回退得到 `MODE_CONFLICT`。观察值 `APPROVED` 也不能通过。缺候选或缺计划得到 `MATERIAL_CHANGED`，不是 `42501`。`quality_state('missing', 1)` 为 `not_frozen`。
- worker 能写入 report、认领 reservation，并把 job 收到 `failed`。非 report 插入和改成 `validated` 被实验触发器拒绝。
- organization 通过 `createOrganizationFactsWriter` 应用一次事实，版本从 1 到 2。usage、business、worker 插入 `principal_facts` 为 `42501`。
- 四个 LOGIN 角色不能 `SET ROLE intake_runtime_fn_owner`，也不能 `CREATE TABLE`。停用后 usage 不能把 `enabled` 或 `revoked_at` 改回去，窄锁返回 `SESSION_UNAVAILABLE`。
- 截止时刻已过时事务回滚，结果是 `PERMISSION_CHANGED`。COMMIT 抛错时不发送 ROLLBACK，结果是 `commit=unknown`。
- 空目录和非空目录的依赖检查都输出 `state: checked-not-activated`、`ready: false`、`legacyAdopted: false`。没有认领材料，不启用服务，也不发明 claim manifest。
- 回收修复补齐属主文本摘要、随机票据、family 检查 EXECUTE；实际调用和逐项撤权反例通过。这只补已发现依赖，不代表完整发布成功。

## 还不是完整装配

- `usage.ts` 的 snapshot 分页闭包没有导出，也没有接到 usage 角色。实验里的分页只是 `release_lineage` 的空 keyset，0 行，加上空 approval-v1 集合的 `bool_or` 为 false。
- 种子没有可发布候选。没有完整发布成功，也没有发布行。
- `quality.ts` 的计划写入和 `createGrants` 没有在窄角色上跑通；对应 INSERT 是 `42501`。
- approval-v1 最小失效行依赖 `review_bindings` 的包对象、候选和摘要。没有造这些行，所以没有证明历史失效路径被绕过，只证明 usage 不能 INSERT `approval_facts`。
- 单一 service pool 仍然存在。实验 helper 不写 receipt，不接管共享发布状态机。

## 会话锁的单一修改点（不是完整接入方案）

所有者：`apps/api/src/content-intake/transaction.ts` 的 `lockProductSession`。`usage.ts`、`discovery.ts`、`quality-access.ts` 都调用它，不需要各自改 SQL。

把现在的：

```sql
SELECT s.expires_at
FROM backend_identity.sessions s
JOIN backend_identity.subject_bindings b USING (binding_id)
WHERE s.token_hash = $1 AND b.user_id = $2 AND b.enabled AND s.revoked_at IS NULL
  AND s.expires_at > clock_timestamp()
FOR SHARE OF s, b
```

换成：

```sql
SELECT intake_runtime_probe.lock_product_session($1, $2) AS expires_at
```

参数仍是 `authenticatedProductSession(actor)` 和 `actor.user_id`。没有行或 SQLSTATE `ZA003` 都映射为 `IntakeRejection('SCOPE_DENIED', 'UNAUTHORIZED')`。其他数据库错误继续走现有未知提交路径。不要给 usage 或 business `UPDATE(revoked_at)`、`UPDATE(enabled)`。

函数正文保持 `session-lock.sql`。正式迁移只能在治理冻结之后安装同签名函数，并把属主设为 NOLOGIN 非超级用户。

## 建议的安全属性切换

所有者是对应迁移里的函数，不是本实验文件。正文保持不变，只在治理通过后改变属主和安全属性。

- `content_intake.entitlement_context_guard()`：属主改为 NOLOGIN 函数属主，`SECURITY DEFINER`，`search_path=pg_catalog`。只把 EXECUTE 给 usage。它内部的 `FOR SHARE` 因而不再要求登录角色持有安全列 UPDATE。
- `publish_candidate(text, jsonb, jsonb)`、`preview_rollback(text, text, text)`、`execute_rollback(text, jsonb, jsonb)`：同样改为该属主的 DEFINER，保留 `search_path=pg_catalog, public, pg_temp`。EXECUTE 只给 business。早失败仍是 `MODE_CONFLICT`，缺材料仍是 `MATERIAL_CHANGED`。
- `quality_state`、`assert_family_catalog`、`authorization_deadline` 保持 INVOKER。

## 建议的工厂形状

所有者：`createContentIntakeService` 所在的 `service.ts`。现在只有一个 pool。建议增加：

```ts
pools: {
  organization: IntakePool;
  business: IntakePool;
  worker: IntakePool;
  usage: IntakePool;
}
```

资格和分页走 usage，直发、回退和质量读取走 business，解析终态走 worker，组织事实走 organization。不要注册新的生产 HTTP，不要给 `app_runtime` 追加或撤销权限。

`purpose-boundary.ts` 的导出都标为 `probe`。保留资格 SQL 副本的唯一原因，是现有 service 在会话锁第一步即 42501，无法用它验证租约、上下文触发器和用途 ACL 的组合；组织事实、主体与授权判断仍复用既有模块。它不提供实际快照页或复制数据。完成治理冻结/export/intake、会话锁切换和四池接线后，必须由实际 service 的资格签发、非空分页、复制前校验与失效场景替换，随后删除副本。单改 `lockProductSession` 不代表这项接入已经完成，不再扩展第二套 service。

worker 终态 SQL 与 `service.ts` 的 `finishFailure` 相同。实验触发器只约束 `current_user = 'intake_worker'`：只能插入 `report`，只能把阅读中的 job 收到 `failed` 或 `cancelled`。正式采用前，这个触发器也要进入治理，而不是直接占用下一个迁移号。

组织写入继续调用任务 A 的 `createOrganizationFactsWriter`。本实验不编辑 `experiments/intake-organization`。

## 回收后的生命周期边界

`start()` 只检查依赖；并发调用被拒绝，检查取消后可重新检查，close 后永久拒绝。本模块只取消自己的检查与解析器信号；未完成 SQL 返回后结果会被丢弃。借用连接、连接池和解析器资源由调用方关闭，不以本模块 close 代替资源回收。
