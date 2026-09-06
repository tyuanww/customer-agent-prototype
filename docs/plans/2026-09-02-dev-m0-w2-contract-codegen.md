# DEV-M0-W2 合同 codegen 与 runtime validation 执行记录

> **当前进度入口：** 本页保存形成时的计划、批准范围或证据，不维护最新进度；当前动作统一见[执行清单](2026-09-06-execution-goal.md)。已批准范围继续有效，历史状态不覆盖新的具体授权与实测。

> **文档状态：** `EXECUTION RECORD`
> **切片状态：** `MERGED · PR #10 · main 1a77297`
> **开工输入：** 用户于 2026-09-02 明确给出“DEV-M0 合同开发与 codegen/runtime validation 开工授权”
> **提交输入：** 用户于 2026-09-02 明确给出“产品仓 DEV-M0-W2 提交授权（当前头 6c759c6）”
> **Git 输入：** 用户已分别授权并完成 W2 推送、PR #10、Review 复核、squash 合并与候选分支清理
> **Review 输入：** 用户于 2026-09-02 明确给出“产品仓 DEV-M0-W2 Review 复核授权（PR #10，当前头 cd9878e）”及随后 Review 修复、提交与推送授权；修复候选头为 `74e2a97`
> **基线：** `origin/main` / `6c759c6b317d9382787dcec200f3e828b7a5007d`
> **Review 修复基线：** `cd9878e437ca0397a54de621f2a5e23c710150f3`
> **分支：** `codex/dev-m0-contract-codegen-validation`

## 1. 本切片边界

W2 只关闭 DEV-M0 的合同编译子项：从已验证且不可变的 OpenAPI 1.11.0 快照生成 TypeScript 类型，并提供可由后续 API / adapter 调用的 component runtime validation。

开工授权明确不做：不创建 Fastify host、配置包、DB 包或 migration；不执行 PostgreSQL；不接 renderer/main/preload；不读取真实数据或飞书；不把消费锁改成已激活。提交、推送和 PR 后续均通过独立 Git 授权完成；合并与部署仍未授权。

两个边界方案中采用独立 `packages/contracts`，不把 codegen 继续塞入 intake 脚本。原因是接收器拥有“验证并保存不可变来源”，合同包拥有“编译产品资产并校验进出边界”，两者生命周期和失败恢复不同。

## 2. 实现事实

- `scripts/customer-agent-contract-set.mjs` 继续拥有来源 commit、成员、字节数与 OpenAPI / DDL 双哈希，并向 codegen 提供与 intake rollover 共用锁的只读快照；旧快照未修改。
- `packages/contracts/scripts/generate-contracts.mjs` 在受控快照锁内解析 OpenAPI 3.1 并写入生成物；外部 `$ref`、版本漂移、生成物字节漂移或并发 lock rollover 均失败关闭。
- 生成 `bundle.generated.yaml`、完整 OpenAPI TypeScript 类型、JSON Schema 2020-12 component 文档、provenance 与 codegen manifest；所有产物绑定同一 contract set、来源 SHA、双哈希和精确工具版本。
- 合同包构建为 Node 可执行 `dist`，公开入口不再依赖测试转译器；provenance 与 runtime 提供独立子路径。validator 按 schema 延迟编译，诊断数量封顶，`validateContractSchema` 返回封闭结果，`parseContractSchema` 在严格边界抛出不携带原始 payload 的类型化错误。
- OpenAPI 的说明、示例、普通 vendor extension 与 discriminator 作为非验证注解从 runtime schema 中剥离；承担数组字段唯一性语义的 `x-unique-by` 被保留并由 Ajv 注册执行，`oneOf/allOf/const/required/additionalProperties/format` 等标准验证语义继续保留。
- 根 `typecheck`、`test`、`build` 已纳入合同包；`test:contract` 同时验证源级合同语义与 Node 24 编译包入口。
- 桌面 main/preload/renderer 没有变化，当前应用仍为合成、无后端模式。

## 3. 当前证据

运行环境：Node.js `v24.19.0`、pnpm `11.19.0`。

| 命令 | 当前结果 |
| --- | --- |
| `pnpm contracts:generate` | PASS；生成 5 类受控产物、132 个 component schema，`runtime_activated=false` |
| `pnpm contracts:codegen:check` | PASS；字节级 `GENERATED_MATCH` |
| `pnpm test:contract` | PASS；2 files / 16 tests + 1 Node package smoke，覆盖五类生成物、精确 132 schemas、`x-unique-by`、公开包入口、closed schema 与错误脱敏 |
| `pnpm install --frozen-lockfile` | PASS；lockfile 与 package manifests 一致 |
| `pnpm lint` | PASS；合同包与桌面仓统一 lint |
| `pnpm typecheck` | PASS；合同包与桌面包均通过 |
| `pnpm test` | PASS；合同包 2 files / 16 tests + 1 Node package smoke，桌面包 51 files / 508 tests |
| `pnpm build` | PASS；合同零漂移、`dist` 编译、Node 24 包入口 smoke 与 Electron 三入口构建均通过 |
| `pnpm workspace:check` | PASS；workspace 策略通过，受控源文件 6.59 MiB / 32.0 MiB |
| `pnpm contracts:verify` | PASS；来源 commit、成员、字节数与 OpenAPI / DDL 双哈希一致 |
| `git diff --check` | PASS |

本切片没有桌面行为、原生窗口、renderer 或 preload 变化，因此未重复 Electron E2E；没有执行数据库、真实 API、打包、签名、公证、部署或真实数据验证，这些结果不得由本记录推断。

## 4. Review 修复事实

- 初始候选头 `cd9878e` 的包入口指向 TS 源码但没有 JS emit，标准 Node 24 无法解析源码中的 `.js` 目标；现改为 `tsconfig.build.json` 生成 `dist`，并由真实 Node 自引用导入 smoke 锁定。
- 初始 codegen 无差别删除 `x-*`，使相同 `domain`、不同版本的非法来源绑定被接受；现只保留已登记验证扩展 `x-unique-by`，三个受影响 schema 均有负例。
- 生成器不再在验证后分别读取 lock、manifest 与 OpenAPI；共享快照锁覆盖读取、生成、漂移检查与原子写入，避免 provenance 与输入混代。
- runtime 不再模块加载时编译全部 132 个 schema，且不再生成无上限 `allErrors`；全 schema 可编译性和错误数量上界由定向测试锁定。

## 5. 尚未关闭

- DEV-M0 的 Fastify 空宿主、config 拒启矩阵、immutable migration、PG15 clean install、ACL、SQLSTATE、N/N-1 与失败回滚仍未开始。
- component validator 尚未接到任何 HTTP 或桌面 adapter；这正是 `runtime_activated=false` 的含义。
- W2 Review 修复已提交并推送；PR #10 已于 2026-09-02 squash 合并为 `1a77297d51ce3cf3a0a551290675c60c941be4b6`，候选 worktree 与本地/远端分支已清理。部署仍未授权，也未执行。
