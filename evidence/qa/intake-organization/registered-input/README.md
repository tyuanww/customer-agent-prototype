# 注册组织输入与共享传输生命周期候选

本轮基于 `a1eac1126a00b08c55b74e4b9c68c0597a085360`，沿 `codex/intake-org-runtime-candidate` 追加。版本 0.3.26。只使用原有合成 seed、回环 HTTP 和一次性 PG15，没有读取真实人员、凭据或配置。当前为 **DRAFT**；没有冻结、export/intake、正式 migration、生产 ACL/factory 或 HTTP 注册。

实现边界及完整治理差集见 [REGISTERED-INPUT.md](../../../../apps/api/experiments/intake-organization/REGISTERED-INPUT.md)。本轮没有复制 writer；原 writer 继续拥有事实 CAS、代际、最终截止、COMMIT 与未知结果，新增可信事务证据钩子将注册版本/摘要和 observer provenance 原子关联。输入在调用钩子前已运行时冻结。绑定撤销与 disabled 事实同事务，过期绑定也能撤销后重新登记。

实际验证：

- 52 项单位/HTTP：原 observer 19、原 transport 24、新 session owner 9，均通过且无跳过。涵盖共享配额跨实例保留、并发单飞与单等待者取消、供应者超时/吊销/owner close、同 token 字符串的新旧 lease 区分、迟到旧 200/401 和新供应尚未完成的竞态，以及完整 5 页成功与第 6 页容量拒绝。
- 24 项实际 PG15：原 writer 10、原 transport consumer 4、新 registered-input 10，均通过且无跳过。新测试覆盖 provenance 与事实原子关联、摘要变更不能冒充重放、撤销旧/新资格失效、重绑定不能使用旧快照、并发重放、观察/撤销/注册未知 COMMIT、证据失败和最终截止全回滚、过期撤销→重登记、同 open_id 唯一性，以及 SQL 域/同范围 FK/finite/NULL 约束。
- API lint、typecheck、build 退出 0。实际 dist 未含新候选符号。最终修复只在被排除的 experiments，故构建输入未变化，复用本轮已执行 build。

原 native-observer 和 transport 证据的源码指纹保留为历史，未重写。本轮 writer、observer 和 transport 已有变化，因此受影响的旧组织测试实际重跑，不能继续把旧指纹当成当前源码。日志、命令、环境和最终源码指纹见 [results.json](results.json)。原始日志保留输出原字节（包括尾部空行），不为 diff 样式告警改写运行记录。

测试使用受限 `registered_facts_writer` 写事实和实验附表；现有使用资格消费者仍使用隔离 harness pool，不能将本结果声称为用途受限 usage 生产装配完成。任务 B 的运行角色范围没有借机修改。

正式缺口限定为：注册维护者及其受限权限、附属表/观察信封/恢复的治理合同、5 页候选容量及真实上游新鲜度、真实 tenant/app 认证供应者与跨进程配额归属。这里没有缓存目录或无限重试，两次相同扫描也不证明上游原子快照。现有真实店铺、来源、认领、保留期与生产配置条件没有被试验数据替代。

完整外部 `/review` 仍 **INCOMPLETE**。没有 push、PR、合并、部署。工作区体积基线已超额，本轮没有清理旧证据/合同或修改阈值。
