# P1 本地合成交付证据 · 2026-10-04

本轮合同差集、合成模块和实际运行证据已落地。用户追加指定 OCR 复审后，30/30 可审文件已覆盖，新增来源绑定问题已修复，75 项定向回归与仓库级检查通过。当前提交前结论见 [OCR 复审记录](ocr-review.md)；此前 `/review` 未收敛及外部失败仍作为历史保留。此状态不签发正式合同、真实数据或上线权限。

- [合同差集与 P2 条件](../../../docs/reference-content-intake-p1-contract-gap.md)
- [运行配方](../../../docs/how-to-develop-content-intake.md)
- [当前 OCR 复审](ocr-review.md)、[历史 /review 与缺口](review.md)、[上一轮验证指纹](verification.json)、[三方合同核验](contract-audit.json)
- [实际探针 JSON](probe.json)、[历史 72 项回归](review-evidence/final-regressions.json)、[当前 75 项回归](ocr-validation.txt)

## 实际结果

| 检查 | 结果 |
| --- | --- |
| P1 定向 | 41 项解析/进程 + 34 项权限/审批，75/75 PASS |
| 仓库级 | `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` 全部退出 0 |
| 全仓测试中的条件项 | API 443 PASS / 91 SKIP；桌面 1095 PASS / 1 SKIP。SKIP 不算通过；PG 专项等未启动 |
| 模板/报告实物 | 生成并从磁盘重开有效文件、仅缺 C3 的无效文件和错误报告；有效两行、多行正文保真、无效恰好 `FAQ!C3 REQUIRED`、阻断时无部分结果 |
| 500 行，10 次 | 进程总时长 p95/p99 146.14 ms，峰值 RSS 92.25 MiB |
| 5000 行，10 次 | 进程总时长 p95/p99 292.15 ms，峰值 RSS 193.42 MiB |
| 取消/调用方 | 取消至退出 1.75 ms；Node 调用方事件循环 p99 12.06 ms；取消后可继续解析 |
| 出站/数据库 | 成功探针观测到网络入口调用 0，DB 查询 0（本轮没有 DB 调用） |

环境：Node v24.19.0 / pnpm 11.19.0 / macOS Darwin 25.5.0 arm64 / Apple M5。每种输入 n=10，尾值是样本最大值，不是 SLA。原始实物在工作区 `.gstack/content-intake-p1/`，按运行配方可重新生成；生成后 SHA 会随 ZIP 元数据变化，本次 SHA 已逐个重读校验并记录。

新增解析生产依赖路径审计无剩余公告；**全仓 audit 仍非通过**：40 high / 18 moderate / 4 low，含沿用的开发工具链。未扩大到全仓升级，见 verification.json 的审计范围及日志指纹。

## 本轮证明的边界

解析包拥有固定模板、格式/资源预算、错误坐标与隔离子进程；API experiments 拥有身份/岗位上限/业务授权的交集、独立分配资格、候选摘要、人工审批和提交点纯判定。生产 API/renderer/preload/DB 与现有 owner-only 运行规则未接新路径。正式 upstream 锁仍为 1.14.0；已核验 1.15.0 export 但没有 intake。

P1 覆盖 G05/06/07/08/10/12/13/14/25/26/27/29 中与本地规则、进程、实物及纯时间模型相关的子路径，**不将任何整组端到端 G01–G31 标为完成**。G07 是同库 direct/process 一致，未接真实 Main/API；G26 是纯状态转移，未证明后台接管队列；G27/29 使用合成官方形状和时间事实，未证明真实传播或 PG 原子性。

## 后续条件与 Git

1. 用户指定的 OCR 完整复审及修正复核已完成；正式 FAQ 接线仍需下述治理与集成验收。
2. 在治理仓版本化协调多店/委派、候选/审批证据、旧 coach/owner、dual-review、域整体替换；正式 export/intake 后才接 API/DB/Main。
3. P2 完成“FAQ 上传→服务端复算→持久候选→审核→原子发布→第二坐席按店查询”，并补 PG 竞态、幂等/未知提交、IPC 失败闭环与实际打包进程。
4. 真实工作簿/员工/飞书租户、OS 内存/出站隔离、Electron Main 与 Windows/Linux 实机、签名/公证均未验证。

分支 `codex/content-intake-p1`，基线 `8ab309f`。本记录随已获用户追加授权的 P1 本地提交交付。原工作区的 TODOS.md 和原未跟踪计划保留；push、PR、merge、deploy 均未授权执行。
