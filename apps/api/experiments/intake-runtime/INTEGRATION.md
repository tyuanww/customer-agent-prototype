# 用途候选接线与正式接入边界

实验 SQL 只安装到一次性合成 PG15，不复制进 `packages/database/migrations`，不改变正式会话锁 SQL、迁移、HTTP、生产 factory 或应用 ACL。用途权限、DEFINER 切换与正式连接配置仍须治理版本化冻结、export、intake。版本保持 0.3.26。

## 旧权限探针的证据边界

`purpose-acl.sql`、`purpose-boundary.ts`、`assembly.ts` 与原专项测试继续保留原输入，原 [15 项证据](../../../../evidence/qa/intake-runtime-assembly/README.md) 不重新声明为本轮运行：

- usage 只验证窄锁、资格写入、空目录 keyset 和 query 授权探针；不是实际非空 snapshot 或复制消费者。
- 未适配的实际 service 在原 `FOR SHARE` 会话锁上仍是 42501；旧 business 不能写质量计划、授权或回执，旧 worker 仅终态 SQL 探针。
- 旧 business 验证直发/回退的拒绝路径与函数依赖，未发布完整候选。旧探针没有 approval-v1 实际形状的失效记录。
- `purpose_gap` 只覆盖旧矩阵。它故意不允许本轮新增 business 的 grants/quality 写入，不能拿它给新矩阵签发“无缺口”结论。
- `start()` 只做依赖检查，固定 `checked-not-activated`、`ready:false`、`legacyAdopted:false`。没有认领材料，不启用服务。cancel/close 丢弃尚未完成检查的结果，借用连接及解析器由调用方关闭。

旧资格 SQL 副本仅保留为旧 ACL 历史探针，已不作为“真实消费者尚无法验证”的理由。正式 ACL 接入并以实际消费者替换对应门禁后删除，不继续扩展第二套 service。

## 本轮实际消费者

`consumer-acl.sql` 在旧 SQL 之后追加独立候选权限；`consumer-pool.ts` 提供仅合成环境使用的会话锁适配。实际调用仍进入 `createContentIntakeService`、`usage.ts` 的私有分页闭包、`quality.ts`、`authority.ts`、`transaction.ts` 和 `capacity.ts`，没有复制这些业务规则。专项 [实际消费者证据](../../../../evidence/qa/intake-runtime-consumers/README.md) 覆盖：

1. 实际 multipart 字节交给 `service.upload`，随后 receive → parse → 来源确认 → 冻结质量计划 → 检查 → confirmed 发布。使用真实对象存储、XLSX 解析与数据库，而未启动 HTTP server。
2. 另一名经真实合成认证流程得到的账号签发资格，读取每页一条的三个非空 snapshot 页，保留换行，并调用实际 `authorization(...,'query')` 作为复制前资格检查。没有实测系统剪贴板。
3. 实际确认回退、发布/回退幂等回放、总监授予业务权限/撤销、旧资格失效；旧角色审核不重做。
4. 发布提交响应丢失后从实际回执恢复，未重复发布；提交前授权到期时发布和回执一起回滚。
5. parser 失败进入实际 `finishFailure`，由 worker 写 report、容量与 job 终态。worker 容量 COMMIT 响应丢失时保留占用、不发送 ROLLBACK，连接标坏释放。
6. 管理员仅为 fixture 构造 approval-v1 包对象、候选、review binding、审批事实、目录与 lineage。撤销/过期后实际 snapshot 和 rollbackPreview 均拒绝；当前 direct 目录继续可读。不是飞书审批接入。
7. 用途角色与管理员冒充被检查；克隆 actor、跨用途写、根 allocation 新建/修改、业务身份安全列/组织事实/直接发布写入被拒绝。

## 最小内部接口

本轮选择默认 pool 加可选 `options.terminalPool`，不把一个 service 重构成四池路由。仅 `finishFailure` 及其 report 容量操作使用 terminalPool；省略时复用原 pool 和容量实例。调用方拥有连接生命周期。

合成宿主先验证连接的 session_user/current_user、角色能力、禁止属主成员及身份安全列 UPDATE，再装配：

```ts
const writer = createContentIntakeService(businessPool, store, report, undefined,
  { requireProductSession: true, terminalPool: workerPool });
const reader = createContentIntakeService(usagePool, store, report, undefined,
  { requireProductSession: true });
// 组织观察/写入器仍独立拥有 organizationPool，不塞入内容 service。
```

这里 business/usage 仅在实验里经过 `createSyntheticConsumerPool`；实际生产 factory 尚未采用这段装配。用途连接是可信服务凭据，不是用户身份；服务通过认证私有对象、角色、grant、范围和截止时刻约束调用者。新 ACL 不提供逐用户 SQL 行隔离。

## 会话锁兼容面

所有者仍是 `transaction.ts` 的唯一 `lockProductSession`。实验钉住整份原文件 SHA-256 和唯一原 SQL 的出现次数，只把精确相等的查询换成：

```sql
SELECT intake_runtime_probe.lock_product_session($1,$2) AS expires_at
```

参数完全保留，只有 `ZA003 / SESSION_UNAVAILABLE` 映射为 `SCOPE_DENIED / UNAUTHORIZED`；任何其他 SQL（包括多一个空格）不适配，其他错误保持原对象。源文件漂移直接拒绝。没有给登录角色 `UPDATE(revoked_at)` 或 `UPDATE(enabled)`，不把 SQL 时序当连接路由。

正式采用时应治理窄函数签名与属主，消费后在唯一锁所有者切换并删除实验适配，不能长期把这个源码指纹桥当生产入口。单改锁仍不足以完成运行装配。

## 剩余正式条件

- 冻结并消费新用途权限、函数安全属性、连接所有权与启动条件；新矩阵完整定义见 [PURPOSE-ACL.md](PURPOSE-ACL.md)。禁止以合成 PASS 代替合同批准。
- 正式配置用途账号和 factory，复核默认业务实例、worker 终态、usage 实例与独立组织写入器的所有权；本轮没有启用真实飞书、生产账号、HTTP 或桌面。
- 真实范围及认领材料仍未到位；不得从空库、合成 source/shop 或测试目录推定完成认领。保留期仍待所属决定，不执行历史删除。
- 完整外部 `/review` 仍是 INCOMPLETE；本轮没有无界重试外部审核。
