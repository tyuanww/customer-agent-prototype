# Mac FAQ 安装副本验收（2026-10-08）

> 证据交付边界（2026-10-12 校正）：下文 `.gstack/` 文件只在原本机工作树保留，未随 Git 交付，远端审阅者不能据此直接复核原始执行。本文保留历史观察及其限制；这些本机路径不是仓内可点击证据，也不证明当前版本通过。
产品运行基线 `b091c9e8de1149cd69d102e80243b884697a237c`，分支 `codex/intake-organization`，版本 **0.3.26**。本轮只给既有 E2E 增加可选打包执行入口并更新文档，没有修改运行源码、角色规则、合同或生产装配。用户授权本地实施/验证/commit；没有 push、PR、合并、部署或真实数据接入。

## 实际结果

| 合同/场景 | 实际结果 | 证据 |
| --- | --- | --- |
| `pnpm package:mac:local` | PASS；Universal DMG/ZIP、资源/许可证/显式 offline 配置、未签名状态及无更新元数据的既有后验通过 | `package.stdout.log` |
| 消费分发产物 | PASS；只读挂载 DMG，ditto 复制到本轮专用目录；app.asar 与构建结果一致，0.3.26，未覆盖 `/Applications` | `install-dmg.stdout.log`、`installed-artifact.json` |
| 打包态完整业务闭环 | 最终 1/1 PASS；`isPackaged:true`、安装副本 executable、独立 userData；将开发 origin 置为无效仍用文件 profile 成功 | `packaged-final.stdout.log`、`packaged-identity.json` |
| 原生窗口真实操作 | 最终 1/1 PASS；CUA 选择合成 XLSX；取消时零发布请求、发布数0，再确认后发布数1、审批/审核绑定0 | `native-final.stdout.log`、`native-observations.json` |
| 变更检查 | 定向 eslint、desktop typecheck PASS；docs/workspace 最终值见 `checks.json` | 测试脚本和文档为本轮变更面 |

完整业务场景实际执行有界文件读取、multipart、真实 API/PG15 的组织/business/worker/usage 用途池、服务端解析子进程、错误报告落盘并用 ExcelJS 重开、整批更正、同 ID v2 修订与重新补证、来源确认和逐条质量检查、取消/确认直发，以及另一普通坐席读取原文/系统剪贴板。还验证取消未发布候选不撤回 live release、撤权后拒绝旧复制、越店拒绝；没有旧 search/announce 或组织审批请求。图形截图和实际产物留在 ignored `.gstack/qa-reports/intake-mac-package-20261008/`，摘要由 `checks.json` 绑定。FAQ parser 属于 API 服务端，不在桌面安装包中。

原生窄探针继续使用同一安装副本和正式用途合成 host，未替换文件对话框。`showMessageBox` 仅包装原函数记录真实返回值，没有伪造响应；CUA 最新 AX 确认后点击取消/确认，动作时间与返回时间相隔约0.3秒，发布计数由实际 DB 检查。截图后的自动退出来自测试完成后的清理，不解释为产品崩溃。它是工具操作实机，不是非开发维护者人工验收。

## 原始失败与 QA 汇总

- Capture 003 首次已运行实际包，但将 `/var/...` 与 macOS 返回的 `/private/var/...` 当不同目录，断言失败；改为比较 `realpath`，未放宽版本、可执行路径、isPackaged 或业务断言。最终004通过。
- Capture 005 已用真实文件框选择合成文件并显示原生确认框，但在成功执行 CUA 取消前已得到 response1；输入来源无法确定，不推断“弹窗自动确认”或产品缺陷，也不计为取消验收。保留原记录；006使用新临时库、紧接当前 AX 操作和时序记录完成取消/确认验证。
- QA helper 的原始 `evidence.json` 整体 verdict 为 **inconclusive**，open 为 `capture 003 superseded`：004重跑使用不同截图目录，工具按精确 argv 未将其认作同命令闭合。保留该结果，不重写为全绿，不为消除此标记重跑。最终具体场景的PASS与这份汇总分别陈述。
- 已审运行源码未变化，复用上一轮根 lint/typecheck/test/build 和角色/四域工作台证据；打包命令实际重新构建了服务与桌面。本轮没有新增外部审核，不覆盖或改写历史完整 `/review` 的 INCOMPLETE。

## 输入与设备边界

全部运行输入均由合成 host 生成，未导入用户 `faq` 原文件。用户目录本轮仅只读表头/结构统计；Menokin、飞书表格导出CSV和首批总监/经理只是来源范围元信息，当前生产账号、绑定、密钥与运行激活未完成。新链仍只支持统一 XLSX；当前包结果不能冒充 CSV 验收。

Node24.19.0、pnpm11.19.0、PG15.18、Electron43.4.0，当前 Mac arm64。Universal 中的 x64 架构存在不等于 Intel 实机运行；办公Windows、普通账号/非开发维护者修错、可靠拖动、Stage Manager、整机断网、签名公证及真实飞书均未由本轮确认。当前 workspace 源码占用36.7MiB／32MiB，预算仍失败，根规则通过；未清理历史或放宽阈值。

每次探针的自有 Electron、PG进程、数据库/对象和临时userData已结束并清理，日志有 `OWNED_RESOURCES_REMOVED`；DMG已卸载。安装副本与DMG/ZIP保留供后续本机查看，不作为可对外发布包。根工作区原 TODOS/规划文件未触碰。

## 复现与探索记录

[打包态复现命令](../../../docs/how-to-verify-desktop.md#faq-mac-安装副本合成验收)。精确 argv、环境、起止时间、原始日志SHA和产物SHA在 `checks.json`。临时原生探针使用本轮目录中的 `native.config.ts` / `native-dialog.spec.ts`，需要 CUA 在真实文件框选择探针刚生成的合成文件，然后取消/确认；不得把用户原表作为选择对象。该脚本仅本机证据，不是新增产品流程。

- checkpoint 002（本机历史文件 `.gstack/qa-reports/intake-mac-package-20261008/exploration-002.json`） — 构建后消费真实 DMG。
- checkpoint 003（本机历史文件 `.gstack/qa-reports/intake-mac-package-20261008/exploration-003.json`） — 安装副本完整场景首轮。
- checkpoint 004（本机历史文件 `.gstack/qa-reports/intake-mac-package-20261008/exploration-004.json`） — 对齐物理路径后重跑。
- checkpoint 005（本机历史文件 `.gstack/qa-reports/intake-mac-package-20261008/exploration-005.json`） — 真实原生框，首次输入来源不明。
- checkpoint 006（本机历史文件 `.gstack/qa-reports/intake-mac-package-20261008/exploration-006.json`） — 最新 AX 与时序绑定后的实机取消/确认。
