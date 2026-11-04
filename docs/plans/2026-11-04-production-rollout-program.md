# 生产发布落地工程计划

> 状态：REVIEWED
>
> 计划基线：`origin/main@35101051e35b24548578d93028bdb9448fa6d3f3`
>
> 实现起点：`origin/main@0b4ca1f2ec8027207ad2eb43722e9fa2941f9474`。后续 main 只前进了一个 CI cache-context 提交，产品输入未变；PR 前仍须 rebase 到计划基线并复核证据。
>
> 目标：在不改变现有生产拓扑的前提下，把生产发布拆成可独立验证的任务，先关闭数据租户、备份前进、版本身份和写入失败关闭四类风险，再申请切换窗口。

方案可以落地，现有架构不需要重写。当前风险集中在缺少可重复的生产前证据，以及人工切换步骤之间没有单一编排。代码合并、本地恢复演练、合成测试和 TLA+ 模型通过均不构成生产验收。

## How to read this

One box is one unit of work. Every box names the evidence that checks it. Check a box only when its evidence exists and the evidence is bound to the candidate SHA, input, and environment.

程序采用 `pstack/skills/poteto-mode/playbooks/autopilot-stack.md`。REL-01、REL-02、REL-03 和 REL-07 各自在独立分支开发，REL-04 在四项合流后实现。REL-05、REL-06 和 REL-08 进入生产窗口后执行。提交、合并、部署和发布继续分别需要明确授权。

Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

## Program checklist

### Arm the program

- [x] 读取仓库章程、工程流程和相关 SSOT，确认当前任务属于产品实施仓的本地工具与迁移开发。
- [x] 记录实现起点 `origin/main@0b4ca1f2ec8027207ad2eb43722e9fa2941f9474`。该起点包含 PR #147 的 `9d47baf0e2c30ce6b994b2d0f1c04e884082324e`。
- [x] 把工作拆成四个独立工作树，避免多个实现者写同一文件或分支。
- [x] 将每个决定和证据写入本地 `.audit/prod-rollout.tsv`。
- [ ] 每次审计从 trunk 重读仓库流程并核对全局执行 skill。使用 `git show origin/main:docs/reference-engineering-workflow.md`，并读取已安装 poteto-mode skill 的 `playbooks/autopilot-stack.md`。
- [ ] 本轮不是长期后台程序，因此不启用 `/loop 1h`。每次状态变化单独记录，不重复发布未变化的 status message。
- [ ] 在合并前由未参与实现的审查者复核最终集成差异。当前只完成主线程审查和真实测试，独立子审查没有返回有效结果。

### Spawn owners

- [ ] REL-01、REL-02、REL-03 和 REL-07 的最终差异分别通过审查。
- [ ] 先合流 REL-01、REL-02 和 REL-07，得到新增 `0081` 后的稳定工程基线。
- [ ] 基于合流后的基线重新生成并构建 REL-03 的 `0.3.43` 候选。
- [ ] 使用最终候选重跑 `79 → 81` 的备份恢复与追加迁移演练。
- [ ] 实现 REL-04，并在测试根完成成功、失败和回滚路径。
- [ ] 生产窗口获批后执行 REL-05、REL-06 和 REL-08。
- [ ] REL-01 独占租户预检脚本、其测试和接入说明。
- [ ] REL-02 独占备份恢复预演脚本、其测试和接入说明。
- [ ] REL-03 独占版本号、发布预检和 release 身份检查。
- [ ] REL-07 独占追加迁移、生成物和数据库验证码。
- [ ] 合流阶段由单一集成工作树消费四个分支，其他分支不再并行修改已合流文件。

### PR mechanics, for every PR

- [ ] 每个任务只提交一个可回退目的，并保留生成物与其源文件在同一提交。
- [ ] 使用 `gh` 创建 ready PR。若 `gh` 不可用，记录替换工具和原因。
- [ ] 不修改已安装的 `0080` 字节。未知 actor 的收紧通过追加 `0081` 完成。
- [ ] 不使用 `0.3.42` 的包、服务产物或健康值代表新候选。
- [ ] 恢复、切换和回滚命令默认拒绝 live root，只有 REL-04 的获批生产入口可以指向生产路径。
- [ ] 生产输出只保留聚合计数、稳定错误码和哈希。不得写入客户正文、身份明细、凭证、内部 URL 或 token。
- [ ] PR 对话中的审查发现逐条修复、明确驳回或保留为风险。

### Verdict and merge, for every PR

- [ ] clean verdict 绑定 PR 的精确 head SHA。
- [ ] 所有 live lane 和审查 lane 返回 PASS。
- [ ] 新 head 使受影响证据失效，并重新运行对应门禁。
- [ ] 只在当前候选获得明确合并授权后执行 merge。

### Boot recipe, for every live lane

