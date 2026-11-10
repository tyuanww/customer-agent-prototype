# 验证 SOP continuation 服务端

## v11 合同与所有者

采用 v11、OpenAPI 1.29.1、schema 1.33 和 source 812a2e80584f。正常迁移顺序为 0085 图生命周期、0086 查询事实、0087 continuation。前 86 段 SQL 和元数据保持原字节。

四个冻结入口为 `POST /v1/intake/sop/check`、`POST /v1/intake/sop/continuations/renew`、`POST /v1/intake/sop/continuations/close` 和 `GET /v1/intake/sop/releases/{releaseId}/media/{mediaObjectId}`。三个命令只接受冻结 DTO，图片要求 release/source/flow/ownerKind/ownerId/resourceId/objectId 完整绑定。历史读取另需 `X-Sop-Continuation`。

Main 生成 `sct_` 加 32 CSPRNG bytes，服务端只保存 hash。active 与五分钟 entitlement 独立。existing exact open 通过原 immutable binding 恢复。session 自然过期后，同账户新 session 需保留的旧 session 证明才能重绑。明确 logout、实际内容过期、来源权威版本停用和打开后经过的 disable event 终结旧 active。关闭原子清 session 引用，终态保留原发布、opening entitlement 和 facts 绑定。

`usage.ts` 提供共同 live selection/scopes，普通资格仍只能 current。D 历史发行从锁定 active 取得 release。continuation snapshot 沿同一分页 owner 仅投影绑定 flow、exact dependencies 和适用媒体。普通 preview 拒绝该资格，图片走 D 窄入口。完整图/digest 与 facts 由 C parser 验证，媒体对象通过原 store 读 bytes，在第二个授权事务提交前重验。

## 合成纵向验证

先构建运行产物，再串行执行对应入口。

```sh
pnpm build:services
pnpm --filter @customer-agent/api test:integration:sop-continuation
pnpm --filter @customer-agent/api test:integration:sop
pnpm test:db:integration
pnpm test:backup:integration
```

定向 continuation 用例从空 graph 表开始，经 upload、receive、真实六表 parser、source confirmation、完整质量 targets/checks 和 direct publish 产生 R1。C 登记明确合成权限来源并 query ready 后，验证 open、合法 action、各媒体 owner 的真实 bytes、R2/R3 固定历史、新 current query、并发、真实提交后丢响应恢复、授权换链、自然 session expiry、真实 logout、停用后 rollback、新 handle 和终态。

每次打印独立 `SOP_CONTINUATION_EVIDENCE` 目录。非空备份使用生产 backup-set 工具真实 dump/restore，逐表比较 graph、quality、publication、facts、active/closed、sessions、entitlement/context/scope 与 snapshot/query leases 的记录摘要，检查原 publication FK 和恢复后的当前 migration verifier。恢复 HTTP 重放 C query、renew 历史 active、读取真实媒体 bytes 并拒绝 closed handle。原 handle 仅经 stdin 传给恢复探针，不写备份元数据。所有输入均为合成，临时 PG、对象和恢复库由 harness 清理。

## v11 保留的合同边界

v11 parser 对资源独立停用返回带 sheet/row/column 的 `SOP_MAPPING_REQUIRED`。flow 和 entry 的已有停用入口继续使用正常发布谱系。独立资源的正式后继形状与验证见下节。

v11 D open 要求同 session、selection 和原图的有效 C 消费证明只有一个 facts 版本，歧义返回 `SOP_SNAPSHOT_INVALID`，已打开 active 始终固定原 facts。v11 C query 固定空 scenario selection，非空 scenario 的 snapshot-only 首开保留原有拒绝语义。

桌面联合消费和真实外部数据验收分别需要自身证据。

## v12 资源停用与精确查询证明

正式修正输入为 `cs-ai-c11-openapi-1.30.1-schema-1.35-5fb5c1285056`，来源提交为 `5fb5c1285056b7a862ef5a03cf25975fb91802b5`，由独立v13合同集和接收锁拥有。原v12冻结件保留。产品 `0088_sop_resource_lifecycle` 从完整87段前缀升级。累计schema供对照，实际安装由既有migration runner完成。

