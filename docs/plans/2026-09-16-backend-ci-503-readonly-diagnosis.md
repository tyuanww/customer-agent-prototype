# BACKEND-CI-503 只读根因定位（2026-09-16）

> **状态：只读诊断。不修、不关、不合并。**
> 本文只回答「PG15 job 里 announce 期望 403、实得 500 的根因是什么」，以及「这条记录现在是否还准确」。
> 它不授权改动任何代码、不放行关闭 `BACKEND-CI-503`，也不与 M5 文档合并处理。

相关：[执行清单](2026-09-06-execution-goal.md) · [后端运行时计划](2026-09-08-backend-runtime-plan.md) · [桌面接入准备](2026-09-09-desktop-integration-preparation.md)

## 1. 结论

**根因已定位到具体断言与具体代码路径，但结论与现行记录有两处重要出入。**

1. **失败断言不是 ack，是 snapshot。** 现行文档写「announce 期望 403、实得 500」，未区分具体端点。实际失败点是 `apps/api/tests/announce.integration.test.ts:396`——向 `/v1/announce/snapshot` 传一个**格式合法但不存在**的 lease token（`osl_` + 64 个 `ab`），期望 403 `OFFLINE_LEASE_INVALID`，实得 500 `INTERNAL`。
2. **这条并非「已修复但保持 OPEN」，而是「修过、复发过、且最近一次全量运行仍失败」。** 详见 §3 时间线。

## 2. 失败路径（代码级）

沿调用链读下来，500 的产生点在错误映射的**兜底分支**：

```
POST /v1/announce/snapshot
  → announce-service.ts  announce_snapshot 分支
  → SELECT * FROM public.read_snapshot_page($1..$6)
       → 内层 validate_snapshot_offline_lease()
           token 查不到 → RAISE ZA004 / DETAIL=OFFLINE_LEASE_INVALID   ← 期望路径
  → catch → announceFailure(error, 'announce_snapshot')
        契约期望：state === 'ZA004' → failure('FORBIDDEN','OFFLINE_LEASE_INVALID') → 403
  → 实得：announceFailure 走到底 → failure(mapDatabaseContractError(unwrapped))
        database-contract-errors.ts 对未知 code 返回 'INTERNAL' → 500
```

`validate_snapshot_offline_lease` 在 `packages/database/migrations/0007_search_bigram.sql:272` 明确 `RAISE EXCEPTION USING ERRCODE = 'ZA004', DETAIL = 'OFFLINE_LEASE_INVALID'`。SQL 侧是对的。

所以 500 意味着**到达 JS catch 的 error 对象上，`code` 与 `detail` 两样都丢了**——`sqlStateOf()` 与 `contractReason()` 都读不到 `ZA004`。映射层本身（`announceFailure`，其中 `if (state === 'ZA004')` 映射块在 `announce-service.ts:329-331`）写得没问题。

**丢字段的最可能机制**（PR #79 的提交信息已独立确认过一次）：node-pg 在**查询超时**时会把迟到的 `ZA004` 替换成 Query read timeout，并可能销毁 socket。此时抛出的不再是数据库错误，而是一个没有 `code`/`detail` 的连接层错误，于是落进 `mapDatabaseContractError` 的 `INTERNAL` 兜底。

## 3. 时间线（实测，纠正现行记录）

| 日期 | run | 事件 | PG15 job | API integration step | 失败详情 |
| --- | --- | --- | --- | --- | --- |
| 09-10 | `34441852225` | push | failure | failure | 503 `ANNOUNCE_AUDIT_BEGIN_FAILED`（另一种失败形态） |
| 09-11 | `34591253869` | push | success | success | PR #79 `9e6e044` 修复合入 |
| 09-11 | `34593344662` | push | success | success | 全绿 |
| 09-15 | `34943603129` | push | **failure** | **failure** | **500 INTERNAL，`announce.integration.test.ts:396`** |
| 09-15 | `34944525392` | push | success | success | 全绿（同日后继提交） |
| 09-15 | `34964181437` | push | success | success | 全绿（#83） |
| 09-16 | `35061766335` | push | **failure** | **failure** | **500 INTERNAL，同一断言复发** |