- [ ] 检出 PR head 的完整 SHA。
- [ ] 使用 Node.js 24.x、pnpm 11.19.0 和 `pnpm install --frozen-lockfile`。
- [ ] 运行对应 CLI 或隔离 PG15，并记录 stdout、stderr 和退出码。
- [ ] 将终端 screenshot 保存到 `/tmp/swarm-<pr-id>/worker-<n>/<slug>.png`。
- [ ] 将运行输出保存为可复核文本证据，避免转录客户内容或凭证。

## Preflight production intake tenancy (REL-01)

**Depends on.** None.

**Outcome.** 运维人员能对生产 `profile.json` 执行只读检查，得到机器可读的活动批次租户报告。

**Files.**

- [ ] `scripts/ops/production-intake-tenancy.mjs`
- [ ] `scripts/ops/production-intake-tenancy.test.mjs`
- [ ] `packages/database/tests/production-intake-tenancy.integration.test.ts`
- [ ] `docs/how-to-run-backend-on-hangzhou.md`

**Build.**

- [x] 复用 `scripts/synthetic-stack/profile.ts` 校验 stack root、环境、端口、正式库名、socket 和对象目录。
- [x] 在同一个 `REPEATABLE READ READ ONLY` 事务内聚合活动批次、principal、来源版本和 current release。
- [x] 检查活动 `default`、principal 缺失、actor 租户错配、来源缺失、来源不完整、来源租户错配和不完整 current four-domain set。
- [x] 输出稳定 JSON schema 和聚合阻断码。退出 `0` 表示 ready，`1` 表示 blocked 或检查失败，`2` 表示参数或 profile 无效。

**You see.**

- [x] 干净 fixture 返回 `status: "ready"`。
- [x] 活动 `default` fixture 返回 `ACTIVE_IMPORT_BATCH_DEFAULT_TENANT`。
- [x] 未知 actor fixture 返回 `ACTIVE_IMPORT_BATCH_PRINCIPAL_MISSING`。
- [x] 只有三个来源的 fixture 返回 `ACTIVE_IMPORT_BATCH_SOURCE_SET_INVALID`。
- [x] PostgreSQL 15 集成测试能从真实表和触发器边界聚合出活动批次与历史 `default` 计数。

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [x] `node --test scripts/ops/production-intake-tenancy.test.mjs`，8 个用例通过。
- [x] `pnpm exec eslint` 检查脚本、测试和数据库测试。
- [x] `CUSTOMER_AGENT_DB_PG15_INTEGRATION=1` 运行生产租户预检集成测试，1 个用例通过。

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `inherit-parent` at the PR head, per the boot recipe.

- [ ] Lane 1. 在隔离恢复库运行 ready fixture。Save `rel-01-ready.png`. Pass when 退出码为 `0` 且 JSON 可被下游脚本读取。
- [ ] Lane 2. 构造活动 `default` 批次。Save `rel-01-default.png`. Pass when 报告包含 `ACTIVE_IMPORT_BATCH_DEFAULT_TENANT`。
- [ ] Lane 3. 构造未知 actor。Save `rel-01-unknown-actor.png`. Pass when 报告包含 `ACTIVE_IMPORT_BATCH_PRINCIPAL_MISSING`。
- [ ] Lane 4. 构造显式 tenant mismatch。Save `rel-01-tenant-mismatch.png`. Pass when 报告包含 `ACTIVE_IMPORT_BATCH_TENANT_MISMATCH`。
- [ ] Lane 5. 构造三域来源和来源租户错配。Save `rel-01-source-set.png`. Pass when 报告包含来源集与来源租户阻断码。
- [ ] Lane 6. 构造 current release 缺失、默认租户和错误来源集。Save `rel-01-current-release.png`. Pass when 报告只返回对应的 current release 阻断码。
- [ ] Lane 7. 使用错误 profile 和非 owner 只读连接。Save `rel-01-profile-readonly.png`. Pass when profile 在连接前失败，只读事务不能执行写入。
- [ ] Lane 8. 停止临时 PG 或指向不可达 socket。Save `rel-01-db-down.png`. Pass when 输出 `CHECK_FAILED` 且不伪装为 ready。
- [ ] Lane 9. 并发运行两次检查并对同一快照重复执行。Save `rel-01-repeat.png`. Pass when 不阻塞发布事务、不留下活动事务，阻断码与计数一致。
- [ ] Lane 10. 在候选恢复库生成最终报告。Save `rel-01-candidate.png`. Pass when 报告绑定候选 SHA、备份 ID、检查时间且不含敏感字段。

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. N/A. This is a low-frequency operational gate and has no user-facing latency promise.
- [ ] Probe. N/A. REL-04 still records the production run duration.
- [ ] Baseline. N/A. Production row counts are unknown before REL-01 runs on the isolated copy.
- [ ] Rule. No fixed duration fails this PR. A missing or incomplete JSON report fails.

