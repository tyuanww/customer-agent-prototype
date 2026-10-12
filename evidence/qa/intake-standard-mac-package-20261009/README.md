# Mac 标准尺寸安装副本合成验收 · 2026-10-09

产品分支 `codex/intake-organization`，构建输入为本地提交 `332119ea77f7d3a03f41eab4f5dd88a2002d2767`，版本保持 `0.3.26`。本轮只用合成身份、CSV/XLSX 与临时 PostgreSQL 15；不读取真实飞书、员工或客户资料。此前同一原版上传测试因实际显示器只有 960×600，无法恢复到 1180×760；那次失败记录保留。本轮系统显示器已变为逻辑 1470×956；新包八份 Electron 身份记录的工作区均为 1470×829、scaleFactor 2。

## 实际产物与测试

原有 `release/local-unsigned/` 已原样移至 `release/preserved-before-standard-332119e-20261009/`。`pnpm package:mac:local` 退出 0，生成 Universal 本机未签名 DMG/ZIP，脚本后验通过。新 DMG SHA-256 为 `a7f71e887c393a1c77a7390cbb479b71ce073cab07df9e3010bf808470f7e3bb`；ZIP 为 `a69c12b20c3ee37d0b90b957d1b7dd46d3daa0ae3a0a8222c10e6dd2e6f59d43`。从 DMG 只读挂载并用 `ditto` 复制到 `.gstack/intake-standard-package-332119e-20261009/installed/`，没有覆盖 `/Applications`。解包副本与构建目录的 `app.asar` SHA-256 均为 `9e655e34c5228f54f71ceda82e6ab14d27b14a784d1c914456848be08db5df86`；挂载点已卸载。

| 输入与命令 | 实际结果 |
| --- | --- |
| 开发态原版 CSV：`CUSTOMER_AGENT_INTAKE_SYNTHETIC_E2E=1 CUSTOMER_AGENT_INTAKE_PURPOSE_RUNTIME=1 CUSTOMER_AGENT_INTAKE_INPUT_FORMAT=csv pnpm --filter @customer-agent/desktop exec playwright test tests/e2e/content-intake-real-stack.spec.ts` | 退出 0，1/1。原测试未降高；实际恢复到 1180×760，紧凑 980×680 的布局断言也通过。 |
| DMG 解包副本、同一原版 CSV 用例；另设置 `CUSTOMER_AGENT_INTAKE_PACKAGED_EXECUTABLE` 为上述独立副本的绝对可执行文件路径 | 退出 0，1/1。`isPackaged=true`、版本、可执行文件和独立 userData 核验；CSV 上传、错误 XLSX 报告回读、修订、来源与质量检查、取消/确认直发、另一客服查询复制及撤权通过。 `dashboard-intake-light.json` 记录 1180×760、无页面或面板横向溢出。 |
| 同一解包副本，设置 `CUSTOMER_AGENT_INTAKE_SYNTHETIC_E2E=1 CUSTOMER_AGENT_INTAKE_PURPOSE_RUNTIME=1`，运行权限、四域工作台、回退和店铺目录四份 `content-intake-*-real-stack.spec.ts` | 退出 0，7/7：权限1、回退1、重名店铺1、产品/活动/售前/售后4。没有重复运行上一行的上传用例。 |

两次安装态命令合计 **8/8**，但属于两个实际执行批次。测试接到真实 Electron Main/preload、回环 HTTP、四个用途受限 PG15 池及系统剪贴板；原生文件选择、保存和确认框的**响应由测试控制**，因此不算真人操作 macOS 对话框或非开发维护者验收。截图和八份 `packaged-identity.json` 保存在 ignored `.gstack/intake-*`，未加入 Git；每个用例的临时数据库、服务与 userData 由原测试清理。新包没有签名、公证、自动更新或外发。

四份剩余测试的精确路径为 `tests/e2e/content-intake-permissions-real-stack.spec.ts`、`tests/e2e/content-intake-workspace-real-stack.spec.ts`、`tests/e2e/content-intake-rollback-real-stack.spec.ts` 和 `tests/e2e/content-intake-shop-directory-real-stack.spec.ts`；均由 `pnpm --filter @customer-agent/desktop exec playwright test` 执行，并显式指定上述解包副本。原版上传测试的截图目录为 `.gstack/intake-synthetic/2026-10-09T14-39-05-632Z/`；其中 `packaged-identity.json` SHA-256 为 `4e0ae8b46d129976d7f18d1ba696e74bde74616c8ef490803aa9816712ee4700`。这份身份记录及另外七份均显示 `isPackaged` 对应的 `packaged=true` 与同一显示器工作区；未从截图本身推断业务通过。

本轮把此前缺少的**当前 Mac 标准尺寸自动化合成证据**补齐；真实系统对话框、Stage Manager/Dock/焦点、办公 Windows、真实资料/具名主体、生产账号与正式接入仍按原事项验收。完整 `/review` 及 `externalCompleteReview` 保持 `INCOMPLETE`，不能用 8/8 代替代码审查或业务批准。
