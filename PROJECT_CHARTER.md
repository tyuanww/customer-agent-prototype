# 客服 Agent 产品实施仓章程

> **生效：** 2026-08-21
> **仓库身份：** 客服 Agent 产品实施仓
> **当前基线：** Menokin 是当前唯一客服试点；`DEV-M0` 的 W1～W6 产品实施已完成，W6 通过 PR #15 合并统一 CI、Windows 可行性 smoke 与正式服务候选产物隔离证据（`main@44b863d`，CI run `33729754086` 三条 lane 全绿）。桌面、业务端口和真实数据仍未接库，当前桌面运行链仍是 `PILOT-S0 · SYNTHETIC` 合成基线
> **目录名说明：** `customer-agent-prototype` 是历史目录名，不再代表仓库只做原型。

## 1. 两个仓库各自负责什么

| 仓库 | 主责 | 不负责 |
| --- | --- | --- |
| `ai-赋能立项` | 记录项目进度、批准范围、G0 / Ddev、证据 ID、正式架构与机器合同 | 产品运行时代码、产品安装包和产品部署 |
| `customer-agent-prototype` | 客服产品源码、UI、Application API、worker、migration、测试、打包与后续上线实现 | 替项目台账签发 G0 / Ddev，或保存真实审批原文 |

两个仓库保持独立 Git 历史。正式需求和阶段门从 `ai-赋能立项` 单向进入本仓的实施计划；本仓的代码、测试或 Demo 结果不能反向自动推进项目状态。正式机器合同只通过带来源 Git SHA、不可变 `contract_set_id` 与 OpenAPI / DDL 双哈希的版本化快照交接；禁止软链接、实时跨仓读取、手改 upstream 快照或运行时依赖。

## 2. 本仓的权威顺序

1. 本文件只拥有**仓库身份、仓间关系与生命周期模式**。
2. `DESIGN.md` 拥有产品视觉、交互与内容表达的不变量。
3. `DEVELOPMENT_BRIEF.md` 拥有当前已实现 v3 原型基线的工程与验收边界。
4. `docs/reference-project-architecture.md` 记录当前代码的模块所有权与信任边界。
5. `docs/plans/` 记录从当前基线走向正式产品的计划，并必须在页头显式标注 `ROUGH / REVIEWED / APPROVED`；只有 `APPROVED` 计划可作为实施输入，任何计划都不得自行改写 G0 / Ddev 或上述 SSOT。
6. `docs/reference-document-lifecycle.md` 记录本仓产品文档与项目记录仓当前状态、历史快照和生成视图的边界；它不复制动态门禁数字。
7. `docs/plans/2026-08-31-dev-m0-execution.md` 记录当前 `DEV-M0` 的产品仓实施事实、验证与下一切片；它不替代项目记录仓的授权真源。
8. `docs/plans/2026-08-31-menokin-pilot-synthetic-stage.md` 是 `DEC-054 / DEC-055` 对应的 `APPROVED` Menokin 试点 S0 实施输入；它只授权其中列明的纯合成能力，不授权真实数据或正式运行链路。

若本仓文档与 `ai-赋能立项` 的当前批准范围、G0 / Ddev 或正式合同冲突，停止对应正式能力的实现，先在项目记录仓完成决策和版本冻结。视觉实现细节仍由本仓 SSOT 持有，不回写到项目进度仓制造第二份 UI 真源。

## 3. Menokin 单一试点生命周期

### 已完成产品实施：`DEV-M0 · IMPLEMENTATION COMPLETE`（2026-08-31～2026-09-03）