**Review gate.** The operator reviews the terminal screenshot and video before merge.

- [ ] 负责人签收 ready 报告和所有历史 `default` 批次清单的聚合数量。
- [ ] operator 审阅终端 screenshot 和 video。
- [ ] 保存并展示 ready 报告 screenshot。
- [ ] 录制一次阻断报告运行 video。

**Merge.**

- [ ] 最终差异通过独立代码审查。
- [ ] 单元、PG15 和隔离恢复库证据绑定最终 SHA。
- [ ] 在 REL-07 合流后重新确认预检仍能识别未知 actor。

## Rehearse candidate migrations on a restored backup (REL-02)

**Depends on.** None for implementation. Final proof depends on REL-07.

**Outcome.** 完整生产备份能在独立临时 PG15 中恢复，并由候选 release 自己的构建继续应用追加迁移和运行候选 verifier。

**Files.**

- [ ] `scripts/ops/backup-set.mjs`
- [ ] `scripts/ops/backup-set.test.mjs`
- [ ] `scripts/ops/backup-set-pg15.test.mjs`
- [ ] `docs/how-to-verify-backup-set.md`

**Build.**

- [x] 增加 `restore-drill --candidate-release` 入口。
- [x] 验证候选目录名等于 Git `HEAD`，tracked 文件干净，`VERSION` 与桌面 package 一致。
- [x] 验证备份 ledger 是候选 migration catalogue 的精确前缀。
- [x] 只导入候选 release 自带的 database、generator 和 verifier 构建。
- [x] 证据记录恢复前迁移数、最终迁移数、追加迁移 ID、候选版本、候选 SHA、源 verifier 和候选 verifier。
- [x] 临时集群默认清理，源备份和 live stack 路径不写入。

**You see.**

- [x] 79 段备份恢复后应用 `0080` 与 `0081`，最终 verifier 为 81 段。
- [x] 候选前缀错位、SHA 不符、dirty tracked 文件、缺少构建模块或 verifier 失败均 fail-closed。
- [x] 成功证据中的 `appliedMigrationIds` 精确等于候选追加的迁移 ID。

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [x] `node --test scripts/ops/backup-set.test.mjs`，17 个用例通过。
- [x] ESLint 通过。

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `inherit-parent` at the PR head, per the boot recipe.

- [x] Lane 1. 隔离 PG15 从 79 段备份恢复并前进到 81 段。Save `rel-02-79-81.png`. Pass when 源 verifier、候选 verifier 和追加迁移 ID 全部匹配。
- [ ] Lane 2. 用最新完整生产备份集重跑。Save `rel-02-backup-set.png`. Pass when 备份 ID、recovery point 和对象集来自同一次采集。
- [ ] Lane 3. 注入缺失对象和损坏 dump。Save `rel-02-corrupt-artifact.png`. Pass when evidence 为 FAIL 且临时集群被清理。
- [ ] Lane 4. 注入错误 ownership 和 ACL。Save `rel-02-fidelity.png`. Pass when metadata fidelity 为 UNCONFIRMED 或 FAIL，迁移不报告成功。
- [ ] Lane 5. 注入候选 ledger 前缀错位。Save `rel-02-prefix.png`. Pass when 在恢复数据库前返回 `CANDIDATE_RELEASE_PREFIX_MISMATCH`。
- [ ] Lane 6. 在备份恢复库运行 REL-01。Save `rel-02-tenancy.png`. Pass when 迁移前后的租户阻断结果符合预置 fixture。
- [ ] Lane 7. 注入候选 verifier 失败。Save `rel-02-verifier.png`. Pass when 源 verifier 状态不会被标成候选通过。
- [ ] Lane 8. 向演练进程发送 SIGINT 和 SIGTERM。Save `rel-02-signal.png`. Pass when 临时集群被清理且源备份不变。
- [ ] Lane 9. 对同一备份重复演练。Save `rel-02-idempotence.png`. Pass when 迁移结果一致且 evidence 文件彼此独立。
- [ ] Lane 10. 使用不匹配的 release 路径、Git HEAD 或 dirty tracked 文件。Save `rel-02-candidate-identity.png`. Pass when 在恢复数据库前 fail-closed。

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Recovery duration and four component durations are recorded.
- [ ] Probe. Run the candidate rehearsal twice on the selected backup and compare component durations.
- [ ] Baseline. Record the first lane-1 duration before production-sized backup evidence.
- [ ] Rule. No production-sized threshold is used before REL-04. Missing duration fields fail.

**Review gate.** The operator reviews the evidence screenshot and rollback video before merge.

