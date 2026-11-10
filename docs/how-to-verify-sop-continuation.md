# 验证 SOP continuation 服务端

## 合同与所有者

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

每次打印独立 `SOP_CONTINUATION_EVIDENCE` 目录。非空备份使用生产 backup-set 工具真实 dump/restore，逐表比较 graph、quality、publication、facts、active/closed、sessions、entitlement/context/scope 与 snapshot/query leases 的记录摘要，检查原 publication FK 和恢复后的 87 verifier。恢复 HTTP 重放 C query、renew 历史 active、读取真实媒体 bytes 并拒绝 closed handle。原 handle 仅经 stdin 传给恢复探针，不写备份元数据。所有输入均为合成，临时 PG、对象和恢复库由 harness 清理。

## 已知合同边界

资源独立停用的材料 identity、来源确认与独立质量形状等待正式后继 intake，v11 parser 对该请求返回带 sheet/row/column 的 `SOP_MAPPING_REQUIRED`。flow 和 entry 的已有停用入口继续使用正常发布谱系。

D open 没有 facts-version 字段。当前要求同 session、selection 和原图的有效 C 消费证明只有一个 facts 版本，歧义返回 `SOP_SNAPSHOT_INVALID`，已打开 active 始终固定原 facts。C query 固定空 scenario selection，非空 scenario 的 snapshot-only 首开还缺明确可追溯的 consumed facts 依据。这一边界不以选 latest 或猜测业务映射填补。

桌面联合消费和真实外部数据验收分别需要自身证据。
