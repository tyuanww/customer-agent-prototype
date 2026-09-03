# DEV-M1 · Search + Events 执行记录

> **状态：** APPROVED · IN PROGRESS
> **开工授权：** 用户于 2026-09-03 明确“继续开工，授权”；仅放行本文件定义的 DEV-M1 合成/测试范围
> **当前切片基线：** `main@362e53c8eaf4995774eeb0c46660c54c316ecd04`
> **当前分支：** `codex/dev-m1-events`
> **上游合同：** `cs-ai-c11-openapi-1.11.0-schema-1.14-1af001b8b0ce`（`1af001b8b0ce95aac0c42f42251a38feb85f3e26`，`VERIFIED_NOT_ACTIVATED`）

## 1. 本里程碑交付

DEV-M1 只实现 Application API / domain 的 Search + Events：

1. mock/test auth、最小 policy 与输入 redaction；
2. Unicode bigram 搜索、Top 3、parent/reselection 与候选四元组；
3. adoption 唯一 terminal 与 escalate auxiliary；
4. current release 四域来源强校验、来源暂停与独立拒绝审计；
5. DEC-042 平台/商品上下文、taxonomy、risk/review、quarantine 与 governance hash 过滤；
6. 可运行但不宣称准确率达标的 G1a runner。

本里程碑不切换 Electron Query，不接真实飞书、真实客服数据、外部模型、付费调用、遥测、自动发送、部署或 Pilot。

## 2. DEC-SEARCH-01 进入条件

- 金标文件：`tests/fixtures/search/zh-gold.jsonl`。
- 格式真源：`tests/fixtures/search/zh-gold.schema.json`，与冻结实现设计 §8.4 一致。
- 标注 Owner：`USR-CONTENT-001`（Content Owner / Content Lead）。
- 验收 Owner：`USR-CS-OWNER-001`（Product Owner）。
- 当前仅确认格式与 Owner；hit@3、no-hit 阈值和 20 正例 + 至少 12 安全负例 + 至少 18 鲁棒性用例必须在 DEV-M1 退出前签发。
- 阈值签发前 runner 只能报告可执行与原始分母，不得声称业务准确率达标。

## 3. 切片顺序

| 切片 | 范围 | 退出证据 |
| --- | --- | --- |
| W0 | 开工记录、金标格式/Owner、合成样例与格式门禁 | JSONL 逐行校验；无真实文本/PII |
| W1 | mock auth、鉴权上下文、policy hard-off、redaction/输入上限 | closed-schema、401/403、token 不泄漏、499/500/501 code point、32 KiB 负例 |
| W2 | search repository/domain、四域 source gate、DEC-042 过滤 | Top 3、UTC 半开有效期、scope/hash/source-denial 负例 |
| W3 | query 幂等、parent/reselection、候选四元组 | replay/异体冲突、父终态、provenance 负例 |
| W4 | adoption terminal、escalate auxiliary、stateless | first-wins、复制语义、辅助动作幂等与零副作用 |
| W5 | G1a runner、全量回归、候选产物与退出回填 | INV-* 全绿；阈值未签则只称 runner 可跑 |

每个 PR 只拥有一个 port、adapter 或一个跨端口不变量；不得把桌面切换、M2 发布能力或无关 UI 重构混入本里程碑。

### 当前进度

