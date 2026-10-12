# P2 管理端：上传文件到候选材料验收

日期：2026-10-07（Asia/Shanghai）。分支 `codex/content-intake-p2`，输入基线 `5e199d5`，本轮原始文件指纹及实测结果见 [verification.json](verification.json)。所有运行只使用隔离 PG15、合成产品登录与临时 loopback HTTP/对象目录；无真实飞书、员工或客户资料。

本轮交付六条冻结合同路径：上传对象、接收候选、读取解析任务、下载错误报告、读取候选、分页读取材料。上传后返回服务端对象摘要；接收后由有界串行队列实际解析，整批失败保留旧候选。候选版本和材料摘要保持一致，坐席与跨店请求被拒绝。正式 API 工厂、数据库应用 ACL 和桌面管理入口未接入本模块。

## 所有者与恢复语义

- `management-http.ts` 只在合成宿主显式注册，内部构造强制真实产品会话的服务；私有认证引用不克隆。持久接收后返回 202，最多 10 个在途解析，关闭宿主会取消并等待自有队列。
- `files.ts` 复用旧有界 multipart 与对象存储，拥有对象登记、服务器摘要、永久操作回执、租户对象预算、材料分页和 Excel 报告输出。每个来源动作仍由现有授权谓词裁决；上传/解析前后及报告读取后复核会话和当前权利。
- `service.ts` 继续拥有解析和候选冻结。崩溃后用原 receive 参数及 operationId 恢复 reading/parsing 任务；GET 读取实际终态。终态回执重放不生成新报告。事务结果未知时保留对象，只有确定无引用时回收临时副本。
- `http-boundary.ts` 统一封装新管理接口与既有使用接口的认证引用、固定公开错误和严格分页解码；没有新增通用 renderer 能力。

## 审核与修复

按 `open-code-review-delegate` 生成文件清单和规则，由父宿主逐项审阅源码、测试和文档，详见 [review-coverage.json](review-coverage.json)。上次提交的同内容审核证据复用；本次不调用外部模型，也不把历史外部超时或校验失败改写成通过。

已修复并实测：

1. 共享 multipart 读取器会裁去原文件末尾的 CRLF。修复后完整保留原始字节，并拒绝终止边界后的多余数据。新增回归先失败、后通过，旧 CSV 导入测试同时通过。
2. 父审及宿主内对抗初审均发现终态 receive 重放生成无引用错误报告。两次原生回归复现磁盘对象增长，修复后重复重放仍是 2 个文件、2 条对象记录、1 条任务；两个并发失败收尾只留下一个权威报告。未知提交的对象保留及重试恢复仍通过。

原生对抗审查对测试/fixture 仅看统计摘要，父宿主读取完整测试差异并实际执行。提交前的最终零修改复审与绑定收据由仓库 gstack review 记录保存，不能由本验收文档替代。

## Exploratory QA and Verification Results

| 字段 | 结果 |
| --- | --- |
| 验证面 | API、文件流、解析 worker、持久事务、Excel 实物消费 |
| 环境 | macOS / Node 24.19.0 / pnpm 11.19.0 / PostgreSQL 15 |
| 权限与隔离 | 自有临时 PG 集群、合成身份、临时对象目录、随机 loopback 端口，测试结束清理 |
| 检查范围 | 根 lint/typecheck/test/build；资料事务、multipart、相邻 usage HTTP；架构/工作区/文档 |
| smoke | 300 秒上限；到期后仅继续已列明的缺陷复现、维修和必要复验，未重置时钟 |

| 合同 | 实际结果 | 状态 |
| --- | --- | --- |
| 成功、幂等、分页 | 实际 HTTP XLSX → 服务端 SHA-256 → 一个持久候选；多页内容与 key 一致，跨会话游标拒绝 | PASS |
| 身份、权限、不可信输入 | 未登录/坐席/跨店/伪造主体及正文行/额外 multipart 字段均拒绝，禁止状态未写入 | PASS |
| 会话变化 | 上传 I/O 后注销不登记对象；解析 I/O 或队列执行前注销不冻结候选，任务收尾为明确失败 | PASS |
| 文件限制与取消 | 文件/元数据超限、重复/缺失部分、错误 MIME/边界拒绝；停滞流到期销毁；队列关闭会终止自有任务 | PASS |
| 丢包、重复、并发 | 上传 COMMIT 丢失响应保留文件并原键恢复；改字节冲突；终态重放无额外文件；并发收尾唯一报告 | PASS |
| 错误报告实物 | 坏修订整批失败且旧候选保留；下载 XLSX 由独立 ExcelJS 进程重新打开，报告只含错误坐标和修正说明 | PASS |
| 完整资料事务 | `content-intake.integration.test.ts` + material：112 项通过，其中管理链路 10 项 | PASS |
| 仓库检查 | lint/typecheck/test/build 全通过；默认测试 1837 通过、209 门禁跳过；架构 339 文件、0 越界 | PASS |

当前功能证据见 [functional-evidence.json](functional-evidence.json)。初次材料化早于补齐原命令复验，保留为本机历史；最终材料化使用未改写的原始收据和后续复验，结果为 PASS、无未关闭必验项。验证输入未变化时复用证据，不因写报告重跑构建。

- [checkpoint 002](exploration-002.json)：成功路径后验证坏修订和报告消费。
- [checkpoint 003](exploration-003.json)：验证 COMMIT 响应丢失后的恢复。
- [checkpoint 004](exploration-004.json)：终态重放泄漏首次失败证据。
- [checkpoint 005](exploration-005.json)：同初始夹具、同命令再次复现。
- [checkpoint 006](exploration-006.json)：修复后的原回归通过。
- [checkpoint 007](exploration-007.json)：10 项相邻管理链路回归通过。
- [checkpoint 008](exploration-008.json)：最终源码上的原成功命令复验。
- [checkpoint 009](exploration-009.json)：最终源码上的原报告消费命令复验。
- [checkpoint 010](exploration-010.json)：最终源码上的原未知提交恢复命令复验。

## 下一阶段的具体入口

下一段由管理 API 继续复用 `evidence.ts`、`quality.ts`、`publication.ts`，把来源确认 → 人工审批证据核验 → 候选质量 → 发布与只读状态串起来，再由 Main 的窄 adapter 接入管理界面。先逐条核对冻结 HTTP 响应：例如 cancel 的内部候选返回值不能直接当正式 `IntakeReceipt`；目前质量操作的内部服务存在，但冻结 OpenAPI 尚无对应路径，需按所属仓治理处理后才能接线。

下一段验收需证明：来源/材料/贡献人任一变化会使旧审核失效；关键变更由合格非参与者复核；资格撤销、审核不可用或质量未过不能发布；重复发布和响应丢失只产生同一发布结果；最终由现有 Query 读取这次发布的原文。飞书网络仅在获批 transport 中接入，不用合成结果冒充真实飞书审核。

## 未验证与边界

完整管理界面、审批/质量/发布 HTTP 全链路、真实飞书与真实数据、生产启用尚未完成。本轮没有桌面交互或窗口代码变化，因此未重复 Electron、打包态或 Windows/WSL 实机验证。大错误报告的峰值 RSS 未做压力验收；现有 parser 输入/输出边界及单导出并发限制不是生产容量结论。没有 push、PR、合并或部署授权。本机详细日志在 `.gstack/content-intake-management/`，临时测试服务与 PG 由测试夹具关闭。