- [ ] 数据库负责人签收恢复迁移数、最终迁移数和候选 SHA。
- [ ] operator 审阅 evidence screenshot 和清理 video。
- [ ] 保存 evidence JSON 的 screenshot。
- [ ] 录制失败清理和恢复的 video。

**Merge.**

- [ ] REL-07 合流后用包含 `0081` 的最终候选重跑。
- [ ] 最终证据绑定候选完整 SHA 和实际备份 ID。

## Bind the 0.3.43 release identity (REL-03)

**Depends on.** REL-07 for the final candidate build. Version tooling can land earlier.

**Outcome.** `0.3.43` 只能标识基于完整 SHA、tracked 文件干净且入口完整的候选。release 预检拒绝版本或目录身份漂移。

**Files.**

- [ ] `VERSION`
- [ ] `apps/desktop/package.json`
- [ ] `CHANGELOG.md`
- [ ] `scripts/ops/customer-agent-release.mjs`
- [ ] `scripts/ops/customer-agent-release.test.mjs`
- [ ] 三处过时的 macOS panel 注释

**Build.**

- [x] 根 `VERSION` 和桌面 package 升到 `0.3.43`。
- [x] preflight 支持 `--expected-version`。
- [x] 当前和下一 release 均验证版本一致。
- [x] 下一 release 验证目录名等于 Git `HEAD`，tracked 文件干净，stack entry 存在。
- [x] 所有失败发生在 current symlink 切换前。

**You see.**

- [x] dry-run 输出版本、完整 SHA、迁移移动方向和入口状态。
- [x] fork ledger、版本漂移、错误 SHA、dirty tracked 文件和缺少入口均拒绝切换。

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [x] release 测试 11 个用例通过。
- [x] 全量 workflow 测试在独立分支通过 178 个用例。
- [x] TypeScript、ESLint、generated check 和 docs check 通过。

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `inherit-parent` at the PR head, per the boot recipe.

- [ ] Lane 1. 在测试部署根创建最终完整 SHA 候选。Save `rel-03-candidate-root.png`. Pass when release 目录、Git HEAD 和批准 SHA 完全相同。
- [ ] Lane 2. 运行成功 dry-run。Save `rel-03-dry-run.png`. Pass when 输出版本、SHA、迁移方向和入口状态。
- [ ] Lane 3. 注入版本漂移。Save `rel-03-version-drift.png`. Pass when current 不变且退出非零。
- [ ] Lane 4. 注入 dirty tracked 文件。Save `rel-03-dirty.png`. Pass when current 不变且退出非零。
- [ ] Lane 5. 注入缺少 stack entry。Save `rel-03-entry.png`. Pass when current 不变且错误点名入口。
- [ ] Lane 6. 注入 fork ledger。Save `rel-03-fork.png`. Pass when current 不变且拒绝切换。
- [ ] Lane 7. 检查 preflight 副作用。Save `rel-03-no-side-effects.png`. Pass when 不创建 bundle、不复制远端文件、不重启服务。
- [ ] Lane 8. 检查失败消息和日志。Save `rel-03-redaction.png`. Pass when 不出现凭证、内部 URL 或 token。
- [ ] Lane 9. 验证 `0.3.42 → 0.3.43` 迁移增量。Save `rel-03-migrations.png`. Pass when 增量只包含批准的追加迁移且包含 `0081`。
- [ ] Lane 10. 消费最终候选。Save `rel-03-consumers.png`. Pass when REL-02 能读取候选，代码回退后的 81 段库仍 fail-closed。

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. N/A. Preflight is not on a user request path.
- [ ] Probe. N/A. REL-04 records the deployment budget.
- [ ] Baseline. N/A. The candidate path has no steady-state throughput.
- [ ] Rule. A missing version, SHA, or migration delta fails.

**Review gate.** The operator reviews the candidate identity screenshot and dry-run video before merge.

- [ ] 发布负责人确认 `0.3.43` 不复用 `0.3.42` 的任何产物。
- [ ] operator 审阅候选身份 screenshot 和 dry-run video。
- [ ] 保存版本和 SHA 输出 screenshot。
- [ ] 录制 dry-run 与拒绝切换的 video。

**Merge.**

- [ ] 在 REL-07 合流后重建候选并更新任何受迁移数量影响的验证输出。
- [ ] 合并前重新运行版本、workflow 和 generated checks。

## Orchestrate the production switch (REL-04)

**Depends on.** REL-01, REL-02, REL-03 and REL-07.

**Outcome.** 一个单写者入口完成候选检查、迁移、指针切换、重启、readiness 和回滚，并在每一步失败时停在可解释状态。

**Files.**

- [ ] `scripts/ops/customer-agent-production-release.mjs`
- [ ] `scripts/ops/customer-agent-production-release.test.mjs`
- [ ] `docs/how-to-deploy-production-release.md`

**Build.**

