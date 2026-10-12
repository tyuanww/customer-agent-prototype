# P2 Mac 原生对话框与 FAQ 模式复核

日期：2026-10-07。基线 `fcda90ca7137478c3653fd4cf73add337ba9af1f`，覆盖上一轮的[候选修订与取消](../content-intake-p2-revision-cancel/README.md)。本轮只使用合成资料、临时 PG15 和本机随机 loopback 端口；不代表真实飞书或正式运行获准。

## 实际完成

- 真实 macOS `open-panel`：取消选择后保留 source-a/shop-a 与等待文件状态；选择坏工作簿后，上传准确报告 FAQ 第 3 行 C 列必填错误。
- 真实 macOS `save-panel`：保存完整 XLSX 报告，实际产物 6614 bytes，由 ExcelJS 重新读取并断言 `FAQ / 3 / C / REQUIRED`；SHA-256 见 verification.json。
- 从原生对话框重新选择修正文件，参与人勾选重新确认后形成候选；原生确认取消后，候选及操作回执显示「已取消」，发布按钮禁用。宿主到期前未独立读取最终 DB 状态，因此这一条是原生 UI/操作记录证据；数据库不变性由完整 E2E 补证。
- 工作台沿用现有侧栏、浅色背景和紫色强调色。此次没有改视觉 token、布局或原生窗口几何；深浅色/尺寸矩阵复用[设计对齐验收](../content-intake-p2-design-alignment/README.md)。

原生操作和 AX/屏幕观察位于本次对话 cua_repl 回执；没有保存原生对话框截图。完整本地观察、charter、失败记录和报告实物位于 ignored `.gstack/qa-reports/content-intake-mac-dialog-20261007/`，可在该工作区复核，但不会随 Git 归档携带。

## 先审查、复现，再修复

OCR delegate 主审确认两项 FAQ 模式隔离遗漏，未调用外部模型：

1. QueryCapsule 隐藏智能检索开关时仍向辅助技术提供 MiniMax 说明。修复为说明与同一 `intake` 分支同时隐藏；旧模式文字与开关保持原行为。
2. FAQ 不创建旧公告服务，但共享 Fox 仍读取窄 `unread` 能力，Main 未注册 handler。Main 复用既有 null 服务注册器返回不可用投影；保留 sender/role/main-frame 校验，无旧公告实例或网络/磁盘副作用。

另修正三处测试自身的问题，均保留原业务断言：FAQ 工作台等待标题副作用完成后再断言，并在删除 bridge 前先卸载；资产确定性测试按狐狸 PNG 与 Dock 图标两项独立合同拆分，两个原验证块逐字不变且仍受默认 5 秒限制；过期授权样例只生成一次固定过期时间，避免两次回读因跨毫秒而意外模拟了权限变化。生产生成器、品牌资产、授权时限和错误优先级均未改动。

两个产品回归均先失败再通过：组件断言捕获实际残留文本；真实 Electron E2E 捕获主进程 stderr 的缺 handler 日志，不能仅靠 renderer `pageerror`。修复后另启一次 Mac 原生应用，查询 AX 不再有旧说明，启动日志没有 `product:announce-unread` 缺 handler。

## 验证和证据边界

定向 QueryApp/FoxApp/公告 IPC/FAQ 工作台共 **152 PASS**；完整 Electron/API/PG 的坏文件→报告回读→修订→重审→发布→独立候选取消→普通坐席查询复制通过（26.3 秒）。E2E 验证无旧 announce/search HTTP；其系统对话框仍只 stub 路径，不能冒充上述单独原生对话框证据。

**最终根全量检查通过**：使用 verification.json 记录的单 worker 环境执行完整 `pnpm test`，退出码 0。contracts 23、retrieval 9、intake 41、database 27、API 476、desktop 1283、artifact 9、architecture 19、workflow 81 项通过；API 247 和 desktop 6 项按既有环境门禁跳过。资产 6 项及授权发现 12 项定向通过。根 lint/typecheck/build、152 项定向和真实 Electron/API/PG 的有效证据保留；最终两处改动只涉及测试，未改变产品构建输入。

最终检查、被测源文件和产物哈希见 [verification.json](verification.json)。此前报告读取脚本曾因自身相对路径错误失败，修正后重读相同实物成功；根 test 与 build 并发曾触发合同生成锁，随后资产测试及默认并发的生成代码类型检查超出既有 5 秒限时；两者独立复跑均通过，API 单 worker 为 476 PASS / 247 skipped。另一次桌面全量暴露上述标题测试时序；资产拆分后的全量又暴露过期授权 fixture 两次回读的期限漂移，均完成根因修复。资产独立计时约为 3068ms + 1955ms，合计 5023ms，解释了旧组合用例超过 5 秒的原因。历史失败日志保留，最终完整命令通过；未改锁、测试超时或跳过规则。

Mac 两次手动宿主、两次 E2E 的自有 PG/对象/profile 均已清理。退出阶段仍可观察到 `intake-query:cancel` 在 handler 撤销之后到达的诊断，未据此推断运行期功能失败；不将该日志隐瞒为「所有日志零错误」。

本候选未执行 Windows 原生 GUI、WSL 当前版本测试、安装包/签名/公证或真实审批。用户补充 SSH 账号与既有密钥用法后，已完成只读连接核验：Ubuntu 24.04.4 / WSL2、Node 24.21.0、pnpm 11.19.0、nobody 与 systemd 可用。首次 SSH 超时，随后经 Tailscale 中继连接成功；未将中继状态解释为已建立直连。当前工具链显示 PostgreSQL 17.11，约定的 PostgreSQL 15 路径不存在，`xvfb-run` 不在 PATH；没有安装依赖、启动远端测试或修改生产服务。用户于 2026-10-07 明确授权本批经审查与修复后执行本地 commit，范围包含候选修订/取消、本轮修复及证据。远端验收还需要准备符合计划的隔离环境，并在本批本地提交完成后绑定完整 SHA。未 push、创建 PR、merge 或部署。