**两点必须写清楚：**

- **PR #79（`9e6e044`，2026-09-11）就是针对这个断言的修复**，提交信息原文：「Invalid-lease snapshot still failed CI with INTERNAL 500: node-pg replaces a late ZA004 with Query read timeout and may destroy the socket. Keep a SQLSTATE/DETAIL layer when unwrapping driver causes, retry the snapshot read once on INTERNAL/OVERLOADED, then audit 403.」——**修复已合入 main 且是 HEAD 的祖先**。
- **但它没有根治。** 09-15 与 09-16 各复发一次，两次失败点完全相同。

## 4. 为什么「五项全绿」不能作为关闭依据（实测加强版）

这是本次诊断最需要提请注意的一点。

`verification-policy.mjs` 的 `verificationPlan()` 把纯文档变更判为 `mode: 'docs'`。此时 PG15 job 的 9 个步骤里，**只有那句 echo 会运行，其余 8 步全部 skipped**：

```
35069047133 (push, #88)  PG15 job: job=success  integration=skipped  docsShortcut=success
35068841592 (PR,  #88)   PG15 job: job=success  integration=skipped  docsShortcut=success
34981711286 (push, #86)  PG15 job: job=success  integration=skipped  docsShortcut=success
```

**`#88` 的五项 SUCCESS、`#86` 的五项 SUCCESS，都没有真正执行 announce 集成测试。** 它们是 docs 模式下的空跑，绿灯只证明「文档范围的判定生效」。

最近一次**真正跑到**该断言的运行是 `35061766335`（09-16 05:59，`#87` 的 push）——**结果是失败**。

**当前可用的准确表述是：** announce 无效租约断言在最近一次含 API 集成测试的运行中**仍然失败**，根因与 PR #79 修复时相同（超时导致 SQLSTATE/DETAIL 丢失）。后续多次「五项 SUCCESS」均为 docs 模式，不构成回归证据，也不构成关闭依据。

## 5. 与现行文档的差异

| 位置 | 现行表述 | 实测 |
| --- | --- | --- |
| `execution-goal.md:38` | 「#80 合入后 push 的 PG15 仍见 announce 500 vs 403」 | 准确，但未说明这也是 **#79 已修过的同一个断言**，且 #87 又复发一次 |
| `execution-goal.md:38` | 「#81–#84 五项 SUCCESS **不得**关闭本项」 | 结论正确；原因应补：这些是 docs 模式空跑 |
| `backend-runtime-plan.md:418` | 「PR #58 run `34336646663` …预期403，实际503/OVERLOADED；同头重跑与合并头通过，本地20次未复现」 | 这是**更早、不同形态**的失败（503 而非 500）；与本轮 500 不是同一个 bug，不应混为一谈 |
| `desktop-integration-preparation.md:316` | 「无新证据则保持 OPEN」 | 现已具备新证据（§2 代码路径 + §3 时间线 + §4 docs 空跑），但仍**未修** |

## 6. 关闭条件（未变，但更具体）

按 `backend-runtime-plan.md:422` 的既有口径，关闭需要：在实际 PG/CI 场景捕获原始故障的安全诊断，确认根因，完成针对性修复、回归、审查与 CI。

结合本次诊断，可执行化后是：

1. 在 `announce_snapshot` 的 catch 里，对**连接层错误**（无 `code`/`detail`）保留判别信息——现有 `runtime-diagnostics.ts` 已有 `databaseCode` 通道，可确认超时路径是否走到了它；
2. 修复后需有一次**真正执行** API 集成测试的运行作为回归证据（`mode: 'full'`，即改动涉及 `apps/` 或 `packages/`），**不能**用 docs 模式绿灯代替；
3. 单独授权、独立分支，不与 M5 文档同批。

## 7. 本次诊断未做的事

- 未改动任何代码、测试、workflow 或文档
- 未重跑任何 CI
- 未关闭 `BACKEND-CI-503`
- 未尝试本地复现（本机合成栈是 PG15 + loopback，与 CI runner 拓扑不同，本地 20 次未复现是 PR #79 期间的既有结论）
