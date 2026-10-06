# FAQ Query 原生合成接线验收

基线 `a995ac14bdca458a6122f256c0c4a039f5a5d2fa`，`codex/content-intake-p2`，2026-10-07。授权与边界方案见[计划 §0.18](../../../docs/plans/2026-10-03-content-intake-requirements.md#018-桌面-query-原生接线2026-10-07)。入口和命令以[开发说明](../../../docs/how-to-develop-content-intake.md#p2-桌面-query-合成入口)为准。

## 本轮行为

显式 loopback `faq-v2` profile 使用实际 ProductSession、Main、白名单 preload 和 Query 窗口。用户选授权店铺，查询时重新取得完整使用资格；复用 retrieval-core 返回通用 FAQ Top 3，展示真实合同字段与多行原文。Main 只接受当前展示的复制 key，原生剪贴板写入其拥有的原文。复制成功仅表示已复制。

店铺发现与检索取消各有生命周期。跨店、注销、迟到响应、已知撤权和资格截止不能继续展示或复制旧内容；普通新版不会主动清空仍有效结果。Main 同步索引受 5000 条及 2 MiB 检索文本预算约束，超限整次失败；计算后让出事件循环并复核资格。新 profile 的 Dock 激活打开 Query，原生菜单/托盘不提供工作台，Main 拒绝直接打开；默认 profile 保留原有 Dashboard 行为。

## 代码审核与修复

采用用户指定的 `open-code-review-delegate`：OCR 做确定性选文件/规则解析，宿主审核代码及完整测试；`/review` 增加宿主内独立对抗复审。独立审核对测试/fixture 只看统计与覆盖概要，覆盖减少明确记录。最终冻结差异的结论与绑定由本地 gstack review-log 保存，不把历史或本轮未执行的外部模型审核写成通过。

| 已确认问题 | 修复及证据 |
| --- | --- |
| 打开或编辑查询触发 cancel，误取消正在读取的店铺菜单，原生登录后得到 STALE | 分离发现与检索取消；002/003 连续复现，004 修复复验，007 最终原生通过，009/010 覆盖并发 |
| 店铺加载完成会收起待确认告知 | 最新 reset 回调保留告知/加载门禁，不重启发现；010 的 QueryApp 回归 |
| 同步 BM25 计算期间资格到期仍可能返回正文，合法大目录可能长时间占用 Main | 增加输入预算，计算后让出循环并复核原资格；009/010 覆盖计算中到期与整次 LIMIT |
| 旧资格到期可能取消正在请求的新结果 | 过期事件仅撤旧正文/复制，保留新检索；010 覆盖新资格完成并复制 |
| 新通道未加入原有白名单期望 | 补齐精确通道断言；最终全仓测试通过 |
| FAQ profile 的 Dock/托盘仍能打开未接线的工作台 | Main capability 与三类原生菜单统一受 profile 约束；007 拒绝直接打开且无 Dashboard，008 默认 Dock 回归 |
| FAQ 卡片折叠多行原文 | 专用卡片使用 pre-wrap；007 验证实际样式和系统剪贴板原文 |
| 新授权段落误混入历史 autoplan JSON 注释 | 恢复历史注释原字节，仅在正文新增 §0.18；最终 diff 核对 |

未建立第二份授权算法、快照指针或窗口几何状态机。组织审核、资料发布和生产授权归属不变。

## Exploratory QA and Verification Results

本机 macOS、Node 24.19.0、pnpm 11.19.0；合成 HTTP wire 测试自建两个 loopback 服务与私有临时 userData，结束清理。五分钟 smoke 未重置，之后只做必要修复复验。旧失败和旧通过均保留，最终所测源文件、合同和依赖摘要见[验证清单](verification.json)。

| 检查 | 实际结果 |
| --- | --- |
| `pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm build` | 全部通过；默认测试 1829 passed、199 gated-skipped，其中桌面 1151 passed、3 skipped；跳过不计通过 |
| Main/profile/IPC 定向检查 | 009：23/23；跨店、迟到、撤权、取消、预算和信任边界 |
| Main/usage + Query component | 010：141/141；包含 96 项 QueryApp、4 项结果组件测试 |
| 原生 Electron FAQ 流程 | 007：1/1；实际登录窗口、Main/preload、原生剪贴板、切店、过期/撤权/恢复、无命中和能力隔离 |
| 默认模式 Dock 回归 | 008：1/1；实际 Electron activate 事件打开并恢复原工作台 |
| 架构边界 / workspace | 336 个文件、0 违规；约 23.4 MiB / 32 MiB，均通过；文档 191 个 Markdown 引用核验通过 |

定向套件与全仓测试有重叠，不能相加为独立覆盖数。[功能证据](functional-evidence.json)保存原始观察、状态和工具生成回执。实际 Query 窗口已目视核对多行展示；截图留在忽略目录，未形成全平台视觉验收。按最终 sourceInputs 核对后复用未改输入的结果。

- [checkpoint 002](exploration-002.json)：从 Main 检查进入原生流程。
- [checkpoint 003](exploration-003.json)：相同输入复现 STALE 菜单。
- [checkpoint 004](exploration-004.json)：修复独立取消后原生复验。
- [checkpoint 005](exploration-005.json)：补验告知及相邻 Query 逻辑。
- [checkpoint 006](exploration-006.json)：原生截图观察，历史版本。
- [checkpoint 007](exploration-007.json)：最终原生入口隔离、多行原文与主流程。
- [checkpoint 008](exploration-008.json)：默认 Dock 行为回归。
- [checkpoint 009](exploration-009.json)：当前 Main/profile/IPC 输入复验。
- [checkpoint 010](exploration-010.json)：当前 Query 并发与告知回归。

## 未验证范围和下一切片

本轮为店铺通用 FAQ：商品/场景选择为空，只取不限商品/场景条目。店铺只显示合同中的 ID，正式显示名目录尚未接入。HTTP 是 wire double；此前封闭 PG → HTTP → Main 探针证据独立保留，本轮不冒充重跑了实际 API/PG 完整闭环。原生自动化不代替人工 Dock/Stage Manager/跨应用焦点验证，也未运行 Windows GUI、杭州 WSL 或安装包验证。

下一步将管理端的上传/解析错误修正、冻结审核材料、审批状态、质量检查、发布恢复接成合成纵向流程，并让本轮 Query 消费真实隔离 API 发布结果。已有 API/数据库/解析模块应复用，不重建合同。可验收条件：阻断错误整批阻止送审、缺行不删除、审批与候选版本一致、关键变更独立复核、发布幂等且可恢复、坐席只获得当前店铺有资格的已发布版本。商品/场景筛选与显示名目录另按现有合同边界接入。

生产 factory/ACL/activation、真实飞书 transport/凭据、真实员工/客户数据、正式资料来源和三方 EVD 仍按既有专项流程；本轮只做本地提交，不含 push/PR/merge/deploy。