- [x] W0：金标路径、JSON Schema、Owner 与 4 条合成种子用例已建立；合同包测试逐行校验 closed shape、上下文成对、唯一 ID 与非真实品牌边界。
- [x] W1a：mock auth 已实现 `POST /v1/auth/mock-login` 与 `GET /v1/auth/me`；支持进程内 opaque Bearer 或成对 `X-Mock-User/X-Mock-Role`，两者冲突/单边 header 均拒绝；token 关闭即清空，身份字段经运行时合同校验。
- [x] W1b：search 输入的 32 KiB 解码前门禁、1～500 Unicode code point 计数、NFKC 后手机号/身份证脱敏及带版本 HMAC 已实现；两类 HMAC key ring 与 runtime/admin 双池在监听前校验；policy 的 owner/hard-off 纯规则、受鉴权只读端点和独立 `app_content_admin` 写 adapter 已通过 unit/package/PG15。Search 编排归入 W2。
- [x] W2：已接收 `schema.v1.14` 并保持 v1.12/v1.13 migration 历史逐字节不变；单 SQL 搜索 repository、公开候选映射、稳定错误归一化与 `/v1/search` 路由边界已实现。PR #18 已合并为 `main@362e53c8eaf4995774eeb0c46660c54c316ecd04`。
- [x] W3：Search 与 `query_events`、精确 `candidate_impressions`、幂等完成已进入同一 `PoolClient` 事务；同体重放、异体冲突、24h key-version 轮换、父 terminal/reselection、来源拒绝回滚后独立审计均有 PG15 证据。当前 synthetic 查询固定 suppressed，不持久化原文。
- [x] W4：Adoption 唯一 terminal、复制语义、并发 first-wins、Escalation auxiliary/action 稳定事实、HTTP→PG15 主链与 `collection_disabled` 零事件降级均已实现并验证。
- [ ] W5：未开始；等待本切片 Review/合并后建立独立 runner 分支。

W3/W4 候选验证（2026-09-04）：`workspace:check`、lint、四包 typecheck/build 与仓级测试通过；普通 API 为 79 passed（PG15 套件按设计跳过），显式 API PG15 为 42/42，其中事件事务 9/9；未改桌面行为但仍完成现有 desktop 508/508 回归。未运行 Electron E2E、真实窗口/Windows 设备、真实数据库、飞书、部署或 Pilot；这些均不在本切片授权和实现面内。

## 4. 停止条件

- 合同快照、OpenAPI / DDL 哈希或生成类型漂移；
- 搜索可绕过四域 binding、永久暂停、平台/商品 scope、taxonomy、审核、风险、quarantine 或 governance hash；
- 任何真实客户文本、真实飞书链接、凭证、token 或业务号码进入 Git；
- copy 被解释为发送、采纳、正确或解决；
- renderer 直连 API/DB，或新增通用 IPC；
- 未获独立授权而进入 DEV-M2、真实接入、部署或 Pilot。

## 5. 工程评审决策（2026-09-03）

### 5.1 已确认的边界

1. 保留完整 DEV-M1，不删减安全负例和并发语义；实现拆成四个顺序、可独立 Review 的切片：
   - Slice 1：治理仓合同增量 + 产品仓 W1b；
   - Slice 2：W2 Search；
   - Slice 3：W3/W4 Events；
   - Slice 4：W5 runner 与退出证据。
2. 保持 `search_recommendable_scripts(platform, product_context_type, product_context_ref)` 的 scope-only 签名；治理仓只扩展其安全返回投影，增加 `content_public_questions(questions_json)`、`search_document` 与 `search_fallback_text`。不得返回原始 `questions_json`、审核身份、来源定位符或其他内部 lineage。
3. API 使用独立的小型 `app_content_admin` 连接池和 `PolicyAdminRepository`；其 DSN、角色校验、连接预算与生命周期均和 `app_runtime` 分离。运行时搜索/事件连接不得继承管理员角色。
4. 两类 HMAC 使用不同密钥域：
   - `IDEMPOTENCY_HMAC_KEYS` + 当前版本：用于 24 小时幂等重放，TTL 内保留历史版本；
   - `LOG_HASH_KEY` + 版本：只用于脱敏 query 指纹。
   缺失、格式错误、当前版本不存在或密钥域重用时，服务必须在监听前 fail-closed；测试只注入合成密钥，不提供默认密钥，也不记录密钥材料。
5. W3/W4 的写入统一复用数据库现有 `idempotency_lookup`、`idempotency_request_hash_version`、`idempotency_claim`、`idempotency_complete` 和 fencing token。单个业务操作在一个受控 `PoolClient` 事务中完成；只有来源拒绝审计按冻结设计在业务事务回滚后，用独立短事务写入安全字段。
6. Search 排名在一条参数化 SQL 中完成：scope-only 函数提供当前安全快照，外层使用固定 A/B/C 权重、`ts_rank_cd`、转义后的 fallback 匹配和稳定 tie-break，最终数据库侧 `LIMIT 3`。不得把全集拉入 Node.js 排名，也不在应用层缓存 current release、来源暂停或 policy 状态。

