# 验证备份集

适用实现与恢复边界见[备份与恢复演练](reference-backup-and-restore.md)。先使用合成 PG15 验证，再在已授权的受控环境对真实库做只读备份与隔离恢复。真实备份和业务文件不得复制进产品仓。

## 合成验证

使用项目 Node.js 24 和锁定的 pnpm。指定已安装 PostgreSQL 15 的 bin 目录。

```sh
export CUSTOMER_AGENT_PG15_BIN=/absolute/path/to/postgresql15/bin
pnpm test:backup:integration
```

该命令先构建数据库运行模块，再分别以迁移 75、76、77 前缀和当前完整目录运行真实 PG15 备份与 full restore。它还验证并发备份被拒绝、失败后释放锁，以及进程被强制终止后可以重新备份。普通归档、校验和保留策略用例随 `pnpm test:workflow` 执行。测试通过不等于生产演练通过。

## 受控备份

以可读取既有 stack profile、Unix socket 和对象目录的服务用户执行。不要使用 root 运行临时 PostgreSQL。以下是配置示例，路径须指向已核对的现有部署和受控备份目录。

```sh
export CUSTOMER_AGENT_STACK_ROOT=/srv/customer-agent/stack
export CUSTOMER_AGENT_BACKUP_ROOT=/srv/customer-agent/catalog-backups
export CUSTOMER_AGENT_PG15_BIN=/usr/lib/postgresql/15/bin
export CUSTOMER_AGENT_BACKUP_KEEP=14
export CUSTOMER_AGENT_BACKUP_COPY_TO=/mnt/c/customer-agent-backups
export CUSTOMER_AGENT_BACKUP_COPY_SCOPE=same-host
/srv/customer-agent/current/scripts/ops/customer-agent-backup.sh
```

没有副本时退出 3，仍会保留完整本地备份集。不要为得到退出 0 将同机目录标成 `offsite`。副本不可写或校验失败时退出 1，历史备份不被修剪。

默认产品版本取工具所在发布目录的 `VERSION`。Git SHA 优先取 `CUSTOMER_AGENT_BACKUP_GIT_SHA`，其次取版本匹配的 `apps/desktop/build/build-identity.json`；两者都没有时记录为 null，不执行 `git rev-parse`。正式备份应核对并记录实际应用 SHA。使用独立审查工具对既有生产备份时，必须显式填写经过核对的 `CUSTOMER_AGENT_BACKUP_PRODUCT_VERSION` 与 `CUSTOMER_AGENT_BACKUP_GIT_SHA`，避免把工具候选版本误记为生产应用版本。工具指纹单独记录。

## 校验和恢复

从备份日志取得本次完整备份集路径，不猜最新文件名。以下变量代表实际生成的目录。

```sh
backup_set=/absolute/path/to/catalog-backups/backup-sets/actual-backup-id
node scripts/ops/backup-set.mjs verify "$backup_set"
CUSTOMER_AGENT_RESTORE_EVIDENCE_FILE=/controlled/path/restore-evidence.json   scripts/ops/customer-agent-restore-drill.sh "$backup_set"
```

恢复默认停止并清理它自己创建的临时集群。只有诊断需要时才设置 `CUSTOMER_AGENT_BACKUP_KEEP_SCRATCH_FOR_REVIEW=1`，随后按证据中的精确路径人工核查并清理，不能清理其他集群。

核对证据中的 `status`、`verifierStatus`、迁移数、对象数、receipt 数、RPO、恢复耗时和 `scratchCleaned`。必须读取实际证据，不只看 shell 退出码。角色口令与服务环境配置另行恢复，应用启动、登录、查询、权限撤销和对象消费应继续在隔离环境验收。

## 迁移旧定时任务

脚本与 `backup-set.mjs`、编译后的数据库模块必须来自同一候选。新版 service 从 `current/scripts/ops/` 运行；仅复制 shell 到旧 `/srv/customer-agent/scripts/` 会缺少模块。核对 Node.js 24、PG15 路径、EnvironmentFile 和 `ReadWritePaths`，再按已批准发布流程安装单元并执行一次完整演练。

旧 `nightly/` dump 与部署回滚目录不受新保留策略管理，不因启用新脚本而删除。真实异地目的地、加密和保管责任须在正式容灾验收中明确。