- [ ] 引入部署锁，禁止两个实例同时切换同一 root。
- [ ] 默认 dry-run。真实执行必须同时提交完整 SHA、`0.3.43` 和明确环境参数。
- [ ] 在写指针前完成 release identity、migration prefix、backup evidence、tenant report 和 readiness target 检查。
- [ ] 先应用追加迁移，再切换 symlink，再重启 unit。
- [ ] readiness 失败时恢复上一指针并重启，保留失败 release 诊断目录。
- [ ] 每一步写入不含敏感数据的结构化审计日志。

**You see.**

- [ ] dry-run 输出完整计划且不写文件、不重启服务。
- [ ] 任一前置检查失败都不发生迁移或指针写入。
- [ ] readiness 失败时 current 回到上一 release，并输出精确回滚结果。

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] 覆盖成功、锁冲突、迁移失败、symlink 失败、restart 失败、readiness 失败和回滚失败。
- [ ] 覆盖重试时识别已完成的迁移和已有 current 指针。

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `inherit-parent` at the PR head, per the boot recipe.

- [ ] Lane 1. 在测试 root 使用桩服务完成成功切换。Save `rel-04-success.png`. Pass when current、迁移、restart 和 readiness 全部到达目标状态。
- [ ] Lane 2. 在每个故障点终止进程后重试。Save `rel-04-crash-retry.png`. Pass when 下一轮能识别已完成阶段。
- [ ] Lane 3. 从 live root 执行 dry-run。Save `rel-04-live-refusal.png`. Pass when preflight 仍拒绝 live root。
- [ ] Lane 4. 缺少生产窗口授权。Save `rel-04-authorization.png`. Pass when 真实执行不可用且无写入。
- [ ] Lane 5. 注入迁移失败。Save `rel-04-migration-failure.png`. Pass when current 不变且不重启服务。
- [ ] Lane 6. 注入 symlink 切换失败。Save `rel-04-link-failure.png`. Pass when 指针和 service 保持原状态。
- [ ] Lane 7. 注入 readiness 失败。Save `rel-04-rollback.png`. Pass when current 恢复上一 release 并成功 readiness。
- [ ] Lane 8. 注入回滚 readiness 失败。Save `rel-04-rollback-failure.png`. Pass when 进程停止并保留完整现场。
- [ ] Lane 9. 并发启动两个实例。Save `rel-04-lock.png`. Pass when 第二个实例立即失败且无写入。
- [ ] Lane 10. 发送 SIGINT 并检查审计证据。Save `rel-04-signal-evidence.png`. Pass when 无半写 symlink，evidence 先写临时文件再原子替换。

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Total lock-to-readiness duration and each migration, link, restart, and readiness duration.
- [ ] Probe. Run the test-root switch three times with the same candidate and fixtures.
- [ ] Baseline. Record the three runs before the production window.
- [ ] Rule. The production window fails if it cannot fit the maximum observed duration plus the approved recovery margin.

**Review gate.** The operator reviews the successful switch screenshot and failure-rollback video before merge.

- [ ] 两名负责人签收成功和回滚路径。
- [ ] operator 审阅成功切换 screenshot 和回滚 video。
- [ ] 保存成功切换的 screenshot。
- [ ] 录制故障注入和回滚的 video。

**Merge.**

- [ ] 只在前置四项合流后实现。
- [ ] 入口未获批前保持 test-only 或 dry-run 限制。

## Accept production identity, content and clients (REL-05)

**Depends on.** REL-04 and an approved production deployment window.

**Outcome.** 获批身份、受控内容和目标设备完成端到端验收。

**Files.**

- [ ] 仓外受控 evidence 记录
- [ ] 客户端安装与设备签收记录

**Build.**

- [ ] 准备获批内容和具名负责人。
- [ ] 准备生产账号、第二坐席和目标设备。
- [ ] 记录安装包完整 SHA、产品版本和平台。

**You see.**

- [ ] 导入、staged、发布、第二坐席复制、取消、回退和客户端升级均完成。
- [ ] Windows 主交付面有真人签收。macOS 和 Linux 按各自声明范围记录。

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] 复用已通过的合成回归，不把合成结果写成生产验收。

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `inherit-parent` at the PR head, per the boot recipe.

