# 独立 SOP 查询验证

此入口验证合成 PostgreSQL、HTTP、Main 和 SOP 窗口。企业工作簿不进入仓库或运行链。真实业务映射、生产迁移、图片预览和上线仍以各自证据为准。

## 正常 v11 查询

正常入口固定 `cs-ai-c11-openapi-1.29.1-schema-1.33-812a2e80584f`，使用正常 86 条迁移目录及原发布/授权 owner。先构建服务，再串行运行专项。

```sh
pnpm build:services
pnpm --filter @customer-agent/api test:integration:sop-query
pnpm test:db:integration
```

专项通过真实 HTTP 完成上传、解析、冻结、来源确认、质量和发布，随后由受控内部 writer 显式登记有来源/version 的 synthetic 事实。查询仍通过真实 PG 和 HTTP。它覆盖三类 owner 媒体及跨 owner 共享图片、完整 original digest、不同分组缺事实隔离、父授权撤销、身份/header/view 边界、并发/CAS/提交未知恢复、四状态、1 MiB 实际 bytes 与到期。备份恢复后重发原请求，核对相同 lease、preview 和权限事实。每次测试创建独立 UUID 证据目录并打印 SOP_QUERY_EVIDENCE。

C 生成短 preview lease。D 拥有 continuation/check/renew/close/media server，桌面与完整 GateB 由父后续同链验收。原业务缺风险、复制许可、来源 sequence 等事实继续 blocked。

## 旧 83 前序候选

### 合同与安装边界

固定合同见 [1.25.0 快照](../contracts/upstream/customer-agent/cs-ai-c11-openapi-1.25.0-schema-1.30-0fb1dc76ee2b/installation.v1.json)。它批准产品实现，但 `runtimeActivated` 与 `productionConsumerReady` 仍为 false。

候选源为 `packages/database/candidates/0084_sop_query/`。生成器组合冻结的存储增量与本地受限查询函数。安装器核对完整迁移回执、实际 0083 前驱和候选 SHA；只接受显式测试开关、PG15、本地 socket、测试数据库名与测试 owner。默认产品迁移 runner 不安装候选。

### 合成验证

使用仓库锁定的 Node 24 与 pnpm，先构建实际服务，再执行临时 PG 测试。

```sh
pnpm build:services
node packages/database/candidates/0084_sop_query/generate.mjs --check
CUSTOMER_AGENT_SOP_QUERY_CANDIDATE=1 pnpm --filter @customer-agent/api exec vitest run tests/sop-query-postgres.integration.test.ts
```

该测试使用实际 HTTP socket、产品会话和低权限 PG 调用，验证发布图查询、无匹配、请求重放、跨店拒绝、版本变化、撤权、租约和事务回滚。它不连接现存数据库。完整根检查仍按工程流程运行，不能以该专项替代。该用例也进入 `@customer-agent/api test:integration`，由 PR 数据库 lane 和 main CI 执行。桌面实际 PG 联合命令与消费边界见[桌面验证](how-to-verify-sop-query-desktop.md)。

临时服务入口如下。进程打印合成服务 origin；停止后清理自己创建的服务与数据库。

```sh
CUSTOMER_AGENT_SOP_QUERY_CANDIDATE=1 node scripts/intake-synthetic/sop-query-host.ts
```

桌面只在显式 loopback `faq-v2` profile 中接受 `sopQuery: "menokin-sop-query-v1"`。开发启动对应环境变量为 `CUSTOMER_AGENT_DESKTOP_SOP_QUERY=menokin-sop-query-v1`；API 和身份 origin 必须满足原有相邻端口规则。正式远程 profile 拒绝该开关。

### 结果与限制

四种查询结果是 ready、blocked、stale、no_match。Main 只沿显式 source/target 边推进，不从节点 sequence 推导路径；renderer 只持有动作句柄。复制只反馈“已复制”。切换条件、到期、版本漂移或权限失效清除旧结果；复制与分支选择先重新读取，不能借此延长原租约。

当前没有批准的图片句柄兑换与字节预览完整协议，包含媒体的图保持 blocked。这个限制不能通过公开路径、永久 URL 或自动抓取外链补齐。真实原表的缺字段、未确认边、未分级话术也不因合成测试通过而变成 ready。

原始 Gate B 与传输层测试分别记录。TLA+ 的有限合成模型通过，不代表任意业务图、真实设备或完整系统无缺陷。实际运行记录应绑定被测提交、输入、环境与命令，不能沿用旧候选的通过数。
