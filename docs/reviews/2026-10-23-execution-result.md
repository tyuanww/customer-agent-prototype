# 2026-10-23 三件执行结果

## 一、生产引导（已执行）

在杭州生产库 `customer_agent_formal` 执行了 `bootstrap-sop-v2` 的 26 条语句，包在单一事务里。

执行前：`src-menokin-sop-v2` 不存在、`store_sets` 0 行、`bootstrap-sop-*` grant 0 条、live grant 0 条。
执行后：

| 项 | 值 |
| --- | --- |
| `src-menokin-sop-v2` | `mode=v2-preview`，mapping `faq-p1.1 / intake-p1.1 / sop-not-imported` |
| store set | version 1，成员 1（仅 SOP 来源） |
| `bootstrap-sop-*` grants | 24 条，全部 `revoked_at IS NULL` |
| `hz-publisher` 的动作 | import / content-manage / source-confirm / review / publish / candidate-cancel / query 各 1 |

执行前先在本地临时集群上演练过**同一份 SQL 文件**（含单事务包裹），并验证第二次执行幂等（store set 不新增版本、grant 不重复）。

撤销方式：`node scripts/bootstrap-sop-v2.mjs --dsn <dsn> --rollback --apply`。它撤销 grants 并用新版本 store set 把来源移出可读集合；注册行本身不能删（`INTAKE_HISTORY_IMMUTABLE`）。

### 但这条链路在生产上仍然不通，两个独立原因

**1. facts 过期。** 实测：

```
authorization_deadline('hz-publisher','import','scope-menokin-product','src-menokin-sop-v2', now) → NULL
authorization_deadline('hz-publisher','publish', ... )                                      → NULL
hz-publisher 的 facts: facts_version 13, enabled t, valid_until 2026-10-15 21:29:33+08
```

事实窗口只有 5 分钟。刷新发生在飞书登录时（`apps/api/src/content-intake/bind-known-principal.ts:66-68` 写 `checked_at + 5 minutes`）。所以授权目前是死的：任何 import 都会在 `authorize` 处得到 `SCOPE_DENIED`（对外是 404）。

**2. 部署的代码是旧版本，这是更硬的阻塞。** 实测：

```
部署软链 → /srv/customer-agent/releases/e5d56674eef785c9124704281811da41782b7794
该 commit → e5d5667 fix: admit the public identity host on the password process (#96)
health    → 0.3.31
该 release 内的迁移文件数 → 49
库内 customer_agent_meta.schema_migrations → 49 行，最后一条 0049_roster_lifecycle
```

也就是说生产是一个**自带 49 条迁移、内部自洽的旧 release**，比 main（61 条）落后 12 条迁移。

对该 release 的 `apps/api/dist` 做 grep：

| 检索 | 结果 |
| --- | --- |
| `freeze_sop_parsed_candidate` | 无 |
| 条目编码校验（`MISSING_ENTRY_CODE_HEADER`） | 无 |
| `stage_sop_candidate_media`（旧路径） | 有，在 `content-intake/service.js` |
| `authorization_sources` 调用 | 无 |

结论：生产上跑的是改动之前的那份 SOP 路径，即通用 `freezeParsed` 加 `stage_sop_candidate_media`。这条路径在发布处必定 `MATERIAL_CHANGED`。它也没有条目编码解析器。

所以「上传 → 候选 → 发布 → 坐席可见」在生产上**仍然不通**，缺的不是数据而是部署。要通必须发布并部署新代码，那是 commit + release + deploy 三步，需要单独授权。

**当前状态是安全的**：facts 过期让所有授权失效，任何人现在都无法借这批 grant 触发那条有 bug 的旧路径。

**store set 只有一个成员是刻意的**：另外四个来源仍是 `legacy`，v2 读路径会按 `mode` 过滤掉它们；把它们并入会让以后的 mode 切换变成不经新审批就可读。这一点已写入脚本注释。

## 二、质检放宽（已改，只动 intake）

新增 `apps/api/src/content-intake/quality.ts` 里的 `intakeQualityTargets`，与 legacy 批量的 `content-normalize.qualityTargets` 分离。

新策略：

| 条目数 | initial | expanded |
| --- | --- | --- |
| ≤ 100 | 全部 | 全部 |
| 266 | 100 | 100 |
| 501 | 100 | 151 |
| 5000 | 300 | 1500 |

501 以上与旧公式完全一致（有测试固定这一点）。

为什么不直接改 `qualityTargets`：它是 legacy CSV 链的共享策略，而 `0004_import_release_announce.sql:54-61` 的 `quality_plan_initial_target` CHECK 硬编码了「≤500 全查」。改它需要新迁移，还会同时削弱 CSV 导入门禁。intake 走自己的 `content_intake.quality_plans`（`0023:8-21`），没有计数约束，所以只改 intake 就够了。

`apps/api/tests/content-intake-material.test.ts:84` 原本断言 intake 在 500 条时全查，这是旧共享策略的断言，已按新策略更新，并新增 `intake-quality-targets.test.ts` 固定「legacy 仍是 500 全查」。

## 三、上游提报（已出草案）

`docs/plans/2026-10-23-upstream-intake-sop-media.md`。

请求两项，第一项必需：

1. `IntakeSnapshot.media.items` 增加 `businessEntryId` / `mime` / `bytes`，`maxItems` 由 `0` 放开到 `200`。用 `businessEntryId` 而不是 `rowId`，因为后者是工作簿物理位置，会随插入行变化。
2. `sopNodes` / `sopEdges` **不建议**在本轮改，避免把两个独立需求压成一次合同变更。

文里同时列出合同到达后产品仓需要同步的六处改动，其中桌面侧新增通道必须四件套原子改。

## 四、验证

| 检查 | 结果 |
| --- | --- |
| `pnpm lint` | 通过 |
| `pnpm build:services` | 通过 |
| desktop typecheck | 通过 |
| `pnpm test:db:integration` | 77/77 |
| `apps/api` 相关单测 | 24/24（material + targets） |

## 五、仍缺的一步

要在生产上真正跑通，顺序是：

1. 提交并发布当前工作树（61 条迁移）
2. 部署到杭州并 `systemctl restart`（迁移 0050–0061 会在启动时应用）
3. 操作者用飞书登录一次以刷新 facts
4. 用 `scripts/write-sop-template.mjs` 生成的模板上传

第 1、2 步需要明确授权，我没有执行。
