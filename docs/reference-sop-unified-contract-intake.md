# SOP unified 合同接收

## 当前协商修正版

OpenAPI `1.29.1` 与数据库 `schema.v1.33` 使用 `customer-agent-contract-set/v11`。修正覆盖 52 个请求头和 496 个响应头的版本 pattern，逐项验证实际 manifest 完整 ID。新成员 `negotiation-proof.v1.json` 保存全部 548 个 JSON Pointer 和变更前后约束，包内共有 14 文件。数据库、存储、v7 intake 和旧 query sidecar 的字节与纠错前序相同。

来源由治理仓 `content-intake-sop-unified-v1-1` 冻结，精确提交为 `812a2e80584f08675fab8b7401ce8b4cd3ab5bca`，合同为 `cs-ai-c11-openapi-1.29.1-schema-1.33-812a2e80584f`。14 个实际导出文件已逐字节接收核对，首次接收 CREATED，重复接收 REUSED，只读验证 VERIFIED。产品接收使用独立 `sop-unified-corrected-contract-set.lock.json`，profile 为 `sopUnifiedCorrected`。旧 `sopUnified` 锁和快照保留为固定纠错前序。

```sh
node scripts/customer-agent-contract-set.mjs verify --profile=sopUnifiedCorrected
```

新 profile 独立钉住前序的十二项产物哈希，从指定 Git 提交读取三个机器源并重建全部产物。它同时检查实际合同 ID、全部 header pattern、变更清单、元数据及产品中的原始前序。接收、幂等、原子失败回收与路径安全继续由既有 host 负责。根安全入口同时验证两份实际快照，再运行旧版与纠错专项。

新锁保持 `VERIFIED_NOT_ACTIVATED`。正常图发布链、查询权限事实、媒体消费和真实验收各自记录实现与验证。新增纠错快照约 3.34 MiB，冻结合同组和总体容量分别增加 3.4 MiB 配额。

## 纠错前序 1.29.0

`customer-agent-contract-set/v10` 接收 `content-intake-sop-unified-v1` 的统一 taskgraph 合同。版本固定为 OpenAPI `1.29.0`、数据库 `schema.v1.33`、架构 `1.16` 和实施 `1.22`。当前接收绑定来源提交 `33fc543523b95b47c1236ef7bbfccd3f772c9d0d` 与 `cs-ai-c11-openapi-1.29.0-schema-1.33-33fc543523b9`，已完成实际 export 的精确字节核对。

## 成员和来源

manifest 根字段为 `schema`、`contract_set_id`、`source_repository`、`source_git_sha`、`architecture_version`、`implementation_version`、`openapi`、`database`、`sopUnified`。ID 的最后 12 位必须等于完整 source SHA 的前 12 位。

包内包含 12 个产物及 `contract-set.json`。

| 成员 | 文件 | descriptor version |
| --- | --- | --- |
| openapi | `openapi.v1.yaml` | `1.29.0` |
| database | `schema-v1.33.sql` | `schema.v1.33` |
| storage | `storage.v1.sql` | `1` |
| installation | `installation.v1.json` | `1` |
| provenance | `provenance.v1.json` | `1` |
| predecessor | `predecessor-lock.v1.json` | `1` |
| compatibility | `compatibility.v1.json` | `1` |
| coverage | `operation-coverage.v1.json` | `1` |
| legacyIntake | `legacy-openapi.v7.yaml` | `7` |
| legacyQuery | `legacy-query.openapi.v1.json` | `1` |
| query | `query-transport.v1.json` | `1` |
| authorization | `authorization.v1.json` | `1` |

所有 descriptor 的 `source_path` 均位于 `business-docs/01-客服Agent项目/30-开发-进行中/content-intake-sop-unified-v1/`。接收器复用 host 的完整目录成员、常规文件、符号链接拒绝、路径闭合、字节数、SHA-256、完整 Git 历史和 exact commit blob 校验。

`provenance.sources` 闭合绑定三个 producer 文件，以及 `sop-unified-candidate/` 的 `source.json`、`authorization.source.json`、`query.source.json`、`storage.patch.sql`。接收器读取声明提交中的 blob，并检查源哈希、冻结目录成员和产物重建结果。上游 JavaScript 只作为来源字节读取。

## 统一语义和兼容性

`sop-unified-contract.mjs` 独立钉住产品已接受的 `0fb1dc76ee2b84fda4a82025c081eea7dd697534`。该锚包含 taskgraph v4 的八成员、旧 query v1 的九成员，以及原 query fragment 和 lease SQL 的哈希。包内 `source.json` 必须匹配这些锚。

