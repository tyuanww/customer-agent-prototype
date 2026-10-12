# FAQ 第一组：坐席适用条件验收（2026-10-08）

范围：`codex/content-intake-query`，依赖基线 `9a175ac`，仅 loopback 合成 FAQ profile。对应[计划 §0.45](../../../docs/plans/2026-10-03-content-intake-requirements.md#045-第一组query-商品场景选择与店铺显示名差集2026-10-08)。[运行/测试输入 SHA-256](inputs.json)用于绑定本次结果；后续纯文档整理不改变被测代码。

## 交付与边界

- 复用冻结词表 GET、数据库 vocabulary/displays、原 query 权限及 entitlement/snapshot；没有新合同版本或迁移。最新菜单显示名不改写已发布正文及其绑定的显示版本。
- Main 完整读取有界词项菜单，校验 ID/种类/范围、分页、时限；每次查询仍需新使用资格。换店重置条件，换条件撤旧结果/复制，保留问题、手动再查询。renderer 没有 token、任意 API 或剪贴板正文写入权。
- 多选、清除、名称查找位于结果区；88px 胶囊和 600px 查询宽度保持，展开/收合/查找复用原测量/ACK。使用现有 Query 颜色、字体和控件 token。截图为实际 Electron 合成运行：[筛选及适用话术](selectors.png)。
- 店铺仍显示 ID。正式名称缺口已形成[最小合同候选](../../../docs/reference-content-intake-p2-contract-handoff.md#第一组店铺显示名差集2026-10-08候选未冻结)，未批准、未接入，不计完成。

## 实际验证

环境：Mac arm64、Node 24.19.0、pnpm 11.19.0、隔离 PG15。测试身份、审批、工作簿和正文均为合成。

| 命令/检查 | 实际结果 |
| --- | --- |
| `pnpm lint`、`pnpm typecheck`、`pnpm build` | PASS；新 worktree 首次检查缺未生成 workspace 包，构建后修正类型/调用方并重验 |
| `pnpm test` / 构建后 `pnpm test:built` | 最终完整链 PASS。首次回归发现旧输入重复上报 SEARCH_INPUT 和 IPC 白名单测试未同步，修复后整链复跑。桌面 136 文件、1304 项通过，6 文件/7 项按原门禁跳过；API 485 通过、279 跳过；contracts 9、retrieval 56、parser 27，以及入口/架构/产物/工作流检查通过。跳过的 PG 专项不算通过 |
| PG：`CUSTOMER_AGENT_API_PG15_INTEGRATION=1 pnpm --filter @customer-agent/api exec vitest run tests/content-intake.integration.test.ts -t 'vocabulary:|usage: filters product'` | 2 PASS；普通坐席、未知/重复参数、HEAD、跨店/会话/limit游标、改名失效、撤权；产品/场景/时间先过滤再分页、所选 ID 持久化。其余175项未在此命令运行 |
| Main/IPC/Query 定向回归 | 118 PASS：旧/未知复制键、跨店/跨种类/重复词项、取消/条件切换后迟到快照、到期、排序后过期、输入/IME及既有布局协议 |
| `pnpm --filter @customer-agent/desktop exec playwright test tests/e2e/content-intake-query.spec.ts` | 1 PASS（5.9s），真实 Electron/preload/Main/HTTP/clipboard，服务为 wire double。登录、多店、词项选择、键盘空格、清除条件、问题保留、未自动查询、错误态清除、88px胶囊、结果区定位/展开增高、资格过期与其他窗口拒绝。[输出](electron.txt) |
| `CUSTOMER_AGENT_INTAKE_SYNTHETIC_E2E=1 pnpm --filter @customer-agent/desktop exec playwright test tests/e2e/content-intake-real-stack.spec.ts tests/e2e/content-intake-rollback-real-stack.spec.ts` | 2 PASS（28.1s），实际 API/PG/Electron 上传、修订取消、发布及独立回退，普通坐席消费；仅原生路径选择和身份/人工审批是合成适配。[输出](real-stack.txt) |
| `pnpm workspace:check`、`pnpm docs:check`、`git diff --check` | PASS；历史忽略目录中的8个检查点从依赖 worktree 原样带入，未伪造/改写历史记录 |

## 审查与修复

OCR delegate 按最终工作树列出的18个文件（13个实现、5个JSON证据）全部审阅，0跳过，规则和范围来自实际 CLI；测试与文档由执行者补充核对。[审查记录](review.json)。独立 in-host adversarial 审查发现2项 P2，已修复并复审：

1. 筛选展开/收合和名称输入未触发窗口测量 → 接入现有 layout ACK，不增加另一套几何。
2. 正常切换条件残留失效错误、控件随结果状态重挂载 → 当前成功响应重置待查询视图，筛选节点稳定；勾选即时反映意图，Main 接受前禁止查询，失败清空。

原生复测同时发现受控复选框等待 IPC 时短暂回弹，现已即时显示意图且保持 busy 门禁。早期 E2E 的“合成/ASCII词应零命中”断言与字符检索行为不符，改用不与通用正文重合的合成词验证选择过滤，没有更改检索算法。

`/review` 的本机核心及 native 复审完成，无遗留已知发现。外部 Claude Code 补充审查输入约89KB、限时180秒，超时且没有完成响应：[原始状态](outside-review.json)。外部结构化 gate 为 MISSING COVERAGE，不声明双模型通过，也不据此执行 ship/对外交付。

## Exploratory QA and Verification Results

本次 `/review` 的有界 functional smoke 复用隔离 PG15 测试：一个 probe、3883ms、exit 0，成功与拒绝边界均有断言，包括最终持久的资格上下文和消费内容。[捕获回执](pg-receipt.json)、[原样输出](pg-observation.json)。无后续探索，因此没有 checkpoint；没有浏览器探索评分。测试宿主自行清理数据库/临时应用目录，原始截图与日志保留在本 worktree 忽略的 `.gstack` 目录。

限制：本轮没有重跑全177项 PG事务矩阵、完整十倍历史负载或5000词项原生渲染性能；不把有限数量样例当容量验收。Windows/WSL 没有运行此新版本，真实焦点/拖动、普通账号和整机断网继续按现场条件办理。真实组织刷新、飞书审批 transport、生产factory/ACL、店铺名称以及正式激活未完成。本地 commit 不等于 push、PR、合并、部署或全 P2 验收完成。