### 5.2 评审发现与处置

#### Architecture Review — 4 项，均已采用推荐方案

1. **[P1]（confidence: 10/10）搜索运行时投影不足。** `packages/database/migrations/0007_search_bigram.sql:104-123` 的返回表缺少问题公开投影和搜索字段，而 backing view 在 `:83-85` 已拥有这些字段。按 §5.1.2 做合同增量；在新合同落地前禁止实现降级版 title/answer-only 搜索。
2. **[P1]（confidence: 10/10）管理员写身份尚未隔离。** `apps/api/src/runtime-config.ts:29-35` 只有一个数据库配置，`apps/api/src/server.ts:49-50` 只构造一个 repository；按 §5.1.3 建立独立管理连接能力。
3. **[P1]（confidence: 10/10）密钥域尚未进入启动配置。** `apps/api/src/runtime-config.ts:19-35` 没有幂等或日志 HMAC 配置；按 §5.1.4 加入类型化 key ring 与启动前校验。
4. **[P1]（confidence: 9/10）事件计划未锁定事务/fencing 所有者。** 本计划原 `W3/W4` 仅列结果，数据库合同已经在 `0006_definer_functions_and_triggers.sql:3761-3977` 定义 lookup/claim/complete；按 §5.1.5 由 EventRepository 统一拥有事务、租约和重放语义。

#### Code Quality Review — 2 项，均已采用推荐方案

5. **[P2]（confidence: 9/10）响应白名单需要独立纯映射边界。** 生成合同在 `packages/contracts/src/generated/openapi.generated.ts:1050-1053` 明确禁止 DB row spread；SearchRepository 返回内部行，SearchService 必须逐字段构造公开候选并再次通过运行时合同校验。
6. **[P2]（confidence: 9/10）数据库错误不能在各 route 重复翻译。** 新增单一 `database-contract-errors` 映射器，以 SQLSTATE + 稳定 `DETAIL` 映射 400/403/404/409/503；未知错误只返回通用 500 和安全 diagnostic id，原始 SQL、参数、DSN 与 query 文本不得进入响应或日志。

#### Performance Review — 2 项，均已采用推荐方案

7. **[P2]（confidence: 9/10）避免函数结果全集进入应用层。** `v_scripts_recommendable` 已有 GIN/trigram 支撑字段，搜索必须按 §5.1.6 在数据库中完成排名与 Top 3，PG15 集成测试保存 `EXPLAIN` 断言和受控规模预算。
8. **[P2]（confidence: 9/10）双连接池必须共享总预算。** 当前 `DB_POOL_MAX` 最高 20；新增管理池后采用 `runtime + admin <= 20` 的启动不变量，admin 默认 2，运行时默认相应收窄，超过预算拒绝启动。

### 5.3 数据流与所有者

```text
HTTP /v1/search
  -> mock auth（拒绝缺失/冲突身份）
  -> SearchRequest runtime schema + 32 KiB/1..500 code point 门禁
  -> NFKC + PII redaction + LOG_HASH_KEY 指纹
  -> SearchService
       -> SearchRepository(app_runtime)
            -> search_recommendable_scripts(scope-only safe snapshot)
            -> SQL rank(A/B/C + exact + escaped fallback + stable tie-break)
            -> LIMIT 3
       -> explicit public mapper -> SearchResponse runtime schema
       -> EventRepository transaction
            -> idempotency lookup/claim(fencing)
            -> query_events + candidate_impressions
            -> idempotency_complete
       -> source denial? rollback -> independent safe denial-audit transaction

HTTP /v1/policy/:flag
  -> mock auth -> owner + hard-off pure policy gate
  -> PolicyAdminRepository(app_content_admin only)
  -> set_policy_flag(...) -> explicit PolicyFlagUpdateResponse
```

