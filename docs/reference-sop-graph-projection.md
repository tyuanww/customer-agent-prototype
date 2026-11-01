# 真实六表映射与 SOP graph projection

当前正式 SOP 仍被 P0 阻塞。真实工作簿的结构证据位于仓外 `real-workbook-structure.json`；它包含六张登记表和 57 张图片，但没有「条目编码」表头。因此不能按物理行号生成业务身份，也不能把表名或图片顺序当作入口、分支、知识、资源、适用范围、可见对象或有效期。

`packages/content-intake/src/sop-real-mapping.ts` 是六表的显式映射边界。每张表必须提供稳定业务编号、入口词、分支目标、无法判断路径、知识、资源和图片归属、适用范围、可见对象和有效区间，并带业务证据引用。任何缺项都返回 `needs-business-confirmation`，不会生成部分图。

`packages/content-intake/src/sop-graph-projection.ts` 是后续 `resume-v3` 候选的纯投影层：它只接受 `prepareSopTaskGraphDraft` 的完整结果，保留多 flow、节点、边、确认项、知识、话术关系和媒体约束；结果始终 `publishable=false`。代码中的合同标识是 `resume-v3-candidate`，不代表产品已接收。在 `IntakeSnapshot` 的 SOP 字段仍为 `maxItems=0`、正式 successor 未冻结、候选未审核发布前，不修改 API、PostgreSQL、Main 或 Query，也不回退 FAQ 或合成树。

`packages/content-intake/src/sop-successor-candidate.ts` 是投影外层的 review-only 接收信封。它把映射版本、来源 SHA-256、六表结构摘要、OpenAPI 摘要、DDL 摘要和迁移摘要绑定到完整投影上。它只返回 `resume-v3-successor-candidate`，并固定 `status=review-only`、`publishable=false`。来源不匹配、摘要格式错误或草稿未准备完成时直接返回 `needs-information`。

同一模块的 `parseSopSuccessorCandidate` 负责外部 JSON boundary。它拒绝额外信封字段、错误来源绑定、错误数组形状和非对象 graph 成员，解析成功后才交给 snapshot readiness 深校验。

`packages/content-intake/src/sop-graph-snapshot.ts` 是 PostgreSQL 接入前的纯 readiness gate。它检查 flow、node、edge、media 的唯一性和引用完整性，并再次核对候选来源绑定。`ready-for-snapshot` 只表示候选结构可以交给未来的事务层，不表示审核通过、发布成功或 API 已经提供正式 graph。

readiness 还要求媒体目标、客户话术 entry 和 script body 都能在同一 graph projection 内闭包解析。孤立的媒体、资源目标或话术正文会被拒绝。

同一模块的 `buildSopGraphSnapshotCandidate` 会把通过 readiness 的候选固化为 `resume-v3-snapshot-candidate`，带 `snapshotVersion=1` 和确定性 `snapshotHash`。快照候选仍固定 `publishable=false`，哈希只绑定候选来源和 graph projection，不代表数据库已写入。

`packages/content-intake/src/sop-graph-release-gate.ts` 再把候选、snapshot readiness、successor 接收和业务审核拆成四个独立事实。只有四项都满足才返回 `ready-for-transaction`，结果仍固定 `publishable=false`。正式发布事务必须在批准的 successor 和数据库合同中实现，不能由这个纯函数代替。

`packages/content-intake/src/sop-graph-transaction.ts` 把候选 ID、版本、幂等键、snapshot hash 和带来源绑定的审核证据组装成未来数据库事务的 review-only 请求。它会重新计算 readiness 和 snapshot hash，拒绝伪造的快照或不匹配的证据，仍不执行 I/O。

`prepareSopGraphSnapshotTransactionFromUnknown` 把外部 JSON 解析、snapshot 固化和事务请求准备串成一个入口。调用方不需要也不能绕过 boundary parser。

事务测试还覆盖一条完整 review-only 链路。prepared draft 经过 projection、successor envelope、JSON parser、snapshot hash 和 transaction request 后，仍不会产生发布能力。

`packages/content-intake/src/sop-successor-handoff.ts` 将事务候选压缩成可审阅的 successor handoff manifest。manifest 只携带候选 ID/版本、幂等键、来源摘要、snapshot hash 和两类审核证据，不携带可绕过来源绑定的正文副本；它固定 `state=CANDIDATE`、`publishable=false`。解析器会拒绝额外字段、错误来源哈希、错误候选身份或不一致的审核证据。该 manifest 仍是交接记录，不是正式合同接收、数据库写入或运行时激活。

successor 接收证据和业务审核证据同时绑定 candidate ID、candidate version、mapping version 和 source SHA-256。successor 证据还绑定合同标识和全部摘要。这样审核事实不能跨候选复用。

`packages/database/tests/sop-graph-candidate-transaction.integration.test.ts` 是隔离 PostgreSQL 15 演练。它只在临时数据库创建测试表，验证候选 snapshot、来源摘要、分开的 successor/business 审核摘要和 durable receipt 的原子提交、幂等冲突、来源漂移回滚、未完成审核/可发布 snapshot 拒绝和 unknown-commit 重放；当前实际 6/6 通过。它不代表正式 migration 已接收。

正式 API 消费边界见 [SOP API 只读 snapshot 消费边界](./reviews/2026-10-31-sop-api-snapshot-consumption-contract.md)。当前 `IntakeSnapshot` 保持 FAQ 和空 SOP 数组语义；后续 successor 应使用独立版本化 graph 合同，由 Main 按 `snapshotHash` 绑定 continuation。本文只记录 review-only 设计，不改变现有 OpenAPI 或 runtime validator。

Main continuation 的状态、命令、权限复核和恢复规则见 [SOP Main continuation 状态与权限边界](./reviews/2026-10-31-sop-main-continuation-contract.md)。正式 adapter 必须拥有 snapshot 会话和修订号，不能把 synthetic tree、renderer 状态或旧 entitlement 当作正式 graph 真源。

Query 的正式 action 协议见 [SOP Query action 协议边界](./reviews/2026-10-31-sop-query-action-contract.md)。普通复制和进入 SOP 保持并列，renderer 只传稳定意图，Main 负责资格复核、流程状态和剪贴板。

模板可由 `packages/content-intake/scripts/sop-real-mapping-template.mjs` 从只读结构证据重新生成。脚本只接受绝对源路径、六张表和合法 SHA-256，映射校验还会绑定 Menokin 只读证据的固定 SHA-256，输出仍保持空映射，避免模板和结构证据漂移。填写步骤见 [真实六表映射填写说明](./how-to-fill-real-sop-mapping.md)。

映射完成后，下一阶段应按顺序接入：批准的 successor 合同 → 候选/审核/发布事务 → snapshot graph projection → Main continuation → Query `open/next/choose/back/copy/renew/close`，并为撤权、过期、旧版本续用和同账号重登保留独立验收证据。
