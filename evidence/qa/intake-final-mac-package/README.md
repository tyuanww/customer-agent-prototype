# Mac 安装副本合成验收 · 2026-10-09

**状态：PARTIAL。新安装副本的 FAQ 业务闭环通过；当前屏幕不足以完成原测试的标准尺寸门。** 这不是正式数据接入、人工设备验收或发布批准，也不改变完整外部 `/review` 的 `INCOMPLETE`。

## 输入与产物

- 独立工作区：`/Users/hutou/.codex/worktrees/intake-menokin-readiness/customer-agent-prototype`，构建 HEAD `953a5552cac127df50b03bff5966962e4d1d0951`，功能基线 `01d7a0c6ef965a7e36a0578168b92d04038ea298`；版本保持 `0.3.26`。
- [输入清单](inputs.json) 记录 235 项桌面打包输入、193 项合成宿主/后端/测试输入。构建与测试后重新计算，全部未变；与回收中的集成树 `ba9279b90d522cb6b63ef5f0accf69c23e4f1f42` 对应输入全部相同。文档提交不等于新的运行输入。
- 依赖从已有安装用 APFS 写时复制隔离到本树，无 `pnpm install`。1,729 个符号链接没有跨回集成树或断链；186 个本地 bin wrapper 的原绝对路径改到本树。服务 `dist`、桌面 `out`、`release` 和安装副本均独立。
- 使用现有 `pnpm package:mac:local`，含实际服务构建、桌面构建、universal DMG/ZIP 和脚本后验，退出码 0。脚本未调用 `workspace:check`。本分支尚未回收任务 A，单独执行预算检查为 40.4 MiB / 32 MiB、exit 1（根目录规则通过），见 [日志](workspace-check.log)。此结果只绑定本独立树，最终预算必须采用主 Agent 回收 A 后的集成树检查；不能把打包通过写成预算通过。
- 只读挂载新 DMG，复制到本任务目录，卸载挂载点；没有覆盖 `/Applications`、用户已安装应用或旧集成树产物。路径、尺寸与 SHA-256 见 [安装产物](installed-artifact.json)；实际 `isPackaged: true`、版本、可执行路径和全新 userData 见 [运行身份](packaged-identity.json)。
- 本机为 macOS 26.5.2 / 25F84、arm64、Node 24.19.0、pnpm 11.19.0、Electron 43.4.0、PostgreSQL 15.18。仅 local-unsigned，无签名、公证、自动更新或外发。

## 实际执行及失败边界

第一轮直接运行现有 `content-intake-real-stack.spec.ts`：**1 FAIL，17.7 秒**，没有进入上传。980×680 明暗主题、表单字体和横向溢出检查已过；恢复 1180×760 时，macOS 返回 1180×680。只读原生屏幕探针确认当前唯一显示器为 **960×600，工作区 960×485，scaleFactor 2**，低于产品最小窗口。[首轮原始日志](package-e2e-original.log) 与 [屏幕几何](display-probe.json) 均保留，没有改显示设置或产品窗口约束。

为完成不依赖 760 高度的业务验证，使用原测试的临时副本，**只将恢复尺寸从 1180×760 改为 1180×680**；980×680 检查及其余业务断言保持原样。[唯一差异](compact-variant.diff) 与 [原件/副本摘要](compact-variant.json) 可用于复核或重建。临时副本已删除，原测试与产品代码未改。

第二轮：**1 PASS，15.0 秒**，见 [紧凑尺寸原始日志](package-e2e-compact.log)。这两轮不能合写成一次全绿验收。所有结构化结果、日志摘要与保留截图位置见 [checks.json](checks.json)。

## 本轮确认的行为

既有合成宿主先实际应用当前 35 段迁移，再配置四个用途受限登录池；临时 PG15、HTTP、上传字节和 XLSX 错误报告都是真实本机运行，内容与身份为合成 fixture。

1. CSV 缺失正文时整批拒绝；实际保存并读取错误 XLSX，定位 `CSV!H3`。
2. 修正后形成候选，确认来源、逐条人工质量检查；修订失败保持旧候选，成功修订为同一候选 v2，要求新的来源与质量证据。
3. 第一次原生二次确认返回取消，未产生发布请求；再次确认才直发，`approvalRows = 0`，未调用审批入口。
4. 取消另一份未发布候选，已发布版本保持不变。
5. 另一普通客服查询到三条修订后的合成 FAQ，实际剪贴板与正文一致；撤销查询授权后新查询与旧结果复制都被拒绝，跨店铺选择被拒绝。
6. Dashboard 的 sandbox / contextIsolation 为 true、nodeIntegration 为 false；无 renderer 错误。用途查询计数为 business 2,157、usage 427、worker 40、organization 30。

两轮自有 PG 与 userData 均已清理并核实不存在；挂载点已卸载。新 DMG/ZIP、安装副本和截图留在本工作区忽略目录，供本地复核；二进制和截图没有加入 Git。

## 仍须完成或另用证据确认

- **当前 Mac 标准尺寸门**：在可容纳 1180×760 的实际显示环境，重跑原测试。紧凑尺寸通过不能代替该项；不需要因此再次重建输入相同的包。
- **人工系统行为**：本轮原生选文件、保存、确认的响应由测试控制；不能冒充人工文件对话框、焦点、Dock、Stage Manager、Gatekeeper 或安装信任提示验收。
- **范围**：本轮是 product FAQ 的安装态 CSV 闭环；不包含非空旧目录发布/回退，也没有新增四域安装态验收。相关既有 PG/桌面证据保留各自边界，不重复全量重跑或合并成此轮通过。
- **办公 Windows**：本轮没有 Windows 实机证据。此前办公机的旧版本安装记录不能证明本版本通过；新版 FAQ 运行档仍限定 loopback，需落实本机隔离合成宿主或另获准的正式装配后，再做实际安装、文件对话框、IME/DPI、查询复制与撤权检查。没有把 Mac 服务地址直接当作 Windows 正式配置。
- **正式接入**：真实飞书、Menokin 正文、具名负责人和生产配置未被读取或激活；正式运行准备仍按现有事项办理。

主 Agent 回收 A/C/D 等提交后，应将最终 SHA 与 `inputs.json` 两组逐项比较；相同才可把这份包和受限结论关联到最终提交。任何真正运行输入变化都需要针对影响重建或重验，不能只改记录中的 SHA。
