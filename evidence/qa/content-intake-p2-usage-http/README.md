# 封闭 HTTP → 实际桌面会话 → FAQ 目录验收

2026-10-06，`codex/content-intake-p2`，基线 `90a72c57695b7d353622aa1cee9b476ddd060560`。仅合成数据、临时 PG15 和 loopback HTTP。没有注册生产入口、开启新 ACL 或接入真实数据。具体输入和命令以[验证清单](verification.json)为准。

## 本轮结果

- 新增 API 所属的资格/快照 Fastify 适配器，保留真实认证对象的私有会话绑定。参数不静默丢弃或覆盖，错误遵守 `IntakeError`，响应 `no-store`。
- 根探针实际装载 `ProductHttp`、`ProductSession`、`ContentIntakeUsage`；替换的只有显示名文件读取、凭据持久化和剪贴板出口。API 不直接导入桌面代码，凭据不进 argv/文件/输出。
- PG 中从合成 XLSX、来源证据、模拟人工审批、质量检查到实际发布 101 条 FAQ；首个 100 条页面超过 1 MiB，第二页完成后才交付目录。原文、多行文本、全停用新版及旧资格期限均实际消费验证。
- 选择变化取消请求，不能交付半目录；精确资格到期保留另一有效旧资格；撤权使新旧句柄均失效；复制只写原文，不代表发送或采纳。
- 旧 HTTP 默认 1 MiB 不变，Main 目录请求显式使用其 32 MiB 剩余预算；超限取消流。诊断不记录路径、query、token、任意异常名称或上游消息，仅保留状态、已知错误类别/errno、耗时。

## 审查与修复

使用 `open-code-review-delegate` 确定文件和规则，由宿主完整审核源码及测试；原生对抗 reviewer 的 fixture 覆盖为 summary-only，外部模型 unavailable，未重复调用历史超时的外部审核。清单见 [OCR 覆盖](ocr-coverage.json)。本次未重新审查已完成的整个分支历史。

首次审查确认三处问题，均已修复：

1. **P2，错误信封/消息泄漏**：诊断 sink 抛错使 Fastify 返回默认异常正文。永久回归先红后绿；现隔离诊断异常，始终返回稳定 `IntakeError`。
2. **P2，测试生命周期**：listen 后早期断言未在清理区，child 终止后未等待。现统一 try/finally，先释放 gate、限时终止并等待 child，再关 server。临时故障探针主动使早期断言失败，2.83 秒退出、close hook 一次、无 runner 强制退出警告；临时文件已清理。
3. **P3，历史计划记录**：正文替换误伤历史 baseline-edit JSON。已恢复 HEAD 原字节，CEO 19 条与 Eng 13 条均可解析且与基线完全相同。

修后 lint/typecheck/test/build、architecture/docs/workspace 检查通过；默认全量 **1801 passed / 191 gated-skipped**，显式 PG+材料 **95/95**，新 HTTP 边界 **15/15**。默认跳过的用例不计通过。修后原生独立零修改复审 **NO_FINDINGS**，本次 `/review` 编辑周期 1，completed/converged 均为 true；原首轮问题保留为已修复历史。OCR 19/19 路径完成（11 可审、8 补查、0 跳过）。

核心 receipt：`d14d809c-00e1-4b9b-96a3-195d0e034894`；原生 receipt：`75d42c54-2558-466a-8494-c0cade4c559c`。只读报告保存在本地 `.gstack/content-intake-usage-http/native-final.md`；最终核验 20 个输入和 10 份日志哈希一致。

## 功能 QA

结构化结果见 [functional-evidence.json](functional-evidence.json)。最终 capture 位于 qa-final；早期 HTTP capture 与 checkpoint 作为审查历史保留，不替代修后证据。

- [历史 checkpoint 002](exploration-002.json)：实际跨应用链路通过后，审查复现诊断 sink 异常；转向完整错误映射和修后失败路径验证。
- [历史 checkpoint 003](exploration-003.json)：错误回归通过后，重新验证下游实际消费。
- [最终 checkpoint 002](qa-final/exploration-002.json)：最终源上的 15 项协议边界通过后，验证相同源的真实 PG 发布目录与会话消费。

原生 reviewer 另完成 13 项独立合成重放，包含实际流读取的 deadline/取消、第二页预算扣减、资格局部到期及全局失效，并单独核验根进程终止后子进程无遗留。其数据库为最小认证 stub，不能冒充本仓真实 PG 矩阵。

## 下一阶段与未验证范围

下一切片先补齐桌面所需的授权店铺/来源读取和合成宿主装配，再接 Main factory、白名单 IPC、FAQ 查询界面。renderer 只能发选择/查询/复制意图；Main 保有凭据、选择代际、原文和复制资格，API 继续逐次授权。验收必须覆盖当前店铺持续可见、零授权店空态、切店立即禁用旧复制、晚到页面隔离、正常新版保留旧显示资格、撤权清空资格与原生窗口 sender/main-frame 拒绝。

上传/候选/审批/质量/发布管理界面的完整闭环、安装包、真实剪贴板与 Mac/Windows 原生窗口未测试；本次未执行杭州 WSL，旧 SHA 的 WSL 证据不升级为本提交证据。生产 ACL/activation、真实 Feishu transport、三方公开交付 EVD 和上线仍有各自条件。未 push、PR、merge 或 deploy；原工作区既有修改保留。