- 项目记录仓已签发 `DEC-DDEV-01=PASS`，用户已明确给出产品仓开工授权；W1～W6 已在批准的 `DEV-M0` 开发 / 测试范围内完成，阶段门的当前展示仍由项目记录仓拥有。
- W0 pre-move 基线与 workspace scaffold 已留作历史；W1 已把原 Electron 源码、测试、资产、配置和打包脚本原样迁入唯一可运行包 `apps/desktop`，根目录只保留 workspace 命令门面与仓级合同 / 卫生工具；产品版本也只由 `apps/desktop/package.json` 拥有。
- W2 已在独立 `packages/contracts` 中完成确定性 bundle、TypeScript 类型、provenance、codegen manifest 与 132 个 component runtime validator；包构建产出 Node 可执行 `dist`，validator 按 schema 延迟编译，并保留合同的 `x-unique-by` 校验语义。
- 正式合同快照继续保持 `ddev_authorized=false`、`runtime_activated=false`；W3 新增 loopback Fastify `/health` 与配置拒启矩阵，W4 从受锁 DDL 快照确定性生成九个不可变 migration，并完成私有账本、同会话 advisory lock、逐段事务、失败关闭后验及隔离 PG15 测试。W5 已新增一个 runtime pool owner 与合同 `/ready`：database/schema 做真实只读检查，auth/storage/content 在 M1/M2 前固定 `not_ready`。W6 已建立 clean-checkout CI、Windows hosted-runner smoke 和非部署型正式服务候选产物后验。API 不自动执行 migration、不注册九业务端口，也不把 desktop 或真实数据接入运行链。
- 真实数据、飞书运行接入、Pilot、付费、遥测、自动发送、部署和发布均未放行。

### 保留开发基线：`PILOT-S0 · SYNTHETIC`

- Fox → Query → Top 3 → 复制和九模块 Dashboard 已作为产品交互基线存在。
- 仅使用编译期合成 fixture / manifest；桌面无正式 OAuth、API adapter、九端口或真实客户数据。W5 的并行 API readiness pool 不改变该桌面模式。
- 允许单人在本仓继续本地 UI、交互、纯状态模型、合成 fixture、测试、构建、开发诊断和 Windows feasibility smoke；新增付费为 0，2026-09-30 复核。
- 这是 Menokin 试点的合成验证 profile，不是另一个 Demo 项目；它自身不接正式 API / worker / migration、真实数据或飞书运行链路。
- 既有 UI 代码与测试只证明本地合成交互和桌面工程；`DEV-M0` 新增证据必须单独标识，二者都不等于产品已上线。

### 后续：`DEV-M1～DEV-M4`

- 按获批产品化计划在**本仓**依次实现正式 Windows 客户端、Application API、PostgreSQL SoR、鉴权、内容治理、指标、工单分析和发布链路。
- 正式能力必须通过窄 adapter 和明确的信任边界接入；不得把 renderer 直连数据库/API，也不得把合成类型直接升格为正式合同。
- 原型模式保留为开发、演示和回归环境，但必须与正式配置、数据和证据分账。

### 后续：Menokin 受控试用与上线

- 试点、真实数据接入、外部付费、签名、公证、发布和部署分别走独立批准与验收。
- “目标上线”是仓库方向，不自动构成 Ddev、真实数据、部署、发布或对外承诺授权。

## 4. 长期不变的红线

- 系统只给候选，坐席人工确认并发送；复制成功不代表已发送、已采纳、回答正确或问题已解决。
- renderer 保持最小权限；禁止通用 IPC、Node 注入、任意文件系统和凭证暴露。
- 真实客户数据、凭证、审批原文和内部链接不进入 Git；数据接入必须有批准范围、脱敏、保留删除和审计证据。
- commit、push、PR、merge、deploy 与发布仍是独立授权动作。

## 5. 每次开始工作的检查顺序

1. 先读本文件，确认仓库身份和当前模式。
2. 再读 `DESIGN.md` 与 `DEVELOPMENT_BRIEF.md`，确认当前交互和工程基线。
3. 查看当前分支、工作树和 `docs/plans/` 中计划的显式状态，禁止把 `ROUGH` 草案当作获批计划。
4. 当前 `DEV-M0` 按 `docs/plans/2026-08-31-dev-m0-execution.md` 和已批准产品化计划逐切片执行；合成 profile 改动仍按 S0 计划约束。
5. 只有涉及正式范围或阶段门时，才去 `ai-赋能立项` 核对对应真源；不要把整个文档仓复制进来。
6. 同一 Menokin 试点内分别汇报合成验证、正式产品开发和上线证据；分账不等于拆成多个项目。
