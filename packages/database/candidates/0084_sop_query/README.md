# SOP 查询候选

这是第 83 号正式迁移之后的**独立测试候选**。它不在正式 migration manifest 中，也不由 `server.ts` 安装或注册。冻结批准仍是 `runnableMigration=false`、`runtimeActivated=false`。

`generate.mjs` 校验冻结合同，复用现有 `renderUpgradeMigration`，把冻结 storage 和本目录 `read.sql` 合成 `candidate.generated.sql`。`manifest.generated.json` 绑定实际 0083 前序及生成字节哈希。修改源后运行：

```sh
node packages/database/candidates/0084_sop_query/generate.mjs
node packages/database/candidates/0084_sop_query/generate.mjs --check
```

`casefold-unicode16.json` 是 Python `unicodedata` 16.0.0 的完整默认 casefold 差异表。生成方式为遍历 `range(0x110000)`，保留 `chr(i).casefold() != chr(i)` 的键值。SQL 使用 PostgreSQL NFKC 后逐字符折叠，避免数据库 locale 改变匹配结果。原文不做归一化。

`install.test-only.ts` 要求显式环境开关、PG15、Unix socket、`gate_owner` 和 harness 的临时数据库命名。安装前复核完整正式 migration 状态和 0083 receipt，安装在一个事务中完成。不给 runtime 图表读写权，`intake_usage` 仅得到受权读取函数；直接签发租约不开放。

## 真实 PG 与 HTTP

仓库根目录运行：

```sh
pnpm build:services
CUSTOMER_AGENT_SOP_QUERY_CANDIDATE=1 pnpm --filter @customer-agent/api exec vitest run tests/sop-query-postgres.integration.test.ts
CUSTOMER_AGENT_SOP_QUERY_CANDIDATE=1 node scripts/intake-synthetic/sop-query-host.ts
```

最后一个命令常驻，输出 `apiOrigin`、独立相邻端口的 `identityOrigin` 和 `contractSetId`，不输出 token。SIGINT/SIGTERM 关闭 HTTP、连接池和临时 PG，删除自己的临时集群。它不接收数据库连接串。

进程内可导入 `apps/api/tests/support/sop-query-synthetic-host.ts` 的 `createSopQuerySyntheticHost()`。默认返回已发布合成图；`{ initial: 'empty' }` 保留空目录。宿主有真实登录入口，测试可用 `login()` 获取一次产品会话，再调用 HTTP。`publishFixture(releaseId)` 切换合成 release，`revokeQuery()` 撤销父查询授权，`close()` 清理。`admin` 和 `pool` 只供同进程测试，不从 HTTP 暴露。

宿主注册实际 `/v1/intake/authorization`、`sources`、`shop-directory`、`entitlements`、`snapshot`、`preview`、词汇接口以及 access/auth 路由。店铺为 `shop-a`，显示为“合成示例店”，主体为合成 `agent`，SOP 为“过敏流程SOP”，可命中输入为“合成过敏”或“synthetic allergy”。这些接口使用真实受限 PG role 和实际服务。普通 `/v1/search` 的 SOP 行为没有修改。

## 终态与安全检查顺序

每次调用先锁定当前产品会话并按现有 content lock 检查当前查询资格。之后验证原始请求内容哈希。`sop_query_requests` 与 `sop_query_completions` 不可变，四种终态都冻结；第一次 `blocked` 不会因为后来发布而变成 `ready`。请求 ID 相同而内容不同返回冲突。

`ready` / `no_match` 重放仍验证既有租约、当前 release、来源映射、审批、依赖及有效期。撤权优先拒绝，过期或 release 变化优先返回 `stale`，绝不通过缓存续租。返回旧终态不代表当前操作获准。

## 明确未完成的边界

- 宿主使用持久化的合成历史 fixture。它**不证明** graph 文件导入、material 冻结、现有发布 API 或现有回滚 API 已贯通。它们仍需实现正式 graph discriminator、完整依赖与质量目标校验、原事务内图谱谱系写入及回滚复制。测试中的新 release 使用同一既有 `content_current`，没有第二个指针。
- 冻结 graph 不携带传输层的 `sequence`、`source_ref`、`message_id`、风险、复制许可，也不为 `next` 指定显示文案。候选 `sop_query_annotations` 仅存与精确 graph digest 绑定的显式元数据，不存回答正文。这里只有测试 bootstrap 写入能力，正式写入合同尚未落实。缺失元数据必须 blocked。
- 任何图媒体目前返回 `MEDIA_UNVERIFIED`。没有伪造 preview handle；媒体字节、节点绑定、可取回预览和 action-check 仍需独立接线。
- 未分类风险不能 ready；非整数 sequence 不能 ready。禁复制消息仍可展示，非 message 节点不能声明可复制。
- 本目录不构成正式安装、真实业务映射、生产启用、发布或设备验收批准。实际桌面消费由协调者使用同一宿主验证。
