# SOP 架构收尾盘查

盘查对象是 `/Users/hutou/.codex/worktrees/sop-integrated/customer-agent-prototype` 的当前工作树。盘查结论只描述源码和本地验证，不代表业务审核、合同接收或上线批准。

## 结论

当前项目适合继续按“离线映射准备 → 正式合同接收 → 数仓与 API → Main → Query → 业务验收”的顺序推进。现有权限、候选媒体和合成执行边界可以保留。正式 SOP 运行链仍未完成，原因是当前 API 合同把 `IntakeSnapshot.sopNodes`、`sopEdges` 和 `media` 限制为 `maxItems: 0`，API 返回空数组，Main 的 `SopWindowController` 仍只查 `findSyntheticSopTree`，Query 的 `ContentIntakeUsage` 也会拒绝非空图。

## 已确认的正确边界

- `apps/api/src/content-intake/usage.ts` 继续拥有资格、租约、发布版本、适用范围和媒体预览的最终校验。
- `apps/desktop/src/main/` 继续拥有流程进度、会话修订、撤权后的清理和剪贴板。
- `apps/desktop/src/preload/` 继续只传类型化意图，不传 token、主体 ID、任意正文或文件路径。
- `packages/content-intake/src/sop-real-mapping.ts` 把真实六表业务确认建模成显式输入，拒绝按物理行号生成身份，并分别要求知识、资源和图片归属声明。
- `packages/content-intake/src/sop-graph-projection.ts` 只接受完整草稿，保留多 flow 及完整节点、边、确认项、知识、话术关系和媒体约束，输出固定为 `publishable: false` 的 `resume-v3-candidate` 内部形状。
- `packages/content-intake/src/sop-successor-handoff.ts` 只输出带来源摘要、snapshot hash、候选身份和双重审核证据的 `CANDIDATE` manifest；外部解析拒绝跨候选复用证据，且不拥有正式 API/数据库写入能力。
- [SOP API 只读 snapshot 消费边界](./2026-10-31-sop-api-snapshot-consumption-contract.md) 保留现有 FAQ snapshot 和空 SOP 数组，规定正式 graph 必须使用独立版本化合同，由 Main 按 `snapshotHash` 绑定 continuation。

## 发现和处置

| 等级 | 发现 | 处置 |
| --- | --- | --- |
| P0 | 正式 API 快照没有图数据，Main 没有正式图读取器 | 保留阻塞。等待批准 successor 合同后，按同一发布和资格所有者接入，不用 FAQ 降级填补 |
| P0 | 真实工作簿没有「条目编码」表头 | 已增加 fail-closed 映射模板和校验。业务编号、入口、分支、归属、范围、可见性和有效期仍需人工确认 |
| P1 | projection 原实现只取第一条 flow，且丢失节点附属约束，可能静默丢图 | 已改为保留全部 flow 和完整 graph definition；节点引用或起始节点未解析时返回 `needs-information` |
| P1 | 内部 projection 名称容易暗示 `resume-v3` 已接收 | 已改为 `resume-v3-candidate`，并在文档中注明 review-only 状态 |
| P1 | 合成树和正式图共用过多相似消费概念，容易误接 | 当前正式 profile 不装配合成树。接入正式图时应使用独立 adapter，并删除旧调用方，不保留双重回退 |
| P2 | 旧 `tryParseSopAsFaq` 仍被合成测试和实验使用，真实 SOP 来源曾可进入该入口 | 已收紧为显式 synthetic-only profile；真实 `domain=sop` 在 graph parser 接入前 fail closed |

## 接下来按可验证单元推进

1. 业务人员按 [真实六表映射填写说明](../how-to-fill-real-sop-mapping.md) 补齐 [真实六表映射模板](../sop-real-six-sheet-mapping.template.json)。验证结果必须是 `ready-for-graph-preparation`，并保留来源 hash 和每项证据引用。
2. 治理侧冻结并导出 successor 合同。产品侧只接收带来源 SHA、OpenAPI/DDL 摘要和可运行迁移清单的版本。`compat-v4` 在获得 successor-specific approval 前不进入产品目录。
3. 在隔离 PostgreSQL 中把候选、审核、发布和 graph projection 串成一条事务。验证旧版本流程续用、新版本不静默替换、撤权、过期和未知提交恢复。
4. 按 [API 只读 snapshot 消费边界](./2026-10-31-sop-api-snapshot-consumption-contract.md) 让 API 返回版本绑定的图快照和媒体引用。Main 在读取和每个命令前重新核验资格、版本和截止时间。
5. 将 Query 的 `open / next / choose / back / copy / renew / close` 接到 Main 的正式 adapter。验证 renderer 永远只发意图，剪贴板只由 Main 写入。
6. 通过第二坐席真实验收、安装包验证、412 条内容业务审核和正式发布批准后，才可报告上线。

## 本轮验证

- `pnpm check:architecture` 通过，562 个文件，0 项边界违规。
- `pnpm typecheck` 通过，且生成合同和迁移检查通过。
- `pnpm lint` 通过。
- `pnpm docs:check` 通过，349 个 Markdown 文件及本地链接通过。
- content-intake 相关测试通过，包含 432 项测试；来源哈希与映射结构漂移、projection 多 flow 保留、完整附属约束、引用闭包、事务身份和 handoff 边界用例已加入。

这些结果证明代码边界和前置模块可构建。它们不证明真实业务映射、正式合同接收、生产数据发布或 SOP 上线。
