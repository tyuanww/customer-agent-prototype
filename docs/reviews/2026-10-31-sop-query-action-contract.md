# SOP Query action 协议边界

状态：`REVIEW_ONLY_DESIGN`。

本文定义正式 graph 接入 Query 前的命令和失败语义。它是协议设计，不是 UI 视觉方案，不修改 renderer、preload 或 IPC。

## 两条并列路径

搜索命中 SOP 相关候选时，Query 同时保留两条路径：

1. 坐席继续复制普通话术。
2. 坐席主动打开 SOP，按流程执行。

进入 SOP 不是必经步骤。打开失败、过期、撤权或网络失败时，普通话术仍按自身资格和版本规则处理。SOP 成功打开也不隐藏搜索结果，直到坐席明确关闭流程。

## 命令数据形状

renderer 只发送以下字段：

```text
sessionId       不透明会话修订号
stepIndex       当前步骤修订号
sceneId         仅 open 使用的入口意图
nodeId          仅当前 projection 已显示的节点引用
edgeId          仅当前 projection 已显示的分支引用
scriptId        仅当前 projection 已显示的话术引用
targetStepIndex 仅 back 使用的已执行历史索引
```

renderer 不发送 entitlement、主体 ID、source ID、release ID、snapshot hash、正文、图片路径或剪贴板内容。Main 根据 `sceneId` 和当前资格解析其余事实。

## Action 语义

| Action | Main 行为 | Query 结果 |
| --- | --- | --- |
| `open` | 校验入口意图，读取已批准 graph snapshot，创建 continuation session | 展示当前步骤；失败保留搜索结果 |
| `next` | 只推进 action 节点的默认边 | 返回新 projection 或明确失败 |
| `choose` | 校验 edge 属于当前 node 和 snapshot | 返回目标节点；不接受 renderer 自造边 |
| `back` | 回退到当前 session 已执行历史 | 清除后续选择和复制状态 |
| `copy` | 重验资格、版本、正文和媒体关系，由 Main 写剪贴板 | 只返回“已复制”状态，不表示已发送 |
| `renew` | 重新获取资格和 snapshot | 成功后建立新 session；旧 revision 全部失效 |
| `close` | 清理 session、图片句柄、定时器和查询交接状态 | 回到搜索结果，不清空搜索词 |

`next` 和 `choose` 不能绕过必要核实项。`back` 不能跳到未执行节点。`copy` 不推进步骤，也不自动选择下一个分支。

## 结果投影

Main 只向 Query 投影当前步骤所需字段：

- 流程标题、版本状态和当前阶段。
- 当前 node 的指令、必要核实项、分支标签、可见知识和可复制话术。
- 已执行历史的受控摘要。
- 当前 session 修订号、是否可继续、是否可选择、是否已复制。
- 图片的短期受控引用和 `required` 状态。

投影不包含内部审核主体、来源原文、数据库 row ID、授权 token、永久对象 URL 或未授权节点。

## 失败路径

| 情况 | Main 行为 | Query 结果 |
| --- | --- | --- |
| 没有正式 graph | 返回 SOP 不可用，不走 FAQ 或 synthetic fallback | 搜索结果和普通复制仍可用 |
| open 入口无资格 | 拒绝并记录不可用原因 | 保留普通话术路径 |
| session 或 step revision 过期 | 拒绝命令，不改变当前状态 | 重新读取当前步骤 |
| edge、script 或 node 不属于当前 snapshot | 拒绝命令并使当前 projection 失效 | 要求重新打开 |
| 版本变化、撤权或过期 | 清理 SOP session 和图片句柄 | 普通复制也按其自身资格重新校验 |
| 网络或登录恢复失败 | 保留搜索结果和恢复意图，不重放旧 copy | 登录后重新 open 或继续普通复制 |
| copy 失败 | 不改变流程历史，不上报 adopted | 显示复制失败，可重试 |
| close 后迟到响应 | 丢弃响应 | 不恢复已关闭 SOP |

## 方案取舍

| 方案 | 结论 | 原因 |
| --- | --- | --- |
| renderer 直接调用 API 并保存流程状态 | 否决 | 暴露资格和正文边界，无法统一撤权、版本和剪贴板复核 |
| 用通用 IPC 转发任意 action | 否决 | sender、role、主 frame 和字段语义无法集中校验 |
| 使用独立、类型化的 Query SOP action 协议 | 采用为后续方向 | Main 拥有状态和副作用，Query 只传稳定意图，普通复制和 SOP 入口能并列存在 |

正式实现前必须完成 API snapshot 合同、Main continuation adapter、资格/版本/撤权重验收和第二坐席路径验收。本文不改变当前 synthetic Query 行为。
