# WeKnora 检索评估（2026-10-26）

E2 调研卡对照 WeKnora 与当前桌面检索。下文引用的 Top-3 命中率、MRR、无命中正确率均来自 [2026-10-24 检索基线报告](../reports/2026-10-24-retrieval-baseline.md)，测的是本仓 `hybrid-retrieve.ts` 的 BM25 加 RRF 回落路径，不是 WeKnora，也未在同一份评测集上跑过 WeKnora。因此本页不能给出「谁更好」的数值结论。

## 卡面目标与本页边界

[2026-10-24 SaaS 重构任务卡](../plans/2026-10-24-saas-refactor-task-cards.md) 中 E2 要求阅读 WeKnora 的检索、分块、重排模块，并用 E1 评测集做对比，同时评估许可证、依赖、运维与授权模型兼容性。本页只做仓库内已有证据的汇总。未启动 WeKnora、未克隆上游、未在本机或杭州同机实例上跑 E1 脚本。

## 仓库里已有的 WeKnora 证据

唯一成体系的记录在 [2026-10-03 资料导入需求](../plans/2026-10-03-content-intake-requirements.md) §7「本机 WeKnora 与已有项目核查」。

核查对象是 CRM 工程保存的源码快照，目录标记 `1edcd54b43606d9079bb36650efe3f68707a79ea`，`VERSION` 为 `0.8.0`。方式是只读读源码，未启动服务、未安装依赖、未读运行数据。CodeGraph 未覆盖该快照。

当时逐项看的是导入、来源连接与租户 RBAC，不是检索流水线。摘要如下。

| 模块位置 | 已记录的可借鉴点 | 与本项目检索主链的关系 |
| --- | --- | --- |
| `FAQEntryManager.vue` | CSV 解析、固定模板、FAQ 批量导入与进度 | 属于资料导入 UI，不是坐席查询排序 |
| `knowledge_faq_import.go` | append/replace、异步任务、冲突明细 | 导入会更新知识条目；本项目须草稿加审批发布，不能直接当发布服务 |
| `connector.go` 及飞书 connector | 连接验证、资源选择、增量游标、重试与来源跟踪 | 与 C06 类来源适配相关，未验证到检索质量 |
| 飞书 drive connector | doc/sheet/bitable 导出路径 | 凭据在受控服务端，不能整包搬进 renderer |
| `tenant_member.go`、`rbac.go` | 租户成员角色与后端门禁 | owner/admin/contributor/viewer 不是客服岗位；部署状态未验证 |

快照根目录声明 Apache-2.0。需求稿写明，若复制具体模块应锁定上游版本并保留许可，当轮仅参考设计。Go 服务与 Vue 页面不是可加入当前 TypeScript/React 产品的 npm 组件。

同一份需求稿在多处重复边界。首期不引入完整 WeKnora 或 Dify 部署。Eng 范围写明不移植 WeKnora 的 Go/Vue 运行栈，WeKnora 仅借鉴分层与来源/FAQ 模式。RAG 平台与 Hugging Face 模型不是表格规范或审批权限的直接实现依赖。

运维侧仅有同机共存描述。[how-to-run-backend-on-hangzhou.md](../how-to-run-backend-on-hangzhou.md) 与 `TODOS.md` 记录杭州机器上跑着 WeKnora，与 fuqing-crm-analytics、tyuan-chat 等并列。这不构成检索能力或 E1 对齐评测的证据。

## E1 基线（仅描述本仓 BM25 lane）

E1 已在合成语料上量化当前桌面链路，详见基线报告。held-out 共 200 条，其中正例 170 条，Top-3 命中率 67.6%，MRR 0.608。负例 30 条，无命中正确率 33.3%。向量与重排两档因无 MiniMax 凭据未跑，报告量的是 BM25 回落路径的下界，不是三档融合上限。

复现命令为 `pnpm --filter @customer-agent/desktop eval:retrieval`。语料与题集在 `apps/desktop/tests/fixtures/retrieval-eval/`。

这些数字回答「本仓现有检索好不好」，不能外推到 WeKnora，也不能反推 WeKnora 应接入生产。

## 检索对比是否成立

不成立。仓库内没有 E2 要求的检索/分块/重排模块阅读记录，也没有在 WeKnora 上跑过 E1 的 360 条题集。§7 快照核查聚焦导入与来源同步，与 E2 卡面的检索验收项不对齐。

因此本页不能填写 E2 卡验收栏里的「直接用、借模块、不用」三选一结论，也不能编造 WeKnora 的命中率、延迟、许可条款细节或运维成本数字。规划方在任务卡中已说明未预设结论，当前证据只支持「未测量」。

## 与产品授权和发布主链的已知张力

即使将来只做「借模块」讨论，需求稿已记录的适配限制仍适用，且与检索无关但会阻塞整包接入。

导入路径假设知识条目可由后端直接更新，本项目须先形成草稿并经飞书审批后在桌面发布。租户 RBAC 角色集与客服 actor、范围、飞书组织事实未对齐，且当时未验证 WeKnora 部署是否满足生产门禁。完整栈是独立 Go/Vue 服务，与 `announce/hydrate/retrieval` 及受控 preload 边界不一致。

上述内容来自需求核查表与 Eng 范围陈述，不是本次新增的架构裁决。

## 建议

在出现可复现的 E1 同款评测（同一 `corpus.json` 与 `cases.json`、同一 held-out/dev 划分、同一指标脚本输出）且明确记录 WeKnora 侧检索配置之前，WeKnora 不应进入本项目的生产检索路径。也不应把 §7 导入/UI 参考误当成检索已验证。

若后续要做测量，最低门槛是任务卡 E2 范围本身。读清检索与分块/重排实现，在隔离环境跑 `eval:retrieval` 或等价脚本，把 held-out 表与基线报告并列写进仓内报告，再谈「直接用、拆模块、不用」。在那之前 E4 服务端检索 RFC 应把 WeKnora 方案标为未评测对照，而不是数字已知的候选。

## 来源清单

| 文档 | 本页使用的信息 |
| --- | --- |
| `docs/reports/2026-10-24-retrieval-baseline.md` | E1 指标、语料规模、BM25 lane 边界 |
| `docs/plans/2026-10-03-content-intake-requirements.md` §7 及 Eng/延期相关段落 | 快照核查、模块表、Apache-2.0 声明、不部署/不移植栈 |
| `docs/plans/2026-10-24-saas-refactor-task-cards.md` E2 | 卡面目标、验收期望 |
| `docs/how-to-run-backend-on-hangzhou.md`、`TODOS.md` | 同机运行事实，非检索评测 |