`apps/api/tests/sop-resource-lifecycle.integration.test.ts` 使用真实临时PG15、HTTP与对象字节，从上传、六表解析、来源确认和联合质量门进入发布。覆盖多商品及非空场景选择、Q1/F1与Q2/F2、active重放、正常停用和rollback、新发布后历史pin、两阶段资源检查、四角色ACL、FK、不可变历史以及非空dump/restore。来源确认必须提交材料中的 `resourceDisableSetDigest`。普通rollback报告保留历史摘要和零新增停用数。

```sh
pnpm build:services
CUSTOMER_AGENT_API_SOP_RESOURCE_PG15_INTEGRATION=1 pnpm --filter @customer-agent/api exec vitest run --maxWorkers=1 --no-file-parallelism tests/sop-resource-lifecycle.integration.test.ts
pnpm --filter @customer-agent/api test:integration:sop
pnpm test:backup:integration
```

原v11材料兼容正例位于 `sop-unified-query.integration.test.ts`。它先通过v11正常B入口发布，再由v12 current entitlement、C ready和explicit-query D open消费同一原图、话术及三类媒体owner，并核对原canonical与风险材料仍保持原字节。

每次非空恢复使用独立临时目录。脚本先比较完整关系行及原publication FK，再通过88 verifier、当前图读、原Q回执重放、active续用、媒体字节和closed拒绝验证恢复结果。测试日志打印证据目录。原Q/E在授权换代后按原资格拒绝，active仍通过自己的原opening proof和新授权重放。opaque `context_generation` 与普通E numeric generation分属各自所有者。

上述入口使用全合成显式事实。真实原表缺失的业务事实继续保留blocked，runtime activation保持false。Main的迟到结果丢弃、确认项进度和原生复制由桌面消费单元提供独立证据。

## 桌面正常后端联合验证

桌面 `menokin-sop-unified-v12` 仅在显式 loopback `faq-v2` 合成 profile 中启用，配置必须携带当前受锁合同的精确 `sopContractSet`。Main 从 Query 既有完整选择取得普通资格，保留商品及场景条件，分别绑定查询 Q、首开证明、continuation 和历史发布。renderer 只接收展示投影及短期动作句柄。

以下入口创建自有临时 PG15、对象存储、正常 API 和合成身份服务，经正常六表上传、解析、来源确认、质量与发布后驱动实际 Electron 窗口。执行前需要本机已有 PG15、Node 24 和项目锁定的 pnpm。

```sh
pnpm build:services
pnpm --filter @customer-agent/desktop build
sop_evidence_dir="$(mktemp -d)"
CUSTOMER_AGENT_SOP_V12_NORMAL=1 CUSTOMER_AGENT_SOP_V12_EVIDENCE="$sop_evidence_dir" pnpm --filter @customer-agent/desktop exec playwright test tests/e2e/sop-v12-normal.spec.ts --workers=1
printf '%s\n' "$sop_evidence_dir"
```

当前十四项覆盖完整选择与三个媒体 owner、原生剪贴板、query/open 提交后丢响应的原请求重试、在线及离线窗口销毁、多话术与完整图推进、必需图片延迟、自然过期重登、明确登出、撤权换链、迟到查询、可选图片迟到、发布停用回退及正常 C blocked。blocked 用例验证旧内容清空、零图片、无第二次成功首开及无新增原生复制。日志、每项 opening 与后台诊断写入指定证据目录。测试只读取本次写入的合成剪贴板内容，自有服务及临时库由 fixture 回收。

GIF 在 Main 控制的隐藏 sandbox 文档中解码，该文档没有 preload 或 Node 权限，仅允许 data 图片，并在取消、完成或五秒截止时销毁。两个媒体工作者按 active、节点及工作身份丢弃迟到结果。可选图片允许明确失败，必需图片未就绪时阻止推进。明确资源停用终结旧 handle，普通新发布保留原历史 pin。

`tests/e2e/sop-unified.spec.ts` 的合成 HTTP double 和组件、纯状态单元分别保留独立证据。上述正常后端用例证明合成运行链，完整 Gate B、最终 packaged 构建、真实设备和真实业务验收继续按各自矩阵记录。

PG-free 的 `sop-unified.spec.ts` 由共享验证映射接入 Linux Electron 和 Windows 原生进程回收 lane，包含实际 GIF 解码、原生复制及窗口销毁。Windows 打包完成后再运行其 Electron 用例。正常 PG/HTTP 十四项通过上述显式入口执行，证据按用例及环境分别记录。
