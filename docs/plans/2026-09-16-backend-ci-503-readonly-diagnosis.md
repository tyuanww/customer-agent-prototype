# BACKEND-CI-503 只读根因定位（2026-09-16）

> **状态：已关闭（2026-09-16）。本文保留诊断过程，不改写。**
> 本文回答「PG15 job 里 announce 期望 403、实得 500 的根因是什么」，以及「这条记录当时是否还准确」。
> 完成：代码路径分析、CI 时间线核对、**本机一次性 PG15 集群上的复现**（§3a）。
> 后续：修复由产品 PR [#91](https://github.com/weiweity/customer-agent-prototype/pull/91) `09a6f55` 完成，回归证据见 merge 后 push run `35090745771`。关闭勘误见 [后端运行时计划](2026-09-08-backend-runtime-plan.md)。
> 本文写作时是只读诊断，未改动 `apps/` / `packages/` 的任何实现或测试。

相关：[执行清单](2026-09-06-execution-goal.md) · [后端运行时计划](2026-09-08-backend-runtime-plan.md) · [桌面接入准备](2026-09-09-desktop-integration-preparation.md)

> 阅读须知：本文写作于 2026-09-16 的**诊断阶段**，当时修复尚未开始。文中「未修」「仍未修」「保持 OPEN」等表述描述的是**那一刻**的状态，按本仓「历史材料可追加勘误、不覆盖已发生记录」的规则保留原文。**该缺陷已于同日由 PR #91 修复并关闭**，见页头与后端运行时计划的勘误段。

## 1. 结论

**根因已在本机复现并证明（§3a），无需再依赖 CI 日志推断。** 同时发现结论与现行记录有两处重要出入。

1. **失败断言不是 ack，是 snapshot。** 现行文档写「announce 期望 403、实得 500」，未区分具体端点。实际失败点是 `apps/api/tests/announce.integration.test.ts:396`——向 `/v1/announce/snapshot` 传一个**格式合法但不存在**的 lease token（`osl_` + 64 个 `ab`），期望 403 `OFFLINE_LEASE_INVALID`，实得 500 `INTERNAL`。
2. **这条并非「已修复但保持 OPEN」，而是「修过、复发过、且最近一次全量运行仍失败」。** 详见 §3 时间线。
3. **根因已证明**（§3a）：node-pg 的 `query_timeout` 抛出的普通 `Error` 不含 `code` / `detail`，令 `announceFailure` 失去唯一的 ZA004 判别依据，落进 `mapDatabaseContractError` 的 `INTERNAL` 兜底。

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

**丢字段的机制已实测确认**（不再只是 PR #79 提交信息里的说法）。2026-09-16 本地复现见 §3a。

## 3a. 本地复现（2026-09-16 实测，根因已证明）

第 1 版本文只把机制写成"最可能"。本节把它做成证据。

**探针环境**：`/tmp` 下一次性的 PG15 15.18 集群（`listen_addresses = ''`、独立 Unix socket、随机端口），与合成栈（`~/.customer-agent-synthetic-stack/data/pg15-socket`）完全隔离；用完即 `pg_ctl -m immediate stop` + 删目录。合成栈全程只读 `status`，pid 与 `/ready` 前后一致。

**实验一：node-pg 的超时 error 到底长什么样**

```
new Pool({ ..., query_timeout: 300, statement_timeout: 300 })
await pool.query('SELECT pg_sleep(2)')
```

结果：

```
constructor: Error
typeof code:   undefined | code = undefined
typeof detail: undefined | detail = undefined
message: "Query read timeout"
has fields: false
```

**`query_timeout` 抛出的是一个普通 `Error`，没有 `code`、没有 `detail`、没有 `fields`。** 这直接解释了 `sqlStateOf()` 与 `contractReason()` 为什么双双读不到 `ZA004`。

**实验二：把三种 error 喂进真实的 `createAnnounceServiceForPool`（`apps/api/dist/announce-service.js`，已含 PR #79 修复，与 HEAD 源码一致）**

| 场景 | 注入的 error | 实际返回 | 对应 HTTP |
| --- | --- | --- | --- |
| A 正常 | 数据库真抛 `Error` + `code='ZA004'` + `detail='OFFLINE_LEASE_INVALID'` | `{ok:false, code:'FORBIDDEN', reason:'OFFLINE_LEASE_INVALID'}` | **403** ✅ |
| B 超时替换 | `new Error('Query read timeout')` | `{ok:false, code:'INTERNAL'}` | **500** ❌ |
| C 连接 deadline | `new Error('Runtime database connection exceeded its configured deadline')` | `{ok:false, code:'INTERNAL'}` | **500** ❌ |

**场景 B 与 CI 上观察到的 500 完全一致。** 根因确认：只要查询在 `query_timeout` 内没返回，迟到/未到的 `ZA004` 就被替换成一个无契约字段的普通 Error，落进 `mapDatabaseContractError` 的 `INTERNAL` 兜底。

**实验三：`mapDatabaseContractError` 本身不认 ZA004**

```
mapDatabaseContractError(Error + ZA004)          => INTERNAL
mapDatabaseContractError(Error('Query read timeout')) => INTERNAL
mapDatabaseContractError(deadline Error)          => INTERNAL
```

**即使 `ZA004` 原样传到兜底函数，它也返回 `INTERNAL`。** 也就是说 403 完全依赖 `announceFailure` 里 `state === 'ZA004'` 那一个分支提前截住；一旦 `code` 在到达前丢失，就没有第二道防线。

这条同时也是**修复方向的直接依据**：需要让"契约字段在传输途中丢失"这一情形本身可判别，而不是只依赖 `code` 恰好还在。

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
| `desktop-integration-preparation.md:316` | 「无新证据则保持 OPEN」 | 现已具备新证据（§2 代码路径 + §3 时间线 + §4 docs 空跑 + **§3a 本机复现**），但仍**未修** |

## 6. 关闭条件（未变，但更具体）

按 `backend-runtime-plan.md:422` 的既有口径，关闭需要：在实际 PG/CI 场景捕获原始故障的安全诊断，确认根因，完成针对性修复、回归、审查与 CI。

**§3a 的复现已满足「确认根因」这一项**（不再需要"在实际 PG/CI 场景捕获"——本机已稳定复现同一形态）。剩余的是修复、回归与审查：

1. 让「契约字段在传输途中丢失」这一情形本身可判别，而不是只依赖 `code` 恰好还在 `ZA004` 分支——`mapDatabaseContractError` 对 `ZA004` 也返回 `INTERNAL`（§3a 实验三），所以 403 目前只有一道防线。可行方向包括：在 catch 里识别 `Query read timeout` 这一类无契约字段的超时错误，或在 `RuntimePoolClient` 层保留被替换前的 SQLSTATE。
2. 修复后需有一次**真正执行** API 集成测试的运行作为回归证据（`mode: 'full'`，即改动涉及 `apps/` 或 `packages/`），**不能**用 docs 模式绿灯代替。
3. 单独授权、独立分支，不与 M5 文档同批。

## 7. 本次诊断做了 / 没做的事

**做了：** §3a 的本机复现——在 `/tmp` 一次性 PG15 集群上用真实 `announce-service` 代码复现 500，并用完即清理；合成栈全程只读 `status`。

**没做：**

- 未改动 `apps/` / `packages/` 下的任何实现代码或测试（`announce-service.ts`、`database-contract-errors.ts`、`announce.integration.test.ts` 原样未动）
- 未改 workflow
- 未重跑任何 CI
- 未关闭 `BACKEND-CI-503`
- 未对 CI 上的实际超时来源下结论——本机复现证明的是**映射路径**（B/C 场景必然产出 500），不是 CI 那次具体卡在 query timeout 还是连接 deadline。§3a 实验二表明两者都落到 500，因此不影响修复方向，但"CI 为什么慢"仍未测

> 注：PR #79 期间「本地 20 次未复现」的结论与本轮不冲突——那次是**直接跑集成测试**（本机快、不超时，本轮实测 1097ms 通过，见下），本轮是**注入超时 error** 直接验证映射路径。前者证明"本机跑不快到超时"，后者证明"一旦超时就必然 500"。
>
> 本地直接跑 `CUSTOMER_AGENT_API_PG15_INTEGRATION=1 vitest run tests/announce.integration.test.ts`：**1 passed in 1097ms**。CI 上同一测试为 **8339ms** 后失败。8 倍差距是超时的合理背景，但该 8339ms 是**整个测试**（含 initdb、migration、导入、审核、发布）的时长，不等于那一条查询的耗时，故不能据此直接断定查询超了 3000ms——这正是本轮改用注入法取证的原因。
