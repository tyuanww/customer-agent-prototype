# P2 使用资格与按店目录验收

2026-10-06；分支 `codex/content-intake-p2`；基线 `bfa68aa`，功能提交 `c97dc80`；两端最终被测提交 `45a533088d11af09bdf237bb87d441e3100466b3`。仅合成 XLSX、审批响应及临时 PostgreSQL。没有生产路由/ACL、Main/renderer 或真实数据接入。

## 交付

`issueEntitlement` / `snapshot` 复用既有事务、原离线租约和正式返回 validator，统一绑定会话、当前店、上下文代际、商品/场景选择和来源代际。每页重验主体/业务授权、全目录承继审批、原来源及 owner 门，截止取各事实/权限/内容边界/租约的最早值。普通新发布保留旧资格原期限，实际撤权/撤销/过期拒绝读取。

坐席页只含允许字段，保留完整多行正文、独立问法版本及原词项显示版本；内部/附件说明不下发。停用、过期、不适用商品/场景和其他店内容在分页前排除；SOP/media 实际为空。无第二 current 或新 schema/依赖。

## 验证与修复

- Mac：Node 24.19.0 / pnpm 11.19.0 / PostgreSQL 15.18；定向 85 项（77 PG + 8 material）通过；全仓 lint/typecheck/test/build、文档和目录检查通过。命令、退出码和日志摘要见 [checks.json](checks.json)。
- 5,000 行原生目录完整消费 50 页，无重复或漏项；Mac 该用例连同建库、上传、审批、质量、发布约 4.69 秒，不代表生产 SLA。
- /review 功能冒烟：2 次 capture / 8 项通过，包含第二坐席成功消费、六类失效和词项预算。原始安全观察见 [evidence.json](evidence.json)，下个探针在执行前由 [checkpoint 002](exploration-002.json) 记录，章程见 [charter.md](charter.md)。临时 PG/对象目录由 harness 清理。
- 独立审查发现的词项预算缺陷已复现并修复：单页 vocabulary 最多 100，但合法多条/单条引用可超限。现在单条准入与发布预检共用上限，多条自动提前分页，不截断、不跳行。111 词项用例修复前失败，修复后两页 80/31 完整输出；下一份单条超限材料在审批前 FILE_LIMIT 拒绝，发布计数不变。
- 开发阶段修复租约微秒时间经 JS Date 截断导致的签发失败：改为 SQL 内保留 issued_at。该行为与 [node-postgres 时间类型说明](https://node-postgres.com/features/types)一致；未放宽数据库约束。另修正合成时间样例、测试候选引用和循环类型标注。

杭州 WSL 首轮为 83/85：两个精确五分钟 fixture 因重复 `clock_timestamp()` 相差微秒而违反约束；统一为 `statement_timestamp()` 后，Mac 和 WSL 最终均为 85/85，WSL API typecheck/build 同时通过。生产约束未变。

杭州最终环境为 Node 24.21.0 / pnpm 11.19.0 / PostgreSQL 15.19。从精确 Git SHA 归档，在无特权 transient unit 中遮蔽生产目录、限制写目录并使用独立临时 PG；最终测试代码及锁文件哈希与 Mac 一致。5,000 行/50 页完整链约 8.80 秒，不是生产 SLA。测试结束后已删除自有源码、依赖缓存与临时目录；没有切换现有服务。命令、限制、首轮失败及清理证据见 [wsl.json](wsl.json)。

## 审查与覆盖

OCR delegate 只做文件选择和规则解析，宿主完整审读含默认排除的测试/文档；清单见 [ocr-coverage.json](ocr-coverage.json)。本机独立对抗审查发现 1 项并完成修复复审；最终无确认遗留缺陷。fixture 为 summary-only，未独立执行测试，宿主承担真实运行与完整测试源码检查。两个最终 review_binding 均 verified，详见 [review.json](review.json)。

2026-10-06 应用户要求再次执行 OCR delegate，复核 `bfa68aa..2dfae03` 全部 18 个文件（包含默认排除的 7 个测试/文档文件），无跳过、无新增确认缺陷。复查权限与会话绑定、最早截止、承继审批、分页预算和字段投影；实现无需再改。核验 67 个被测输入及 12 份检查日志哈希，确认当前代码/测试/依赖与两端通过 85 项的 `45a5330` 一致，复用既有运行证据；本次只更新复审记录，不声称新增运行或外部审查通过。详细绑定见 [review.json](review.json) 的 `hostRereview`。

历史外部两次 540000ms 超时仍是缺失覆盖，本轮无重试/换模型。没有把本机复审算作外部审查；也未重新确认最新远程 Git 头。原工作区 TODOS.md 和未跟踪规划保持原样。

## 下一步与未验证范围

[合同交接](../../../docs/reference-content-intake-p2-contract-handoff.md#下一阶段入场与验收)已明确两个差集：商品/场景选择的正式传输与会话绑定、单条最多 200 引用和快照词项上限 100 的协调。当前仅封闭 adapter 注入选择；默认不把未选择商品/场景的受限行下发。

正式版本化 intake 后再接 Main 当前店/使用资格、失效扇出及原生客户端。显式 family、旧内容认领/初始基线、真实飞书 transport、正向 owner 承接整包消费仍有独立验收。WSL 只能证明 Linux 后端；Windows 原生 preload/sandbox、窗口、复制及实际 Mac 桌面交互本轮未验证。没有 push、PR、merge 或部署。
