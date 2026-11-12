# 在生产环境切换完整候选

`scripts/ops/customer-agent-production-release.mjs` 是生产切换的单写者入口。它只消费已经构建、已恢复预演并绑定完整 SHA 的 release 目录，不在切换过程中拉代码或安装依赖。

## 输入

- `--sha`：候选完整 40 位 Git SHA，目录必须位于 `<root>/releases/<sha>`，Git `HEAD` 必须等于目录名，tracked 文件必须干净。
- `--expected-version`：必须与 release 根 `VERSION` 和 `apps/desktop/package.json` 一致。
- `--backup-evidence`：带 `--rollback-release` 的恢复预演证据。数据库保真、候选 runtime 和各迁移前缀的回退检查均须通过，候选与回退 SHA 必须对应本次发布。
- `--tenant-report`：只读租户预检产出的 JSON。必须是 `ready`，且阻断码为空。
- `profile.json`：生产环境使用 `environment=production`、库 `customer_agent_formal` 和现有 stack root。
- `api.env`：必须是 `0600` 普通文件，并且只包含一个 `CUSTOMER_AGENT_BUILD_VERSION`。

生产 root 固定为 `/srv/customer-agent`。生产 apply 还要求 `--authorization` 或 `CUSTOMER_AGENT_PRODUCTION_RELEASE_APPROVAL` 等于完整候选 SHA。

生产 apply 必须以 root 身份运行，因为入口需要重启 systemd unit。非 root 会在创建部署锁、应用迁移或写指针之前以 `DEPLOYMENT_PRIVILEGE_REQUIRED` 退出。只读 dry-run 可以由服务用户执行。候选和历史 release 的 Git 安全目录由入口按实际路径临时注入，不需要修改 root 的全局 Git 配置。

## 生产 dry-run

先保存当前指针、服务状态、最新备份 ID、恢复 evidence 和租户报告，再运行：

```sh
node /srv/customer-agent/releases/<candidate-sha>/scripts/ops/customer-agent-production-release.mjs \
  --root /srv/customer-agent \
  --stack-root /srv/customer-agent/stack \
  --sha <candidate-sha> \
  --expected-version 0.3.43 \
  --backup-evidence /controlled/evidence/candidate-restore.json \
  --tenant-report /controlled/evidence/tenant-ready.json
```

默认是 dry-run，不迁移、不写部署锁或状态文件、不写 `api.env`、不切换 `current`、不重启服务。它仍会读取生产数据库，确认当前服务 ready，并重新执行实时租户快照；输入的租户报告必须与该快照逐项一致。输出列出当前和候选 SHA、版本、回滚版本、备份 ID、待执行迁移及是否会改指针。

## 生产 apply

只在批准的维护窗口内执行：

```sh
node /srv/customer-agent/releases/<candidate-sha>/scripts/ops/customer-agent-production-release.mjs \
  --root /srv/customer-agent \
  --stack-root /srv/customer-agent/stack \
  --sha <candidate-sha> \
  --expected-version 0.3.43 \
  --backup-evidence /controlled/evidence/candidate-restore.json \
  --tenant-report /controlled/evidence/tenant-ready.json \
  --apply \
  --authorization <candidate-sha>
```

默认部署锁是 `/srv/customer-agent/deploy.lock`。第二个实例会在任何写入前以 `DEPLOYMENT_LOCKED` 退出。同一主机上锁记录指向已不存在进程时会通过独立 recovery guard 回收一次；活进程、跨主机、冲突或不可读的锁都要求人工检查。

执行顺序固定为：

1. 验证候选 Git、版本、数据库构建与源码重建一致、迁移前缀、备份 evidence、生产 profile 和当前服务 readiness。
2. 重新执行实时租户快照，并要求它与传入报告一致。
3. 确认数据库账本等于回滚 release 或候选 release，重建核对 runtime 产物，并核对预检绑定的当前内容指针、来源门禁和范围指纹。
4. 在 `release-evidence/deployment-state.json` 持久化旧指针、旧版本、候选、备份 ID 和阶段。
5. 用候选自带数据库模块应用追加迁移并运行候选 verifier。
6. 先把原 `api.env` 备份放入 0600 evidence，再把备份索引写入部署状态，最后原子更新构建版本。
7. 原子替换 `current`。
8. 重启 `customer-agent-stack.service`。
9. 同时等待 `/health` 报告候选版本、`/ready` 的五个依赖检查全部 `ok`。

