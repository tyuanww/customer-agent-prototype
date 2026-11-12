# 在生产环境切换完整候选

`scripts/ops/customer-agent-production-release.mjs` 是生产切换的单写者入口。它只消费已经构建、已恢复预演并绑定完整 SHA 的 release 目录，不在切换过程中拉代码或安装依赖。

## 输入

- `--sha`：候选完整 40 位 Git SHA，目录必须位于 `<root>/releases/<sha>`，Git `HEAD` 必须等于目录名，tracked 文件必须干净。
- `--expected-version`：必须与 release 根 `VERSION` 和 `apps/desktop/package.json` 一致。
- `--backup-evidence`：带 `--rollback-release` 的恢复预演证据。数据库保真、候选 runtime 和各迁移前缀的回退检查均须通过，候选与回退 SHA 必须对应本次发布。
- `--tenant-report`：只读租户预检产出的 JSON。必须是 `ready`，且阻断码为空。
- `profile.json`：生产环境使用 `environment=production`、库 `customer_agent_formal` 和现有 stack root。
- `api.env`：必须是 `0600` 普通文件，并且只包含一个 `CUSTOMER_AGENT_BUILD_VERSION`。

显式使用 `CUSTOMER_AGENT_QUERY_MODE=intake-compat` 的候选需要 v2 恢复证据。恢复预演传入同一 `--candidate-stack-root`，部署入口复核查询模式和配置摘要，并在重启后检查 `x-customer-agent-query-mode`。当前旧回退版本若拒绝追加迁移，发布保持阻塞，待完整恢复路径完成验收。

## 固定控制器与完整配置切换

`--controller-release` 启用 v3 预检。v3 发布及恢复命令从固定控制器目录执行。控制器使用独立目录，例如 `<root>/controllers/<controller-sha>`，目录名固定为已验证的完整 Git SHA，其 `stack.ts` 负责既有数据库证明、子进程监督和清理。systemd 的应用参数使用 `--runtime-release <root>/current`。控制器启动采用 `start --existing-database --foreground`，要求已有 profile、PG 集群和数据库，读取实际完整账本及物理前缀后再启动应用。应用自带迁移目录规定其最低 schema，尚缺前驱时在启动子进程前拒绝。该入口跳过迁移、fixture、测试授权、身份重绑及 profile 重写。

```sh
/usr/bin/node /controlled/releases/<controller-sha>/scripts/synthetic-stack/stack.ts \
  start --existing-database --foreground \
  --runtime-release /controlled/current
```

unit 使用 `Type=simple` 或 `Type=exec`，`Restart=on-failure` 或 `Restart=always`。准入核对完整 ExecStart、stack root、环境文件摘要以及实际主进程 argv。恢复前可以凭受锁 journal 校验 failed 服务的声明，恢复后必须再次核验 active 主进程。`api.env` 的字节归发布器备份与安装绑定，其他 unit 环境文件继续逐字节绑定。

证据目录必须归发布器有效用户所有且权限为 `0700`；上级目录及符号链接必须由 root 或发布器拥有，上级目录不得允许其他用户改写，受信任的 sticky 目录除外。检查失败时停止，不自动修改已有目录权限。备份保留服务账号的文件所有权，因此必须依靠该私有目录阻止服务账号改写备份。

完整模式切换额外提供 `--candidate-api-env /controlled/private/candidate.env`。该文件须为有界、owner 可读且仅 owner 有权限的普通文件，所有字节参与预检。候选和原配置各自经过对应 release 的 stack parser。发布器先持久化完整原配置备份和 journal，再应用完整候选迁移、原子安装候选配置、切换指针并重启。只提供控制器时保留既有构建版本更新路径。

v3 将控制器的物理前缀证明、应用 API 就绪与协议解码能力分别记录。应用业务消费与 worker 接管仍需实际回归。旧 `3519d486` 在新 SOP 发布后出现资格校验失败与旧快照混入 SOP 正文，无法作为该数据状态的已验证回退基线。先建立经过正常业务链验证的兼容应用基线，再执行 v3 代码升级。旧库首次迁移的维护与恢复验收继续单独保留。

未完成的 v3 journal 优先进入恢复检查。候选构建、候选配置或外部预检文件损坏后，恢复使用 journal、固定控制器、完整旧应用、原配置备份与实际已提交前缀。未知指针、漂移前缀、损坏控制器或旧应用均拒绝恢复。恢复成功须读回旧配置、实际服务启动和 readiness，之后才记录 `rolled_back`。已提交 schema 与当前数据继续由数据库拥有。

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
  --controller-release <test-controller-release> \
  --candidate-api-env <private-candidate-env> \
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
| `MIGRATION_PREFIX_MISMATCH` | 当前和候选迁移目录的对应项不一致 |
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