- [ ] Lane 1. 记录生产候选与批准身份。Save `rel-05-identity.png`. Pass when 操作人、时间、完整 SHA 和回退点齐全。
- [ ] Lane 2. 导入获批内容到 validating。Save `rel-05-import.png`. Pass when 批次进入 validating 且租户与 actor principal 一致。
- [ ] Lane 3. 完成 staged。Save `rel-05-staged.png`. Pass when 来源四域和质量状态可由负责人复核。
- [ ] Lane 4. 发布受控内容。Save `rel-05-publish.png`. Pass when 负责人确认结果并记录 release ID。
- [ ] Lane 5. 第二坐席查询。Save `rel-05-query.png`. Pass when 第二坐席读到本次发布且范围正确。
- [ ] Lane 6. 执行复制。Save `rel-05-copy.png`. Pass when UI 只显示已复制，不推断发送、采纳或解决。
- [ ] Lane 7. 取消活动操作。Save `rel-05-cancel.png`. Pass when 取消结果与回执状态一致。
- [ ] Lane 8. 执行回退。Save `rel-05-rollback.png`. Pass when 未授权数据不可见且原 release 可恢复。
- [ ] Lane 9. 安装 Windows 客户端。Save `rel-05-windows.png`. Pass when 具名负责人签收安装、登录、查询和复制。
- [ ] Lane 10. 验证 macOS 和 Linux 声明范围。Save `rel-05-other-clients.png`. Pass when 每个声明范围有设备证据或明确未验收记录。

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Import-to-staged, publish, query, and copy durations on each target device.
- [ ] Probe. Run the same approved scenario on the test stack before the production window.
- [ ] Baseline. Record the test-stack values before the device run.
- [ ] Rule. Missing measurements fail. Production failure thresholds require product-owner approval.

**Review gate.** The operator reviews target-device screenshots and the workflow video before merge.

- [ ] 产品负责人保存关键界面 screenshot。
- [ ] 具名设备负责人录制完整 workflow video。
- [ ] operator 在合并前查看 screenshot 和 video。

**Merge.**

- [ ] 生产授权、真实内容和设备负责人均已明确。
- [ ] 所有生产 evidence 绑定同一候选 SHA。

## Observe and roll back after release (REL-06)

**Depends on.** REL-04.

**Outcome.** readiness、watchdog、backup、租户错配、migration 状态和外部 probe 都有发布后观察与告警证据。

**Files.**

- [ ] 告警配置
- [ ] 发布后观察记录
- [ ] 回滚演练记录

**Build.**

- [ ] 把 `/ready`、服务状态、watchdog、备份 age、备份恢复结果和租户阻断码接入告警。
- [ ] 定义告警接收人、响应时间和升级路径。
- [ ] 定义代码回退、数据库恢复、隧道回退和通知链路。

**You see.**

- [ ] 主动故障能触发对应告警，恢复后告警关闭。
- [ ] 回滚演练产生可读证据。

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] 告警规则和阈值通过配置校验。

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `inherit-parent` at the PR head, per the boot recipe.

- [ ] Lane 1. 注入 readiness 失败。Save `rel-06-readiness.png`. Pass when 对应告警送达并记录恢复时间。
- [ ] Lane 2. 注入 backup age 超限。Save `rel-06-backup-age.png`. Pass when 备份告警送达。
- [ ] Lane 3. 注入迁移后缀异常。Save `rel-06-migration.png`. Pass when migration 告警送达。
- [ ] Lane 4. 注入租户阻断。Save `rel-06-tenancy.png`. Pass when tenant 阻断码进入告警。
- [ ] Lane 5. 注入 watchdog 停止。Save `rel-06-watchdog.png`. Pass when service watchdog 告警送达。
- [ ] Lane 6. 注入公网 probe 失败。Save `rel-06-probe.png`. Pass when 独立 probe 告警送达。
- [ ] Lane 7. 恢复 readiness。Save `rel-06-recovery.png`. Pass when 告警解除且服务 ready。
- [ ] Lane 8. 执行代码回退。Save `rel-06-code-rollback.png`. Pass when current 指向上一个完整 SHA。
- [ ] Lane 9. 执行数据库恢复。Save `rel-06-db-restore.png`. Pass when 恢复库通过 verifier 且切换证据完整。
- [ ] Lane 10. 演练通知与升级。Save `rel-06-escalation.png`. Pass when 接收人、响应和升级时间都有记录。

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Detection delay, notification delay, and recovery duration.
- [ ] Probe. Trigger each alert in the approved test window and record timestamps.
- [ ] Baseline. Record the current on-call response target before the drills.
- [ ] Rule. A missed notification or recovery outside the approved target fails.

**Review gate.** The operator reviews alert screenshots and the rollback drill video before merge.

- [ ] operator 审阅 alert screenshot 和回滚 drill video。
- [ ] 保存每条 alert 的 screenshot。
- [ ] 录制回滚与恢复 video。

**Merge.**

- [ ] 告警接收人、升级路径和发布窗口均已获批。
- [ ] 回滚 evidence 绑定生产候选 SHA。

## Reject unknown import actors in PostgreSQL (REL-07)

**Depends on.** None.

**Outcome.** 新增导入批次无法在 actor 没有唯一 principal，或 principal 仍使用 `default` 租户时写入。

**Files.**