建议在 `search-repository.ts` 和 `event-repository.ts` 保留上述缩短版 ASCII 注释，因为 SQL 排名、事务与回滚后审计顺序不是从单个函数签名即可看出。

## 6. 测试覆盖计划

框架：Node.js 24 + Vitest/Node test；数据库语义使用隔离 PostgreSQL 15 集成 harness。当前仓已有 71 个已跟踪测试文件，继续复用现有合同、迁移、API 和 package smoke 分层。

```text
CODE PATHS                                              CALLER / USER FLOWS
[+] runtime-config                                     [+] API 启动
  ├── [GAP -> UNIT] 两个 key ring 合法                  ├── [GAP -> PACKAGE] 缺密钥时监听前退出
  ├── [GAP -> UNIT] 缺失/坏 JSON/重复域/当前版缺失      └── [GAP -> PACKAGE] 双池总预算超限退出
  └── [GAP -> UNIT] runtime/admin DSN 同身份拒绝
[+] policy write                                       [+] Owner 设置 mutable flag
  ├── [★★ TESTED] owner/hard-off pure gate              ├── [GAP -> PG15] admin role 可调用函数
  └── [GAP -> API+PG15] 401/403/409/503/成功             └── [GAP -> PG15] runtime role 仍不可调用
[+] search                                              [+] 客服输入问题获得 Top 3
  ├── [★★★ TESTED] 32 KiB、1/499/500/501、PII redaction ├── [GAP -> API+PG15] hit/no-hit 与稳定顺序
  ├── [GAP -> PG15] 四域/current/scope/hash/暂停门       ├── [GAP -> API] 不泄漏 internal row 字段
  ├── [GAP -> PG15] A/B/C、exact、escaped fallback      └── [GAP -> API] 失败显示稳定合同错误
  └── [GAP -> PG15] 半开有效期与 DEC-042 负例
[+] query/idempotency                                  [+] 重试、双击与 reselection
  ├── [GAP -> PG15] miss/proceed/replay/body mismatch   ├── [GAP -> API+PG15] 同体重放首次响应
  ├── [GAP -> PG15] in-flight/expired lease/fence lost  └── [GAP -> API+PG15] 父 query 非 terminal 拒绝
  └── [GAP -> PG15] rollback 后 denial audit 独立落库
[+] adoption/escalate                                  [+] 复制后终态与辅助升级
  ├── [GAP -> PG15] adoption first-wins                 ├── [GAP -> API+PG15] adopted 只表示复制
  ├── [GAP -> PG15] escalate auxiliary 幂等             └── [GAP -> API+PG15] 无状态搜索不可上报事件
  └── [GAP -> API] 复制/发送/正确语义不混淆
[+] G1a runner                                         [+] Owner 查看候选报告
  ├── [GAP -> RUNNER] 逐行 schema、分母与失败明细        ├── [GAP] 阈值未签发时不输出 PASS
  └── [GAP -> RUNNER] 20 正例+12 安全+18 鲁棒性         └── [GAP] 只读合成 fixture、零外部调用
```

计划内测试缺口共 9 组，全部随对应切片实现，不推迟到独立 TODO：

1. `runtime-config.test.ts`：两类 key ring、版本轮换、密钥域隔离、双池 DSN/角色/总预算；
2. package/main smoke：配置错误必须在 bind 前退出，输出仅含稳定字段；
3. policy API + PG15：owner mutable 成功、hard-off/非 owner 拒绝、角色最小权限与池关闭；
4. search migration/PG15：安全投影、四域 gate、暂停、有效期、scope/hash/DEC-042 与 ACL 负证据；
5. search unit/API/PG15：规范化、A/B/C、exact/fallback、转义、稳定 Top 3、no-hit 和公开白名单；
6. query event PG15：original/reselection、parent terminal、候选四元组与 provenance；
7. idempotency 并发 PG15：lookup/claim/replay/conflict/lease reclaim/fence lost；
8. adoption/escalate API + PG15：terminal first-wins、auxiliary 幂等、无状态零写入、复制语义；
9. G1a runner：50 条合成用例、closed schema、原始分母、阈值未签发不宣称 PASS。