任一步失败都会停止。迁移失败后，入口先确认回退版本能读取实际账本并通过数据库 verifier，再恢复指针和配置。已经进入服务重启阶段时会重启回退版本；每次回退均检查服务 readiness，成功后才记录 `rolled_back`。进程被 SIGKILL 后重试会复用同一状态和原 env 备份；如果上次停在 rollback，下一次 apply 会先完成回滚。兼容检查或 readiness 失败时以 `ROLLBACK_FAILED` 停止并保留现场。

数据库迁移已经提交后，代码回滚不会撤销 schema。需要回退 schema 时必须使用已验证的完整备份恢复，不能改写迁移账本。

`RELEASE_PREFLIGHT_REQUIRED` 表示缺少绑定本次发布的完整预检。`CANDIDATE_RUNTIME_NOT_READY` 表示候选无法加载恢复后的目录。`ROLLBACK_INCOMPATIBLE` 表示回退版本不能读取至少一个可能提交的迁移前缀。`RELEASE_RUNTIME_BUILD_CHANGED` 表示 runtime 产物与预检不一致。`RELEASE_PREFLIGHT_STALE` 表示预检后的内容指针、来源门禁或范围发生变化，需要重新预演。上述检查在 live 迁移之前执行。

应用迁移的数据库会话按既有顺序取得内容发布锁，并在锁内重查指纹。该会话持锁到迁移及其 verifier 完成，随后释放。来源撤销和内容发布通过同一锁与迁移串行。

候选迁移目录与当前目录逐项相同时，可以发布新的代码版本。较短目录或任意来源、校验和变化继续被拒绝。

## 测试环境

测试环境必须使用独立 release root、stack root、数据库、端口和测试 unit：

```sh
node <test-candidate-release>/scripts/ops/customer-agent-production-release.mjs \
  --environment test \
  --root /srv/customer-agent/test-rollout-root \
  --stack-root /srv/customer-agent/test-stack \
  --sha <candidate-sha> \
  --expected-version 0.3.43 \
  --backup-evidence <test-restore-evidence> \
  --tenant-report <test-tenant-report> \
  --unit customer-agent-test-stack.service \
  --apply
```

测试模式拒绝生产 profile 和 `customer_agent_formal`。生产模式拒绝其他 root。测试结束后核对测试端口停止、生产端口仍正常，再按测试留存策略清理 release。

## 审计

apply 的默认审计文件是 `<root>/release-evidence/production-release.jsonl`，部署状态是 `<root>/release-evidence/deployment-state.json`，权限均为 `0600`；dry-run 只把事件随计划输出，不落盘。状态和审计只包含路径、完整 SHA、版本、阶段、计数和备份 ID，不记录 env 内容、数据库连接串、客户正文、身份明细或凭据。成功部署后保留状态以支持同一候选的回滚；下一次成功切换使用新候选状态覆盖它。

## 失败分类

| code | 含义 |
| --- | --- |
| `INVALID_ARGUMENTS` | 路径、SHA、版本、unit 或 environment 无效 |
| `RELEASE_NOT_AUTHORIZED` | 生产 apply 的授权 SHA 不匹配 |
| `DEPLOYMENT_PRIVILEGE_REQUIRED` | apply 不是以 root 运行，无法安全重启 systemd unit |
| `DEPLOYMENT_LOCKED` | 另一个部署持有锁 |
| `RELEASE_*` | 候选目录、Git、版本或入口无效 |
| `MIGRATION_PREFIX_MISMATCH` | 当前和候选迁移目录不是严格前缀 |
| `BACKUP_EVIDENCE_INVALID` | 恢复 evidence 不覆盖该候选 |
| `TENANT_REPORT_INVALID` | 租户预检未 ready |
| `TENANT_REPORT_STALE` | 传入的 ready 报告与当前数据库聚合不一致 |
| `TENANT_CHECK_FAILED` | 无法完成实时只读租户检查 |
| `DATABASE_PREFIX_MISMATCH` | 生产数据库不等于当前或候选迁移账本 |
| `DATABASE_MIGRATION_APPLY_INVALID` | 候选迁移未到达精确目录 |
| `DATABASE_VERIFIER_FAILED` | 候选 verifier 未接受迁移后的数据库 |
| `DEPLOYMENT_STATE_CONFLICT` | 另一个候选仍有未完成部署状态 |
| `ROLLBACK_RECOVERY_REQUIRED` | 检测到未完成回滚，需要执行 apply 完成恢复 |
| `READINESS_FAILED` | 候选或回滚版本未在时限内 ready |
| `ROLLBACK_FAILED` | 回滚后的服务仍未 ready，需要停止并人工恢复 |
