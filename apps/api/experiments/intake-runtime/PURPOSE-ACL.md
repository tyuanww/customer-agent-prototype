# 用途受限权限候选

离线合成候选。测试安装到一次性 PostgreSQL 15，不是迁移，不开放应用 ACL，不注册 HTTP。实验通过不等于合同冻结、export、intake 或生产装配。

## 边界选择

方案一是每条 SQL 一个包装函数。权限可以很窄，但每个读语句都要新签名，调用方要改每一处 SQL。

方案二是只按用途 GRANT 表。会话锁的 `FOR SHARE` 至少需要一列 UPDATE。把 `sessions.revoked_at` 或 `subject_bindings.enabled` 交给登录角色后，调用方可以重新打开已停用会话。业务角色若再拥有 `grants`、`publications` 或 `principal_facts` 的 INSERT，就能绕过 TypeScript 门。

采用的方案是四个用途 LOGIN 角色，加上一个 NOLOGIN 函数属主。只把已经存在的粗粒度函数改成该属主的 `SECURITY DEFINER`。不为每条读 SQL 加包装。租约明文仍留在既有 `public.issue_snapshot_offline_lease` 内。调用语句使用既有 `public.digest(bytea, text)`，只把 hash 返回给客户端。

身份参数只来自 `authenticatedProductSession` 和已认证 `actor.user_id`。没有新的客户端身份或 hash 字段。

## 角色

全部 `NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT`。没有 `GRANT ALL`。四个 LOGIN 角色互不继承，也不是 `intake_runtime_fn_owner` 的成员。调用方不能 `SET ROLE` 到函数属主。

| 角色 | LOGIN | 用途 |
| --- | --- | --- |
| `intake_runtime_fn_owner` | 否 | 持有身份安全列 UPDATE，以及被改为 DEFINER 的函数 |
| `intake_usage` | 是 | 坐席资格、空目录分页探针、复制前 query |
| `intake_business` | 是 | 直发、回退、质量读取、授权截止 |
| `intake_worker` | 是 | 解析失败收尾：report 对象、容量认领、job 终态 |
| `intake_org_writer` | 是 | 只通过任务 A 的 `createOrganizationFactsWriter` 写组织事实 |

`intake_runtime_fn_owner` 拥有 `backend_identity.sessions` 的 SELECT 和 `UPDATE(revoked_at)`，以及 `subject_bindings` 的 SELECT 和 `UPDATE(enabled)`。`intake_usage` 与 `intake_business` 只有 `subject_bindings` 的 `SELECT(user_id, enabled)`。任何 LOGIN 角色都没有这两列的 UPDATE。

## 函数

`PUBLIC` 的 EXECUTE 已撤销。下表是一次性库里的安装结果，`proconfig` 由测试读出。

| 函数 | 属主 | DEFINER | search_path | EXECUTE | 错误 |
| --- | --- | --- | --- | --- | --- |
| `intake_runtime_probe.lock_product_session(text, text)` | `intake_runtime_fn_owner` | 是 | `pg_catalog` | usage、business | `ZA003` / `SESSION_UNAVAILABLE` |
| `content_intake.entitlement_context_guard()` | 同上 | 是 | `pg_catalog` | usage | 正文未改；不匹配为 `ZA003` / `ENTITLEMENT_SESSION_MISMATCH` |
| `content_intake.publish_candidate(text, jsonb, jsonb)` | 同上 | 是 | `pg_catalog, public, pg_temp` | business | 未确认或带 `approvalEvidenceVersion`：`ZA003` / `MODE_CONFLICT`；缺候选：`ZA003` / `MATERIAL_CHANGED` |
| `content_intake.preview_rollback(text, text, text)` | 同上 | 是 | 同上 | business | 正文未改，缺目标仍是 `ZA003` |
| `content_intake.execute_rollback(text, jsonb, jsonb)` | 同上 | 是 | 同上 | business | 未确认：`MODE_CONFLICT`；缺计划：`MATERIAL_CHANGED` |
| `intake_runtime_probe.purpose_gap(text)` | 同上 | 是 | `pg_catalog` | 四个 LOGIN | 稳定函数。检查 `session_user`，不检查函数属主。角色不符返回 `{role_mismatch}` |
| `intake_runtime_probe.worker_object_purpose()` | 安装用户 | 否 | `pg_catalog` | worker | 仅当 `current_user` 是 worker 且 purpose 不是 `report`：`ZA003` / `WORKER_OBJECT_PURPOSE` |
| `intake_runtime_probe.worker_terminal_only()` | 安装用户 | 否 | `pg_catalog` | worker | worker 只能把 `reading`/`parsing` 改成 `failed`/`cancelled`：`ZA003` / `WORKER_TERMINAL_ONLY` |

仍是 INVOKER、正文未改：

