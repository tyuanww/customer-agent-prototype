# docs/plans 索引

> 本目录保存**带日期的历史计划**。它们记录当时的批准、设计与证据，属于只增不删材料：可以追加勘误，但不覆盖已发生的记录（见 [产品文档生命周期](../reference-document-lifecycle.md) §2）。
>
> 本页只做导航。**现行入口**以 README 的[文档表](../../README.md)和[执行清单](2026-09-06-execution-goal.md)为准。

## 怎么读这个目录

- **文件名 = 日期 + 主题。** 日期是写下的那天，不是最后修改日。
- **小桩（几百字节）不是缺陷。** 09-19 那天按「一个切片一个文件」写了约 50 个 P4 / P7 / P10 / announce / docs 切片，每个几行拍板。它们当时是工作单元，现在是历史。
- **零入链是正常的。** 历史计划不必被 README 链接。别因为「没人引用」就删——那正是本目录存在的意义。
- **现行计划也在本目录。** 目前 `2026-09-24-office-owner-publish.md` 是唯一仍带未闭合任务（T9 办公机秒表）的现行计划。

## 现行 / 仍被引用

| 文件 | 为什么还在用 |
| --- | --- |
| [2026-09-06-execution-goal.md](2026-09-06-execution-goal.md) | 当前一期任务、证据与下一动作的唯一入口 |
| [2026-09-24-office-owner-publish.md](2026-09-24-office-owner-publish.md) | 一人发布方案；T9 办公机秒表尚未闭合 |
| [2026-09-10-windows-package-and-device-verification.md](2026-09-10-windows-package-and-device-verification.md) | Windows 安装包与实机方案入口（状态 DRAFT，未批准开工） |
| [2026-09-16-real-sku-replacement-input-contract.md](2026-09-16-real-sku-replacement-input-contract.md) | 真实 MENOKIN SKU 替换输入格式（准备件，未实施） |
| [2026-09-07-natural-language-search.md](2026-09-07-natural-language-search.md) | 候选展示规则仍有效 |
| [2026-09-10-macos-semantic-query-freeze.md](2026-09-10-macos-semantic-query-freeze.md) | 桌面检索冻结点 |
| [2026-09-05-script-selection-preparation.md](2026-09-05-script-selection-preparation.md) | 已暂停的探索备忘，不是上线前置 |
| [2026-09-19-local-unpushed-merge-order.md](2026-09-19-local-unpushed-merge-order.md) | 已合入 main 的分支合入记录 |
| [2026-09-18-mac-dev-remainder.md](2026-09-18-mac-dev-remainder.md) | Mac 开发机收口边界 |

## 历史阶段（按主题，不逐个列）

| 阶段 | 文件范围 | 说明 |
| --- | --- | --- |
| 产品化立项 | `2026-08-21-customer-agent-productization.md` | 最早的产品化全景（133 KB，历史最大） |
| DEV-M0 W0–W6 | `2026-08-31-*` ～ `2026-09-03-dev-m0-w*` | 合同 codegen、API bootstrap、migration 控制面、readiness、CI 退出 |
| DEV-M1 搜索 | `2026-09-03-dev-m1-search-events.md`、`2026-09-04-g1a-*`、`2026-09-08-g1a-supplement.md` | 搜索主链与 G1a 合成验收 |
| Owner 验收 | `2026-09-06-owner-*`（5 个）、`2026-09-06-astra-agents-audit.md` | 合同消费、装配、merge 前置 |
| 检索决策 | `2026-09-08-search-*`、`2026-09-10-*retrieval*` | 自然语言、否定修复、混合检索、MiniMax pipeline |
| 桌面集成 | `2026-09-09-desktop-integration-preparation.md` | D0–D5 合成桌面设计真源 |
| 交付形态 | `2026-09-16-desktop-delivery-shape-review.md`、`2026-09-17-office-machine-delivery-path-decision.md` | 办公机可用性评审与路径决策 |
| 登录身份 | `2026-09-17-login-identity-design.md`、`2026-09-17-synthetic-dual-login.md`、`2026-09-18-identity-c-password-and-feishu.md`、`2026-09-18-login-environment-and-ui.md` | 飞书 OAuth + 产品自管账号（方案 C） |
| 远端 P4 / P6 / P7 / P9 / P10 | `2026-09-19-p*`（约 35 个小桩） | origin 隔离、HTTPS profile、证书代理、Linux 打包与 userdata |
| announce 与文案 | `2026-09-19-announce-*`、`2026-09-19-docs-*`、`2026-09-19-fix-feishu-*` | 租约头、失效语义、文档口径、飞书修复 |
| 内容闭环 | `2026-09-20-script-ops-content-loop.md`、`2026-09-20-inaccuracy-contracts-intake.md`、`2026-09-20-live-published-scripts.md`、`2026-09-20-dashboard-hydrate-window-label.md` | 话术库 ops、不准落库、hydrate 生效窗口 |

## 相关目录

- [docs/reviews](../reviews/) — 带日期的审查材料（2 个）
- [docs/acceptance](../acceptance/) — 检索验收 JSON 与 manifest
- [内容导入与发布合同](../reference-content-publish.md) — 现行实现参考
