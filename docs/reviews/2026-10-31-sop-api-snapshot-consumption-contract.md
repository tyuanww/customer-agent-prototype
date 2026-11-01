# SOP API 只读 snapshot 消费边界

状态：`REVIEW_ONLY_DESIGN`。

本文定义正式 graph 进入 API 只读层前的边界。它不修改 OpenAPI、生成类型、数据库、Main 或 Query。

## 当前事实

- `GET /v1/intake/snapshot` 返回 FAQ 和空的 `sopNodes`、`sopEdges`、`media`。
- `IntakeSnapshot` 的三个 SOP 数组仍是 `maxItems: 0`。
- Desktop `ContentIntakeUsage` 会拒绝非空 SOP 数组。
- Main 的 `SopWindowController` 仍从 synthetic tree 读取流程。

这四条约束共同表示正式 graph 尚未接通。不能只放宽一个数组上限，也不能用 FAQ 行或 synthetic tree 填补正式 graph。

## 消费边界

保留现有 `IntakeSnapshot` 的 FAQ 语义。正式 successor 使用独立的版本化只读合同。合同名称和 HTTP 路径等待 successor 冻结后确定，不能先写入现有 `/v1/intake/snapshot`。

正式合同必须表达以下数据形状：

| 区域 | 最小内容 | 所有者 |
| --- | --- | --- |
| 身份 | `releaseId`、`entitlementId`、`contextGeneration` | API 资格事务 |
| snapshot | `snapshotVersion`、`snapshotHash`、不可变版本标识 | PostgreSQL snapshot，API 只读投影 |
| flow | 稳定的 `sourceId/flowId/flowVersion`、标题、入口词、适用范围、可见对象、有效区间、起始节点 | PostgreSQL graph snapshot |
| node | 稳定节点 ID、任务类型、阶段、确认项、知识引用、话术引用 | PostgreSQL graph snapshot |
| edge | 稳定边 ID、起点、终点、条件和动作 | PostgreSQL graph snapshot |
| script | 业务条目 ID、话术版本、标题、对客正文 | PostgreSQL graph snapshot |
| media | 对象 ID、序号、SHA-256、MIME、必要性、graph 目标和短期预览关系 | PostgreSQL media relation 与 API 资格校验 |
| 分页 | `nextCursor` 只能表示读取位置，不能表示资格或发布权限 | API |

API 返回 `snapshotVersion` 和 `snapshotHash` 供 Main 绑定会话。治理侧的 OpenAPI、DDL、迁移摘要和原始工作簿 SHA 留在服务端审核事实中，不下发给坐席。

## 读取和会话规则

1. API 先按 entitlement 重读租约、来源资格、店铺选择、撤权代际、发布版本和最早截止时间。
2. API 只读取已批准的不可变 snapshot。候选、review-only handoff 和旧 FAQ 目录不能作为正式 graph 来源。
3. Main 打开流程时保存 `snapshotHash`、flow identity、session revision 和当前资格截止时间。
4. Main 的每个 `open`、`next`、`choose`、`back`、`copy`、`renew`、`close` 命令都重新检查资格、版本、撤权和截止时间。
5. Query 只发送类型化意图。正文、授权 token、主体 ID、文件路径和剪贴板写入权不进入 renderer。
6. `renew` 获取新资格和新 snapshot。旧会话不能静默切换版本。

## 失败路径

| 情况 | API 或 Main 行为 | 用户结果 |
| --- | --- | --- |
| 没有已批准 graph snapshot | 返回正式 SOP 不可用；禁止 FAQ 或 synthetic fallback | 坐席继续选择普通话术，不能误以为进入了 SOP |
| 租约过期、撤权或版本失效 | 返回资格错误并清理会话和图片句柄 | 不能继续 next、copy 或 renew 旧内容 |
| snapshot hash 在会话期间变化 | 当前会话失效，要求重新 open | 不会混用两个 graph 版本 |
| graph 引用不闭包 | 发布前由数据库事务拒绝 | 不出现半棵流程树 |
| 必需图片失效 | 不返回旧句柄；节点是否可继续由媒体合同的 `required` 规则决定 | 不显示错误图片 |
| 可选图片失效 | 保留文字步骤并显示明确的图片不可用状态 | 不把图片失效伪装成正文正确 |
| API 网络或登录恢复失败 | 保留可恢复的会话意图，重新取得资格后再校验版本 | 不复制过期或撤权内容 |

## 方案取舍

| 方案 | 结论 | 原因 |
| --- | --- | --- |
| 直接扩展现有 `IntakeSnapshot` 的三个数组 | 否决 | 旧客户端把非空 graph 判为越权，且 FAQ 与 SOP 的分页、版本和引用语义不同 |
| 保留旧 snapshot，新增版本化 SOP 只读合同 | 采用为后续方向 | 资格和发布所有者仍可复用，旧客户端不受影响，Main 能按 hash 绑定 continuation |
| 在 API 侧把候选或 synthetic tree 转成正式 graph | 否决 | 会绕过 successor、业务审核和不可变 snapshot，无法证明来源、版本和撤权行为 |

## 进入实现的前置条件

1. 六表映射返回 `ready-for-graph-preparation`，所有入口、分支、归属、范围、可见对象和有效期都有证据。
2. `resume-v3` successor 正式冻结，并完成 OpenAPI、DDL 和 migration 摘要核对。
3. PostgreSQL 候选、审核、发布事务和不可变 snapshot 已通过正式迁移及回执验收。
4. API 生成正式合同和 runtime validator，Main 建立独立的 graph adapter。
5. Query 完成 `open / next / choose / back / copy / renew / close` 的权限、版本、过期、撤权和恢复验收。

在这些条件满足前，正式 API graph 保持空，当前合成 SOP 只作为合成验证证据，不作为正式消费证据。
