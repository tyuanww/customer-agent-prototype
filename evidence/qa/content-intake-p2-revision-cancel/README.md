# P2 候选修订与服务端取消合成验收

基线：`fcda90ca7137478c3653fd4cf73add337ba9af1f` 后本轮差异。环境为 macOS 26.5.2 arm64、Node 24.19.0、pnpm 11.19.0、PostgreSQL 15.18。全部工作簿、人员、来源及审批均为合成输入；OpenAPI 1.19.0 / schema.v1.21 无变更。

## 实际行为与边界

当前可变候选提供「修订当前候选」：Main 固定完整旧键与来源，接收完整修订 XLSX。整批校验失败保留旧版及证据；成功生成同一候选的下一版本，来源、审批和质量证据重新建立。修订完成后选择新文件创建独立候选；取消文件选择保留原结果，失败修订重选文件保留旧键。

「取消当前候选」要求独立 candidate-cancel 资格与确认，使用现有 API 的精确版本取消合同。未知结果沿用 Main 原操作编号、原正文，通过取消回执或原请求重试确认；不把停止本机等待、关闭窗口或清除本地准备当成服务端取消。终态不再提供修订/取消，已发布内容不因取消另一候选而撤回。

继续复用 `ContentIntakeUpload` 与 `ContentIntakeManagement` 的所有权，不新增控制器、通用 IPC 或 renderer 身份/候选键输入。UI 沿用 DashboardWorkspace、侧栏、字体、圆角及深浅色 token；取消按钮复用既有危险操作配色。边界方案和授权见[计划 §0.31](../../../docs/plans/2026-10-03-content-intake-requirements.md#031-候选修订与服务端取消接线2026-10-07)。

## 已修复问题

1. 导入资格撤销后，修订目标在视图隐藏，旧管理检查因此允许切换候选。现在以 Main 持有的状态阻止切换，允许用户清除尚未提交的本地准备。回归先失败、修复后通过。
2. 修订成功后选取新文件仍沿用已消耗的旧键，导致连续上传失败。真实 Electron 首轮发现，补充回归证明修前失败；在接纳新文件时清除已完成目标，取消对话框和失败修订仍保留目标。
3. 权限投影过期且网络不可用时，清除本地准备被无关的权限 HTTP 刷新阻断。父审查与原生复核均确认；先用管理层回归复现，再仅令 upload-reset 跳过该刷新。现有会话、active、未知提交、质量草稿与解析任务门禁保留，测试明确验证无 HTTP 也能清理及 pending/parsing 仍拒绝。

采用 `open-code-review-delegate` 确定文件和规则，父审查完整检查源码与测试；`/review` 原生对抗复核检查生产代码及调用方，测试/fixture 仅以摘要交给独立复核。最终逐文件清单和零修改复审记录在本工作树 `.gstack/qa-reports/content-intake-revision-cancel-20261007/`，不包含外部模型审查。

## 实测结果

精确输入/日志/截图 SHA-256 与命令见 [verification.json](verification.json)。

| 检查 | 结果 |
| --- | --- |
| 根 lint / typecheck / test / build | 全部通过 |
| Main、严格 IPC 与组件定向测试 | 95 项通过 |
| 桌面默认测试 | 1,282 通过，6 项按宿主条件跳过 |
| API 默认测试 | 476 通过，247 项按环境条件跳过 |
| contracts / retrieval / content-intake / database | 23 / 9 / 41 / 27 项通过，编译产物消费者亦通过 |
| PG15 专项 | 6 项通过；历史取消回执及会话归属、坏修订整批阻断与报告回读、取消/撤权先于发布、发布先于取消、双修订竞争与防复活 |
| Electron → 实际 HTTP → PG15 → 坐席 | 最终 1 项通过（19.3 秒）；错误报告实际落盘回读、坏修订保旧、好修订换版、重新审批/质量检查、v2 发布、另一候选取消、普通坐席查询并复制修订原文 |
| 深浅色及最小窗口 | 1180×760 和 980×680 几何断言，无整体或面板横向溢出；原生 select/checkbox 保留可见性 |

首轮 Electron capture 001 失败，日志保留，截图目录改存 `native001-failed`。修后 capture 002 通过；capture 003 按原命令完成复验，截图输出到 `native001`。随后原生复审发现离线清理缺陷，修复后在 `final-revalidation/001` 对新构建再次完整通过；最终截图来自 `final-revalidation/native`。父目录和最终复验的 QA 工具 verdict 都为 pass，不把首轮失败记成成功。探索学习记录：[checkpoint 002](../../../.gstack/qa-reports/content-intake-revision-cancel-20261007/exploration-002.json)、[checkpoint 003](../../../.gstack/qa-reports/content-intake-revision-cancel-20261007/exploration-003.json)。全部测试拥有的 PG 与 Electron 临时目录由 finally 清理并断言移除。

截图：[工作台深色](dashboard-intake-dark.png)、[修订材料](dashboard-revision-v2.png)、[取消终态](dashboard-cancelled.png)、[坐席已发布修订稿](query-published-faq.png)。

## 未验证与下一步

原生文件选择仅替换路径选择，其余文件读写、解析 worker、认证 HTTP、事务、窗口及剪贴板实际执行。该证据不能代替人工 macOS 文件对话框、Windows GUI/合成器、WSL 后端、签名安装包或真实飞书审批验证。默认跳过项未计入通过；145 项完整 intake PG 矩阵未重复执行，本轮针对新增消费者运行上述 6 项及真实栈 E2E。

下一步是平台验收：从审阅后的同一 Git SHA 准备 Mac 原生选择/保存及杭州 Windows GUI、WSL 后端验证，复用现有合成宿主和测试入口；WSL 后端通过不能记为 Windows 桌面通过。正式飞书 transport、真实工作簿/员工、运行 ACL 与生产 activation 继续走各自批准流程。

本轮未 commit、push、PR、merge 或部署；上一候选 `fcda90c` 保留。本轮新增差异提交待用户审阅授权，原工作区 TODOS 与未跟踪规划未动。
