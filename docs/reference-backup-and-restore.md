# 备份与恢复演练

生产目录库的每夜逻辑备份，以及把备份还原回空库的演练。脚本在 `scripts/ops/`，systemd 单元与它们同目录。

## 组成

| 文件 | 作用 |
| --- | --- |
| `scripts/ops/customer-agent-backup.sh` | `pg_dump` 全量（schema + data）自定义格式，应用保留策略，可选异地副本 |
| `scripts/ops/customer-agent-backup.service` | oneshot 运行上面的脚本 |
| `scripts/ops/customer-agent-backup.timer` | 每日 03:20 触发，`Persistent=true` |
| `scripts/ops/customer-agent-restore-drill.sh` | 把一份 dump 还原进临时库并核对账本 |

## 为什么是全量而不是 `--data-only`

一份备份必须能单独还原进空库。`--data-only` 归档还需要 `--disable-triggers`（`query_events` 与 `content_releases` 之间有循环外键），那是每个还原者都要重新记一遍的坑。全量 dump 没有这个问题，代价是文件大一些。

## 退出码

| 码 | 含义 |
| --- | --- |
| 0 | dump 成功、保留策略已应用、异地副本成功 |
| 3 | dump 成功、保留策略已应用、**没有配置异地副本** |
| 1 | dump 或保留策略失败 |

`SuccessExitStatus=0 3`：3 表示「备份只在同一块盘上」，这是真实缺口，必须留在日志和退出码里；但如果单元每晚读作 `failed`，所有人都会开始忽略它。

## 保留策略

保留最近 `CUSTOMER_AGENT_BACKUP_KEEP`（默认 14）份。规则：

- 只在 dump 成功后修剪，失败的一晚不会把历史清空；
- 永不删除最新的一份；
- 文件名是 `<db>-<YYYYMMDDTHHMMSSZ>-<NNN>.dump`，固定宽度的序号让字典序等于时间序。同一秒内跑两次会得到 `-001` 和 `-002`，不会互相覆盖。

## 异地副本

`CUSTOMER_AGENT_BACKUP_COPY_TO` 是副本目录。脚本在 `scripts/ops/customer-agent-backup.sh`。变量为空时，脚本写下面这一行，然后退出 3。

```text
offsite copy: NOT CONFIGURED (set CUSTOMER_AGENT_BACKUP_COPY_TO); this backup exists on one disk only
```

2026-10-25 选定的副本路径是 `/mnt/c/customer-agent-backups`。这是 Windows 的 C 盘，经 WSL 挂到这个路径。选定这个路径，是为了躲开 WSL 虚拟磁盘被换掉。整块系统盘损坏时，这份副本一起丢。

2026-10-27 杭州单元把 `CUSTOMER_AGENT_BACKUP_COPY_TO` 设为 `/mnt/c/customer-agent-backups`。操作者接受副本和数据库在同一台 Windows 机器上。当天备份退出码是 0。恢复演练打印 `DRILL PASSED`。生产库没有被这次演练改写。`/mnt/c` 上的文件权限是 `rwxrwxrwx`。

仓库里的 `scripts/ops/customer-agent-backup.service` 有 `ProtectSystem=strict`。没写进 `ReadWritePaths` 的路径，服务写不进去。杭州现在的 drop-in 是 `customer-agent-backup.service.d/offsite.conf`。

```ini
[Service]
Environment=CUSTOMER_AGENT_BACKUP_ROOT=/srv/customer-agent/catalog-backups
Environment=CUSTOMER_AGENT_BACKUP_COPY_TO=/mnt/c/customer-agent-backups
ReadWritePaths=/srv/customer-agent/catalog-backups
ReadWritePaths=/mnt/c/customer-agent-backups
```

服务用户是 `customer-agent`。脚本会对副本目录执行 `mkdir -p`。路径不可写时，副本失败。上面这段是 2026-10-27 写入杭州的 drop-in。

## 杭州机器上的实际安装（2026-10-24 已执行）

备份根没有放在 `/srv/customer-agent/backups`：那个目录是 `root:root 0750`，被部署回滚产物占用，`customer-agent` 连进入都不行。改用独立目录，既有权限一位未动。

```text
/srv/customer-agent/catalog-backups/             customer-agent 0750
  nightly/                                       每日 dump，保留 14 份
  offsite/                                       副本（同一台机器的另一目录，暂代异地）

/srv/customer-agent/scripts/customer-agent-backup.sh          root 0755
/srv/customer-agent/scripts/customer-agent-restore-drill.sh    root 0755
/etc/systemd/system/customer-agent-backup.service             root 0644
/etc/systemd/system/customer-agent-backup.timer               root 0644
/etc/systemd/system/customer-agent-backup.service.d/offsite.conf
```

drop-in 的内容：

```ini
[Service]
Environment=CUSTOMER_AGENT_BACKUP_ROOT=/srv/customer-agent/catalog-backups
Environment=CUSTOMER_AGENT_BACKUP_COPY_TO=/srv/customer-agent/catalog-backups/offsite
ReadWritePaths=/srv/customer-agent/catalog-backups
```

`ReadWritePaths` 必须显式加上：单元文件里的 `ProtectSystem=strict` 让整个 `/srv` 只读，先前的写入路径指向旧目录，`pg_dump` 会以 `Read-only file system` 失败。这一条是首次 `systemctl start` 的 journal 才暴露的。