- [ ] `packages/database/overlays/0081_require_import_batch_principal.sql`
- [ ] `packages/database/migrations/0081_require_import_batch_principal.sql`
- [ ] migration generator、manifest、planner、verifier 和 contract guard
- [ ] planner、PG15 和 contract tests

**Build.**

- [x] 追加 `0081`，不改写已安装的 `0080` 字节。
- [x] 未知、空或 `default` 租户 principal 抛 SQLSTATE `ZA003` 和 detail `TENANT_BINDING_REQUIRED`。
- [x] 已知 principal 仍写入其真实 tenant。
- [x] 生成器、planner、verifier、inventory、ACL fingerprint 和架构说明同步到 81 段。

**You see.**

- [x] 未知 actor、null actor 和 `default` 租户 principal 的 INSERT 被拒绝。
- [x] 已绑定 principal 的 INSERT 成功。
- [x] 现有取消、发布和回退函数仍能解析新增触发器契约。

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [x] database unit 57 个用例通过。
- [x] generated migration check、ESLint 和 typecheck 通过。

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `inherit-parent` at the PR head, per the boot recipe.

- [x] Lane 1. PostgreSQL 15 完整迁移。Save `rel-07-pg15.png`. Pass when integration 103 个用例通过且 verifier 为 81 段。
- [ ] Lane 2. 在最终合流基线重跑。Save `rel-07-merged.png`. Pass when generated、unit 和 integration 全部通过。
- [ ] Lane 3. 在隔离生产恢复库插入未知 actor。Save `rel-07-unknown.png`. Pass when SQLSTATE 为 `ZA003` 且 detail 为 `TENANT_BINDING_REQUIRED`。
- [ ] Lane 4. 插入 null actor 和 `default` 租户 principal。Save `rel-07-null-default.png`. Pass when INSERT 被拒绝且不暴露 actor 值。
- [ ] Lane 5. 插入已知 principal。Save `rel-07-bound.png`. Pass when batch 写入真实 tenant。
- [ ] Lane 6. 检查历史数据。Save `rel-07-history.png`. Pass when迁移不自动改写历史 `default` 批次。
- [ ] Lane 7. 运行旧 release。Save `rel-07-old-release.png`. Pass when旧代码与新增触发器兼容或明确 fail-closed。
- [ ] Lane 8. 验证取消、发布和回退。Save `rel-07-workflows.png`. Pass when错误映射包含稳定 detail。
- [ ] Lane 9. 重复规划并破坏 `0081`。Save `rel-07-verifier.png`. Pass when已完成规划收敛，verifier 定位缺失或错误迁移。
- [ ] Lane 10. 检查 ACL、inventory 和失败副作用。Save `rel-07-fidelity.png`. Pass when fingerprint 一致且失败不留下 batch、binding 或 job。

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. N/A. The trigger adds one indexed lookup on an existing user identifier.
- [ ] Probe. N/A. REL-02 records end-to-end migration timing.
- [ ] Baseline. N/A. There is no prior user throughput contract for this write path.
- [ ] Rule. A missing indexed lookup plan or a sequential scan on the principal lookup fails.

**Review gate.** The operator reviews the PostgreSQL error screenshot and failure video before merge.

- [ ] 负责人确认历史数据盘点由 REL-01 单独完成，迁移不隐式改错活动批次。
- [ ] operator 审阅 `ZA003` error screenshot 和失败 video。
- [ ] 保存 `ZA003` 错误的 screenshot。
- [ ] 录制未知 actor 写入失败和回滚的 video。

**Merge.**

- [ ] 在 REL-03 最终候选构建前合流。
- [ ] 合流后用最终候选重跑 REL-02。

## Place backups and probes outside the primary fault domain (REL-08)

**Depends on.** External storage, alert recipients and named owners.

**Outcome.** 完整备份集和公网 readiness 探针能在杭州主机关机时独立工作。

**Files.**

- [ ] 仓外基础设施配置
- [ ] 异地恢复 evidence
- [ ] 独立 probe evidence

**Build.**

- [ ] 选择不同于杭州主机的存储目标。
- [ ] 配置加密、访问控制、保留期限和恢复责任人。
- [ ] 安装独立 probe 和告警接收链路。

**You see.**

- [ ] 主机关机后异地副本仍可读取，probe 能告警。
- [ ] 从异地副本恢复出的数据库通过完整 verifier。

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] 配置语法和权限检查通过。

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `inherit-parent` at the PR head, per the boot recipe.