覆盖目标：本里程碑新增纯函数/route/adapter 分支 100%；跨 API→DB 信任边界必须有 PG15 集成测试；无 LLM/prompt 变更，因此不新增 eval 套件。

## 7. 失败模式

| 路径 | 真实失败 | 测试 | 错误处理与可见结果 |
| --- | --- | --- | --- |
| 启动配置 | 密钥缺失、版本不存在、双池超预算 | unit + package smoke | bind 前 `CONFIG_INVALID`，不泄密 |
| admin 写 | DSN 配错到 runtime 身份或 DB 不可用 | PG15 ACL + API | fail-closed 403/503，稳定错误码 |
| search | 合同投影漂移、来源暂停、hash/scope 不一致 | contract + PG15 | 零候选或稳定 denial；必要时安全审计 |
| ranking | wildcard/Unicode 输入改变匹配或 tie 顺序 | unit + PG15 | 参数化/转义，稳定 tuple，最多 3 条 |
| idempotency | 并发请求、租约过期、fencing 丢失 | PG15 concurrency | 409/replay，不重复业务写入 |
| denial audit | 业务事务回滚连带丢审计 | PG15 rollback test | 回滚后独立事务；审计失败仍拒绝且报安全 diagnostic |
| adoption | 两个 terminal 同时到达 | PG15 concurrency | first-wins，冲突 409 |
| runner | 阈值未签或 fixture 非 closed shape | runner test | 报告 NOT SIGNED/失败分母，不伪造 PASS |

不存在“无测试 + 无错误处理 + 静默失败”的计划内路径；因此当前 critical gap 为 0。

## 8. What already exists

- 已有 OpenAPI 1.11.0 runtime validator、codegen 与合同 provenance：复用，不复制 DTO。
- 已有 PostgreSQL 15 迁移 harness、运行时 ACL 负证据和 `app_runtime` verified pool：扩展，不新建第二套数据库测试框架。
- 已有 `v_scripts_recommendable`、GIN/trigram 字段与 scope-only definer 函数：增量扩展安全投影，不新增平行搜索表/索引体系。
- 已有 idempotency lookup/claim/complete、fencing、rate limit 与 source-denial 函数：由 repository 编排，不实现内存锁或新队列。
- 已有 mock auth、请求体上限、Unicode 边界、redaction、policy 纯规则与只读端点：继续接线并补齐写 adapter。
- 已有 W0 closed-schema 合成金标：W5 runner 直接消费，不复制 fixture。

## 9. NOT in scope

- Electron Query 接线与 UI 调整：属于后续 DEV-M2；本轮只有 API/DB，无需设计评审。
- 真实飞书、客服数据、工作簿或业务号码：尚未放行，继续只用合成数据。
- 外部模型、LLM rerank、改写、自动学习、自动发送：一期 hard-off，且没有 prompt/eval 变更。
- 遥测、实验 KPI、生产部署、签名/公证、Pilot/UAT：需要独立阶段门与授权。
- 搜索缓存、向量库/RAGFlow、分布式队列：当前受控内容规模与 PostgreSQL 索引足够，引入会扩大一致性和运维面。
- 现有 `TODOS.md` 的四项 Electron/PILOT-S0 P3 验证债：与本轮后端切片无依赖，不夹带处理。

## 10. 顺序与并行化

| Step | Modules touched | Depends on |
| --- | --- | --- |
| Slice 1A 合同增量 | 治理仓 schema/current-state；产品仓 contracts/database | — |
| Slice 1B W1b | API config/policy/repositories | 1A 的合同版本（搜索接线部分） |
| Slice 2 W2 | API search；database integration | Slice 1 |
| Slice 3 W3/W4 | API events；database integration | Slice 2 候选四元组 |
| Slice 4 W5 | tests/fixtures；runner；动态文档 | Slice 2+3 |

