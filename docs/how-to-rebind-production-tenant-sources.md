# 为合成试点发布重绑来源租户

`scripts/ops/production-tenant-source-rebind.mjs` 修复历史合成来源仍使用 `default` 租户、而当前 release 已使用显式租户的状态。它不修改正文、不删除旧 release，也不改写 immutable source history。工具会创建新的租户来源版本，复制当前 release 的 408 条单审发布项、release catalog、公告及已有来源与回滚谱系，然后原子切换 `content_current`。

该工具只接受以下状态：

- 当前 release 是 `published`，且 release 租户等于 `--tenant`。
- 当前 release 由合成试点 owner 发布。
- 当前 release 恰有四个 `srcv_stack_*` 来源。
- 四个来源都由 `synthetic-owner` 批准，且全部仍为 `default`。
- 发布项全部是 `single` 审查模式。
- 当前 release 没有 `content_intake.publications` 或 `content_intake.release_revocations`。
- 恢复 evidence 是 `PASS`，候选版本与本仓 `VERSION` 一致，来源验证、对象和元数据保真度均为 `PASS`，临时集群已清理。

任何真实来源、混合租户、owner acceptance、双审内容或非当前 release 都会被拒绝。这个限制用于避免把通用租户放宽或伪造业务批准。

Apply 必须指向当前 release。只有重绑已经完成时，当前 release 的回滚父版本才可作为幂等重试别名。短期的 offline entitlement 与 lease 不复制到新 release；它们继续绑定旧 release 并按原期限失效，新请求在切换后对新的 current 签发。

## Dry-run

```sh
node /srv/customer-agent/releases/<candidate-sha>/scripts/ops/production-tenant-source-rebind.mjs \
  --environment production \
  --stack-root /srv/customer-agent/stack \
  --release-id rel_27 \
  --tenant tenant-menokin \
  --backup-evidence /srv/customer-agent/catalog-backups/restore-drills/<evidence>.json
```

输出包含源到新源版本的映射、当前发布项数、预计新 release ID、catalog、公告、来源谱系和回滚谱系数量。Dry-run 在只读事务中运行，不分配 release sequence。

## Apply

```sh
node /srv/customer-agent/releases/<candidate-sha>/scripts/ops/production-tenant-source-rebind.mjs \
  --environment production \
  --stack-root /srv/customer-agent/stack \
  --release-id rel_27 \
  --tenant tenant-menokin \
  --backup-evidence /srv/customer-agent/catalog-backups/restore-drills/<evidence>.json \
  --apply \
  --authorization rel_27:tenant-menokin:<backup-id>
```

Apply 使用 serializable transaction、发布 advisory lock、`content_current` 行锁、`lock_timeout` 和 `statement_timeout`。任一步失败都会回滚整个事务。提交后以新的 current release 重跑会返回 `already-ready`；使用它的回滚父版本重试也会识别已经完成，但父版本不能用于首次写入。

## 完成后核对

```sh
node /srv/customer-agent/releases/<candidate-sha>/scripts/ops/production-intake-tenancy.mjs \
  --stack-root /srv/customer-agent/stack

node /srv/customer-agent/releases/<candidate-sha>/scripts/ops/production-consistency.mjs --help
```

租户预检只能报告 `ready` 且阻断码为空。随后重新运行生产 smoke、候选恢复 evidence 和生产切换 dry-run。旧 release 保持 `superseded`，数据库恢复仍使用事先验证并绑定的完整备份。