- `content_intake.quality_state(text, bigint)`：business、函数属主。缺计划返回 `not_frozen`。
- `content_intake.assert_family_catalog(text)`：usage。
- `content_intake.authorization_deadline(text, text, text, text, timestamptz)`：usage、business、函数属主。agent 的 publish 返回空；enabler 的 publish 返回截止。数据库角色不能代替 principal grant。
- `content_intake.entitlement_context_required()`、`entitlement_lease_guard()`、`selection_ids_valid(text[])`：usage。
- `content_intake.object_scope_guard()`、`parse_object_guard()`：worker。worker 另有 `sources`、`scopes` 的 SELECT，供 invoker 守卫读范围。
- `content_intake.principal_guard()`：organization。

沿用既有 DEFINER，不改属主：

- `public.issue_snapshot_offline_lease(text, text, integer)`，属主 `cs_ai_definer`。只追加 EXECUTE 给 usage。`app_runtime` 上原有 EXECUTE 不追加、不撤销。
- `public.owner_acceptance_release_content_ready(text)`、`public.owner_acceptance_release_ready(text)`、`public.owner_acceptance_instant(jsonb)`：usage 与函数属主。发布门视图会以调用方身份执行 `owner_acceptance_release_ready`。
- `public.digest(bytea, text)`：usage 与函数属主。`PUBLIC` 的 EXECUTE 维持 0008 的撤销。
- `public.jsonb_jcs(jsonb)`：仅函数属主。
- `backend_review.lock_content()`：四个 LOGIN 角色和函数属主。调用前事务必须是 read committed。

## 表权限

usage 可读资格路径需要的目录、来源、授权、发布、审批事实和 entitlement 表，并可 INSERT `entitlements`、`entitlement_scopes`、`entitlement_contexts`。不能 INSERT `grants`、`publications`、`principal_facts`、`approval_facts`，不能执行发布函数。

business 可读 principal、事实、角色规则、来源、范围、授权和质量表。发布和回退的写表只授给函数属主。business 不能 INSERT 质量计划、授权、组织事实或发布公告。

worker 可 SELECT/INSERT `objects`，按列 UPDATE `parse_jobs(state, finished_at, report_object_id)` 和 `object_reservations(state, updated_at)`。不能执行发布，不能 INSERT `grants`。

organization 与任务 A 的写入器同构：SELECT `principals` 与 `principal_facts`，INSERT `principal_facts`，按列 UPDATE `principals(current_facts_version, revocation_generation)`，执行 `lock_content`。

函数属主另有发布写表、公共发布表和 `content_release_seq` 的使用权，供 DEFINER 正文在越过第一句拒绝后继续。LOGIN 角色没有这些写权限。

PostgreSQL 15 对没有 GRANT OPTION 的非属主执行 `GRANT` 会成功返回，并且不改变 ACL。测试断言 worker 执行 `GRANT SELECT, DELETE` 之后，usage 对 `content_intake.objects` 仍然没有这两项权限。属主是集群的 `gate_owner`。

## 装配输入

`createIntakeRuntimeAssembly` 在查库前拒绝：

- 输入含 `approvalTransport`：`APPROVAL_TRANSPORT_REJECTED`。direct-v1 不接收审批 transport。
- `claimManifest` 不是 `null`，或出现未声明的键：`CLAIM_LIST_UNUSABLE`。清单值不进入 SQL。
- 没有 `parser.probe`：`PARSER_UNAVAILABLE`。
- 没有 `organization.refresh` 函数：`ORGANIZATION_DEPENDENCY_MISSING`。start 只检查函数存在，不用假快照调用它。

start 依次检查解析器、四个连接的 `purpose_gap`、来源 mode、函数属主和对象计数。来源必须至少一条，且全部是 `v2-preview`。函数属主必须不可登录，且不是 superuser、createdb、createrole、bypassrls。对象计数可以是 0。`legacyAdopted` 恒为 false，`reason` 为 `CLAIM_MANIFEST_ABSENT`。空目录不是承接。`adoptLegacy()` 恒为 `LEGACY_ADOPTION_REFUSED`。

缺用途权限返回 `PURPOSE_PRIVILEGE_MISSING` 和 gap 名。管理员连接冒充 usage 得到 `role_mismatch`。来源被改成 `legacy` 时必须同时增加 `mode_version`，否则现有 `source_scope_guard` 以 `VERSION_REGRESSION` 拒绝；这不是装配放行。取消会中止等待中的解析器。关闭后不能再 start。

历史 approval-v1 的失效条件没有改写。usage 对 `approval_facts` 只有 SELECT。空 `release_lineage` 上 `coalesce(bool_or(...), false)` 为 false。没有构造 `review_bindings` 最小失效行，因此没有演习一条真实 approval-v1 失效记录。