两仓合同准备可先各自在隔离分支工作，但产品仓正式 intake 必须等待治理仓合同提交 SHA；API 各切片共享 `apps/api` 和 PG15 harness，强行并行会放大冲突。结论：**以一条主 lane 顺序推进，无安全的实现并行化收益。**

## 11. Implementation Tasks

Synthesized from this review's findings. Each task derives from a specific finding above.

- [x] **T1 (P1, human: ~3h / CC: ~30min)** — contracts/database — 扩展安全搜索投影并生成新合同集
  - Surfaced by: Architecture #1，`search_recommendable_scripts` 缺少安全搜索证据。
  - Files: 治理仓 schema 真源、产品仓合同快照/manifest/迁移生成器与 migration tests。
  - Verify: `pnpm contracts:verify && pnpm contracts:codegen:check && pnpm db:migrations:check && pnpm test:db`。
- [x] **T2 (P1, human: ~3h / CC: ~30min)** — API bootstrap/policy — 完成密钥配置、双池隔离和 policy 写 adapter
  - Surfaced by: Architecture #2/#3 与 Performance #8。
  - Files: `apps/api/src/runtime-config.ts`、server/app composition、policy admin repository/routes/tests/docs。
  - Verify: API unit/package tests + PG15 role/ACL integration。
- [x] **T3 (P1, human: ~5h / CC: ~45min)** — search — 实现单 SQL 排名、公开映射与来源拒绝路径
  - Surfaced by: Code Quality #5/#6 与 Performance #7。
  - Files: API search repository/service/routes/error mapper/tests。
  - Verify: search unit/API/PG15 matrix，Top 3、no-hit、ACL、无内部字段泄漏。
- [x] **T4 (P1, human: ~6h / CC: ~60min)** — events — 实现 query/adoption/escalate 的事务、幂等与 fencing
  - Surfaced by: Architecture #4。
  - Files: API event repository/service/routes/tests。
  - Verify: PG15 并发、replay/body mismatch、parent terminal、first-wins、rollback audit。
- [ ] **T5 (P1, human: ~3h / CC: ~30min)** — G1a — 完成 50 例 runner 与退出证据
  - Surfaced by: Test Review gap #9。
  - Files: `tests/fixtures/search`、runner、执行记录/验证文档。
  - Verify: runner 全量；未签阈值时只输出可运行与原始分母。
- [ ] **T6 (P2, human: ~2h / CC: ~20min)** — verification — 跑全量质量门并做凭证/真实数据扫描
  - Surfaced by: 全部评审项的落地门。
  - Files: 仅修复验证发现的本里程碑问题；不扩大范围。
  - Verify: `pnpm workspace:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build`，再执行定向 PG15/runner。

## 12. 工程评审完成摘要

- Step 0 Scope Challenge：保留完整 DEV-M1，缩减为四个顺序 PR-sized slices。
- Architecture Review：4 项，均已折叠进计划。
- Code Quality Review：2 项，均已折叠进计划。
- Test Review：已产出覆盖图，9 组缺口全部纳入当前里程碑。
- Performance Review：2 项，均已折叠进计划。
- NOT in scope / What already exists：已写明。
- TODOS.md：0 个新增项；现有四项均与本轮无关。
- Failure modes：0 个未处理 critical gap。
- Outside voice：当前运行于 Codex，按 gstack 规则跳过嵌套 Codex；完成一次进程内反向挑战，未发现与上述决策冲突的新问题。
- Parallelization：1 条顺序 lane；合同准备可分仓，但 intake 有明确 SHA 依赖。
- Lake Score：8/8 项采用完整推荐方案。

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
| --- | --- | --- | ---: | --- | --- |
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | 本轮未改变产品方向，未触发 |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | 当前已运行于 Codex，未嵌套调用 |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR | 17 项（4 architecture + 2 quality + 9 test groups + 2 performance），0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | 后端-only，无 UI 变更 |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | 当前无需独立 DX 评审 |

**VERDICT:** ENG CLEARED — ready to implement Slice 1；不代表实现、提交、推送、PR、合并或部署已完成。

NO UNRESOLVED DECISIONS
