# 任务 B：Grok 独立外部代码审查

日期：2026-10-09。只读。没有改代码、没有提交、没有 push / PR / 合并 / 部署。没有重跑角色 15/15，没有把本轮局部审核写成整套 `/review` 通过。

## 仓库核对

| 工作区 | 分支 | HEAD | status |
| --- | --- | --- | --- |
| 产品 `/Users/hutou/.codex/worktrees/intake-organization/customer-agent-prototype` | `codex/intake-organization` | `89bca38ffbbaae624cfc29e2e2a3fb76d981ac76` | 干净 |
| 治理 `/Users/hutou/Desktop/ai-content-intake-p2-contracts` | `codex/content-intake-p2-contracts` | `0125a97c284a78262a52a67b3d9834107a0f59bc` | 干净 |
| 桌面原目录 `/Users/hutou/Desktop/customer-agent-prototype` | `main` | `8ab309fcd9c494b7343ed88bacb253205d36575f` | 保留既有 `TODOS.md` 修改和未跟踪计划，本任务未读正文、未改 |

产品 `VERSION` 为 `0.3.26`。消费锁为 `cs-ai-c11-openapi-1.22.0-schema-1.25-db6ba13d4780`，`intake_status=VERIFIED_NOT_ACTIVATED`，`ddev_authorized=false`，`runtime_activated=false`。`authority.ts` 与 `0030_intake_role_ceiling.sql` 不在本次差异里。

## 1. 确切审核范围和文件覆盖

本次实际审核的增量：

- 产品 `f6f8cf35ef9a9007cddade8a0c7fa4b648bef9a1..89bca38ffbbaae624cfc29e2e2a3fb76d981ac76`。唯一提交 `89bca38` `fix(intake): complete legacy check permissions and atomic verification`。66 个文件，+24727 / -148。
- 治理 `231cba56aa81afca43f009f3990f7a25b67f4f0f..0125a97c284a78262a52a67b3d9834107a0f59bc`。两笔提交：`db6ba13` 冻结并导出，`0125a97` 只记录导出回执。17 个文件，+879 / -27。产品锁的 `source_git_sha` 是 `db6ba13`，不是回执提交。

产品差异构成：

- 16 件 v4 包：`contracts/upstream/customer-agent/cs-ai-c11-openapi-1.22.0-schema-1.25-db6ba13d4780/` 下 `contract-set.json`、OpenAPI、`schema-v1.25.sql` 和 13 个 runtime 工件。
- 消费锁、intake 脚本、migration generator、`0035_intake_legacy_check_acl_v1_25.sql`、`runner.ts`、`verifier.ts`、生成清单、数据库/合同/桌面测试。
- 证据目录 `evidence/qa/intake-legacy-acl-runtime/` 与少量计划、交接、架构文档。
- 前 34 段 migration SQL 文件没有出现在差异里。清单只追加第 35 段和 v1.24 前序条目。

治理差异构成：

- `db6ba13`：导出器 `export_customer_agent_contract_set.mjs`、v4 导出测试、批准文、冻结规范、profile 切到 `content-intake-legacy-check-v1`。
- `0125a97`：只改 README、导出回执 json/md、冻结验证说明中的回执链接。

已有审查与本次关系：

| 范围 | 已有证据 | 本次处理 |
| --- | --- | --- |
| 角色可审文件 15/15，产品 `1480292..b703b20`、治理 `d7b1352..9856fba` | 用户提供结论，证据标记 `REUSED_NOT_RERUN` | 复用，不重跑 |
| 产品 `f6f8cf35..89bca38` | `evidence/qa/intake-legacy-acl-runtime/review.json` 只有本机核心和独立差异审查，`externalCompleteReview=INCOMPLETE` | 本次补上外部审查 |
| 治理 `231cba56..0125a97` | 批准文和回执都写明完整外部 `/review` 仍 INCOMPLETE | 本次按同一增量审查 |
| 更早超时或未调用外部的证据 | 见第 4 节 | 保留为缺口，不重跑 |

方法：

- 逐段阅读 intake 脚本、generator 的 v4 分支、`runner.ts` 事务、`verifier.ts` 前后核验、0035 与 ACL 原文、治理导出器 `assertIntakeLegacyCheckExportGate` / `assertLegacyCheckInstallation` / `verifyContractSetDirectory`、批准文与冻结规范、PG 与 API 测试差异。
- 在 `schema-v1.25.sql` 中核对八个函数的签名、`LANGUAGE sql`、`REVOKE ALL FROM PUBLIC`，以及文件末尾 ACL 块与 `intake-legacy-check-acl.v1.sql` 一致。没有逐行读完整 14030 行 DDL，也没有逐行读 5013 行 OpenAPI。OpenAPI SHA-256 仍是已批准的 `3f741eb980aba1cd9a2a273b25771b50299e1aef3acbc6a1579b57541ed43a94`。
- 重算 `checks.json` 里 18 个产品日志和 44 个输入文件的 SHA-256，全部相符。治理 `release-final.log` 的 SHA-256 `5855d6015c24cbd0fe0dda9fb2b45351b9a516ea9e80f0ae59059b7663dbafaa` 与回执一致；步骤清单为 46 项，日志终止于最后一步 `audit:deps` exit 0。
- 没有重跑测试，也没有重算治理所复用的 18 个 PG 输入哈希。

## 2. 发现

该范围未发现可行动缺陷。这不保证不存在未检到的缺陷。

核对过的行为：

