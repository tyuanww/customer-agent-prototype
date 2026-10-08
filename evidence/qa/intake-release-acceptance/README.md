# 用途能力候选贯穿本机实际 HTTP / Electron 验收

状态：本轮限定的合成验收 PASS；正式运行装配仍未激活，完整外部 `/review` 仍是 INCOMPLETE。本轮基于产品 `cff9fa9b611a5f77de465b3a5ee1022c64027d9c`，版本保持 0.3.26。所有输入均是仓内合成 fixture，没有读取真实飞书员工、客户、店铺名单或凭据。

## 已实际运行

- `http-four-domains.log`：5/5。旧默认 profile 的 product 回归，加新 capability profile 下 product / campaign / presale / aftersale 各一次完整实际 HTTP 上传、解析、来源确认、质量冻结与逐项检查、确认直发、另一坐席资格和非空目录读回。每域候选的 scope 与请求域一致，内部说明不进入发布 entry 或 answerText。campaign 还验证缺失失效时间整批失败、原发布不变，并用 ExcelJS 读取下载的完整 XLSX，三行均为 EXPIRY_REQUIRED；有效活动的失效时间保留。
- `electron-mac.log`：当前 Mac 上实际 Electron 2/2。FAQ 流程包含原生 Main 读取实际文件、multipart HTTP 上传、解析错误报告保存并用 ExcelJS 读取、检查、原生确认框默认取消（没有发布请求）、再次确认发布、修订、取消候选、另一坐席查询及真实系统剪贴板比对。撤权在下一次实际查询发现后清除旧结果，旧复制句柄拒绝，剪贴板保持原值；不是即时撤权推送，也不是逐次复制的 HTTP 授权。回退流程实际生成新发布，另一坐席读取并复制历史内容。业务/查询/worker 都使用受限 capability 连接；组织池只预检，不计为组织写入。
- `candidate-guards.log`：实际 PG15 一项组合边界用例 PASS，加实验 adapter 3 单测 PASS。验证实际安装 migration ledger 指纹变化拒绝；环境 LOGIN 显式 SET ROLE 到 NOLOGIN capability 后通过；错误用途、多角色成员、REPLICATION、跨用途或 owner SET ROLE、身份安全列更新、组织事实更新、建表均拒绝。真实 parser 生成的候选用于取消记录测试：只准 pending→cancelled，冒充 publish / rollback、published 初态或非法后续迁移全部拒绝。
- `default-unit.log`：既有 assembly 生命周期 7 项及 adapter 3 项 PASS；不把重复的 adapter 计为新的覆盖面。
- `director-login.log`：为后续权限 UI 验收开放已 seed 的 director 测试身份，实际登录并读取 query 的 mayAllocate 投影通过；未新增经理根资格，也未提前声称权限 UI 已完成回收。
- 定向 lint、API / Desktop typecheck、API build、desktop electron-vite build 均退出 0。采用现有依赖直接运行 bin，没有 pnpm install。初始 pnpm build:services 因外置 node_modules 符号链接触发非交互 install 检查而拒绝，随后直接 tsc 构建本工作区各 package 与 API，正常完成；未更改锁文件或依赖目录。

## 可复现入口

PATH 需选择 Node 24 与 PG15；本机分别是 `/Users/hutou/homebrew/opt/node@24/bin` 和 `/Users/hutou/homebrew/opt/postgresql@15/bin`。使用已构建的本工作区 API 和 desktop 产物：

```sh
# repo root
CUSTOMER_AGENT_INTAKE_SYNTHETIC_TEST=1 node --test scripts/intake-synthetic/host.test.ts
# apps/api
CUSTOMER_AGENT_API_PG15_INTEGRATION=1 ./node_modules/.bin/vitest run tests/intake-runtime-candidate.integration.test.ts tests/intake-runtime-consumer-pool.test.ts
./node_modules/.bin/vitest run tests/intake-runtime-consumer-pool.test.ts tests/intake-runtime-assembly.test.ts
./node_modules/.bin/tsc --noEmit
# apps/desktop
./node_modules/.bin/tsc --noEmit
CUSTOMER_AGENT_INTAKE_SYNTHETIC_E2E=1 CUSTOMER_AGENT_INTAKE_PURPOSE_CANDIDATE=1 ./node_modules/.bin/playwright test tests/e2e/content-intake-real-stack.spec.ts tests/e2e/content-intake-rollback-real-stack.spec.ts
```

`checks.json` 绑定源码、候选 SQL、日志及本地截图 SHA。两份 Vitest 日志仅移除文件末尾多余空行，并保留规范化前的原始日志 SHA。Electron 日志对应的 SQL 六件与最终副本逐字相同；其后只扩展了已 seed director 的选择白名单、读取 campaign 报告的测试断言和元数据说明，分别用定向检查验证，不机械重跑已通过 Electron。截图保留在 `.gstack/intake-synthetic/`，未把数 MB 图片纳入 Git；已目视检查发布结果及另一坐席查询截图。所有自有连接归零、identity listener 关闭、PG / 文件临时目录删除均有断言。

首次 Electron 发现在旧候选缺 usage policy_versions SELECT，以及取消候选缺 business write_attempts 精确权限。修复均由治理候选所有者更新，本工作区重新复制并校验 SHA，没有测试临时 GRANT。中途一次回退复制按钮因窗口节点 detach 失败，下一次同测试、无强制点击或生产 UI 改动通过；它属于本机窗口验收的一次不稳定观测，不将其隐去，也不据此主张 OS 手动焦点验证完成。

## 未包含的结论

- 不代表 1.21 / schema1.23 已冻结、export、intake，或生产四池/能力账号已装配；没有改正式锁 SQL、migration、生产 app/server/factory。
- 没有真实飞书、真实员工/店铺显示名、来源认领或生产数据接入；copy 只证明已复制，不证明发送或业务有效。
- 原生文件/确认框返回由测试控制；实际 OS 文件读取、保存和剪贴板发生，但不冒充人工操作对话框、Stage Manager、Dock、Windows/Linux、签名/公证证据。
- 本轮完整 Electron 仅 product FAQ 和回退；四域分别上传成功是 HTTP 层验收，不声称四套桌面 Tab 已有独立 UI 验收。
- A 的权限列表/配置/撤销插件与桌面入口由主 Agent 回收后接到 management 的唯一 service，再单独验收；本提交不引入缺失模块或第二份 service。
- 本轮未重跑旧角色审核、历史全部 PG 矩阵或完整外部 review；主 Agent 负责集成后的全仓 lint/typecheck/test/build/workspace/document 门禁。