新 API 由原 v4 OpenAPI 与新 query source 重建。原 FAQ、CSV、snapshot、质量、发布及 continuation 描述继承 v4。独立 `POST /v1/sop/query` 保留四状态与必填 exact 合同头，使用独立 `MenokinSopQuery` schema 命名空间。`ready.result` 包含完整 `IntakeSopFlowDefinition`、`graph_digest`、`IntakePublishedEntry` 集合、媒体绑定和逐 entry 权限事实。完整图包含节点和边，published entry 限定公开字段。

v7 intake 视图保存在独立 legacy sidecar。旧 query 视图绑定 `cs-ai-c11-openapi-1.25.0-schema-1.30-0fb1dc76ee2b` 与原 fragment 字节。缺失合同头按原 query 合同拒绝，`/v1/search` 的 SOP 行为保留 503 fail-closed。

storage 严格拼接 v4 storage、转换后的原 query lease 和 patch。lease 转换删除注释之后的外层 `BEGIN` 与末尾 `COMMIT`，将 15 分钟改为 5 分钟。patch 增加原 publication 的 deferred FK，并撤销 `app_runtime` 对 lease issuer 与 validator 的直接 EXECUTE 权限。累计 DDL 同样逐字节重建。

安装元数据固定为 `runnableMigration=false`、`migrationPosition=null`、`runtimeActivated=false`、`productionConsumerReady=false`。产品原 query 锁和 readiness 前序仍需通过各自校验。业务 mapping、真实数据与部署批准字段均为 false。

## 接收和只读核验

接收入口读取最终 export 与完整 source checkout。

```sh
node scripts/customer-agent-contract-set.mjs ingest \
  --source=/absolute/export/contract-set-directory \
  --source-repository-root=/absolute/source-checkout
```

结果位于 `contracts/upstream/customer-agent/<contract_set_id>/`。独立锁为 `sop-unified-contract-set.lock.json`，schema 为 `customer-agent-sop-unified-contract-consumption/v1`，profile 为 `sopUnified`，状态为 `VERIFIED_NOT_ACTIVATED`。

```sh
node scripts/customer-agent-contract-set.mjs verify --profile=sopUnified
```

`verifyIngestedSopUnifiedContractSet` 提供相同只读核验。接收结果的 `generateMigrations`、`generateContracts`、`ddev_authorized` 与 `runtime_activated` 均为 false。共享 intake mutex 串行保护快照和锁安装。相同 bundle 重试返回 `REUSED`，损坏目标、孤立锁、孤立目录和内容冲突均拒绝。锁安装失败时清理本次目标并释放 mutex。

## Foundation 消费入口

产品数据库生成器通过 `verifyIngestedCorrectedSopUnifiedContractSet` 选择独立 corrected 锁所绑定的 v11 快照，将其中的 `storage.v1.sql` 登记为正常目录的 `0084_sop_unified_storage`。生成物统一绑定 `812a2e80584f08675fab8b7401ce8b4cd3ab5bca` 来源。foundation 的 83→84 独立测试保留其历史目录。当前正常 apply / verify 消费包含实施 overlay 的完整 85 条目录，前 84 条 SQL 与来源元数据保持不可变。host 的 repair 和 readiness 前序检查直接校验 corrected 独立锁、v11 合同目录及 84/85 精确尾部。完整 corrected verifier 继续从固定 v10 前序重建产物。

`@customer-agent/contracts/sop-unified` 从同一快照生成 128 个引用闭合的 schema，拥有独立的类型、validator 注册表与 provenance。foundation 的 79 个 component 扩为正常 facade 实际使用的 Intake 闭包，包含间接携带新 scope 和错误的请求与响应。生成 paths 仍只有原 `/v1/sop/query`。默认 contracts 视图的五项生成物保持原字节。正常目录依赖 corrected 锁和 sourcehash 钉住的 0085 overlay，两个生成入口校验全部来源与产物。

旧 query candidate 的合成 host 显式应用前 83 条，并通过 testkit 的 `verifyMigrationPrefix(client, 83)` 核验物理前序后安装候选。该测试入口仍需既有 opt-in 和隔离 PG15 门禁。

## 正常图生命周期实施

既有 `createContentIntakeService` facade 继续拥有上传、接收、来源确认、人工质量、发布、回退与永久回执。内部 `sop-graph.ts` 集中关系闭包、canonical、精确依赖、图差异和媒体 owner。纯六表解析与 Excel 报告由 `packages/content-intake` 拥有。`0085_sop_unified_lifecycle` 从 overlays 经现有生成器登记，绑定相同 source 和合同版本。