- v4 要求 16 件成员、同源批准、哈希、完整 Git 历史；浅克隆被拒绝。v3 及更早来源提交在其自身历史上没有后续批准文件时仍可消费；已经包含新批准文件的历史不能降级成旧 profile。旧 CSV 安装清单和依赖键保留，并由同一套 v3 校验函数检查。
- 0035 只执行八条 `GRANT EXECUTE`，对象是 `intake_runtime_fn_owner`，没有 `WITH GRANT OPTION`。`db-manifest-delta.json` 记录 ACL 542→550、删除 0；八条新增的 grantee、权限和 `is_grantable=f` 与 SQL 一致。对象 3090、函数安全属性 255、触发器 109 的摘要前后相同。八个函数均为 INVOKER SQL，并且已有 `REVOKE ALL FROM PUBLIC`。
- `applyMigrationCatalogue` 在 0035 的 `BEGIN` 之内先跑完整 34 段前序核验，再执行 GRANT 和账本插入，恢复迁移前的 `search_path` 后做 35 段后验。失败走 `ROLLBACK`。`COMMIT` 回执失败仍是 `MIGRATION_COMMIT_UNKNOWN`，不在未知提交后盲目回滚。
- PG 日志包含七类前序漂移拒绝，以及同一事务内后验失败后 GRANT 与账本一起回滚。首轮全库门禁是 74 PASS / 1 FAIL，失败点是空库后缀文案仍写 25、实际为 26；定向复跑该测试 1 PASS / 48 SKIP。证据写明没有一次完整 75 项绿跑。
- API 日志中，非超级用户 `synthetic_legacy_publisher`（`GRANT intake_business`，`current_user=intake_business`）完成旧 8 行两次发布、纠正回退和原操作重放。来源停用、映射变化、权限变化，以及旧 approval-v1 撤销/到期，均拒绝且 `commit=rolled_back` 或 `APPROVAL_UNAVAILABLE`。直接 `INSERT` 旧表期望 42501。
- 根 `pnpm test` 日志与声明一致：contracts 24、retrieval-core 9、content-intake 97、database 42、API 567、desktop 1426；跳过 database 26、API 332、desktop 7。`workspace:check` 如实为 FAIL，40.3 MiB / 32 MiB，exit 1。根 lint / typecheck / build / docs 日志 exit 0。

## 3. 本次没有覆盖的部分

- 没有逐行阅读完整 `schema-v1.25.sql` 和 `openapi.v1.yaml`。生成物靠批准哈希、包成员哈希、前序 DDL 拼接检查和八函数签名抽查核验。
- 没有重跑任何测试，也没有重算治理 17 项 PG 所依据的 18 个输入哈希。
- API 专项 `api-result.json` 里的 `eslint.log` / `typecheck.log` 没有入库，记录值是空文件摘要。根 lint 和 typecheck 日志已入库且摘要相符。
- 旧 8 行测试证明 `public.release_items` 在两次发布和回退中与原基线相同，并在回退后读到第一版 FAQ 正文。它没有在回退前单独读取第二次发布的新正文。
- 没有审查桌面原目录，也没有审查其他 worktree 上尚未回收的分支。
- 没有审查真实飞书、真实 Menokin 正文、生产账号、Mac 新包或 Windows。

## 4. 两个状态必须分开

### Grok 本次范围

`f6f8cf35..89bca38` 与 `231cba56..0125a97` 的外部审查状态：**已完成，该范围未发现可行动缺陷**。可以据此把这两段从“缺少外部结论”中划出。不能据此改角色上限，也不能把消费状态改成已激活。

### 整个 `/review`

**仍是 INCOMPLETE。** 本次只补上上面两段。沿本期证据链，下列范围仍没有外部结论，本次按“超时无结论保留为缺口”没有重开 diff：

1. CSV 正式消费本地审查所覆盖、但外部仍空缺的产品区间 `54f428ca8296aba9a75d2205439b3063cfef8c9b..f6f8cf35ef9a9007cddade8a0c7fa4b648bef9a1`。见 `evidence/qa/intake-csv-runtime/review.json`。旧目录缺 EXECUTE 已由 0035 关闭；该区间其余 CSV/XLSX、0034、Main 与报告消费代码仍无外部结论。
2. `evidence/qa/intake-organization/review.json`：自 `29fc709` 起的组织 writer。外部 adversarial 与 structured 均在 180 秒超时，无模型结论。`intake-runtime-boundary/review.json` 明确不再重跑这两次超时。
3. `evidence/qa/intake-direct-publication/review.json`：先前两路外部路径 180 秒超时，无结论。
4. `evidence/qa/intake-unified-workspace/review.json`：自 `e25d528` 起的四域工作台。该轮没有调用外部审查。
5. `evidence/qa/intake-parallel-recovery/three-part-completion/review.json`：治理新边界一次 180 秒超时，无结论。
6. 同期证据链里仍标记外部超时或不能替代外部覆盖的局部记录：`content-intake-p2-capacity`、`content-intake-p2-usage`、`content-intake-p2-query-filters`、`content-intake-p2-family`、`content-intake-p2-publication`。
7. 角色 15/15 只覆盖当时的可审文件，不是上述缺口的外部替代。
8. 任务 A/C/D 如果在 `89bca38` / `0125a97` 之后产生新提交，只复审那些实际增量。

主 Agent 只有在上述已记录缺口各自有外部结论，并且回收后的新增量也完成复审时，才能更新整套 `/review` 标记。本次没有发现，不能写成整套 `/review` 通过。
