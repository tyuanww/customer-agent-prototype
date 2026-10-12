# 注册组织输入候选（DRAFT）

本模块只用于合成回环和一次性 PostgreSQL 15。不进入 API dist、HTTP、正式 migration 或真实飞书装配。附属 SQL 是待治理候选，不是对已冻结 schema1.22 的修改。版本仍为 0.3.26。

## 所有者与选择

比较了复制一套有 provenance 的 writer，以及给既有 writer 加事务内证据关联两个边界。复制会分叉 CAS、最终截止与未知提交恢复；因此保留原 writer 唯一写事实。它运行时冻结解码后的载荷，在自己的 content lock / 事实 CAS 后调用可信、只做数据库工作的关联钩子，然后执行原最终截止检查与 COMMIT。钩子只由本实验装配传入，不接外部请求或 renderer；发生任何异常，事实、代际、绑定和证据一起回滚。钩子不拥有事实版本、输入、事务、提交或期限。旧调用不带钩子时保持原行为。

`registered-refresh.ts` 拥有注册绑定、观察信封、证据关联及其恢复协议。`feishu-observer.ts` 继续拥有原生字段映射、双扫描和五分钟事实窗。`http-transport.ts` 的应用会话 owner 拥有注入令牌生命周期和按 tenant/app 共享的配额；借用它的 HTTP 实例不拥有或清空这些状态。

## 最小入口

- `createOrganizationHttpSessionOwner({supplier,tokenTimeoutMs,now?})`：一个运行装配持有一个 owner；`session({tenantId,appId})` 返回该应用共享会话。`close()` 终止 owner 和待定供应者；借入 transport 不关闭 owner。原 `tokenSupplier` transport 参数仅保留旧的单客户端隔离实验；本注册候选明确使用 `session`。
- `createRegisteredOrganizationRefresh(pool,scope,transport)`：`register`、`observe(principalId,signal)`、`prepareRevocation(principalId)`、`write(originalEnvelope)`。这里只接已登记 principal，不能创建身份、角色或 grant。注册是可信维护入口，不是给登录用户的接口。
- `register` 显式接收期望绑定版本、open_id 和截止；版本化历史与 current 指针一起提交。有效绑定禁止直接换人，须先撤销再注册；同 tenant/app 的一个 open_id 只能出现在一个 current 绑定。登记不认领既有数据、不增加业务资格，也不重写既有事实。
- `observe` 从数据库注册行读取 open_id、绑定版本/摘要与事实版本；调用方不能在观察入口另塞 open_id。结果携带原快照以及 mappingVersion、directoryDigest、observedUntil。每次观察仅用实时回环响应，没有目录缓存。
- `write` 先固定整个信封，再交给原 writer。关联钩子校验当前绑定并插入对应事实版本的 provenance。事实窗不超过注册有效期；observedUntil 不能早于观察起点、晚于数据库时钟或到达事实截止。回执摘要同时绑定快照、注册版本/摘要和 provenance，不能修改摘要后冒充重放。
- `prepareRevocation` 也可读取已到期但 enabled 的绑定。`write` 经原 writer 写 disabled 事实，并在同一事务追加 disabled 绑定版本。原事实从 enabled 变 disabled 时按原语义推进撤销代际。若此前事实已经 disabled，不额外虚增代际；新事实与绑定仍推进各自版本。实际使用服务拒绝旧资格与新资格签发。

观察、撤销的未知 COMMIT 只能保留原信封重试。注册的恢复键是原请求的确定性绑定版本/摘要。历史回执可以在后续绑定变化后被确认，但不改变 current 指针、不恢复权限。重新观察、改 observedUntil、换绑定或换摘要都不是原请求重放。

## 实际边界

附表 `bindings/current_bindings/observations` 复用现有 identifier/version/sha256 域。注册行通过 principal+tenant+app 复合 FK，证据通过绑定同范围 FK 和事实版本 FK 关联。日期必须 finite；observation 的映射/目录摘要/结束时间必须非空。测试账号没有更新历史 bindings/observations 或身份/角色/grant 的权限；正式账号合同仍待治理。

共享配额延续用户 50/秒及 1000/分钟、职务 10/分钟。达到上限立即拒绝，没有排队、重试或无限等待。重建 transport、令牌失效或重新签发不清配额。不同 tenant/app 独立计数；跨进程的配额协调不由这份单装配候选冒充实现。

注册候选每次完整扫描最多 5 页，每页最多 50 条，两次完整扫描最多 10 次职务请求。第 5 页仍有下一页时明确拒绝 INCOMPLETE_DIRECTORY，绝不截断后声称完整。已使用配额不足时立即失败；不缓存或借旧扫描拼快照。这个 250 条目录容量是可审阅候选条件，须在正式合同批准时确认，不能声称适用于任意企业目录。两次相同扫描仍不证明上游原子快照或上游缓存新鲜度。

令牌只来自注入供应者，不访问环境或 token endpoint。一个应用的并发请求共用一次有时限的供应；一个等待者取消不取消别人的请求。吊销或 owner close 能结束不响应 AbortSignal 的待定供应。每次签发用私有 lease 对象区分代际，即使 token 字符串相同，旧 HTTP 成功响应也被拒绝；迟到旧 401 不会废弃新代或待定替换。读完 HTTP 后再次核验 lease 和到期。供应者不证明租户身份，真实 provider 仍未装配。

## 治理与集成条件

正式化须在所属仓版本化治理这三张附表、可信注册者/写入者的受限权限、信封及错误映射、候选目录容量、真实认证供应者/租户证明、上游新鲜度和多实例配额归属。这里只实现并验证确定的候选，不冻结未知字节，不 export/intake，也不添加生产开关。

Main/renderer、角色上限、正式 schema/migrations、API src、登录 provider、共享 TODO/计划和其他 Agent 模块没有修改。实际用途受限 usage 装配属于任务 B；本测试只对事实与附属记录使用受限角色，现有 usage 消费者继续用隔离 harness pool。

验证见 [注册输入证据](../../../../evidence/qa/intake-organization/registered-input/README.md)。完整外部 `/review` 仍 INCOMPLETE。
