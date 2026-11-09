# SOP unified 合同接收

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

## 验证入口

```sh
pnpm test:sop-unified
pnpm test:sop-unified:pg15
```

安全入口先核验仓内实际 `sopUnified` 快照与独立锁，再运行自包含技术合同 fixture、独立合成 Git source 和 bundle。压缩 fixture 保存已核实的 v4 输入与统一 source，复用仓内原合同字节并逐一核对固定哈希。测试运行时从仓内构造输入。合成 producer 会在执行时抛错，正常 intake 通过证明接收过程仅消费其字节。

根 `pnpm test` 经 `test:built`、`test:workflow` 调用安全测试及 readiness 接收回归。根 `pnpm check` 也运行安全测试，供 main CI 使用。PR 的 verification-policy quick lane 经既有 workflow-tests 调用同一入口。PG15 测试进入根 `test:db:integration`，由 main PostgreSQL job 和 PR database lane 消费。policy 回归检查这些实际调用关系。新增 scripts 路径沿用现有未知路径的 full fallback，登记范围限于根脚本与 policy 回归。

PG15 测试只创建隔离 Unix socket 临时库。它先应用并核验正式 migration 前缀，再安装统一 storage，核验空表、publication FK、lease ACL 和五分钟上限，最后确认正式 migration verifier 拒绝未登记 DDL。

原合同回归入口包含 `scripts/sop-query-contract-intake.test.mjs`、`scripts/repair-contract-intake.test.mjs` 与 `scripts/readiness-contract-intake.test.mjs`。本次来源 export 与产品快照共有 13 个文件，首次接收返回 `CREATED`，只读 verify 返回 `VERIFIED`。独立锁记录完整来源 SHA、manifest、OpenAPI 与数据库哈希。含锁的新增快照约 3.18 MiB，对冻结合同分组及总体容量各增加 3.2 MiB 配额。