- [ ] Lane 1. 验证异地目标与主机故障域。Save `rel-08-fault-domain.png`. Pass when storage identity is independent from杭州主机。
- [ ] Lane 2. 复制完整备份集。Save `rel-08-copy.png`. Pass when异地副本 ID、对象集和 receipt 与来源一致。
- [ ] Lane 3. 检查加密和访问控制。Save `rel-08-access.png`. Pass when只有获批身份可读且内容已加密。
- [ ] Lane 4. 检查保留策略。Save `rel-08-retention.png`. Pass when保留期限和责任人已记录。
- [ ] Lane 5. 从异地副本恢复 PG15。Save `rel-08-restore.png`. Pass when完整 verifier 通过。
- [ ] Lane 6. 核对 RPO。Save `rel-08-rpo.png`. Pass when副本 age 和文件时间满足负责人批准值。
- [ ] Lane 7. 停止探针目标。Save `rel-08-probe-down.png`. Pass when independent probe发出告警。
- [ ] Lane 8. 恢复探针目标。Save `rel-08-probe-recovery.png`. Pass when告警解除且 readiness 恢复。
- [ ] Lane 9. 验证告警接收人。Save `rel-08-alert-routing.png`. Pass when designated recipient收到通知并记录响应。
- [ ] Lane 10. 验证恢复负责人。Save `rel-08-owner.png`. Pass when恢复操作和签收都绑定具名负责人。

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Copy lag, recovery duration, and alert delay.
- [ ] Probe. Run the offsite copy and restore drill on the approved schedule.
- [ ] Baseline. Record the first complete drill before setting production thresholds.
- [ ] Rule. A value outside the owner-approved RPO or RTO fails.

**Review gate.** The operator reviews the offsite restore screenshot and probe alert video before merge.

- [ ] operator 审阅异地恢复 screenshot 和 probe alert video。
- [ ] 保存异地恢复 evidence 的 screenshot。
- [ ] 录制 probe 失联、告警和恢复 video。

**Merge.**

- [ ] 存储、安全和运维负责人共同签收。
- [ ] 异地副本和 probe 的负责人姓名进入受控 evidence。

## Close the program

- [ ] 每张任务卡的复选框都有绑定候选 SHA、输入和环境的证据。
- [ ] 独立审查发现全部关闭，未关闭项明确保留。
- [ ] `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`、database integration、backup integration、workspace check 和 docs check 在最终集成 SHA 上通过。
- [ ] 最终候选绑定 `0.3.43`、完整 Git SHA 和 81 段 migration catalogue。
- [ ] 生产部署授权、真实内容、身份和设备负责人分别明确。
- [ ] 汇报区分本地实现、PR 就绪、已合并、部署验证、业务验收和发布验证。

## Appendix A. Prototype evidence

- 生产租户预检脚本单元测试 8 个通过。
- 生产租户预检 PostgreSQL 15 集成测试 1 个通过。
- 备份消费与候选输入单元测试 17 个通过。
- 备份恢复预演从 79 段前进到 81 段，PostgreSQL 15 实测 1 个通过。
- release preflight 单元测试 11 个通过。
- 集成工作树的 migration generated check 显示 81 段。
- TLA+ 租户发布、合成栈和发布取消并发模型通过，负向控制能发现错误。该证据不替代数据库恢复与生产验收。

## Appendix B. Rejected alternatives

- 手写 SQL 盘点生产租户。命令难复现，输出口径会漂移，因此改为只读 CLI。
- 直接把历史活动 `default` 批次改写成某个 tenant。缺少负责人和业务证据，可能改变事实，因此先只读阻断并由负责人处置。
- 继续依赖进程内 actor 检查。数据库仍允许错误状态，因此追加 `0081` 强制不变量。
- 复用 `0.3.42` 的产物并只改健康检查字符串。版本和构建身份会与真实代码分离，因此升级到 `0.3.43`。
- 在本机同目录复制备份。该副本不能覆盖整机或磁盘故障，因此异地目标进入 REL-08。

## Appendix C. Risks

- 生产活动批次数量和历史 `default` 数量未知。REL-01 的隔离副本结果决定是否需要先取消、完成或人工回填。
- `0081` 可能使仍绕过 principal 的旧入口失败。必须先在测试栈验证所有实际入口。
- 真实备份总大小和恢复耗时尚不知道。REL-02 的实测结果决定发布窗口。
- 生产 root 依赖 Git 元数据验证候选 SHA。部署流程必须保留候选 release 的 `.git`，或在 REL-04 中增加等价签名清单。
- 当前没有独立故障域备份，也没有独立外部告警确认。
- 真实 Windows 客户端、身份、内容和业务验收尚未执行。

## Appendix D. Links

- [工程工作流程](../reference-engineering-workflow.md)
- [项目架构与目录边界](../reference-project-architecture.md)
- [杭州后端运行](../how-to-run-backend-on-hangzhou.md)
- [备份集与恢复验证](../how-to-verify-backup-set.md)
- [数据库角色与连接](../reference-database-roles-and-connection.md)
- [桌面验证](../how-to-verify-desktop.md)