只有 exact manifest ID 选择 successor validator。缺头或 exact v7 ID 使用原 validator。资源查址、身份和来源授权先于协商拒绝，随后才读取材料、映射和媒体。parse job、永久 receipt、资格及游标绑定 view。队列恢复读取持久 job 的原 view。

图来源登记 exact v1.1 tuple、六表结构 SHA 和显式 `source_mappings.graph_mapping`。该映射包含明确的 `riskLevel`（routine 或 critical）、`sourceClaim` 的版本声明及 acquisition、`flows[flowId]` 的 anchorEntry 与 audience、`entries[businessEntryId]` 的完整非正文元数据、`images[resourceId]` 的 required/alt/ordinal。对象哈希来自实际上传 bytes。业务映射缺失时返回 `SOP_MAPPING_REQUIRED`。六表中的列表采用 JSON 文本，适用范围采用合同 Applicability 的 JSON，任务类型显式为操作/判断/结束，维护字段逐行填写。原文、来源 scope、风险与关联依赖显式登记和行记录。

正常管理入口沿用 upload→receive→job→material→source-confirmation→quality/freeze→quality/checks→publish，回退沿用 rollback/preview 与 rollback。候选图片复核使用 `GET …/sop/media/{mediaObjectId}`，锁外读取真实 bytes 后重验 exact binding、权限与哈希。验证后的 graph job 报告由原 report 入口输出 XLSX，质量证据页保留完整 plan、targets、阶段检查及归因，读取需同时具有原 job 与 review 权限。

当前图通过既有 intake entitlement 与 snapshot 分页读取，合并 FAQ、词表、flows、nodes、edges、media，绑定 totals、pageCount 与完整 snapshotDigest。内部 `readCurrent(tx, principal, entitlementHash)` 调用受限 `read_sop_graph_current(text,text)`。图生效边界在不可变资格插入前由 `read_sop_graph_deadline(text,text)` 计算。005C 负责独立 query wire 与权限事实 writer，005D 负责 continuation 与最终图片消费。真实业务映射、来源和批准输入继续由对应 owner 提供。

正常链专项在 `apps/api/tests/sop-unified-lifecycle.integration.test.ts`，由 `test:integration:sop` 串行执行。它通过真实 HTTP 创建候选、质量与 R1/R2/R3，随后使用现有 backup-set 工具 dump/restore 非空图与媒体，再运行 85 verifier、受控当前图读取及实际 bytes 校验。所有输入为合成 fixture。上游 installation 与消费锁保留其未激活元数据。

## 验证入口

```sh
pnpm test:sop-unified
pnpm test:sop-unified:pg15
```

安全入口先核验仓内实际 `sopUnified`、`sopUnifiedCorrected` 快照及各自独立锁，再运行自包含技术合同 fixture、独立合成 Git source 和 bundle。压缩 fixture 保存已核实的 v4 输入与统一 source，复用仓内原合同字节并逐一核对固定哈希。测试运行时从仓内构造输入。合成 producer 会在执行时抛错，正常 intake 通过证明接收过程仅消费其字节。

根 `pnpm test` 经 `test:built`、`test:workflow` 调用安全测试及 readiness 接收回归。根 `pnpm check` 也运行安全测试，供 main CI 使用。PR 的 verification-policy quick lane 经既有 workflow-tests 调用同一入口。PG15 测试进入根 `test:db:integration`，由 main PostgreSQL job 和 PR database lane 消费。policy 回归检查这些实际调用关系。新增 scripts 路径沿用现有未知路径的 full fallback，登记范围限于根脚本与 policy 回归。

PG15 测试只创建隔离 Unix socket 临时库。它先应用并核验正式 migration 前缀，再安装统一 storage，核验空表、publication FK、lease ACL 和五分钟上限，最后确认正式 migration verifier 拒绝未登记 DDL。

原合同回归入口包含 `scripts/sop-query-contract-intake.test.mjs`、`scripts/repair-contract-intake.test.mjs` 与 `scripts/readiness-contract-intake.test.mjs`。本次来源 export 与产品快照共有 13 个文件，首次接收返回 `CREATED`，只读 verify 返回 `VERIFIED`。独立锁记录完整来源 SHA、manifest、OpenAPI 与数据库哈希。含锁的新增快照约 3.18 MiB，对冻结合同分组及总体容量各增加 3.2 MiB 配额。
