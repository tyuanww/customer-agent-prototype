# DEV-M0-W6 退出收口执行记录

> **文档状态：** `APPROVED · EXECUTION RECORD`
> **切片状态：** `IMPLEMENTED LOCALLY · AWAITING REMOTE CI`
> **基线：** `main@49a574a9ff763c64550d87b9e97cf033caf12f90`
> **分支：** `codex/dev-m0-w6-exit-closure`
> **边界：** 只收口 CI、Windows 可行性 smoke、正式服务候选产物隔离和退出文档；不新增业务端口，不接 desktop/真实数据/飞书，不部署、不发布、不激活 runtime

## 1. 工作流与 TODO

| Lane | 产出 | 当前状态 | 完成判据 |
| --- | --- | --- | --- |
| A · canonical CI | 根 `pnpm check` + Linux clean checkout | 本地 PASS，远端待跑 | 合同、漂移、lint、typecheck、test、build、artifact、workspace 全绿 |
| B · PG15 | 独立 PostgreSQL 15 CI | 本地 database 10/10、API 18/18 | CI 使用临时 PG15 cluster 全绿 |
| C · Windows | hosted Windows 定向启动/透明 overlay/快捷键 E2E + 未签名 package | 待远端 runner | 标记 `FEASIBILITY-SMOKE`，并保留真实设备/签名边界 |
| D · artifact | 非部署型 contracts/database/API 候选 + manifest/verifier | 本地 41 files PASS | Git SHA、合同来源与逐文件哈希一致；无 desktop/testkit/source map/凭证标记 |
| E · docs | 产品仓、治理仓动态状态与生成视图 | 产品仓候选已回填；治理仓待产品合并头 | W5/W6/M0 状态一致，冻结历史不改写 |

执行依赖：A/B/C/D 可由 CI 并行；E 只能在产品仓 W6 合并 SHA 和 CI 结果确定后最终回填。DEV-M1 必须晚于 DEV-M0 退出证据和新的明确授权。

## 2. 实现

- `.github/workflows/ci.yml`：三个并行 job，分别运行 Linux canonical check、PostgreSQL 15 integration 和 Windows feasibility smoke。
- `pnpm check`：单一非设备总门，避免 CI 逐条重复完整测试。
- `scripts/build-m0-formal-candidate.mjs`：只在干净工作树自行执行全包构建，再从 contracts/database/API 输出组装严格类型白名单候选集；排除 database testkit/source map，写入绑定 Git/合同来源的逐文件 manifest。
- `scripts/formal-artifact-boundary.mjs`：只在干净工作树复核目录成员、哈希、仓库 intake 合同身份、候选锁与仓库受控锁、构建提交必须等于当前 HEAD、不可部署/未激活声明、符号链接、未知文件类型、桌面合成模块、E2E 开关和常见凭证格式。
- `scripts/formal-artifact-boundary.test.mjs`：覆盖允许合同枚举、桌面 fixture 泄漏、未知文件类型、GitHub fine-grained token、内部/根目录 symlink、缺失根目录和旧提交候选拒绝八条正反例。
- workspace 清理 allowlist 增加 `release/m0-formal-runtime-candidate/`，生成证据不堆积在源码工作区。

## 3. 本地证据

环境：Node `v24.19.0`、pnpm `11.19.0`。

| 命令 | 结果 |
| --- | --- |
| `pnpm test:artifact-boundary` | PASS，8/8 |
| `pnpm check` | PASS；合同 `VERIFIED_NOT_ACTIVATED`、132 schemas、9 migrations、四包 test/build、41 文件候选产物与 workspace policy 全绿 |
| `pnpm test:db:integration` | PASS，10/10，隔离 PostgreSQL 15 |
| `pnpm --filter @customer-agent/api test:integration` | PASS，18/18，含真实 PG15 runtime/schema/ACL 探针 |
| `git diff --check` | PASS |

Node 25 下 `workspace:check` 曾按设计返回 `NODE_RUNTIME_MISMATCH: 25.8.2`；切换到受支持 Node 24 后全门通过，未放宽或绕过版本门。

## 4. 未完成与不代表

- 远端三条 CI lane 尚未执行，因此本记录不能先写 DEV-M0 PASS。
- Windows hosted runner 结果只能登记可行性 smoke；真实企业机器的 IME、DPI、多屏、High Contrast、Narrator、全局快捷键、GPU 透明窗、签名/更新仍属 M3/发布门。
- 候选产物没有 node_modules、运行配置、auth/storage/content 或部署描述，明确不可部署；它只证明构建隔离。
- 真实 N-1 继续为 `N/A · no prior signed baseline`，不伪造升级证据。
- 真实数据、飞书 OAuth、九业务端口、desktop adapter、Pilot、部署、发布、付费、遥测和自动发送均未授权。

## 5. 退出判据

1. W6 PR 的 Linux canonical、PG15、Windows feasibility 三条 CI 全绿。
2. PR Review 无未解决 finding，W6 合并到 `main` 并清理候选分支。
3. 产品仓 W6 记录回填 PR、合并 SHA 和 CI run；治理仓动态真源及生成 HTML/PlantUML 浏览器同步同一事实。
4. 完成后只关闭 DEV-M0；DEV-M1 仍需独立评审与授权。
