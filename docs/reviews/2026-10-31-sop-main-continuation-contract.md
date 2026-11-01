# SOP Main continuation 状态与权限边界

状态：`REVIEW_ONLY_DESIGN`。

本文定义正式 graph 进入 Electron Main 前的状态机和命令边界。它不修改 `SopWindowController`、IPC、preload 或 renderer。

## Main 的唯一状态

正式 SOP 使用独立的 `GraphContinuationSession`。它不复用 synthetic tree 的 `SopTree` 作为数据源，也不让 renderer 保存流程状态。

```text
idle
  └─ open → opening
                  ├─ graph + qualification valid → ready
                  ├─ expired / revoked / version drift → unavailable
                  └─ network or login recovery → resumable

ready ── next / choose / back / copy ──> ready
ready ── renew ──> opening
ready ── close ──> closed
resumable ── fresh login + recheck ──> opening
unavailable / closed ── open ──> opening
```

`ready` 必须同时持有以下内部事实：

| 事实 | 用途 | 是否下发 renderer |
| --- | --- | --- |
| `sessionId` | 拒绝旧命令和迟到响应 | 只下发不透明修订号 |
| `snapshotHash`、`snapshotVersion` | 固定当前 graph 版本 | 只下发版本状态，不下发治理摘要 |
| flow identity、当前 node ID、历史路径 | 计算 continuation | 只投影当前步骤和受控历史 |
| entitlement、release、context generation | 每个命令重验资格 | 否 |
| `validUntil`、revocation generation | 过期和撤权清理 | 只投影可读的截止状态 |
| selected script、checked requirements | 当前操作意图 | 只投影选择结果 |

## 命令合同

renderer 只发送 `sessionId`、当前修订号和命令所需的稳定 ID。Main 不接受正文、授权 token、主体 ID、source ID、任意 snapshot hash 或文件路径。

| 命令 | Main 行为 | 成功条件 |
| --- | --- | --- |
| `open` | 按场景入口读取已批准 snapshot，建立 session | graph、资格、范围和有效期全部通过 |
| `next` | 只允许 action 节点的默认下一步 | 当前必要核实项已完成，目标节点仍在同一 flow |
| `choose` | 按 edge ID 选择分支 | edge 属于当前节点，目标节点仍在同一 snapshot |
| `back` | 回到已执行历史节点 | 目标是当前 session 的历史，不能跳到未执行节点 |
| `copy` | 再次核验资格和正文版本，由 Main 写系统剪贴板 | 话术属于当前节点，正文和媒体关系仍有效 |
| `renew` | 重新申请资格并读取新 snapshot | 新版本通过当前权限和有效期检查 |
| `close` | 清理 session、选择、图片句柄和定时器 | 关闭后旧命令全部失效 |

复制成功只表示“已复制”。它不表示“已发送”、客户已看到、坐席已采纳或问题已解决。

## 每个命令的复核顺序

1. 验证窗口、角色、主 frame 和不透明 session 修订号。
2. 重读当前资格、release、context generation、撤权代际和截止时间。
3. 确认当前 `snapshotHash` 仍是已批准版本。
4. 校验 node、edge、script、media 的归属和引用闭包。
5. 执行纯状态转换。
6. 只把受控 projection 发给 renderer。

网络失败不能跳过第 2 步。登录恢复不能复用旧 entitlement 或旧图片句柄。旧 snapshot 不能因为重新登录而自动换成新 snapshot。

## 失败路径

| 情况 | Main 结果 | renderer 看到的结果 |
| --- | --- | --- |
| 没有正式 graph | `UNAVAILABLE`，不查 FAQ 或 synthetic tree | 可以回到普通话术 |
| session 修订号过期 | `INVALID`，不改变当前状态 | 保留当前步骤，要求重新读取 |
| 资格过期或撤权 | 清理 session 和媒体句柄 | 流程关闭，不能继续复制 |
| release 或 snapshot 变化 | 标记 `unavailable`，禁止混用版本 | 提示内容已更新，重新打开 |
| 图片句柄失效 | 丢弃句柄，不显示旧图片 | 按媒体 `required` 规则显示不可用 |
| copy 写入失败 | 不推进历史，不报告发送 | 显示复制失败，可重试 |
| 未知提交结果 | 只恢复原操作，不创建新版本 | 保持原步骤，等待状态确认 |
| close 后迟到响应 | 丢弃响应 | 不恢复已关闭流程 |

## 方案取舍

| 方案 | 结论 | 原因 |
| --- | --- | --- |
| 继续扩展现有 synthetic `SopWindowController` | 否决 | 它从 synthetic tree 读数据，无法拥有正式 snapshot、资格和撤权事实 |
| 新建第二套完整 UI 和 IPC | 否决 | 会复制 renderer 状态、剪贴板和窗口协议，增加权限漂移 |
| 新增正式 graph adapter，复用 Main 的窗口和剪贴板边界 | 采用为后续方向 | Main 继续拥有副作用，graph adapter 只拥有 snapshot 会话和状态转换，renderer 只消费 projection |

正式实现前必须满足：业务映射 ready、successor 已冻结、API 返回版本化 snapshot、PostgreSQL 发布回执已验收。此前只保留当前 synthetic controller 和 review-only 设计。