`Customer-agent` 读 `/srv/customer-agent/stack`（socket 与 `content.env`）由单元里的 `ReadOnlyPaths` 提供，不需要额外权限。

### 首次真实运行

```text
2026-10-23T17:37:29Z dump start database=customer_agent_formal target=.../nightly/customer_agent_formal-20261023T173729Z-001.dump
2026-10-23T17:37:30Z dump done bytes=7355299
2026-10-23T17:37:30Z retention keep=14 total_before=1 removed=0
2026-10-23T17:37:30Z offsite copy done destination=.../offsite
Result=success  ExecMainStatus=0
```

timer 已 enable，下一次 03:23（`OnCalendar` 03:20 + `RandomizedDelaySec`）。

### 第一次演练失败，以及它带出的问题

第一次失败在 `commit_tickets` 的 3 行孤儿（已按授权清理，导出留档）。清理后演练前进到下一处：
`entitlement_contexts` / `entitlement_scopes` / `grant_history` / `publications` / `quality_*` /
`release_lineage` / `intake_organization.*` 共 15 条外键同样被标为 `convalidated = true`
却存在孤儿行，约 117 行。

这里选择不删数据，而是把 15 条约束改成 `NOT VALID`（迁移 `0065`），理由是那些行是审计证据。
取证、根因与三个方案的取舍见[恢复完整性发现](reports/2026-10-24-restore-integrity-finding.md)。

第一次失败现场（`commit_tickets`，5 行中 3 行孤儿）：

```text
ready before drill: 200
pg_restore: error: could not execute query: ERROR: insert or update on table "commit_tickets"
  violates foreign key constraint "commit_tickets_actor_id_action_operation_id_fkey"
  DETAIL: Key (actor_id, action, operation_id)=(hz-publisher, publish, hz-publish-upl00001)
  is not present in table "write_attempts".
FAIL pg_restore reported an error
```

### 第二次演练：通过

`0065` 部署后（生产账本 64 → 65），同一份脚本第一次打印 `DRILL PASSED`：

```text
PASS dump replayed into an empty database
ledger live='65 0065_legacy_orphan_fk_not_valid' restored='65 0065_legacy_orphan_fk_not_valid'
table count live=121 restored=121
grant rows live=42 restored=42
ready after drill: 200
DRILL PASSED dump=customer_agent_formal-20261023T184219Z-001.dump
```

要点是**备份自身没有变过**。dump 一直能写；不能还原的原因始终是数据违反了数据库自称成立的约束。

## 相关

## 演练脚本的判定

`customer-agent-restore-drill.sh` 创建 `customer_agent_restore_drill` 临时库，还原，比对，然后删库。比对四项：

1. 还原无错误；
2. 迁移账本 `count(*)` 与 `max(migration_id)` 与生产一致；
3. `information_schema.tables` 计数一致；
4. `content_intake.grants` 行数一致 —— 这一项最能暴露「schema 回来了但数据没回来」。

结束时 `trap` 删库；`CUSTOMER_AGENT_DRILL_KEEP=1` 会保留临时库供人工查看。

`/ready` 检查的做法是**比对演练前后**，而不是假定 200。这样在纯集群上（没有 API）也能跑，同时仍能抓出「演练把生产弄坏了」。生产上演练前应已是 200。

## 已验证与未验证

已在 macOS 上用真实 PostgreSQL 15 集群跑通（一次性集群，64 迁移、121 表、1 条造出来的授权行）：

- 无异地配置 → 退出 3；
- 有异地配置 → 退出 0；
- `KEEP=3` 连续 6 次 → 保留 3 份，最旧的被删；
- 同一秒两次 → `-001`、`-002` 并存；
- 演练 → `DRILL PASSED`，账本 `64 0064_roster_query_requires_reader` 两侧一致，表 121 对 121，授权行 1 对 1；
- 故意损坏的 dump → `FAIL`，退出 1，临时库被清掉。

已在杭州生产机验证：

- timer 已 enable 并按计划运行；
- 备份 `Result=success / ExecMainStatus=0`，dump 约 7.36 MB，副本已写出；
- 第一次演练**失败**，原因是生产库自身的孤儿行（见上一节），临时库已被 `trap` 清理干净（`pg_database` 查不到 `customer_agent_restore_drill`）；
- 每次演练前后 `/ready` 都是 200，演练没有扰动线上服务；
- `0065` 部署后演练**通过**：账本 65 两侧一致、表 121 对 121、授权行 42 对 42、`DRILL PASSED`。

**未验证：**

- 异地副本仍是同一台机器的另一个目录，与源盘共命运；真异地（另一块盘或另一台机器）没做。
- 还原后的库没有跑迁移 verifier，也没有让应用对着它启动。
- 保留策略的 14 天滚动只在本地用 `KEEP=3` 演练过，没有在生产上等满 14 天。
- 备份文件没有加密，也没有校验和清单；能否还原完全依赖 `pg_restore` 读得动。

## 相关

- [在杭州机器上运行后端](how-to-run-backend-on-hangzhou.md)
- [职位名单权限模型](reference-job-roster-permission-model.md)
