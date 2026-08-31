# 客服 Agent 产品化实施路线（gstack 评审已批准，合同已交接，等待组织授权门）

> **状态续记（2026-08-31）：** 本计划以下评审结论保持冻结；项目记录仓随后签发 `DEC-DDEV-01=PASS`，用户已明确授权产品仓进入 `DEV-M0`。当前实施事实与验证见 [`2026-08-31-dev-m0-execution.md`](2026-08-31-dev-m0-execution.md)，不要再把本页原始“等待组织授权门”页头当作当前状态。

> **状态：** GSTACK REVIEW APPROVED · 用户于 2026-08-21 选择 A；ENG-T1 正式修正、来源 commit、contract set 与产品仓验证接收已完成；产品实施继续等待 G0 / Scope 与 Ddev
> **日期：** 2026-08-21 · 2026-08-22 更新合同交接状态
> **实施仓：** `customer-agent-prototype`
> **项目记录仓：** `ai-赋能立项`
> **当前授权边界：** 本轮新增授权仅覆盖正式合同快照接收、完整性校验及对应文档 / 测试；G0 / Ddev 尚未签发，不据此开始 DEV-M0、codegen、migration、adapter、真实数据、部署或发布。
> **仓库落点决定：** DEC-051 已明确本仓承接正式产品实现；正式合同以版本化 `contract_set_id`、来源 Git SHA 和 OpenAPI / DDL 双哈希交接，不通过软链接或实时跨仓读取。
> **最终审批：** A = 批准本计划及全部推荐排序；不等于批准代码实施、正式合同变更的提交 / 推送、DEV-M0、真实数据、Pilot 或上线。
> **ENG-T1 正式交接检查点：** 记录仓 commit `1d62e2c85c3c77dbb7a2fecc1d24a2002cb0ed38` 已冻结修正并输出 `cs-ai-c11-openapi-1.11.0-schema-1.12-1d62e2c85c3c`；OpenAPI SHA-256=`06698f233702591c8f981c7b08ebac4b7d5bc5cc2d69d36014ef2a9f5a6802e4`，DDL SHA-256=`47b667958e522a28df1c04d7c79a56c930bfe0ac04598321824b55744ac4a801`。产品仓已按精确成员、字节数、来源 SHA 与双哈希接收，锁定为 `VERIFIED_NOT_ACTIVATED`；隔离 PG15.18 证据仍只是 `PASS-WITH-LIMITATION`，不等于 migration/runtime 证据。

## 0. 三套“通过”必须分账

| 判断层 | 当前状态 | 代表什么 | 不代表什么 |
| --- | --- | --- | --- |
| 正式八关 · 第 3 关“实现设计” | **记录状态 PASS · ENG-T1 与不可变合同交接已完成** | ACK denial-audit 与事件 closed schema 已由来源 commit、contract set、双哈希和产品仓 intake 共同固定 | 合同已接收仍不代表 G0、Ddev、DEV-M0、Pilot 或上线已授权 |
| 组织授权门（第 3→4 关之间） | **NOT AUTHORIZED** | 费用路径与 WBS / 成本包已签发，但 G0-09 / Scope #9、G0 和 Ddev 尚未闭合 | 不允许开始 DEV-M0 或把现有 Demo 当成正式运行时 |
| gstack 计划评审 | **APPROVED · 用户选择 A；合同 P0 已后置关闭** | CEO / Design / Eng / DX 已完成；路线、任务排序和 P0 处理原则获批，ENG-T1 已按权威链修订、提交、出包并接收 | 不自动签发组织门、Ddev 或任何运行证据 |

本轮把用户选择的 **A** 解释为：在已经冻结的正式路线与 `DEV-M0 → M4` 里，优先围绕一个高频场景、3～5 名 Windows 坐席和 Query → Top 3 → 人工复制闭环组织价值证据；经理侧先保留最小只读计分板，完整 Dashboard 仍是路线图。它**不改变正式里程碑顺序，也不提前形成真实 Pilot 授权**。若要把官方 Pilot 提前到 M2 / M4 之前，或放宽四域硬门，必须回到项目记录仓新增 CR / DEC，不能由 gstack 评审静默改写。

## 1. 先把问题说清楚

本项目不是重新做一个 Demo，而是把已经验证过交互和视觉的 Electron 原型，演进为可试点、可上线、可审计的客服 Agent 产品。目录名 `customer-agent-prototype` 是历史遗留，不再定义仓库上限。

两个仓库必须长期保持以下分工：

| 仓库 | 写入所有者 | 输出 |
| --- | --- | --- |
| `ai-赋能立项` | 项目进度、批准范围、G0 / Ddev、架构与 API 正式合同、证据索引 | “允许做什么、何时可以进入下一关” |
| `customer-agent-prototype` | 产品 UI、客户端、服务适配、运行时、测试、打包和发布实现 | “产品实际上实现了什么、验证到了哪一层” |

两仓不共享 Git 历史，不做跨仓源码 import、软链接或运行时读取。项目记录仓的批准范围单向进入本仓计划；本仓产出的代码、测试和构建结果可以回填为证据，但不能自动改变门禁状态。

## 2. 当前事实基线

### 2.1 项目记录侧

- 技术第 1～3 关已经形成需求、架构和实现设计静态文档包。
- 当前仍处于第 3→4 关之间的组织授权门：G0 13/14、Scope 14/15，G0-09 / Scope #9 尚未关闭，Ddev 为空。
- `37-架构SSOT-v1.md` 拥有产品架构和不变量；39、OpenAPI 与 33 拥有正式机器合同；`46-实现设计-开工包.md` 定义 DEV-M0～M4、独立产品仓落点和双仓合同交接顺序。
- ENG-T1 已由来源 commit `1d62e2c85c3c77dbb7a2fecc1d24a2002cb0ed38` 与不可变 `contract_set_id=cs-ai-c11-openapi-1.11.0-schema-1.12-1d62e2c85c3c` 完成交接；产品仓只登记 `VERIFIED_NOT_ACTIVATED`，未接运行时。
- 静态合同 Ready 不等于产品运行时已实现，也不等于可以上线。

### 2.2 产品实施侧

- 已有 Electron 双表面产品基线：Fox / Query 浮窗与经理 Dashboard。
- 当前只使用编译期合成 fixture / manifest；无正式 OAuth、PostgreSQL、九端口 Application API 或真实客户数据。
- renderer 已保持 sandbox、context isolation、无 Node；Fox / Query 只经窄 preload / IPC 使用原生能力，Dashboard 当前无 preload。
- 现有“一期开发框架”UI 映射把 A1～A6 坐席闭环和 B1～B7 管理闭环显示在 Dashboard 中。这里的“一期”是架构图名称，不是项目优先级；客服项目仍按 P0 推进。
- Dashboard 已把证据拆为“设计已映射 / 原型可交互程度 / 正式运行状态”三条轴；当前只证明合成原型与静态交互，不证明九端口、数据库或 worker 已运行。

## 3. 产品目标

一期目标是在 Windows Electron 客户端中，让客服坐席能够安全检索已批准话术、查看 Top 3 原文、人工确认并复制；让客服经理能够查看工具运行指标、检索复制双账、内容治理、业务工单分析、话术优化待办和客户端同步状态。

产品必须满足：

- 系统只给候选，坐席人工确认；不自动发送。
- “已复制”不推断已发送、已采纳、回答正确或问题已解决。
- 正式内容必须绑定售前、活动、售后、产品四域不可变来源版本，缺域或来源异常时 fail-closed。
- PostgreSQL 是 SoR；Application API 是客户端唯一正式数据入口；renderer 不直连数据库、线上 API 或凭证。
- 真实数据、OAuth、灰度、部署和发布分别取证，不能用本地 Demo 证据替代。

## 4. 建议的产品架构落点

```text
[Windows Electron renderer]
  Fox / Query / Dashboard
          |
          | typed ViewModel + narrow capability API
          v
[preload capability boundary]
          |
          v
[Electron main adapter]
  auth session / search / events / announce / native OS
          |
          | HTTPS + generated OpenAPI client
          v
[Application API]
  auth | search | events | metrics | workorders
  content | announce | policy | redaction
          |
          v
[PostgreSQL SoR + object storage + outbox worker]
```

边界原则：

- `src/renderer/` 只接收 ViewModel，不认识数据库 schema、token 或服务凭证。
- `src/preload/` 只暴露白名单能力，不提供通用 `send/on/invoke`。
- `src/main/` 拥有 Electron / OS 权限与客户端 adapter；网络失败、会话过期、离线租约和原生副作用在这里归一化。
- 正式检索由 main 侧 `DesktopSearchCoordinator` 统一选择 synthetic / production adapter；preload 只暴露类型化 `search(request)`，renderer 只消费稳定 ViewModel，不接触生成 OpenAPI DTO、token 或 provider 选择。
- Dashboard 在 DEV-M4 如需正式数据，新增独立、只读优先的 `dashboard` preload 与 sender / role / main-frame 门禁；不得复用 Query preload，也不得把 Dashboard 变成通用 IPC 客户端。当前 Ddev 前基线仍保持 Dashboard 无 preload。
- 正式 API、worker 和迁移应形成有真实职责的深模块，不能把现有合成 fixture 类型直接升格为 OpenAPI DTO。
- 原型 provider 与正式 provider 通过同一窄领域接口切换，但配置必须 fail-closed；生产构建不得回退到合成数据冒充成功。
- 产品仓只消费 `contracts/upstream/customer-agent/<contract_set_id>/` 下经过双哈希校验的只读快照；生成类型、migration、runtime 与负例必须处于同一产品仓 changeset。

## 5. 交付路由

### P0 · 逻辑和证据归位（当前允许）

1. 固化两个仓库的职责、权威顺序和生命周期模式。
2. 复核现有“一期开发框架”UI 映射，持续锁定“设计已映射 / 原型可交互 / 正式运行已接通”三类证据不得互相冒充。
3. 用 gstack `autoplan` 对本草案依次执行 CEO、Design、Eng、DX 评审，形成获批计划。
4. 只读核对项目记录仓的 37 / 39 / 46 与本仓模块落点，不复制合同制造第二真源。
5. 保留现有原型回归命令和合成数据模式，确保计划工作不破坏可运行基线。
6. 按选择 A 形成“价值证据优先”的实施切片：先定义单场景评价口径、失败样例、人工确认边界和最小经理计分板；这些仍是设计与验收准备，不是 Ddev 前的产品功能开发或真实 Pilot。
7. 场景不凭印象指定：由 Product Owner 在既有业务基线 / G1a 冻结集上按“频次 × 当前处理耗时 × 错答风险 × 四域来源就绪度”排序，随 `DEC-SEARCH-01` 冻结首场景、评价集版本和阈值；本计划不虚构业务答案。
8. 价值证据以全部冻结问法为总体可用率分母；no-hit、全部不可用、来源阻断与超时必须记录唯一终态及到终态耗时。可用样本的 p50 / p95 耗时、总体失败率与失败类型分布分别报告，禁止只报成功样本耗时或在聚合前过滤失败样本。

### Gate · Ddev

只有项目记录仓出现专用 Ddev / `DEC-DDEV-01=PASS` 证据，并满足 G0 与上游合同条件，才进入 DEV-M0。Ddev 不替代 commit、push、PR、部署、Pilot、真实数据或外部付费授权。

新增的上游合同前置项同样必须在 Ddev / DEV-M0 消费前关闭：

1. `UPSTREAM-C1`：统一 37 / 39 / 41 / 46 与 OpenAPI / DDL 的 `announce_ack` 来源/租约拒绝审计语义；采用完整选项——把 `announce_ack` 纳入最小 denial audit 的 allowlist、受控 wrapper、DDL、OpenAPI、负例和哈希，而不是削弱已在四份人读合同中重复冻结的 fail-closed 证据链。
2. `UPSTREAM-C2`：为 adoption / escalation request 加 closed schema，并冻结 desktop 的 copy saga、迟到 search、query terminal delivery、最小无正文待同步记录及崩溃恢复合同；产品仓不得自行发明第二套 wire / 本地持久化规则。
3. **已关闭（2026-08-22）：** 记录仓输出来源 commit `1d62e2c85c3c77dbb7a2fecc1d24a2002cb0ed38`、`contract_set_id=cs-ai-c11-openapi-1.11.0-schema-1.12-1d62e2c85c3c`、OpenAPI / DDL 双哈希与全套静态回归；产品仓已精确接收并保持未激活。该关闭只移除合同交接阻断，Ddev / DEV-M0 仍由组织门控制。

### DEV-M0 · 合同与工程骨架

- 先把当前 Demo 的 P3 验证债务与完整回归固化为 pre-move 基线；再在同一 Git 历史中按“脚手架 → 纯机械移动 → 行为变化”拆小 changeset，建立正式 workspace 边界、Node 24 / pnpm 精确版本、CI 和配置拒启矩阵。
- 从正式 OpenAPI 单向生成客户端 / 服务类型；建立 Fastify 宿主、PostgreSQL migration、ACL 和稳定错误合同。
- 建立 dev/test 合成 provider 与 production provider 的显式配置；生产缺配置必须拒启。
- 在不改变 DEV-M3 实机验收归属的前提下，追加一次 Windows 构建 / 启动 / 热键 / 透明窗最小可行性检查；这里只暴露平台阻塞，不冒充签名、更新、焦点或 DEV-M3 通过。
- M0 不接正式 Query UI、Dashboard 或真实数据；M1 的 current release 测试由与生产相同的 publish 函数创建，不直插第二真源。
- 退出证据：合同快照 / 双哈希、closed schema 负例、类型、lint、schema、ACL、clean install、N/N-1 migration、失败回滚和生产 artifact 不含 synthetic/mock 的后验全绿。

### DEV-M1 · Search + Events

- 只实现 Application API / domain：mock/test auth、policy、redaction、Unicode 检索、Top 3 来源证明、adoption terminal、升级辅助动作和未来桌面所需的稳定领域端口；不在本阶段切换 Electron Query。
- search 输入在 JSON 解析 / redaction / HMAC / bigram 前执行 32 KiB 与 1～500 Unicode code point 限制；网络响应必须 runtime 校验，生成 TS 类型不能代替边界校验。
- 使用正式 publish 函数为测试创建四域齐全 current release；禁止直插 current、release item 或自动发布空快照。
- 退出证据：499/500/501 code point、代理对、32 KiB、no-hit、UTC 半开有效期、来源绑定、平台/商品 scope、唯一终态、重放 / 异体冲突和零副作用负例全绿。

### DEV-M2 · Content + Publish + Announce

- 实现上传、staging、审核、质量门、四域来源绑定、发布、撤回、回滚、outbox、公告和短租约。
- 本阶段只交付 API、worker、storage、publish / announce 与读模型能力；不把任何 Dashboard 模块切到正式 runtime，避免与 M4 冲突。
- `announce_ack` 必须使用 `UPSTREAM-C1` 新合同；拒绝业务事务、最小 denial audit 和 HTTP denial 的顺序由一个受控边界拥有。
- 退出证据：来源原子切换、缺域阻断、并发、fencing、审计分账、固定分页、存储持久性和失败恢复 E2E 全绿。

### DEV-M3 · Windows Electron 客户端

- 复用当前 Fox → Query → Top 3 → 复制的设计基线，完成 Windows 原生焦点、热键、托盘、签名更新与回滚。
- 首次把 Query 从 synthetic adapter 切到 production adapter；main-owned operation coordinator 统一拥有会话、search ledger、clipboard side effect、terminal sync 和 runtime DTO→ViewModel 映射，renderer 不持有 token、OpenAPI DTO 或 provider 选择。
- 实现平台确认、受控 placeholder 内存填值、二次确认，以及 main-owned `OfflineSnapshotStore`：固定 release 分页拉全 → binding / lease / cursor 验证 → staging FTS → 原子切换 → ACK；租约过期、用户切换、时钟回拨、损坏或部分页均停搜且不回退旧快照。
- 退出证据必须包含真实 Windows 设备；macOS 自动化不能冒充 Windows 合成器、焦点、签名或更新证据。

### DEV-M4 · 经理 Dashboard

- 接入 metrics / stream、检索复制双账、业务工单分析、话术优化待办、内容来源审计、公告与租约状态。
- 第一个纵向切片只把现有 Overview 接成最小只读计分板；其后把静态 manifest 逐模块迁到正式 read model。写操作按 capability、幂等和审计边界单独接入，不继承 Query preload。
- 退出证据：RBAC、双分母口径、cursor、数据包络、导入/下钻/脱敏导出、CAS 状态机和无源系统写回证明全绿。

### Pilot Readiness · M4 后、Pilot 前的可执行工作包

- Auth：真实飞书 OAuth callback、服务端 session、刷新 / 过期 / 退出 / 用户切换、agent/coach/owner 越权负例与 secret 轮换；生产 mock 路由存在即拒启。
- Runtime：选择并记录 `single_host` 或 `multi_instance`，建立 staging、migration job、API、worker、PostgreSQL、对象存储 / 共卷、配置 / secret provisioning、不可变 artifact promotion 与回退。
- Recovery / Ops：真备份恢复、outbox fencing / replay、client resync、RPO≤24h / RTO≤4h 目标演练、SLI / 告警 / 值班责任、runbook 和故障演练。
- Desktop：受支持 Windows 矩阵、企业 CA / proxy、签名安装包、更新元数据验签、防降级、上一签名版本回滚、安装 / 卸载 / 升级与真实设备证据。
- Exit：每一项都有 Owner、环境、命令 / runbook、artifact / evidenceRef、通过阈值与停止条件；M4 退出本身不自动通过 Readiness。

### Pilot / Launch · 独立后续门

- 只在 Pilot Readiness 退出并取得独立 Pilot 授权后，才使用获批真实内容进行 3～5 名坐席灰度；外部付费、扩面和 Launch 继续分别批准。
- 产品上线必须以真实设备、真实构建和运行证据验收；不以 Dashboard 的“设计映射”徽标代替。
- 在当前正式路线下，官方 Pilot 仍位于 M0～M4 退出证据之后；选择 A 只改变各里程碑内的验证重心，不越过该门禁。

## 6. UI 与状态模型需要 gstack 重点评审

建议每个能力至少保留三条相互独立的状态：

| 轴 | 示例 | 回答的问题 |
| --- | --- | --- |
| `designStatus` | mapped / pending | 正式设计是否已经映射到产品界面 |
| `prototypeStatus` | runtime-interactive / static-interactive / visual-only / absent | 当前合成原型能否操作，以及属于真实本地交互还是静态交互样例 |
| `formalRuntimeStatus` | not-started / in-progress / verified | 正式后端和真实环境是否已实现并取证 |

证据元数据规则：`prototypeStatus` 不是 `absent` 或 `formalRuntimeStatus` 不是 `not-started` 时，必须同时提供 `evidenceRef`、`verifiedAt` 和 `evidenceLevel`；缺任一项则 UI 只能降级显示为“待复核”，不能沿用旧绿标。`designStatus` 则绑定正式设计版本 / contract set，而不是绑定运行证据。

UI 不能把“一期设计映射”（架构图名称）、`DEMO 表面` 或 `流程模拟` 解释成生产 Ready。状态标签必须有来源、时间和证据层级；正式数据未接通时，所有数值继续明确标注为合成快照。

## 7. 验证策略

每个里程碑先跑受影响模块窄测试，再扩到：

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

按影响面追加 Electron E2E、`test:float`、Dashboard component / E2E、`test:assets`、`workspace:check` 和正式打包后验。新增 API / DB 后再加合同、迁移、ACL、备份恢复、并发与性能门。

证据分层汇报：

1. 静态设计通过；
2. 本地合成原型通过；
3. 正式运行时自动化通过；
4. Windows 实机 / 真实环境通过；
5. Pilot / 上线通过。

任何一层都不能替代下一层。

## 8. 本轮不自动获得的授权

- 不开始 DEV-M0～M4 产品功能开发。
- 不读取、导入或提交真实客户数据、凭证、审批原文或内部链接。
- 不安装正式服务、不执行生产 migration、不部署、不发布、不创建 PR、不 merge。
- 不把目标上线解释为上线日期或对外承诺。

## 9. gstack 已确认的选择与后置决策门

本轮已确认：首个价值证明以坐席主链为中心，经理侧只做最小只读计分板；完整九模块 Dashboard 不作为最早价值证明的前置条件。正式设计中的 M0～M4 顺序和四域来源硬门保持不变。

1. **仓库布局已决：** 按正式 46 §3，`customer-agent-prototype` 是唯一产品 Monorepo，承载 desktop、API、worker、migration 与测试；禁止再建第二个服务端产品仓或 `services/api`。
2. **证据绑定已决：** 三轴状态按 §6 增加 `evidenceRef` / `verifiedAt` / `evidenceLevel` 的条件不变量，过期或缺证据必须降级。
3. **场景选择待 Owner 决策但不构成计划歧义：** 选择协议与冻结点已写入 P0；具体场景和阈值由 `DEC-SEARCH-01` 在 DEV-M1 退出前签发。
4. **Pilot 参数待后置门签发：** 人数沿用最低 3、计划 4（2 新 + 2 老）、允许 3～5；真实平台、Windows 支持矩阵、分发方式、OAuth、运维 Owner 与恢复证据进入 Pilot readiness packet，不由本计划提前假定。

## 10. GSTACK PHASE 1 · CEO REVIEW

### 10.1 前提挑战与模式

模式选择为 **SELECTIVE EXPANSION**：保留正式 Route A 与 DEV-M0→M4，只把能显著提高价值验证和降低返工、且不越过 Ddev 的内容纳入计划。

| 前提 | 判断 | 处理 |
| --- | --- | --- |
| “现有 Electron 交互值得复用” | 成立；Fox→Query→Top 3→复制已经有可运行合成基线 | 复用交互和安全边界，不把 fixture / DTO 当正式合同 |
| “完整 Dashboard 必须先于价值证明” | 不成立；它会让最早证据被后台广度拖住 | 坐席主链优先，经理侧先给最小只读计分板，完整 Dashboard 仍在 DEV-M4 |
| “复制率足以证明价值” | 不成立；复制只证明发生了复制 | 主指标改为“到首个可用且人工认可候选的时间 + 人工质量复核”，复制率只作辅助行为指标 |
| “四域硬门可以为早期 Pilot 放宽” | 不成立；这会把演示数据风险带进真实坐席 | 合成验证可先做，真实 Pilot 仍要求四域 binding、来源状态和 Ddev / Pilot 门齐全 |
| “Windows 到 DEV-M3 再看也来得及” | 风险过高 | DEV-M0 做不计通过的最小可行性检查，DEV-M3 仍保留完整真机、签名、更新与焦点验收 |
| “服务端落点仍需选择” | 已被正式 46 §3 决定 | 唯一产品 Monorepo，消除重复仓和第二真源 |

### 10.2 What already exists · 现有能力复用图

| 子问题 | 已有实现 | 计划动作 |
| --- | --- | --- |
| 坐席浮窗与状态机 | `QueryApp.tsx`、overlay machine、原生窗口 controller | 保留视觉 / 节奏；正式搜索经新 capability 注入，不把 UI 状态机拆散 |
| 合成检索与 Top 3 | `search-service.ts::searchScripts`，含有效期、去重、稳定排序、no-hit | 作为 dev/test synthetic adapter 与回归 oracle；正式 provider 不复用 fixture DTO |
| 剪贴板与信任边界 | 类型化 preload、sender / role guard、`clipboard-ipc.ts` | 延续一能力一方法；复制成功仍只表示复制 |
| Dashboard 展示 | `DASHBOARD_MANIFEST` + 三轴证据 badge | 先补证据元数据；正式 read model 在 DEV-M4 逐模块替换，不整页翻写 |
| 窗口安全 | sandbox、context isolation、无 Node、Dashboard 当前无 preload | 保留；未来 Dashboard 用独立最小 preload，不复用 Query 权限 |
| 测试基线 | Vitest + Electron E2E + workspace / asset checks | 保留分层；Windows 自动化不得代替实机验收 |

### 10.3 梦想状态与 10x 检查

```text
CURRENT                       THIS PLAN                         12-MONTH IDEAL
合成 Top 3 + 静态 Dashboard -> 来源可证的坐席辅助 + 最小计分板 -> 可治理、可回放、可安全扩面的客服工作台
无真实 API / SoR              -> 单一 Monorepo + 版本化合同       -> 多渠道仍共用同一内容与证据内核
复制行为                       -> 人工认可质量 + 时间证据         -> 每次推荐可解释、每次失败可恢复
```

10x 不是“更像通用 AI 客服”，而是让一线在原工作流里更快拿到**来源可证、仍由人确认**的话术。现有主流产品正扩向全渠道自动解决、CRM 写动作和 AI / 人混合运营；本项目的现实差异点应是更窄、更可信、低切换成本的坐席辅助，而不是在一期追赶完整联络中心。

### 10.4 实现方案比较

| 方案 | 努力 / 风险 | 优点 | 缺点 | 决定 |
| --- | --- | --- | --- | --- |
| A. 先完成九端口 + 全 Dashboard 再验证价值 | 人工 XL / CC L；价值反馈晚 | 架构一次铺全 | 可能完整实现错误优先级 | 拒绝作为实施优先级；正式路线仍保留 |
| B. 价值证据优先，正式里程碑内纵向切片 | 人工 L / CC M；需严守门禁 | 最早暴露内容质量、Windows 与工作流问题 | 必须防止被误称真实 Pilot | **采用** |
| C. 接入现成 SaaS / 自治 Agent 替代 Route A | 人工 M / CC S；组织 / 数据 /合同风险高 | 上手快、能力广 | 推翻已冻结路线与本地治理边界 | 不在本轮变更；若考虑须新 CR / DEC |

### 10.5 时间拷问

```text
HOUR 1     冻结价值证据模板、首场景选择算法、禁止误报边界
HOUR 2-6   把正式合同落点、provider seam、失败码与测试矩阵写成可执行任务
DAY 1+     等 DEC-DDEV-01；未签发前仅继续文档、合成验证与只读检查
DEV-M0     合同 / migration / CI + Windows 最小可行性检查
DEV-M1     单场景 Search + Events，跑冻结集与人工质量复核
DEV-M2-4   内容治理、客户端真机、完整经理面依次取证
PILOT      3-5 名坐席，独立授权；不由代码存在自动触发
```

### 10.6 双模型独立意见

`CLAUDE SUBAGENT (CEO — strategic independence)` 与 `CODEX (CEO — strategy challenge)` 在前提门前均指出：原草案技术路线完整，但需求 / ROI 证据滞后；最早应围绕单一高频场景、坐席主链和最小经理计分板，主指标不能只看复制；内容来源就绪与 Windows 可行性是高风险。两者未建议放松四域来源、人工确认或 Ddev 门。

| 维度 | Claude | Codex | 共识 |
| --- | --- | --- | --- |
| 前提有效性 | 技术前提大体成立，价值前提未证 | 同意 | CONFIRMED |
| 是否解决正确问题 | 应从“建完整平台”改为“证明坐席提效” | 同意 | CONFIRMED |
| 范围校准 | 主链先行，完整 Dashboard 后置 | 同意 | CONFIRMED |
| 替代方案 | 应比较窄纵切与全量建设 | 同意 | CONFIRMED |
| 竞争 / 市场风险 | 大厂全渠道自治更快，本项目应靠可信与贴流 | 同意 | CONFIRMED |
| 六个月轨迹 | 先证价值再扩面；平台 / 后端选择保留可逆性 | 同意 | CONFIRMED |

用户已在前提门选择 **A**。这里的 A 只改变验证重心，不改变正式里程碑或授权门，因此不存在待处理的模型分歧。

### 10.7 CEO Sections 1-11

1. **Architecture：2 项已收口。** 正式 46 已决定唯一 Monorepo；计划补足 `DesktopSearchCoordinator` 与按角色拆分的 preload，使 generated DTO、凭证和 provider 选择不泄漏到 renderer。
2. **Error & Rescue：11 条路径已映射，0 个静默关键缺口留作默认。** 所有 production 配置 / 合同 / 来源错误 fail-closed；网络、会话、租约、复制、stream stale 和更新失败必须有用户可见恢复动作。
3. **Security：3 项已纳入。** production 禁 synthetic fallback；Query / Dashboard capability 分权；contract snapshot 双哈希与 sender / main-frame / payload / RBAC 均在边界校验。
4. **Data & Interaction：12 个边界态已纳入。** 空 / 超长 / no-hit / 部分结果 / 迟到响应 / 重试 / 重选 / 复制失败 / 来源拒绝 / 会话失效 / stale stream / 租约过期各自有唯一语义。
5. **Code Quality：2 项已纳入。** 不为 provider 做薄 wrapper；adapter 必须完成 DTO→ViewModel、错误归一化和环境策略，状态所有者保持单一。
6. **Tests：5 个计划级缺口已转成实施任务。** 价值评价、provider 合同、生产拒退、Windows 可行性和状态证据降级都必须有测试；详细分支图由 Eng 阶段输出。
7. **Performance：1 项已纳入。** 继承正式 API 内 p95 <300ms、用户端 800/1200ms 目标与 300 QPS 短突发取证纪律；当前不声称达标。
8. **Observability：2 项已纳入。** request / query / release / client 关联 ID 和 freshness / lag 可见；日志不留原问句、token、正文或 placeholder 值。
9. **Deployment：2 项已纳入。** milestone 退出不等于部署，签名 / 更新 / rollback / Pilot 各有独立门；任何失败保留上一签名版本。
10. **Long-term：可逆性 4/5。** API / ranker / storage 通过端口可替换，OpenAPI / DDL 版本化；不可逆项是公开合同、审计语义和真实数据留存，必须在门内冻结。
11. **Design：2 项转入 Phase 2。** Query 的首屏信息层级与所有异步状态需逐态复核；Dashboard 三轴证据需绑定时间 / 来源并对过期证据降级。

### 10.8 Error & Rescue Registry

| 边界 / 方法 | 错误类 | 捕获状态 | 恢复动作 | 用户影响 |
| --- | --- | --- | --- | --- |
| contract-set bootstrap | 缺文件 / SHA 不符 / 来源 commit 不符 | `CONTRACT_MISMATCH` | 启动前停止 codegen / migration | 管理员看到精确缺项 |
| API config bootstrap | 缺 production auth / DB / storage | `CONFIG_INVALID` | 监听端口前拒启 | 不出现假可用服务 |
| `search(request)` preload | payload 非法 | `VALIDATION` | 本地拒绝，不发 IPC / HTTP | 字段级提示 |
| main search coordinator | session 失效 | `AUTH_EXPIRED` | 清 session，提示重新登录 | 可恢复，不降级 fixture |
| main search coordinator | 断网 / timeout / 503 | `NETWORK_UNAVAILABLE` / `OVERLOADED` | 有界重试或明确重试按钮 | 保留输入，不造结果 |
| search port | 四域缺失 / 暂停 / binding 错 | `SOURCE_UNAVAILABLE` | fail-closed，写独立拒绝审计 | 不冒充 no-hit |
| search port | 0 条合格候选 | `NO_HIT` | 回焦输入 / 可升级人工 | 与系统错误分开 |
| copy capability | OS clipboard 失败 | `COPY_FAILED` | 保留候选并允许重试 | 不显示“已复制” |
| events write | 超时 / 重放 | `IDEMPOTENCY_CONFLICT` / retryable | 幂等键重试，唯一 terminal | 不重复计数 |
| Dashboard stream | cursor 过期 / 数据陈旧 | `STALE_READ_MODEL` | 重拉 snapshot，显示更新时间 | 不把旧数标实时 |
| updater | 验签 / 防降级失败 | `UPDATE_REJECTED` | 中止并保留上一签名版本 | 可继续使用已知好版本 |

### 10.9 Failure Modes Registry

| CODEPATH | FAILURE MODE | RESCUED? | TEST? | USER SEES? | LOGGED? |
| --- | --- | --- | --- | --- | --- |
| contract ingest | 锁定快照被手改 | Y | 计划内 | 启动阻断 | Y |
| provider select | production 回退 synthetic | Y，明确禁止 | 计划内 | 启动阻断 | Y |
| Query search | 旧响应覆盖新查询 | Y，generation / abort | 已有基线 + 计划扩展 | 最新查询状态 | 仅安全元数据 |
| Query search | 来源异常被当 no-hit | Y | 计划内负例 | “来源暂不可用” | 独立 denial audit |
| copy | 写剪贴板失败却计成功 | Y | 已有基线 + 正式负例 | “复制失败” | Y |
| terminal event | 重试产生双终态 | Y，幂等 + DB 不变量 | 计划内 | 无重复反馈 | Y |
| content publish | 四域非原子切换 | Y，单事务 | 计划内并发 / 回滚 | 发布失败 | Y |
| offline snapshot | 租约过期仍搜索 | Y | 计划内 E2E | 停检索并提示同步 | Y |
| Dashboard | stale stream 仍显示绿灯 | Y，freshness 降级 | 计划内 | “数据已过期” | Y |
| Windows update | 签名失效 / 降级包 | Y | DEV-M3 实机 | 更新中止 | Y |

没有 `RESCUED=N + TEST=N + Silent` 的行；运行测试尚未执行，表中“计划内”不得写成已通过。

### 10.10 数据流、状态机与发布 / 回滚图

```text
INPUT → renderer validation → typed preload → main coordinator
      → production adapter → generated OpenAPI client → search port → PostgreSQL
      ← DTO mapper ← typed result / typed error ←──────────────────────┘
      → Top 1..3 → human confirm → clipboard → terminal event
```

```text
IDLE → INPUT → LOADING ─┬→ RESULTS → COPY_PENDING → COPIED → DISMISS
                        ├→ NO_HIT  → INPUT / ESCALATE
                        ├→ SOURCE_BLOCKED → SYNC / HUMAN
                        ├→ AUTH_EXPIRED → LOGIN
                        └→ ERROR → RETRY
late generation / closed window → CANCELLED（零 UI 覆盖、零重复 terminal）
```

```text
DEV-M0 → M1 → M2 → M3 → M4 → Pilot readiness → Pilot → Launch
  │       │    │    │    │          │              │
  └─任一退出证据失败：停在当前里程碑，不注册下一能力，不推导部署
```

```text
release/update failure?
  ├─ content：事务回滚 → current release 不变 → denial / failure audit
  ├─ API/DB：停止新路由 → forward-fix 或恢复一致点 → 重跑合同 / ACL
  └─ Electron：验签失败即中止 → 保留上一签名安装包 / metadata → 再取证
```

### 10.11 NOT in scope

- 自动发送、自动判定正确 / 已解决：违背一期人在环与可验证承诺。
- 为追赶竞品新增全渠道自治、语音机器人或 CRM 写动作：需要新 Scope / CR / DEC，不属于本路线。
- Ddev 前初始化 API、worker、migration 或 production adapter：组织授权未成立。
- 在产品仓手改 upstream OpenAPI / DDL：会制造第二真源。
- 用 macOS / 自动化证据代替 Windows 真机签名、焦点、更新与回滚：证据层级不等价。
- 将可选 LLM / embedding 变成一期主路径：正式 Route A 仍以 Unicode bigram 为主，训练 / teacher 受后置门控制。

### 10.12 Dream state delta

本计划结束时，产品可达到“一个受控桌面客户端 + 一个版本化 Application API + 一个 PostgreSQL SoR + 可追溯内容 / 事件 / 管理读模型”。距离 12 个月理想仍有：跨渠道上下文、规模化运维、长期内容优化、模型影子评估与组织级变更运营；这些不能在一期用抽象层提前假装完成。

### 10.13 Scope Expansion Decisions

- **Accepted：** 首场景选择协议、主价值指标、状态证据元数据、main 侧 provider seam、Dashboard 独立最小 preload、DEV-M0 Windows 最小可行性检查。
- **Deferred：** 全渠道自治、移动端、自动发送、LLM 主路、规模化 CRM 写动作；均须独立正式变更。
- **Skipped：** 新建服务端仓、在 renderer 直连 API、以 SaaS 快速替换已冻结 Route A。

### 10.14 CEO Implementation Tasks

- [ ] **CEO-T1 (P1, human: ~1d / CC: ~1h)** — value evidence — 冻结首场景选择、评价集版本、时间与人工质量口径
  - Surfaced by: Premise Challenge — 复制率不足以证明价值。
  - Files: `docs/plans/`、未来 `tests/fixtures/search/`、正式 `DEC-SEARCH-01` 证据引用。
  - Verify: 冻结集可重放；指标不把复制推断为发送 / 正确。
- [ ] **CEO-T2 (P1, human: ~2d / CC: ~2h)** — desktop boundary — 建立 main 搜索 coordinator、typed preload 与 DTO→ViewModel mapper
  - Surfaced by: Architecture / Security — renderer 不能知道 provider、生成 DTO 或凭证。
  - Files: 未来 `apps/desktop/src/main/`、`apps/desktop/src/preload/`、`apps/desktop/src/api-client/`、`apps/desktop/tests/`。
  - Verify: production 缺配置拒启；untrusted sender / malformed payload / synthetic fallback 负例全绿。
- [ ] **CEO-T3 (P2, human: ~4h / CC: ~30min)** — evidence UI — 为三轴状态增加来源、时间、层级与过期降级
  - Surfaced by: Design / Observability — 当前 badge 没有持久证据新鲜度合同。
  - Files: `src/renderer/data/dashboard-manifest.ts`、`src/renderer/features/dashboard/ArchitectureModule.tsx`、对应 unit / component tests。
  - Verify: 缺证据或过期时只显示“待复核”，不能显示 verified。
- [ ] **CEO-T4 (P1, human: ~1d / CC: ~1h)** — Windows feasibility — 在 DEV-M0 增加不计正式通过的 Windows build / launch / hotkey / transparent-window smoke
  - Surfaced by: Temporal / Failure review — 把平台阻塞留到 DEV-M3 才发现会造成高返工。
  - Files: 未来 CI / packaging scripts 与 `docs/how-to-verify-desktop.md`。
  - Verify: 明确区分 smoke 与 DEV-M3 真机签名 / 更新 / 焦点验收。

### 10.15 CEO Completion Summary

```text
+====================================================================+
|            MEGA PLAN REVIEW — COMPLETION SUMMARY                   |
+====================================================================+
| Mode selected        | SELECTIVE EXPANSION                         |
| System Audit         | dirty branch protected; Ddev still absent   |
| Step 0               | proof-first priority; formal route kept     |
| Section 1  (Arch)    | 2 issues found, both folded                 |
| Section 2  (Errors)  | 11 paths mapped, 0 silent critical gaps     |
| Section 3  (Security)| 3 issues found, 3 high before mitigation    |
| Section 4  (Data/UX) | 12 edge cases mapped, 0 left unspecified    |
| Section 5  (Quality) | 2 issues found                              |
| Section 6  (Tests)   | diagram deferred to Eng, 5 requirements     |
| Section 7  (Perf)    | 1 evidence-discipline issue                 |
| Section 8  (Observ)  | 2 gaps folded                              |
| Section 9  (Deploy)  | 2 risks folded                             |
| Section 10 (Future)  | Reversibility 4/5, 3 debt classes           |
| Section 11 (Design)  | 2 issues passed to Phase 2                  |
+--------------------------------------------------------------------+
| NOT in scope         | written (6 items)                           |
| What already exists  | written                                    |
| Dream state delta    | written                                    |
| Error/rescue registry| 11 methods, 0 critical gaps                |
| Failure modes        | 10 total, 0 planned silent gaps            |
| TODOS.md updates     | 0; formal future scope is not local debt    |
| Scope proposals      | 9 proposed, 6 accepted                     |
| CEO plan             | written                                    |
| Outside voices       | Claude + Codex ran before premise gate     |
| Lake Score           | 9/9 chose complete in-scope option         |
| Diagrams produced    | architecture, data, state, deploy, rollback|
| Stale diagrams found | 0                                          |
| Unresolved decisions | 0 plan decisions; formal gates remain      |
+====================================================================+
```

Phase 1 结论：两路独立意见 6/6 共识；用户前提门已通过。进入 Phase 2 时只审 UI 规格，不重开正式实现设计或产品路线。

## 11. GSTACK PHASE 2 · DESIGN REVIEW

### 11.1 范围、方法与评分

本阶段只把现有 UI Demo 补成可实施、可验收的产品化 UI 合同，不重新选择视觉方向，不写产品代码，也不把截图升级为正式运行证据。设计生成器在本机返回 `DESIGN_NOT_AVAILABLE`，因此按 gstack 回退规则采用实际 Electron 界面作为视觉基线，并由两路独立评审分别检查文档与四张真实截屏。

| 项 | 结果 |
| --- | --- |
| 独立评审初始分 | 5/10（规格保守口径）与 8/10（视觉基线口径） |
| 本计划采用的初始分 | **5/10**；按较低分管理遗漏风险 |
| 共同结论 | 不重做视觉风格；补齐首屏层级、逐态合同、证据语义、Windows / a11y 验收 |
| 本轮文档收口后 | **9/10 · PLAN READY**；10/10 必须等真实键盘、IME、Windows、DPI、焦点和辅助模式证据 |
| 授权含义 | 只表示 Design plan review 完成；不表示 Ddev、DEV-M0、正式 UI runtime 或发布已获准 |

双路设计共识：

| 维度 | 规格保守声音 | 视觉基线声音 | 共识 |
| --- | --- | --- | --- |
| 信息架构 | 坐席 / 经理首屏优先级需冻结 | 现有层级可保留，但要写成实施合同 | CONFIRMED |
| 交互与状态 | 异步 / 失败态明显不足 | Happy path 成立，边界态需补 | CONFIRMED |
| 旅程与恢复 | 输入、候选、焦点必须可恢复 | 不应为恢复增加多余确认步骤 | CONFIRMED |
| AI slop | “深度思考 · 预留”会制造未兑现暗示 | 整体视觉克制，不需重做风格 | CONFIRMED |
| 设计系统 / 证据 | 合成日期、风险、绿标语义需降级 | 狐狸、玻璃 Query、实色 Dashboard 一致 | CONFIRMED |
| 响应式 / a11y / Windows | 静态图不能证明真机与辅助模式 | 视觉基线不反对分层设备取证 | CONFIRMED |
| Taste / 未决项 | 需冻结最小计分板、证据详情与排名语义 | 可在既有 UI 内收口，无需新表面 | CONFIRMED |

结论为 **7 / 7 共识、0 个视觉方向分歧**；较低初始分用于管理规格遗漏，较高初始分只说明现有视觉基线成熟。

### 11.2 既有 UI 视觉基线

本轮没有生成替代稿。以下文件冻结“方向与层级”，不冻结其中的合成业务值，也不证明正式服务、原生窗口或 Windows 行为：

| 证据 | 锁定内容 | 明确不证明 |
| --- | --- | --- |
| gstack 本地取证 `existing-ui-20260821/01-fox-idle.png` | 狐狸是闲置主形态；不增加常驻说明文字 | hover / focus、动画、桌面背景、OS 命中、辅助模式 |
| gstack 本地取证 `existing-ui-20260821/02-query-results.png` | 输入法式 Query、Top 1～3 原文卡、人工复制主链 | 正式来源、风险判定、真实有效期、失败态、Windows IME |
| gstack 本地取证 `existing-ui-20260821/03-dashboard-overview.png` | 管理概览先展示待决策事项，再展示指标 | 正式指标、实时性、权限或完整九模块已交付 |
| gstack 本地取证 `existing-ui-20260821/04-dashboard-architecture.png` | 设计 / 原型 / 正式三轴分账方向 | 任一能力已正式接通；单独绿色标签不得脱离证据解释 |

完整截图与 `capture.json` 保存在本机 gstack 的 `existing-ui-20260821/` 取证目录；这些本地 artifact 不进入产品仓。

### 11.3 七轮设计检查结论

| Pass | 发现 | 收口决定 |
| --- | --- | --- |
| 1 · 信息架构 | 坐席与经理首屏优先级未写成规格 | 坐席：输入 / 当前状态 → 排名第 1 合格原文及来源 → 其余候选 / 复制 / 人工升级；经理：阻断事项及影响 → Owner / 下一步 / 窗口 → 新鲜度 / 证据 → 指标趋势 |
| 2 · 交互与状态 | `ERROR` 过宽，loading / partial / stale / auth / source-blocked / copy-failed 缺逐态合同 | 采用 §11.5、§11.6 状态矩阵；每态定义文案、动作、保留内容、焦点和播报 |
| 3 · 旅程与情绪 | Happy path 可信，但无命中、长等待、断网、旧数会迅速损害信任 | 所有恢复遵循“输入不丢、原因可理解、下一步明确、不得越权” |
| 4 · AI slop | 整体克制；`深度思考 · 预留 · OFF` 容易像未兑现 AI 功能 | 正式产品主查询路径移除；只允许在“演示环境 / 架构能力图”解释关闭边界，且不生成、不改写 |
| 5 · 设计系统 | 玻璃 Query、实色 Dashboard、紫色锚点一致；合成有效期 / 风险词仍像正式判断 | 合成日期、风险、状态统一加“合成演示 / 固定快照”前缀；风险无策略证据则不展示 |
| 6 · 响应式 / a11y / Windows | 四张静态宽屏图不能证明最小窗口、DPI、IME、键盘和高对比 | 采用 §11.9 分层证据矩阵；真实设备证据不得被自动化替代 |
| 7 · 未决决策 | 最小计分板落点、证据详情、排名高亮与只读元数据语义未冻结 | 已在 §11.4、§11.8、§11.10 自动收口；没有遗留给工程师临场猜测的 Taste 项 |

### 11.4 表面层级与里程碑边界

```text
PRIMARY AGENT JOURNEY
Fox idle -> Query input -> searching -> 1..3 eligible originals
         -> human activates one card's Copy -> copied OR recoverable failure

SECONDARY MANAGER JOURNEY
Dashboard Overview -> blockers -> owner / next step / window
                   -> evidence freshness -> metric definition / trend
```

- Query 是坐席关键路径；Dashboard 图标、原生菜单与 Tray 只是次入口，不抢查询主 CTA。
- Demo 可继续展示九模块以说明架构和设计覆盖，但 `milestoneSurface` 必须分账：DEV-M1 只形成 Search / Events 与未来计分板所需的事件合同，不交付正式 Dashboard；DEV-M4 的第一个纵向切片才把现有“管理概览”接成最小只读计分板，随后再逐模块完成九模块 read model 与获批写能力。
- 最小只读计分板复用现有“管理概览”，不新增第四个窗口或第四种产品表面。首屏只保留阻断事项、影响、Owner、下一步、处理窗口、数据更新时间、证据等级和样本充足性；KPI 不能压过待决策表。
- 少于 3 条合格结果时显示“仅找到 1 / 2 条合格话术”，不补空卡、不降低门槛、不暗示系统遗漏。

### 11.5 Query 用户可见状态合同

| 状态 | 用户看见 | 主动作 / 禁用 | 内容保留 | 焦点与读屏 |
| --- | --- | --- | --- | --- |
| `INPUT` | 当前问法与环境边界 | Enter 查询；空值 / 超长时不发请求 | 输入保留 | 打开时聚焦输入；错误与帮助由输入关联 |
| `SEARCHING` | “正在检索已批准来源”与克制进度反馈 | 可取消或继续编辑；复制禁用 | 输入保留，旧结果移出可操作区 | `aria-live=polite` 播报开始；编辑会取消旧 generation |
| `RESULTS_1_3` | 实际结果数、稳定排名、原文、真实非数字匹配理由、来源 / 策略说明 | 每卡独立复制；不自动选择、不自动复制 | 输入与结果保留 | 首条排名强调不等于焦点；Tab / 数字键按既有安全门路由 |
| `NO_HIT` | “未找到可用话术”与评测范围说明 | 修改问题 / 转人工；无复制 | 输入保留 | 焦点回输入；播报无命中与下一步 |
| `SOURCE_BLOCKED` | “来源暂不可用”，只显示可公开的缺失域 / 同步状态摘要 | 查看同步状态（有权限时）/ 转人工；查询与复制禁用 | 输入保留，不展示未获批候选 | 错误横幅获焦或由 live region 播报 |
| `AUTH_EXPIRED` | “登录已过期，请重新认证” | 重新认证 / 取消；新检索与复制禁用 | 查询文本保留；旧候选标为不可用，不当作当前答案 | 认证完成返回原任务；取消回输入 |
| `OFFLINE_LEASE_EXPIRED` | “离线使用期限已到，需联网确认来源” | 重新连接 / 转人工；检索和复制禁用 | 输入保留，旧结果不继续标为有效 | 播报停检索原因和恢复入口 |
| `NETWORK_UNAVAILABLE` / `TIMEOUT` / `OVERLOADED` | 具体原因、可否重试、不会丢输入 | 重试 / 取消 / 转人工；禁止静默切 synthetic | 输入保留；只保留仍在有效证据期内且明确标旧的候选 | 主动作获焦；重试保持上下文 |
| `COPY_PENDING` | 目标卡“正在复制” | 阻止重复激活；其他复制动作暂不可用 | 所有候选保留 | 播报处理中，不改变发送语义 |
| `COPIED` | “已复制第 N 条”约 900ms | 可按既有行为自动收起；不得显示已发送 / 已采纳 / 正确 / 已解决 | 仅记录复制终态 | `aria-live=polite`；不把视觉排名读成选择 |
| `COPY_FAILED` | “复制失败，候选仍保留” | 重试复制 / 取消 | 输入与候选全部保留 | 焦点回失败卡复制按钮，播报可重试 |
| `STALE_CANCELLED` | 不显示旧请求结果；继续呈现最新输入 / 请求状态 | 无旧请求动作 | 最新输入保留 | 旧 generation 不播报、不抢焦点 |

Query 另有以下不变量：

- `rank`、`focusedCandidateId` 与 `copyTargetId / copyState` 三者独立；本产品不增加一次多余的“预选择”点击，用户激活某卡复制动作即完成当次人工选择。
- `matchReason` 只能来自真实检索路径，如精确问法、同义表达、主题与意图、相似问法；禁止为了填标签让全部候选显示“精确问法”，仍禁止数值匹配分。
- `answerText` 始终是获批原文；风险标签只有在明确策略结果及解释存在时才显示。合成 Demo 使用“策略演示：低风险 / 需人工核对”，不得冒充正式判定。

### 11.6 Dashboard 用户可见状态合同

| 状态 | 用户看见 | 动作与恢复 | 证据规则 |
| --- | --- | --- | --- |
| `SYNTHETIC_FIXED` | “合成固定快照 · 无后端 · 不保存” | 仅浏览获准的本地联动 | 所有值带合成口径，不出现“实时” |
| `LOADING` | 结构骨架与模块名，不闪现旧 KPI | 取消 / 等待；达到阈值后给重试 | 不用 synthetic 数值填充正式 loading |
| `EMPTY` | “当前范围暂无数据”及范围 / 周期 | 返回上层 / 调整获准筛选 | 空数据不等于 0，不伪造趋势 |
| `PARTIAL` | 明确哪些组件可用、哪些不可用 | 重试受影响组件 / 查看证据 | 可用组件保留各自 `asOf`，页面不得给整体绿色 Ready |
| `STALE` | 页面标题与受影响组件同时显示“数据已过期” | 刷新 / 查看阻断原因 | 显示最后更新时间、阈值和原因；绿色 verified 自动降级 |
| `SOURCE_BLOCKED` | 四域分别显示 ready / missing / paused / invalid binding | 查看治理责任人 / 下一步 | 不把缺域缩成普通空态 |
| `PERMISSION_DENIED` | 能力不可用及所需角色，不展示受限数据 | 返回 / 申请既有授权流程 | UI disabled 不等于后端授权；服务端仍需拒绝 |
| `ERROR` / `RETRYING` | 发生了什么、影响范围、当前重试状态 | 重试 / 返回 / 查看证据 | 不把部分失败写成整页成功，不静默轮询 |
| `FORMAL_VERIFIED` | 正式运行状态、数据截至时间和指标口径 | 下钻 / 刷新 / 获批动作 | 必须同时满足 `evidenceRef`、`verifiedAt`、`evidenceLevel` 与未过期条件 |

Dashboard 每个模块至少提供：`moduleState`、`dataState`、`asOf / period / scope`、三轴状态、证据元数据、指标单位 / 分母 / 周期、权限状态、交互模式、恢复动作。同步 / 发布四分面继续独立，不因其中一项成功推断其余项成功。

### 11.7 两条 storyboard 与恢复原则

| 角色 / 步骤 | 用户担忧 | 系统必须解释 | 恢复 |
| --- | --- | --- | --- |
| 坐席唤起 Fox / Query | 快捷键是否失效、输入会不会丢 | 当前入口、环境边界、快捷键失败降级 | 点击狐狸或原生入口；输入始终保留 |
| 坐席等待结果 | 是否卡死、旧结果是否串入 | 正在查什么、何时可重试、结果属于哪个问法 | 可编辑取消；迟到结果不得覆盖新问法 |
| 坐席判断候选 | 是否来自获批来源、是否过期 | 原文、适用范围、匹配理由、来源 / 策略状态 | 查看证据摘要；不确定时转人工 |
| 坐席复制 | 是否已经发送、失败后是否丢失 | 复制只改剪贴板 | 失败保留卡片并回焦重试 |
| 经理打开概览 | 数字是否实时、该先处理什么 | 固定范围、数据截至时间、证据等级、阻断影响 | 先处理 blocker，再进入指标 / 证据详情 |
| 经理遇到旧数 / 部分失败 | 是否还能据此拍板 | 哪些旧、旧到何时、哪些组件不可用 | 刷新、看 Owner / 下一步；不能继续显示整体绿色 |

### 11.8 证据、合成标签与详情呈现

- 能力卡首层只显示紧凑三轴 badge 与最近验证时间；“查看证据”打开同页、键盘可达的右侧详情抽屉，列出 `evidenceRef`、`verifiedAt`、`evidenceLevel`、过期阈值、阻断原因和验证环境。关闭后焦点返回触发器；窄窗以覆盖式抽屉呈现，不让卡片永久堆满元数据。
- 状态文案固定为“一期设计映射（非运行状态）”“原型层：本地合成运行”“正式层：未接入 / 已取证”，避免标签脱离列标题后被误读。
- 合成 Demo 不再把 `2099-12-31` 这样的远期日期孤立显示成正式有效期；首选文案为“合成固定快照，不代表正式有效期”。
- 固定的统计周期、业务范围、数据级别使用只读文本 / description list，不画成可点击筛选器。只有确实联动本地视图的 VOC 年 / 月 / 日切片使用交互控件。
- Source、risk、status 与数值没有证据时宁可显示“待复核 / 样本不足 / N/A”，不得用合成默认值填绿。

### 11.9 响应式、无障碍与 Windows 证据矩阵

| 验证面 | 文档 / 静态截图 | 自动化 | macOS 实机 | Windows 实机 / VM |
| --- | --- | --- | --- | --- |
| 信息层级、文案、状态覆盖 | 可评审 | component / visual state 可覆盖 | 可抽查 | 可抽查 |
| Query 输入、IME、焦点、快捷键冲突 | 不可证明 | 只能覆盖 DOM / 协议部分 | 当前 Space 与系统焦点 | Microsoft Pinyin、冲突与任务栏行为必须实测 |
| Dashboard 布局 | 980 / 1180 / 1440 规格 | 无页面级横溢出、长文 / 长 Owner、200% 文本 | 原生标题栏 / Cmd 行为 | 原生标题栏、Snap、125% / 150% / 200% DPI、多屏 |
| 键盘 / 读屏 | 名称、顺序、live 文案可审 | Tab、方向键、焦点恢复、图表替代内容 | VoiceOver 取证 | Narrator + 键盘全流程取证 |
| 辅助模式 | token 与行为可审 | `forced-colors`、reduced-motion、reduced-transparency | 实际渲染 | Windows High Contrast 实际渲染 |
| Fox / Query 透明窗与 aura | 截图只证明单背景 | DOM / bounds 局部 | macOS 桌面背景与合成器 | Windows 桌面背景、DPI、合成器、任务栏 / 托盘 |
| 签名、更新、安装、回滚 | 不可证明 | 包后验不等于运行 | 对应平台实测 | DEV-M3 真实受支持设备，DEV-M0 smoke 不计通过 |

断点规则：

- Dashboard 以 `980×680`、`1180×760`、`1440+` 三档取证；事项、状态和主动作始终保留。980 档可把 Owner / 下一步合并，辅助证据进入详情抽屉，禁止页面级横向滚动。
- Query 维持约 600px 原生宽度和动态高度；长正文只滚结果区，输入胶囊与当前卡复制动作持续可达。200% 文本缩放时不得截断主动作或把焦点元素推到不可达区域。
- 状态不能只靠颜色；错误横幅、结果数、复制反馈、图表选择与旧数据均有文字、图标 / 结构和适当 live 播报。

### 11.10 设计系统与 Taste 自动决策

本轮没有用户提出新的视觉挑战，以下 Taste 项按既有 `DESIGN.md`、用户已认可 Demo 和最小复杂度原则自动决定：

| Taste 项 | 决定 | 原因 |
| --- | --- | --- |
| 排名第 1 卡是否保留淡紫强调 | 保留，但只表示排名，不表示选中；键盘焦点使用独立 focus ring | 延续现有层级且消除语义混淆 |
| 风险标签是否每卡常驻 | 仅在策略依据和解释存在时显示 | 无证据的“低风险”会制造过度安心 |
| `深度思考 · 预留 · OFF` | 正式主查询路径移出，放入演示环境 / 架构说明 | 避免未兑现 AI 入口与主任务竞争 |
| 合成有效日期 | 默认显示“合成固定快照”，不突出 2099 日期 | 降低正式有效期误读 |
| Dashboard 首屏 | 保留待决策表优先，KPI 在后 | 符合经理“先拍板再浏览”任务 |
| 架构说明英文 | 主界面中文化；英文仅保留代码 / 架构参考 | 降低认知负担 |
| Fox aura | 保留当前方向；仅在不同背景 / 辅助模式证据失败时调透明度或裁切 | 不重做已经认可的狐狸资产 |
| 证据详情 | 紧凑 badge + 同页详情抽屉 | 在可审计与避免卡片过密之间取平衡 |

### 11.11 Design Litmus Scorecard

分类为 **APP UI**；Fox 是唯一品牌锚点，Query 是主工作区，Dashboard 是高密度管理面。Litmus 评价计划与现有视觉基线，不代表真机运行通过。

| Litmus | YES / NO | 证据 / 限制 |
| --- | --- | --- |
| 首屏能否立即识别产品 / 品牌 | YES | Fox 闲置形态和 Query 狐狸共享元素唯一；Dashboard 左上沿用同一角色 |
| 是否只有一个强视觉锚点 | YES | 坐席面以狐狸 / 输入胶囊为锚；管理面以 blocker 决策表为锚，不与 KPI 抢层级 |
| 只扫标题 / 状态能否理解 | YES | Query 状态、结果数、来源 / 策略和 Dashboard blocker / Owner / freshness 均有明确文本 |
| 每个区域是否只有一个职责 | YES | Fox 唤起、Query 检索复制、Dashboard 决策与证据分面；不新增第四表面 |
| 卡片是否确有交互必要 | YES | Query 每卡对应一个独立原文与复制动作；Dashboard 不用卡片马赛克替代布局 |
| 动效是否改善层级 / 状态 | YES | Fox / Query 共享元素和业务态反馈服务方向与连续性；reduced-motion 时可安全降级 |
| 去掉装饰阴影后是否仍成立 | YES | Dashboard 依赖排版、1px 分隔与状态结构；Query 玻璃是表面语义，不靠堆叠阴影制造层级 |

结论：**7 / 7 YES，0 个 hard rejection pattern。** 这解释了为何保留现有视觉方向；Windows 合成器、DPI、焦点、IME、读屏与辅助模式仍须按 §11.9 取证。

### 11.12 Design Implementation Tasks

| ID | 生效阶段 | Owner | 任务 | 验收证据 |
| --- | --- | --- | --- | --- |
| DES-T1 | Ddev 后 · DEV-M1 | Product + Frontend | 把 §11.5 变成 Query 状态 / 文案 / 焦点合同，不新增预选择步骤 | component + Electron E2E 覆盖逐态、IME、迟到响应、复制失败 |
| DES-T2 | Ddev 后 · DEV-M1 / M4 | Search + Frontend | 真实 `matchReason`、合成标签、来源 / 策略摘要和证据降级 | 正负例合同测试；无伪“精确问法”、无正式化合成值 |
| DES-T3 | Ddev 后 · DEV-M4 first slice | Product + Dashboard | 复用管理概览完成最小只读计分板，不新增表面 | blocker / Owner / next step / window / freshness / evidence / sample sufficiency E2E |
| DES-T4 | Ddev 后 · DEV-M4 | Dashboard + Security | 三轴 badge 与 evidence details 抽屉，按角色只读优先 | 缺证据 / 过期降级、焦点返回、权限负例 |
| DES-T5 | DEV-M0 规格冻结；DEV-M3 实机 | Desktop + QA | 冻结并执行 Windows / DPI / IME / 多屏 / 高对比 / 热键矩阵 | `FEASIBILITY-SMOKE` 与 `WINDOWS-VERIFIED` 分账证据 |
| DES-T6 | 各里程碑退出 | Frontend + QA | 键盘、读屏、200% 文本、forced-colors、reduced-motion / transparency | 自动化 + 对应 OS 实机证据，不以截图替代 |

### 11.13 Design Completion Summary

```text
+======================================================================+
| GSTACK DESIGN REVIEW                                                 |
+======================================================================+
| Visual direction       | existing Electron UI retained              |
| Generated alternatives | 0; generator unavailable, real UI used     |
| Independent voices     | 2                                          |
| Initial completeness   | 5/10 conservative (other voice: 8/10)     |
| Plan completeness      | 9/10                                       |
| UI state contracts     | Query + Dashboard written                  |
| Journey storyboards    | agent + manager written                    |
| Responsive / a11y      | evidence matrix written                    |
| Taste decisions        | 8 auto-decided, 0 unresolved              |
| Visual rewrite         | none                                       |
| Runtime / device PASS  | none claimed                               |
| Remaining gate         | Eng review, DX review, final approval      |
+======================================================================+
```

Phase 2 结论：Design plan review 完成，现有 Demo 没有搞混，也无需推倒重来。新增内容是未来实施和验收合同；任何代码动作仍等待 Ddev。

## 12. GSTACK PHASE 3 · ENG REVIEW

### 12.1 范围、双路结论与审批含义

本阶段按“现有代码 → 本计划 → 正式 37 / 39 / 41 / 43 / 46 / OpenAPI / DDL”逐层复核。两路独立工程意见都认为 Route A 与用户选择 A 可保留，但当前草案不能直接升级为 DEV-M0 开工输入。

| 评审声音 | 主要结果 | 独有发现 |
| --- | --- | --- |
| Claude 工程复核 | 10 项 P1；六维均为 `CONCERN` | 强调 copy saga、迟到 query、operation state machine、offline snapshot、里程碑错位、Windows / Pilot Readiness |
| Codex 工程复核 | 1 项 P0 + 7 项 P1；总体 `NO-GO until amended` | 新发现人读合同要求 ACK denial audit，而 OpenAPI / DDL 禁止 `announce_ack` 写入该表 |
| 主评审收口 | **6/6 维度共识；0 个路线分歧；1 个正式合同 P0** | 保留产品方向，修订交接合同与执行计划，不越权实现 |

六维共识：

| 维度 | 共识 | 本计划的收口 |
| --- | --- | --- |
| Architecture | 方向成立，状态 / 边界所有者未完全闭合 | main-owned operation coordinator、terminal delivery、offline snapshot；M1～M4 重新对齐 |
| Tests | 当前仅证明 synthetic Demo | 输出完整测试图与 QA artifact；正式 API / DB / Windows / recovery 都是未来证据 |
| Performance | 300 QPS 尚未认证；10× 不在现有 SLA | 300 QPS 为正常认证，3,000 QPS 只作过载/混沌探针 |
| Security | 当前 Electron 基线可复用，正式能力仍未闭合 | role-specific preload、strict main-frame、closed schema、runtime response validation、production artifact scan |
| Error paths | copy/event、cancel/commit、snapshot crash 存在空窗 | 分离副作用与同步事实；显式 unresolved；原子快照与逐 kill-point 测试 |
| Deployment | Pilot prerequisites 仍是名词列表 | 新增 M4 后的可执行 Pilot Readiness 工作包 |

没有 User Challenge：两路意见都不要求改选 B/C、不提前 Pilot、不取消四域硬门、不重做 UI，也不要求删掉正式离线能力。所有收口均是实现完整性与权威合同一致性问题，可按 autoplan 的 mechanical decision 原则纳入；最终是否批准计划仍留给 Phase 4。

### 12.2 P0 · 正式合同交接缺口

#### ENG-P0-1 · `announce_ack` denial audit 自相矛盾

- 37 §5、39 §6、41 §5.6、46 §5.8 都写明 current / snapshot / ACK 的来源或租约拒绝要在主事务失败后，以独立幂等事务提交最小 denial audit，再返回 HTTP denial。
- OpenAPI `x-source-denial-audit.allowedOperations` 与 DDL `source_denial_audits.operation` 不含 `announce_ack`；ACK 路由反而写 `source-denial-audits-write: forbidden`。
- 39 的冲突规则要求对应路由停止，由同一正式 changeset 修正，产品 runtime 不得自行挑一份执行。

采用完整修复：记录仓先把 `announce_ack` 纳入 allowlist、受控 runtime wrapper、DDL、OpenAPI、39 / 46 说明、静态负例与哈希；ACK 的非来源 / 非租约错误继续走标准 error audit。这里不直接修改正式合同源，因为当前产品化计划不是跨仓合同 changeset，且记录仓工作树已有用户修改。

#### ENG-P1-2 · public request schema 未全部封闭

`SearchRequest` 已有 `additionalProperties:false`，但 `AdoptedEventRequest`、`NonAdoptedEventRequest` 与 `EscalationRequest` 没有。正式修订必须默认拒绝 `user_id`、role、answer、渲染正文、placeholder 值、source locator、token 与任意未知对象字段；产品仓只消费修订后的机器合同，不额外手写一套 Zod / TypeBox 真源。

#### ENG-P1-3 · desktop terminal delivery 静态合同不足

正式合同冻结了“clipboard 成功后才能 adopted”“每 query 只有一条 terminal”，但没有闭合 clipboard 已成功而 event 响应丢失、进程崩溃、timeout 竞态和已提交 search 被 UI 取消的客户端交付合同。`UPSTREAM-C2` 必须冻结最小待同步记录：只允许 query / candidate 四元组、outcome / push method、幂等键、状态与时间；禁止 query text、answer、placeholder 值或渲染正文。若需要跨进程重启持久化，必须同时冻结 OS 保护、保留期、用户切换清理与隐私告知，不由实现者临场猜测。

### 12.3 目标架构与单一所有者

```text
Fox renderer                 Query renderer                  Dashboard renderer
     │                             │                                │
fox preload                  query preload                  dashboard preload
(window-only)              (query capability)              (read-first, M4)
     │                             │                                │
     └───────────┐       strict sender / role / main-frame       ┌──┘
                 ▼                                               ▼
          OverlayController                         DashboardReadCoordinator
          (window lifecycle)                         (coach/owner, no Query powers)

Query preload ──► DesktopOperationCoordinator (Electron main)
                   ├─ AuthSession
                   ├─ QueryOperationLedger
                   ├─ SearchPort ──► SyntheticAdapter   [dev/test entry only]
                   │             └─► ProductionAdapter ─► generated client
                   ├─ ClipboardPort                            │
                   ├─ TerminalDeliveryStore                    ▼
                   └─ OfflineSnapshotStore              Application API
                                                          │ nine ports
                                                          ▼
                                                   PostgreSQL SoR + outbox
```

所有权与隐藏知识：

| 模块 | 独占知识 | 最小接口 / 禁止泄漏 |
| --- | --- | --- |
| `OverlayController` | 窗口、bounds、handoff、focus、生命周期 | 不拥有 search / auth / terminal；不被 operation state machine 吞并 |
| `DesktopOperationCoordinator` | 一次 Query 的 identity、generation、session、search / copy / terminal 编排 | renderer 只收领域 ViewModel / sealed error，不见 token、OpenAPI DTO、provider、retry 时序 |
| `QueryOperationLedger` | 是否已发送 / 已提交 / 响应未知、parent lineage、唯一 terminal eligibility | `CANCELLED` 只代表 UI 旧 generation；不能擦除服务器事实 |
| `TerminalDeliveryStore` | clipboard fact 与 terminal sync 分账、幂等 replay、崩溃恢复 | 待上游合同冻结；严禁正文与 placeholder 值 |
| `OfflineSnapshotStore` | 固定 release 分页、cursor / binding / lease、staging、FTS、原子切换、ACK、用户 / 时钟 / 损坏恢复 | renderer 不能直接读写 SQLite；旧 snapshot 不因网络失败自动恢复为有效 |
| `ProductionAdapter` | generated HTTP DTO、runtime response validation、stable error → domain error | 不把 DB / wire shape 泄漏给 UI；不含 synthetic fallback |
| role-specific preload | 一方法一能力、payload validator、白名单 IPC | Fox / Query / Dashboard 不共享通用 `send/on/invoke` 或超集 API |
| Application API | auth、schema、idempotency、rate limit、transaction、repository / definer orchestration | 不接受 renderer role、raw DB error 或 DB row spread |

建议在未来 `DesktopOperationCoordinator`、`QueryOperationLedger`、`TerminalDeliveryStore`、`OfflineSnapshotStore`、import worker fencing 与 publish transaction 入口保留小型 ASCII 不变量注释；普通 mapper / component 不复制这份架构图。

### 12.4 Monorepo 迁移与变更放大控制

当前仓已有 `pnpm-workspace.yaml`，但仍是单包 Demo。DEV-M0 只在 Ddev 后按以下 changeset 顺序执行：

```text
0. pre-move baseline
   └─ 当前 lint / typecheck / unit / component / Electron E2E / packaging / TODOS 取证
1. workspace scaffold
   └─ root policy + empty target directories; no behavior change
2. mechanical desktop move
   └─ current root app -> apps/desktop; imports/scripts fixed; identical behavior
3. contract ingest
   └─ immutable upstream snapshot + source commit + double hashes + codegen/validation
4. API/config skeleton
   └─ no business route until config/schema/ACL gates pass
5. immutable migrations + ACL
   └─ clean install + N/N-1 + failure rollback
6. M1..M4 vertical slices
```

禁止把目录迁移、IPC 改造、正式 API 接入和 UI 行为变化塞进一个 PR。结构变更与行为变更分开，才能准确定位回归并保留现有合成 Demo 基线。

### 12.5 Query operation 与 copy saga

```text
LOCAL_ONLY
  └─ send(query_id) ─► REQUEST_UNKNOWN ─┬─► NOT_COMMITTED
                                        ├─► COMMITTED_WAITING_RESULT
                                        └─► RESULT_AVAILABLE

RESULT_AVAILABLE
  ├─ user edits/closes ─► UI_STALE (server query still tracked)
  ├─ explicit dismiss ─► TERMINAL_SYNC_PENDING(dismissed)
  ├─ lifecycle timeout ─► TERMINAL_SYNC_PENDING(timeout)
  └─ copy requested ─► CLIPBOARD_PENDING
                         ├─ fail ─► COPY_FAILED (no adopted event)
                         └─ success ─► COPIED + TERMINAL_SYNC_PENDING(adopted)

TERMINAL_SYNC_PENDING
  ├─ same-key replay ─► TERMINAL_SYNCED
  ├─ different-body / first-wins ─► TERMINAL_CONFLICT (visible, diagnosable)
  └─ retryable failure ─► COPIED_BUT_SYNC_PENDING (never relabel copy as failed)
```

关键不变量：

1. `clipboardState` 与 `terminalSyncState` 是正交状态；UI `已复制` 只来自 OS side effect，`记录待同步` 只描述证据状态。
2. main 进程拥有 copy saga，Query renderer 不发送两个松散的“复制”和“adoption”调用。
3. 对结果未知的 search 用同 `query_id + canonical body` 重放确认；不能仅靠 AbortController / generation 假设服务端未提交。
4. 已提交的旧 query 必须进入合法 terminal 路径；`CANCELLED` 不得被计作第四个 wire terminal。
5. 自动收起等待 terminal 已确认，或明确显示可恢复的待同步状态；不得在后台静默丢失。

### 12.6 Offline snapshot 子系统

```text
current + lease
  -> create staging store for exact release/user/binding
  -> fetch page(cursor) with fixed release_id
  -> reject duplicate/loop cursor, partial page, binding/lease mismatch
  -> validate every public item + [effective_from,effective_to) semantics
  -> build FTS and manifest
  -> fsync/commit staging
  -> atomic pointer/file switch
  -> ACK exact release/binding/lease
  -> serve local search only while lease valid
```

崩溃在原子切换前：删除 / 隔离 staging，继续保留上一 committed snapshot 的物理文件，但是否可查询仍由其当前有效租约决定。崩溃在切换后、ACK 前：重启后对同 release / lease 幂等 ACK；ACK 不续租。租约过期、时钟回拨、用户切换、数据库损坏或 binding 不一致：立即停本地检索，清理不属于当前用户的可读状态，联网重新建立；无旧 snapshot fallback。

### 12.7 测试覆盖图与 QA artifact

```text
[current synthetic Demo]
  unit/component/Electron E2E/window/assets/package postconditions ── COVERED NOW

[DEV-M0]
  contract hash ─ schema closed negatives ─ config reject ─ migration/ACL ─ artifact scan
       │
[DEV-M1]
  auth/notice ─ 32KiB/500cp ─ current/source gate ─ search/idempotency ─ events
       │
[DEV-M2]
  durable upload ─ outbox fencing ─ quality/review ─ publish/rollback ─ announce/audit
       │
[DEV-M3]
  operation ledger ─ copy saga ─ placeholder zero-retention ─ offline atomic snapshot
       │
[DEV-M4]
  RBAC ─ dual denominator ─ stream cursor/freshness ─ workorders ─ scorecard/a11y
       │
[Readiness]
  OAuth ─ deploy ─ backup/restore ─ signed Windows update ─ monitoring/on-call

Every path right of the current Demo line is PLANNED, not runtime PASS.
```

完整 QA 输入保存在本机 gstack artifact：`hutou-codex-implementation-design-p1-eng-review-test-plan-20260821-105228.md`，不进入产品仓。

必须与功能同批实现的关键负例包括：

- request 未知字段、身份 / role / 正文 / placeholder 值注入、runtime response 多字段与敏感字段泄漏；
- 499 / 500 / 501 Unicode code point、代理对、32 KiB、UTC `effective_to=null` 与 `now==effective_to`；
- clipboard / terminal 的每个 kill-point、响应丢失、timeout 竞态、重复激活和重启；
- search send 前 / 后 / server commit 后取消与同 query replay；
- snapshot cursor 环、部分页、磁盘满、clock rollback、lease 错绑 / 过期、用户切换与损坏；
- clean install、N/N-1、ACL、并发 publish、worker 失租、审计失败、备份恢复；
- production bundle 中存在 fixture / mock auth / synthetic provider / secret / source map 即失败；
- Windows Microsoft Pinyin、焦点、透明窗、DPI、多屏、High Contrast、Narrator、企业 CA / proxy、签名更新与回滚。

本计划不修改 prompt / LLM 主路径，不需要 LLM eval；可选 ranker 只需超时 / 错误回退到冻结规则序的负例。

### 12.8 Failure Modes Registry

| Codepath | 现实故障 | 测试 | 处理 / 用户可见 | 当前结论 |
| --- | --- | --- | --- | --- |
| contract handoff | ACK audit / schema 冲突被旧哈希掩盖 | 静态 cross-contract + hash reject + 产品仓 intake 负例 | 来源 commit、contract_set 与产品仓双哈希接收已完成；锁为未激活 | **resolved for handoff · runtime still gated** |
| production boot | auth / DB / storage / contract 缺失 | config reject matrix | 监听前拒启 | planned |
| search | 服务器已提交、客户端取消并丢响应 | replay + kill-point E2E | UI stale 与 server terminal 分账 | planned |
| copy saga | clipboard 成功、event 失败 / app crash | side-effect × network × crash matrix | `已复制 · 记录待同步`，有界重放 | planned; upstream contract first |
| terminal | timeout 与 adopted 竞争 | DB first-wins + client state test | 冲突可见，不伪造第二终态 | planned |
| snapshot | 部分页或 cursor 环被切成 current | page/cursor/crash tests | staging 拒绝，原子指针不动 | planned |
| snapshot lease | 时钟回拨 / 过期仍搜 | fake-clock + real-device | 立即停搜、联网同步 | planned |
| import worker | claim 后失租仍 finalize | fencing / kill test | 事务回滚，旧 worker 停副作用 | planned |
| publish | 四域切换半成 | concurrency / failure injection | old current 不动，拒绝审计独立提交 | planned |
| Dashboard | 部分组件 stale 仍整体绿色 | component / stream E2E | 局部 stale / partial，整体不 Ready | planned |
| overload | retry storm 耗尽 pool / WAL | 300 QPS + 3,000 QPS chaos | bounded 429/503，无放大，压力后恢复 | planned |
| updater | 签名 / metadata / version 降级 | Windows package + real-device | 中止，保留上一签名版本 | planned |
| recovery | PG 与对象存储恢复点不一致 | restore drill | 停写、恢复一致点、fenced replay、client resync | planned |

所有当前发现都已绑定未来测试与可见恢复，不留“无测试 + 无处理 + 静默”的计划缺口。`ENG-P0-1` 已由来源 commit、正式 `contract_set_id`、双哈希和产品仓 intake 关闭 handoff blocker；codegen、migration、runtime 与动态负例仍等待 Ddev 后对应里程碑。

### 12.9 Performance / capacity

- 300 QPS × 60s 是现有正常短突发认证场景；分别报告 API 内 p95、端到端 p95、PG pool wait、rate-limit lock wait、WAL / 写放大、错误率与恢复时间。
- 500/s 只是保护上限，不是已认证吞吐。3,000 QPS 是 10× overload / chaos probe，目标是 bounded 429/503、无重复 terminal、无 retry amplification、无 pool/WAL 崩溃并可恢复；不要求 800ms SLA。
- 若业务要求 3,000 QPS 仍满足正常 SLA，先签 `DEC-CAP-01` 并切公司网关 / Redis 等原子限流，再重做架构与容量认证。
- snapshot 采用流式分页与磁盘 staging，不把完整 release 与 FTS 同时复制多份到 JS heap；import 同样流式 hash / parse。内存与磁盘水位、cursor 页数和最大 release 条目数进入测试指标。
- Dashboard 避免按行 N+1；metrics / stream 使用冻结读模型、稳定 cursor 和窗口限制，任何新 query 用 EXPLAIN 包络与索引证据验收。

### 12.10 Security / deployment closure

- Fox、Query、Dashboard 分别拥有 capability map。现有 clipboard handler 只使用允许 `senderFrame` 缺失的 `isTrustedSender`；正式 Query 能力必须统一采用 strict main-frame + expected WebContents + exact origin + runtime payload validator。
- production 与 synthetic 使用独立构建入口 / dependency graph；运行时环境变量不能把 production 切回 fixture。包后扫描证明 synthetic fixture、mock auth 路由和 provider 不存在。
- renderer 不直连网络、不持有 token；Dashboard 保持 read-first，服务端 RBAC 不因按钮 disabled 而省略。
- Pilot Readiness 以实际环境 / artifact / runbook 取证：真实 OAuth、secret、migration job、API / worker / storage、immutable promotion、backup/restore、监控/on-call、signed Windows install/update/rollback。Docker / Compose 或 CI 配置存在都不能单独证明已部署。

### 12.11 What already exists

| 现有资产 | 复用方式 | 不得误用 |
| --- | --- | --- |
| Fox / Query / Dashboard UI 与玻璃视觉 | 作为唯一视觉和交互基线 | 不等于正式数据、Windows 或 M4 runtime |
| `OverlayController` 与 window lifecycle | 保持深模块，继续独占窗口时序 | 不把 search / auth / terminal 塞进去 |
| typed preload、IPC whitelist、sender / role guards | 复用验证模式并拆 role-specific surface | 当前 clipboard guard 不能直接升格为正式 main-frame 证据 |
| synthetic `searchScripts` 与 fixtures | dev/test adapter、回归 oracle | 不复用 wire DTO，不进入 production artifact |
| Dashboard manifest 与九模块 | 设计映射、M4 迁移清单 | 不按现有字段直插 PostgreSQL / metrics |
| packaging / workspace hygiene / Electron E2E | 作为 pre-move baseline 与 package 后验起点 | unsigned Windows 包不等于 Pilot 分发 |
| `docs/reference-api-adapter-handoff.md` | Demo→正式字段和语义迁移输入 | 不是新的正式合同真源 |
| 正式 37 / 39 / 41 / 43 / 46 / OpenAPI / DDL | 版本化 contract set 单向消费 | 当前 P0 未修前不可称 immutable handoff Ready |

### 12.12 NOT in scope

- Ddev 前初始化 API、worker、migration、正式 adapter 或生产配置：组织授权未成立。
- 本轮直接修改记录仓 OpenAPI / DDL / 37～46：需要独立、完整、可重算哈希的正式 changeset，且记录仓已有用户修改。
- 提前到 M1 / M2 的正式 Query UI 或 Dashboard：分别保持 M3 / M4 归属。
- 取消离线 snapshot、放宽四域来源或用 stale fallback：会改写正式路线，未获授权。
- LLM 改写、embedding 在线主路、auto-send、班牛写回、真实训练 / teacher：一期边界继续关闭。
- 3,000 QPS 正常 SLA：需要新的容量决策，不从 chaos probe 推导。
- 真实客户数据、凭证、token、OAuth 配置、部署、Pilot、付费、commit / push / PR / merge：均需各自授权。

### 12.13 Worktree parallelization strategy

| Step | Modules | Depends on |
| --- | --- | --- |
| A0 · 正式合同修订 | 记录仓 contracts / OpenAPI / DDL / tests | 当前设计 Owner；产品实现前 |
| A1 · pre-move / workspace | root policy / `apps/desktop` / scripts | Ddev + A0 handoff |
| A2 · contract / codegen / migrations | contracts / API schema / DB | A1 |
| B1 · M1 API search/events | API domain / ports / DB | A2 |
| B2 · M2 content/worker/announce | API content / worker / storage / DB | A2；部分与 B1 共 DB migration，分 changeset 协调 |
| C1 · M3 desktop coordinator | desktop main / preload / adapters | B1 + B2 announce contract |
| C2 · M3 offline snapshot | desktop main / local cache | B2 + A0 lease contract |
| D1 · M4 Dashboard | dashboard renderer / preload / read models | B1 + B2 + C1 identity/session |
| E1 · Pilot Readiness | deploy / ops / packaging / runbooks | M4 complete |

并行 lane：

- Lane A：A0 → A1 → A2（串行，权威合同与骨架关键路径）。
- Lane B：A2 后 B1 与 B2 可在独立 worktree 并行；共享 DB migration / generated contract 时按 migration owner 串行合并。
- Lane C：B1 / B2 合并后，C1 与 C2 可分模块并行，最后由 main coordinator 集成。
- Lane D：后端 read model 稳定后进入 D1；不和早期 M1/M2 UI 混写。
- Lane E：E1 在 M4 后，部署 / OAuth / Windows / recovery 可并行取证，但统一 Readiness gate 汇总。

冲突旗标：B1 / B2 都可能触碰 migrations 与 shared generated types；C1 / C2 都触碰 Electron main。各自必须指定单一 owner、先合合同再分支，不能靠冲突后手工拼接隐含顺序。

### 12.14 Eng Implementation Tasks

以下都是未来任务；除记录仓静态合同修订外，产品代码任务均等待 Ddev。

- [x] **ENG-T1 (P0, human: ~2d / CC: ~4h)** — formal contracts — 修复 ACK denial audit 与 public request closed schema，重算并交接合同集
  - Surfaced by: §12.2；37 / 39 / 41 / 46 与 OpenAPI / DDL 冲突。
  - Files: 记录仓 37 / 39 / 41 / 46、OpenAPI、33 DDL、合同测试、交接清单。
  - Verify: cross-contract regression、OpenAPI validator、PG15 DDL / ACL、双哈希与 generated view 全绿。
  - Status 2026-08-22: 来源 commit `1d62e2c85c3c77dbb7a2fecc1d24a2002cb0ed38`、contract set、双哈希与产品仓 `VERIFIED_NOT_ACTIVATED` intake 均已验证；任务按“正式合同交接”口径关闭，不代表 ENG-T4 或 DEV-M0 已开始。
- [ ] **ENG-T2 (P1, human: ~1d / CC: ~3h)** — formal desktop contract — 冻结 copy saga、query replay、terminal delivery 与最小待同步记录
  - Surfaced by: §12.2 / §12.5；clipboard 成功、event 失败 / 崩溃尚未闭合。
  - Files: 记录仓 31 / 37 / 39 / 41 / 46、OpenAPI extension / test plan；产品 handoff 文档随后对齐。
  - Verify: side-effect × timeout × crash 决策矩阵无正文 / 值持久化且每 query 至多一 terminal。
- [ ] **ENG-T3 (P1, human: ~1d / CC: ~3h)** — workspace — 固化 pre-move 证据并机械迁移现有 desktop 到 Monorepo
  - Surfaced by: §12.4；避免结构与行为同批放大。
  - Files: root workspace、未来 `apps/desktop/`、scripts、test config。
  - Verify: 迁移前后同一 lint / typecheck / unit / component / Electron E2E / build / workspace 结果。
- [ ] **ENG-T4 (P1, human: ~2d / CC: ~5h)** — contracts / DB — 建立 immutable contract ingest、codegen、runtime validator、migration 与 ACL 门
  - Surfaced by: §12.2 / §12.4 / §12.7。
  - Files: `contracts/upstream/`、generated types/schemas、future `packages/db/`、CI。
  - Verify: hash mismatch fail、unknown / sensitive fields 400、clean install、N/N-1、ACL、rollback、production artifact scan。
- [ ] **ENG-T5 (P1, human: ~4d / CC: ~1d)** — Application API — 按正式 M1 实现 auth/policy/redaction/search/events，不接 UI
  - Surfaced by: milestone correction；正式 46 的 M1 边界。
  - Files: future `apps/api/`、domain / ports、DB functions、contract tests。
  - Verify: 32 KiB / 500cp、source / scope / current、idempotency、stateless、terminal / escalation 正负例。
- [ ] **ENG-T6 (P1, human: ~5d / CC: ~1.5d)** — Content / worker — 按 M2 实现 durable import、fencing、publish/rollback/announce
  - Surfaced by: §12.6 / failure review；M2 不包含 Dashboard UI。
  - Files: future API content modules、worker、storage port、DB migrations / tests。
  - Verify: durable 202、kill-points、lease lost、quality/review、four-domain atomicity、ACK audit、restore tests。
- [ ] **ENG-T7 (P1, human: ~3d / CC: ~1d)** — Electron main / preload — 建立 role-specific capability 与 operation coordinator
  - Surfaced by: §12.3 / security review。
  - Files: future desktop main、Fox/Query/Dashboard preload、shared validators、tests。
  - Verify: strict main-frame / origin / role / payload negatives；renderer 无 network/token；production 无 synthetic fallback。
- [ ] **ENG-T8 (P1, human: ~3d / CC: ~1d)** — Query operation — 实现 query ledger、copy saga 与 terminal delivery
  - Surfaced by: §12.5；迟到 server commit 与 clipboard/event 非原子。
  - Files: future desktop coordinator / operation state / terminal store / Query ViewModel。
  - Verify: replay、cancel、copy / timeout / crash 全矩阵；`已复制` 与 `记录待同步` 分账。
- [ ] **ENG-T9 (P1, human: ~4d / CC: ~1d)** — Offline snapshot — 实现 staging→validate→FTS→atomic switch→ACK
  - Surfaced by: §12.6。
  - Files: future desktop snapshot store / cache adapter / lease state / tests。
  - Verify: cursor、partial page、disk / crash、clock、user、lease、corruption kill-point 全绿，无 stale fallback。
- [ ] **ENG-T10 (P1, human: ~4d / CC: ~1d)** — Windows desktop — 在 M3 接 production adapter 与真实 OS 验收
  - Surfaced by: milestone correction / Design matrix。
  - Files: desktop renderer/main/preload、packaging、Windows E2E / manual evidence。
  - Verify: IME、focus、hotkey、DPI、多屏、CA/proxy、placeholder zero-retention、签名更新 / rollback。
- [ ] **ENG-T11 (P1, human: ~5d / CC: ~1.5d)** — Dashboard — 从 Overview 最小只读 scorecard 开始完成 M4
  - Surfaced by: CEO / Design / milestone alignment。
  - Files: Dashboard preload/coordinator/read models/modules/tests。
  - Verify: RBAC、freshness、evidence、dual denominator、cursor、partial/stale、workorder no-writeback、a11y。
- [ ] **ENG-T12 (P1, human: ~3d / CC: ~1d)** — capacity / readiness — 完成 300 QPS 认证、3,000 QPS chaos 与 Pilot Readiness
  - Surfaced by: §12.9 / §12.10。
  - Files: load suites、deploy / migration / restore runbooks、monitoring、packaging evidence。
  - Verify: 300 QPS SLI、3,000 QPS bounded overload、OAuth / deploy / restore / signed Windows / on-call exit packet。

### 12.15 TODOS.md disposition

现有 `TODOS.md` 的 4 项 P3 都是当前 Demo 的设备 / 人工验证债务；本轮不复制或改写。它们作为 DEV-M0 pre-move baseline 的输入保留，正式 Windows / OAuth / DB / Pilot 工作已经进入本计划的里程碑和 Implementation Tasks，不再追加模糊 TODO。提议新增 TODO：0；当前直接构建：0。

### 12.16 Eng Completion Summary

```text
+======================================================================+
| GSTACK ENG REVIEW                                                    |
+======================================================================+
| Step 0 scope challenge       | route accepted as-is                  |
| Architecture review          | 6 issues; boundaries folded           |
| Code quality review          | 4 issues; deep owners specified        |
| Test review                  | coverage diagram + 13 gap groups       |
| Performance review           | 3 issues; 300 normal / 3000 chaos      |
| Formal contract blockers     | 1 P0 + 2 P1 upstream amendments        |
| NOT in scope                 | written                                |
| What already exists          | written                                |
| TODOS.md proposals           | 0                                      |
| Failure modes                | 1 critical gap until contract revision |
| Outside voices               | Claude + Codex                         |
| Consensus                    | 6/6 confirmed, 0 route disagreement    |
| Parallelization              | 5 lanes; staged parallel after A2      |
| Lake Score                   | 12/12 chose complete in-scope option   |
| Runtime tests run            | 0 in this phase; plan review only      |
| Ddev                         | NOT AUTHORIZED                         |
+======================================================================+
```

Phase 3 结论：工程评审完成。路线、UI 和里程碑总顺序保留；M1 / M2 / M3 / M4 的职责已纠偏，Pilot Readiness 已变成工作包。正式交接包仍有 1 个 P0，故 Eng 状态为 `ISSUES OPEN`，不等于撤销第 3 关记录，但在记录仓输出新版合同集前不可作为 DEV-M0 输入。

> **2026-08-22 后置关闭记录：** 上述 `ISSUES OPEN` 是 2026-08-21 评审时点结论。ENG-T1 已按评审要求形成来源 commit、新 contract set、双哈希和产品仓 fail-closed intake，因此该 P0 的“合同交接”部分现已关闭；历史评审记录不改写。当前阻断已前移为组织授权门与 `DEC-DDEV-01`，仍不可进入 DEV-M0。

## 13. GSTACK PHASE 3.5 · DX REVIEW

### 13.1 范围、Persona 与审批含义

本阶段审查的是“一个从未接触过本项目的开发者，如何从当前合成 Electron 基线安全进入 M0～M4 正式产品化”，不是重审 UI，也不是实现脚本。两路独立评审均以现有 README、第一次运行、桌面验证、`package.json` 与正式 43 / 46 为证据；没有把未来命令或未授权 runtime 当成已经存在。

| Persona | 主要任务 | 最担心什么 | 成功定义 |
| --- | --- | --- | --- |
| 主 Persona：TypeScript / Electron 全栈开发者 | 跑起 Demo、定位边界、实现某一纵向切片并交付可复验变化 | 跑错模式、改错合同真源、把 synthetic 当 production、在 Windows 才发现平台阻塞 | 15 分钟内知道“当前可运行、未来计划、授权阻断、下一条正确命令” |
| 次 Persona：QA / Ops | 选择正确 gate、复验 migration / package / Windows / recovery 证据 | 用静态或 macOS 证据冒充真实 Windows / runtime /上线证据 | 每条命令都说明能证明、不能证明、artifact 与恢复入口 |

当前结论为：**Demo DX 可用；正式产品化 DX 在 P0 合同修订与 Ddev 前仍是 `NO-GO`。** 本节把计划质量提升到可实施，但不代表 `doctor`、profiles、migration CLI、Windows quickstart 或 DX 测量已经写入代码。

### 13.2 双模型独立意见与共识

Claude 与 Codex 各自从零阅读同一组入口。Claude 给当前约 **4.5/10**，Codex 给 **5.1/10**；分差来自“现有安全文档是否计入错误体验”的权重，不是路线分歧。

| 维度 | Claude | Codex | 共识 |
| --- | --- | --- | --- |
| 首次运行 | Demo 可跑，但 strict zero-to-run 不完整 | 有主链，无实测 TTHW / doctor | CONFIRMED |
| CLI / profiles | 缺统一 setup / doctor / check / dev:all | 命名尚可，profiles 与渐进披露不足 | CONFIRMED |
| 错误与文档 | 缺 problem → cause → fix → docs | 错误设计好，但未形成统一可执行入口 | CONFIRMED |
| 迁移 / 回滚 | 纸面完整，缺可运行 CLI / runbook | 同意；不能把 clean 当 rollback | CONFIRMED |
| macOS / Windows / container | Windows 首跑缺失，服务与 GUI 边界需显式 | Electron 必须原生，容器只承载服务 | CONFIRMED |
| DX 测量 | 缺无敏感数据的本地测量 | 当前 TTHW 必须标 UNMEASURED | CONFIRMED |

两路均保留 Route A、M0～M4、Windows 优先与安全红线；没有产生新的 User Challenge。正式 ACK denial-audit P0 是继承自 Eng 的共同阻断，不是 DX 命令可以绕开的摩擦项。

### 13.3 TTHW 与内部基准

`TTHW` 定义为 clean clone 后第一次看到狐狸头，并完成一次 synthetic Query → Top 3 → 人工复制；不把 Dashboard、正式 API、Pilot 或生产配置算入 hello world。

| 口径 | 当前事实 | 目标 | 取证方式 |
| --- | --- | --- | --- |
| 已配好 Node / pnpm 的快速确认 | **UNMEASURED**；现有路径约 7～11 个操作，规划估计 6～12 分钟 | P50 ≤5 分钟，P95 ≤10 分钟 | clean worktree、本地 JSON artifact、重复 5 次 |
| clean clone、工具链已预装 | **UNMEASURED**；Electron / pnpm cold cache 未分账 | P50 ≤8 分钟，P90 ≤15 分钟 | macOS 与 Windows 分开记录下载 / install / launch 阶段 |
| 全新企业 Windows 电脑 | **UNMEASURED**；CA / proxy / 权限路径尚无 quickstart | P90 ≤30 分钟 | 受支持企业镜像真机；失败阶段与恢复耗时分账 |
| Ddev 后 formal-dev stack | 当前不存在，不得以 Demo 时间代替 | P50 ≤10 分钟，P90 ≤15 分钟到 API ready + native Electron synthetic smoke | `doctor --profile=formal-dev` + services ready + Electron native launch |

基准不是追求最少字符，而是成熟内部 Monorepo 的四个共同点：根命令可猜、失败可恢复、当前 / 未来命令分开、每个 profile 安全默认。目标控制在 **clean clone 不超过 5 个显式操作**；企业证书安装与需要管理员权限的动作单独计时，不能藏在脚本中。

### 13.4 Magical Moment 与根命令合同

Magical Moment 采用 **root CLI guided path**：开发者运行诊断后，终端明确显示当前模式是 `DEMO · SYNTHETIC · NO BACKEND`，随后用一个可复制命令启动狐狸；第一次复制后，终端 / 文档同时解释“已复制不等于已发送、已采纳或正确”。

计划中的命令面如下；标为 `PLANNED` 的命令在实现前不得放入“现在可直接运行”代码块：

| 命令 | 生命周期 | 唯一职责 | 默认 / 输出 |
| --- | --- | --- | --- |
| `pnpm doctor --profile=demo` | PLANNED / Ddev 前可实现为纯诊断 | 检查 Node、pnpm、lockfile、Electron、CA / proxy 与平台 | read-only；人读摘要 + `--json`；失败给下一条修复命令 |
| `pnpm setup:demo` | PLANNED / Ddev 前可实现 | 明确安装 frozen dependencies 与锁定 Electron runtime | 不关闭 TLS、不改系统证书、不静默提权 |
| `pnpm dev:demo` | PLANNED alias；当前入口是 `pnpm dev` | 启动唯一 synthetic Electron profile | 启动前打印三条 Demo 边界 |
| `pnpm verify:quick` / `pnpm check` | PLANNED | 分别跑窄反馈与完整非实机门 | 输出执行了什么、跳过什么、artifact 在哪 |
| `pnpm dev:services` / `pnpm dev:all` | Ddev 后 PLANNED | 启 API / worker / PG / storage；`dev:all` 再拉起原生 Electron | 服务可容器化；Electron 永不进入 Linux 容器冒充 Windows |
| `pnpm db:migrate:{status,plan,apply,verify}` | Ddev 后 PLANNED | 查看、预演、执行与复验不可变 migration | `apply` 显式确认目标；支持 `--json` / `--dry-run` 的只读子命令 |

命名收口时同步修正 `packageManager=pnpm@11.19.0` 与 `engines.pnpm>=9` 的冲突；Corepack / PATH 指引必须跨机器可移植，不再把个人 Homebrew 路径作为默认复制块。

### 13.5 统一错误体验

所有开发入口、API bootstrap 与 migration 工具采用同一五段式输出，不能只抛栈或让开发者搜索长文：

```text
[CONTRACT_MISMATCH] Contract snapshot rejected
Problem: 当前快照不能用于生成或迁移。
Cause: source commit、contract_set_id 或 OpenAPI / DDL hash 不匹配。
Fix: pnpm contract:status --json；获取记录仓签发的新快照后重试。
Docs: docs/troubleshooting/contract-mismatch.md
Diagnostic: <opaque diagnostic_id>
```

| 稳定 code | Problem / cause | 一键恢复或明确下一步 | 禁止行为 |
| --- | --- | --- | --- |
| `CONTRACT_MISMATCH` | 文件、来源 commit、ID 或双哈希不一致 | `contract:status`，停止 codegen / migration | 猜一个“最接近”的快照继续 |
| `CONFIG_INVALID` | profile、auth、DB、storage 或 URL 缺失 / 冲突 | 列出字段与对应 profile 文档 | production 降级 mock / synthetic |
| `CONTENT_NOT_READY` | 尚无合法 current release | 指向 Owner publish runbook | 创建空 release 或直插 current |
| `VALIDATION` | payload、长度、scope、placeholder 非法 | 字段级修复，保留输入 | 把请求原文写日志 |
| `NETWORK_UNAVAILABLE` / `OVERLOADED` | 断网、timeout、503 / 限流 | 有界重试 / 明确按钮 | 伪造 no-hit 或 synthetic 结果 |
| `COPY_FAILED` | OS clipboard 未成功 | 保留候选并重试 | 显示“已复制”或写 adopted |
| `UPDATE_REJECTED` | 签名、metadata 或防降级失败 | 中止，保留上一签名版本 | 安装未签名 / 较旧包兜底 |

`diagnostic_id` 只关联脱敏内部诊断；错误输出、URL、JSON 与本地 DX artifact 均不得包含 query、话术正文、token、placeholder 值、客户身份或真实路径凭证。

### 13.6 Developer Journey Map

| 阶段 | 开发者动作 | 当前摩擦 | 计划后的理想路径 | 证据 |
| --- | --- | --- | --- | --- |
| 1. 找入口 | 打开 README | Demo 入口清楚，产品化计划不够显眼 | 首屏三栏：Current Demo / Ddev 后 / Pilot Readiness | link check + 首次开发者走查 |
| 2. 识别授权 | 查当前能否开发 | 正式记录分散，容易把 Stage 3 PASS 当 Ddev | `doctor` 同时显示 stage、P0、Ddev 与禁止动作 | 合成状态 fixture + snapshot hash |
| 3. 检查环境 | Node / pnpm / CA / Electron | 个人 PATH、企业 CA 判断依赖人工 | profile-aware doctor；只给本机适用修复 | macOS / Windows 正反例 |
| 4. 安装 | frozen install + Electron | 两条安装命令、失败阶段不聚合 | `setup:demo` 分阶段、可重跑、无静默 TLS 绕过 | clean cache / partial retry |
| 5. Hello world | 启狐狸并完成复制 | 路径存在但无计时 | `dev:demo` + guided sample；P50 / P95 artifact | 5 次 clean run |
| 6. 选择验证 | lint / test / E2E / package | 文档完整但命令多 | `verify:quick` / `check`，保留窄命令 | 输出 manifest 与 skipped gates |
| 7. 进入 M0 | consume contract / migration | 正式命令当前只是文档计划，且有 P0 | 新 contract set → status → plan → apply → verify | hash / ACL / N/N-1 artifact |
| 8. 开发 M1～M4 | services + native Electron | profiles / owners / Windows 路径未统一 | `dev:services` + native `dev:desktop`，按 owner 纵切 | API / worker / desktop 分层 evidence |
| 9. Readiness / handoff | OAuth、签名、恢复、3～5 seats | 易把 M4 Done 推导为 Pilot | 独立 readiness command map / runbook / Owner packet | 真 Windows、restore、on-call、审批 EVD |

### 13.7 首次开发者困惑报告与共情叙述

| 困惑 | 当前证据 | 本计划如何处理 |
| --- | --- | --- |
| “现在能跑哪些命令，哪些只是未来设计？” | 46 列出当前并不存在的 `test:contract` / `test:db` 等 | README 与命令清单强制 `CURRENT` / `PLANNED` / `AUTHORIZED` 三态 |
| “为什么 pnpm 锁 11.19，engine 却允许 9？” | `packageManager` 与 `engines.pnpm` 不一致 | 同一 changeset 对齐，并由 doctor fail-fast |
| “Windows 才是目标，为何第一次运行是 macOS？” | tutorial 以 macOS 为已验入口 | 补 PowerShell quickstart；CA / proxy / DPI / native Electron 单列 |
| “容器是不是已经覆盖客户端？” | 正式服务可容器化，Electron 是原生 GUI | profile 图明确 services-in-container / desktop-native |
| “失败后应该改环境、换合同，还是重跑？” | 错误注册表在长计划中，入口未统一 | 五段式错误 + docs anchor + safe next command |

第一人称叙述：**“我是第一次加入项目的开发者。我能在 macOS 上找到狐狸并完成一次合成复制，但进入正式开发时，我不确定哪些命令今天能运行、哪些只是 M0 后的目标，也不知道 Windows、容器、Electron 和正式合同分别由谁负责。看到一长串环境变量和 ACK 审计冲突，我更担心改错真源，而不是写错代码。一个 `doctor`、一个明确 profile、一张当前 / 未来命令表和统一恢复格式，会让我敢于做第一处改动。”**

### 13.8 Profiles、容器与 Escape Hatch

| 能力 | 允许环境 | 默认 | 可覆盖条件 | 永不可覆盖 |
| --- | --- | --- | --- | --- |
| synthetic provider / fixture | `demo`, `test` | demo ON；formal / production 不打包 | 仅显式 profile | production artifact 含 fixture 即失败 |
| `AUTH_MODE=mock` | dev / test | formal-dev 可显式选择，production OFF | 本地合成身份 | production 注册 mock route 即拒启 |
| `RANKING_ADAPTER=disabled` | 全环境 | **disabled** | 经 DEC-EGRESS / budget / security 后启用 | 不得改写 Answer 或成为一期在线必需 |
| stateless / collection disabled | 明确降级场景 | OFF | 只影响允许降级的指标采集 | DLP、Auth、content source 不能随之放宽 |
| `single_host + filesystem` | dev / 明确批准部署 | dev 可选 | API / worker 同主机同持久卷且探测通过 | multi-instance 节点本地盘 |
| local read-only snapshot | M3、租约有效 | 未实现 | 完整拉取、原子切换、user/binding/lease 全匹配 | 过期宽限、ACK 续租、旧 snapshot fallback |

profile 单真源拟定为 `demo | formal-dev | test | single-host | multi-instance | production`；环境变量仍可由受控配置生成，但禁止多个 flag 组合出未命名的“灰色环境”。

### 13.9 Upgrade / Migration / Rollback 合同

- DB：`status → plan → apply → verify`；plan 必须列出当前指纹、目标指纹、兼容窗口、backfill 与停止点。首版诚实标 `N-only`，有 N-1 后才跑真实 N-1 → N。
- 失败：migration 不可改写；根据兼容阶段选择 forward-fix、停新路由或恢复一致点。每次 apply 生成不可变 artifact，不能靠终端滚屏作为证据。
- 客户端：签名版本、update metadata、防降级、上一签名安装包与服务端兼容窗口分账；`clean:deep` 只是删除可重建本地文件，不是产品 rollback。
- 合同：产品仓 upstream snapshot 只读；任何正式 wire / DDL 变化先回记录仓形成新 commit、`contract_set_id` 与双哈希，再由产品仓消费。
- 演练：备份恢复、outbox 重放、client resync 与 Windows downgrade / upgrade 在 Pilot Readiness 独立取证，M0 migration 通过不自动证明这些项目。

### 13.10 无遥测 DX 测量

用户已选择关闭遥测。实现只允许**本地、显式、可删除**的 DX artifact，不发送网络事件：

```json
{
  "schema": 1,
  "profile": "demo",
  "platform": "win32",
  "stages": [{"name":"doctor","duration_ms":0,"exit_code":0,"error_code":null}],
  "hello_world_ms": 0,
  "recovered": false
}
```

- 默认写入 ignored 本地目录，例如 `.gstack/dx-reports/`；命令先说明路径与删除方法。
- 只记录 profile、平台、阶段耗时、exit code、稳定 error code、是否恢复；不记录用户 / 机器唯一 ID。
- 禁止 query、候选、话术正文、token、URL 凭证、文件原路径、客户 / 员工身份、剪贴板或窗口标题。
- 汇总只能由开发者主动执行 `pnpm dx:report` 读取本机文件；没有后台发送、唯一 ID 或自动学习。

### 13.11 What already exists

- README 已明确仓库身份、合成 / 正式边界、Fox → Query → Dashboard 主链和“复制不等于发送”。
- `docs/tutorial-first-run.md` 已给出可执行 Demo 路径、企业 CA 条件说明与常见故障。
- `docs/how-to-verify-desktop.md` 已把 unit / component / Electron E2E / package / 真机证据分层，并明确自动化不能证明真实 OS。
- package scripts 已有 lint、typecheck、unit/component、build、Electron E2E、workspace hygiene 和 fail-closed 本地包后验；新根命令应组合它们，不复制测试逻辑。
- 正式 43 / 46 已冻结 Node / Fastify / PG / worker / deployment profile / migration / recovery / startup rejection 的主体设计；本节补入口，不另造技术栈。

### 13.12 NOT in scope

- 不在 Ddev 前实现 API、worker、migration、production provider 或真实 OAuth。
- 不把 Electron 塞进 Linux container，也不把容器 smoke 写成 Windows GUI 证据。
- 不开发通用脚手架框架、插件系统或多语言 SDK；一期是内部 TypeScript Monorepo。
- 不建立公共社区、论坛或外部文档站；“Community”在本项目等价为内部 Owner、reviewer 与 runbook discoverability。
- 不采集遥测、用户身份、业务正文或设备唯一 ID；只设计本地可删计时 artifact。
- 不把未来 `test:*` / `db:*` 命令写成当前可运行，也不为缩短 TTHW 自动绕过 TLS、签名、合同或生产拒启。

### 13.13 DX Scorecard

以下“目标分”是本计划全部实施并取证后的目标，不是当前 runtime 得分：

```text
+====================================================================+
|              DX PLAN REVIEW — SCORECARD                            |
+====================================================================+
| Dimension                    | Current | Target | Trend             |
|------------------------------|---------|--------|-------------------|
| Getting Started              | 4/10    | 8.5/10 | +4.5              |
| API / CLI / SDK              | 5/10    | 8.5/10 | +3.5              |
| Error Messages               | 5/10    | 8.5/10 | +3.5              |
| Documentation                | 5.5/10  | 8.5/10 | +3.0              |
| Upgrade Path                 | 5/10    | 8/10   | +3.0              |
| Dev Environment              | 3.5/10  | 8/10   | +4.5              |
| Internal Ecosystem / Owners  | 6/10    | 8/10   | +2.0              |
| DX Measurement               | 2.5/10  | 8/10   | +5.5              |
+--------------------------------------------------------------------+
| TTHW                         | UNMEASURED; estimated 6-12m warm     |
| Target                       | P50 <=5m warm; P90 <=15m clean clone |
| Enterprise Windows target    | P90 <=30m                            |
| Competitive Rank             | Current: Needs Work; Target: Comp.  |
| Magical Moment               | designed via root CLI guided path   |
| Product Type                 | internal TS/Electron monorepo        |
| Mode                         | POLISH + FORMAL-DEV EXPANSION        |
| Overall DX                   | 4.8/10  ->  8.3/10 target            |
+====================================================================+
| Zero Friction: planned | Learn by Doing: planned                   |
| Fight Uncertainty: covered | Opinionated + Escape Hatches: covered|
| Code in Context: covered | Magical Moments: designed              |
+====================================================================+
```

当前低于 6 的维度是实施前的 critical DX debt；正式开发入口未落地前不得把 8.3 写成实测分。`TTHW >10min` 的阻断规则以实测 P90 判断，不能用规划估计宣称通过。

### 13.14 DX Implementation Checklist

- [ ] warm TTHW P50 ≤5 分钟，clean clone P90 ≤15 分钟，企业 Windows P90 ≤30 分钟
- [ ] 依赖与 Electron setup 一个显式命令完成，失败可重跑且不静默提权 / 绕 TLS
- [ ] 第一次运行完成 Fox → Query → synthetic Top 3 → 人工复制，并持续显示模式边界
- [ ] 每个开发错误都有 problem + cause + fix command + docs anchor + opaque diagnostic ID
- [ ] root 命令名不查文档也能猜到；`--help`、安全的 `--json` / `--dry-run` 可用
- [ ] 每个 profile 有安全默认，override / non-override 矩阵可查
- [ ] README 的 CURRENT / PLANNED / AUTHORIZED 命令均可机器检查，不出现复制即失败的未来命令
- [ ] migration 有 status / plan / apply / verify、N/N-1、失败停止与 rollback / forward-fix runbook
- [ ] TypeScript 类型只从已校验 contract set 生成，重生成零 diff
- [ ] macOS 与 Windows quickstart 分开；服务容器与原生 Electron 边界明确
- [ ] CI 使用同一 `pnpm check` 聚合面，不依赖个人 Homebrew 路径或交互式 shell
- [ ] CHANGELOG / migration guide / error catalog / troubleshooting 互链并有 Owner
- [ ] 本地 DX artifact 默认 ignored、可删除、零网络、零身份 / 业务正文 / secret
- [ ] public community 标为 N/A；内部 Owner、review queue 与 runbook 入口已建立

### 13.15 DX Implementation Tasks

- [ ] **DX-T1 (P1, human: ~1.5d / CC: ~4h)** — developer CLI — 建立 root doctor / setup / dev / verify / check 命令面
  - Surfaced by: onboarding / CLI — 当前 7～11 个操作、无 doctor，未来命令与当前 scripts 混杂。
  - Files: `package.json`、未来 `scripts/devx/`、`docs/tutorial-first-run.md`、对应 unit tests。
  - Verify: clean cache 的 macOS / Windows 正反例；`--help` / `--json`；无静默 TLS / 权限变化。
- [ ] **DX-T2 (P1, human: ~1d / CC: ~2h)** — documentation — 建立 CURRENT / PLANNED / AUTHORIZED 文档入口与 Windows PowerShell quickstart
  - Surfaced by: discoverability / cross-platform — README 首屏偏 Demo，正式 Windows 无首次运行路径。
  - Files: `README.md`、`docs/tutorial-first-run.md`、未来 `docs/tutorial-first-run-windows.md`、link checker。
  - Verify: 新开发者走查；所有 current command 实跑，planned command 不进入可复制块。
- [ ] **DX-T3 (P1, human: ~2d / CC: ~4h)** — profiles / dev environment — 落地命名 profile 与 services-container / native-desktop 编排
  - Surfaced by: environment — `single_host` / `multi_instance` 只有变量，容易组合出灰色环境。
  - Files: 未来 config schema、compose、workspace scripts、developer runbook。
  - Verify: demo / formal-dev / test / single-host / multi-instance / production 配置拒启矩阵；Electron 不在 container gate 中。
- [ ] **DX-T4 (P1, human: ~1.5d / CC: ~4h)** — errors / recovery — 实现统一五段式错误与可搜索 catalog
  - Surfaced by: error quality — 计划有 registry，当前 CLI / API / tutorial 没有统一恢复入口。
  - Files: 未来 shared error catalog、CLI formatter、API mapper、`docs/troubleshooting/`、tests。
  - Verify: 每个稳定 code 输出 problem / cause / fix / docs / diagnostic；secret / PII snapshot 负例。
- [ ] **DX-T5 (P1, human: ~2d / CC: ~5h)** — migrations / upgrades — 提供 status / plan / apply / verify 与回滚演练 runbook
  - Surfaced by: upgrade path — expand/backfill/validate/contract 已设计，尚无可运行入口。
  - Files: 未来 DB package scripts、migration tool、compat fixtures、recovery docs。
  - Verify: clean install、N-only / N-1、backfill retry、旧客户端兼容、失败 artifact、forward-fix / restore drill。
- [ ] **DX-T6 (P2, human: ~1d / CC: ~3h)** — local DX evidence — 实现无遥测 TTHW / recovery 本地 probe
  - Surfaced by: measurement — 当前 TTHW 为 UNMEASURED，用户已关闭遥测。
  - Files: 未来 `scripts/devx/probe.*`、ignored `.gstack/dx-reports/` schema、privacy tests、docs。
  - Verify: 零网络、零唯一 ID / query / 正文 / token；5 次 clean run 可重算 P50 / P90。
- [ ] **DX-T7 (P2, human: ~4h / CC: ~1h)** — governance — 对齐版本声明并建立 escape-hatch / non-override 矩阵
  - Surfaced by: defaults / safety — pnpm 11.19 与 `>=9` 冲突，安全例外散落多文档。
  - Files: `package.json`、README、未来 config reference / doctor tests。
  - Verify: 错版本 fail-fast；每个 override 都有环境、Owner、审计和不可覆盖条件。

### 13.16 TODOS.md disposition

本阶段发现均直接影响 M0～M4 的开发入口或验收，已经转为本计划 DX-T1～T7，不追加模糊 P3 TODO。公共社区、多语言 SDK、通用插件框架明确不在一期范围；现有 `TODOS.md` 的设备验证债务保持原样。

### 13.17 DX Completion Summary

```text
+======================================================================+
| GSTACK DX REVIEW                                                     |
+======================================================================+
| Product type                | internal TS/Electron monorepo           |
| Primary persona             | full-stack TS/Electron developer        |
| Current score               | 4.8/10                                  |
| Planned target              | 8.3/10; not runtime proof               |
| TTHW current                | UNMEASURED; 7-11 operations             |
| TTHW target                 | P50 <=5m warm / P90 <=15m clean         |
| Enterprise Windows          | P90 <=30m                               |
| Outside voices              | Claude + Codex                          |
| Consensus                   | 6/6 confirmed, 0 route disagreement     |
| Journey stages              | 9                                      |
| Implementation tasks        | 7                                      |
| Telemetry                   | OFF; local removable artifact only      |
| Formal contract blocker     | inherited P0; cannot be bypassed        |
| Runtime tests run           | 0 in this phase; read-only plan review  |
| Ddev                        | NOT AUTHORIZED                          |
+======================================================================+
```

Phase 3.5 结论：DX 评审完成。优先补统一入口和不确定性消除，不重做 UI、技术栈或里程碑；计划已达到可实施粒度，实际 DX 仍须在对应里程碑实现并取证。

<!-- AUTONOMOUS DECISION LOG -->
## Decision Audit Trail

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Phase 0 | cross-project learnings 保持关闭 | Mechanical | P4 DRY / 仓库隔离 | 正式记录仓与产品仓必须共享事实而不混入其他项目经验 | 全机跨项目检索 |
| 2 | CEO | 采用 SELECTIVE EXPANSION | Mechanical | P1 + P2 | 只补价值证据与直接返工风险，不改变正式路线 | 全量扩张或缩减正式范围 |
| 3 | CEO | 坐席主链先于完整 Dashboard | Mechanical（用户已选 A） | P1 | 更早验证真实工作流，完整管理面仍在 M4 | 全后台先行 |
| 4 | CEO | 唯一产品 Monorepo | Mechanical | P4 | 正式 46 §3 已冻结，避免第二仓和第二真源 | desktop-only + 另建服务仓 |
| 5 | CEO | 时间 + 人工质量为主价值证据 | Mechanical | P1 | 复制无法证明正确、发送或解决 | 单看复制率 |
| 6 | CEO | 三轴状态绑定证据元数据并过期降级 | Mechanical | P1 + P5 | 让“看得见”不能自动变成“已运行” | 永久静态绿标 |
| 7 | CEO | main coordinator + DTO mapper 隐藏 provider | Mechanical | P5 | renderer 保持窄、稳定、无凭证 | renderer 直连 API / DTO |
| 8 | CEO | Dashboard 使用独立最小 preload | Taste | P5 | 未来正式数据需要能力边界，但不应继承 Query 权限 | 通用 preload 或 renderer 直联网路 |
| 9 | CEO | DEV-M0 做 Windows feasibility smoke | Mechanical | P2 | 低成本提前暴露平台阻塞，且不抢 DEV-M3 证据 | 到 M3 才首次验证 |
| 10 | CEO | 具体首场景由 DEC-SEARCH-01 冻结 | Mechanical | P6 | 不能在没有业务频次证据时替 Owner 猜答案 | 计划内虚构场景 |
| 11 | Design | 既有 Electron UI 作为唯一视觉基线 | Mechanical | P4 | 用户已有 Demo 且两路评审均认为方向成立 | 另起视觉稿或风格重做 |
| 12 | Design | 最小计分板在 DEV-M4 内先接，不前移到 DEV-M1 | Mechanical | P3 + P4 | 保持正式里程碑归属，同时让 M4 先完成价值所需最小切片 | 改写正式顺序或新建第四表面 |
| 13 | Design | Query 排名、焦点与复制终态分离 | Mechanical | P5 | 防止高亮被误读为自动选择或采纳 | 持久“已选”假状态或增加多余确认步骤 |
| 14 | Design | 证据采用 badge + 同页详情抽屉 | Taste | P1 + P5 | 既保持首屏清晰，又不隐藏证据来源与时效 | 每卡常驻全部元数据或只给无障碍不足的 tooltip |
| 15 | Design | 合成值统一固定快照语义 | Mechanical | P1 | 2099 有效期和无依据低风险会像正式判断 | 合成默认值冒充运营事实 |
| 16 | Design | 正式 Query 移出“深度思考 · 预留 · OFF” | Taste | P1 | 未兑现 AI 入口不应和原文检索主任务竞争 | 作为主 CTA 或生成暗示 |
| 17 | Design | 决策表优先于 KPI 强视觉 | Taste | P1 | 管理端先回答哪里受阻、谁处理、何时处理 | KPI 大屏先行 |
| 18 | Design | Windows 与 a11y 采用分层证据矩阵 | Mechanical | P2 | 静态截图和 macOS 自动化不能证明 Windows 原生行为 | 统一截图即通过 |
| 19 | Eng | M1 / M2 只交付 backend / domain，正式 Query / Dashboard 分别回归 M3 / M4 | Mechanical | P3 + P4 | 与正式 46 里程碑一致，避免 UI 集成重复和测试 bootstrap 伪造 | M1 切 Query、M2 切 Dashboard |
| 20 | Eng | `announce_ack` 纳入正式 denial audit 修订 | Mechanical | P1 + P5 | 四份人读合同一致要求，机器合同缺 allowlist 是可验证缺口 | 产品 runtime 私选 OpenAPI 禁写或削弱人读证据链 |
| 21 | Eng | adoption / escalation request 全部 closed schema | Mechanical | P5 | 未知字段会允许身份、正文和值越过静态机器边界 | 仅在 handler 手写黑名单 |
| 22 | Eng | copy saga 与 query operation 由 main 深模块拥有 | Mechanical | P5 | renderer generation 无法代表 server commit，clipboard 与 terminal 需要单一时序所有者 | renderer 分两次松散调用 |
| 23 | Eng | clipboard fact 与 terminal sync 分账 | Mechanical | P1 + P5 | adoption 失败不能倒推 OS copy 失败，也不能静默丢证据 | 一个 `COPIED` 布尔值覆盖两件事 |
| 24 | Eng | offline snapshot 作为 main-owned 子系统完整实现 | Mechanical | P3 + P5 | 固定分页、FTS、原子切换、ACK、租约与崩溃恢复共享内聚知识 | 只加 `leaseExpired` UI 状态或删除离线路线 |
| 25 | Eng | production / synthetic 使用独立构建入口并扫描 artifact | Mechanical | P2 + P5 | 启动配置拒退不能证明 fixture / mock 能力没有被打包 | 运行时字符串切 provider |
| 26 | Eng | 300 QPS 正常认证，3,000 QPS 仅 overload / chaos | Mechanical | P2 + P6 | 现有容量门超过 300 QPS 即升级，不应暗示 10× SLA | 把 DB 3000ms 或保护上限写成吞吐认证 |
| 27 | Eng | M4 后新增可执行 Pilot Readiness 包 | Mechanical | P2 + P3 | OAuth、部署、恢复、签名和 on-call 是工程交付，不只是审批名词 | M4 结束直接进入 Pilot |
| 28 | Eng | workspace 迁移拆成 pre-move、scaffold、mechanical move、behavior slices | Mechanical | P2 + P4 | 降低变更放大并保留合成基线可定位性 | 目录、API、IPC、UI 一次性大改 |
| 29 | DX | demo 与 formal-dev 使用独立命名 profile | Mechanical | P2 + P5 | 防止环境变量组合出 synthetic / production 灰色模式 | 一个 `.env` 靠人工记忆切换 |
| 30 | DX | root 命令采用 doctor / setup / dev / verify / check 渐进面 | Taste | P1 + P5 | 新开发者先获可恢复诊断，再逐步进入完整验证 | 暴露全部底层脚本或另造通用 CLI 框架 |
| 31 | DX | 错误统一 problem / cause / fix / docs / diagnostic 五段式 | Mechanical | P1 | 长文档中的错误设计必须在失败点可执行 | 只抛栈、只给 code 或解析 DB MESSAGE |
| 32 | DX | services 可容器化，Electron 始终原生运行 | Mechanical | P2 + P3 | 容器不能证明 Windows GUI、焦点、签名或合成器 | 把整套产品塞进 Linux container |
| 33 | DX | migration 暴露 status / plan / apply / verify | Mechanical | P2 + P5 | 不可变迁移需要可预演、可停止、可复验入口 | 直接执行 SQL 或把 clean 当 rollback |
| 34 | DX | TTHW 仅用本地可删 artifact 测量 | Mechanical（用户已关闭遥测） | P1 + privacy boundary | 获得可比较耗时而不采集身份、业务正文或网络事件 | 后台遥测、唯一设备 ID 或完全不测 |
| 35 | DX | 文档命令强制 CURRENT / PLANNED / AUTHORIZED 三态 | Mechanical | P1 + P4 | 防止复制未来命令、把设计写成当前能力 | 用一张无生命周期的命令长表 |
| 36 | DX | escape hatch 与 non-override 条件集中成矩阵 | Mechanical | P2 | 安全默认可理解，但生产红线不能靠“便捷模式”覆盖 | 继续散落在 ENV、Ban 与教程中 |
| 37 | Phase 4 | 用户选择 A，批准计划及全部推荐 | User decision | 最终审批门 | 计划、Taste 决定、29 项任务和 P0 阻断一并获批；授权边界不扩大 | B 覆盖、C 追问、D 修订、E 拒绝 |

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
| --- | --- | --- | ---: | --- | --- |
| CEO Review | `/plan-ceo-review` via `/autoplan` | Scope、价值与策略 | 1 | CLEAN | SELECTIVE EXPANSION；用户接受 proof-first；双路 6/6 共识 |
| Design Review | `/plan-design-review` via `/autoplan` | UI / UX 与证据语义 | 1 | CLEAN | 5/10 → 9/10 plan；双路 7/7 共识；既有 UI 保留；逐态、a11y、Windows 补齐 |
| Eng Review | `/plan-eng-review` via `/autoplan` | 架构、合同与测试 | 1 | ISSUES OPEN | 26 findings；1 个正式合同 P0；双路 6/6 共识且无路线分歧 |
| DX Review | `/plan-devex-review` via `/autoplan` | 开发者入口与迁移体验 | 1 | CLEAN (PLAN ONLY) | 4.8/10 → 8.3/10 target；TTHW 当前 UNMEASURED；双路 6/6 共识 |

**Plan Summary：** 保留 Route A 与 `DEV-M0 → M4 → Pilot Readiness → Pilot`，在每个正式里程碑中先验证单一高频场景、3～5 名 Windows 坐席与 Query → Top 3 → 人工复制价值链。M1 / M2 归 backend / domain，M3 首次接正式 Query，M4 首切最小只读 scorecard。现有 UI Demo 是视觉与交互基线，不是正式 runtime 或 Ddev 证据。

**Decisions Made：** 37 项；35 项按原则自动决定，其中 5 项是 Taste；用户分别在前提门与最终门选择 A。Decision Audit Trail 已逐项记录。

**Resolved User Challenge：** 两路 CEO 意见都反对把“先建完整平台”当作价值证明；建议先围绕一个高频场景证明坐席提效。用户已选择 A。该选择只改变验证重心，不提前 Pilot、不放宽四域来源，也不改正式里程碑。

**Final Approval：** 用户选择 **A · Approve as-is**，接受全部推荐、Taste 默认值、P0 修订顺序与授权边界。计划状态从 `AWAITING USER APPROVAL` 更新为 `APPROVED`。

**Taste Choices：** 默认采用 Dashboard 独立最小 preload、badge + 同页证据抽屉、正式 Query 移除“深度思考 · 预留”、决策表优先于 KPI 强视觉，以及 root `doctor / setup / dev / verify / check` 命名。它们均可在最终批准前覆盖，改变时须同步对应计划段与任务。

**Review Scores：** CEO 选择性扩展收口；Design plan 9/10；Eng 评审时有 1 个 P0，已于 2026-08-22 按来源 commit + contract set + 产品 intake 后置关闭；DX plan 目标 8.3/10、实际 runtime 仍约 4.8/10 且未测 TTHW。四阶段的“clean”只评价计划是否闭合，不代表代码、Windows、OAuth、真实数据、部署或上线通过。

**Cross-Phase Themes：**

- **证据不能由界面颜色推导。** CEO、Design、Eng 均要求 capability、来源、时间与 evidence level 分账，过期或缺失必须降级。
- **Windows 是实施证据，不是文档脚注。** CEO、Design、Eng、DX 均要求 M0 早期 smoke 与 M3 真机验收分层，macOS / container 不得替代。
- **所有副作用必须有单一所有者。** CEO / Eng 收口 main coordinator、copy saga、terminal 与 offline snapshot；DX 把恢复命令暴露给开发者而不复制业务策略。
- **安全默认不能被便利入口绕过。** Eng / DX 均要求 production 无 mock / synthetic、合同 hash fail-closed、TLS / 签名 / lease /来源红线不可 override。
- **设计通过、开发授权与运行通过三账分离。** 四阶段均确认 Stage 3 的历史 PASS 不等于当前合同快照可交接，更不等于 G0 / Ddev / Pilot。

**Deferred to TODOS.md：** 0 项新增。现有 Demo 的 4 项设备 / 人工验证债务保持原样；公共社区、多语言 SDK、通用插件框架、自动发送、全渠道自治与 LLM 主路明确不在一期范围。

**Implementation Tasks (aggregated across phases)：** 共 29 项，按 P0 → P1 → P2 排序；每项来自最新 phase run，按 `(component, files, title)` 精确去重。

- [x] **ENG-T1 (P0, human: ~2d / CC: ~4h) — formal contracts** — 修复 ACK denial audit 与 public request closed schema，重算并交接合同集
  - Surfaced by: eng-review — §12.2：37 / 39 / 41 / 46 与 OpenAPI / DDL 冲突，事件请求未封闭。
  - Files: `ai-赋能立项/37/39/41/46`、`openapi.v1.yaml`、`33-schema-v1-草案.sql`、contract tests。
- [ ] **CEO-T2 (P1, human: ~2d / CC: ~4h) — Architecture** — 建立 main 搜索协调器与 DTO 到 ViewModel 映射边界
  - Surfaced by: ceo-review — renderer 不应知道 provider、生成 DTO、token 或生产回退策略。
  - Files: `src/main`、`src/preload`、`src/shared`、`src/renderer/QueryApp.tsx`。
- [ ] **CEO-T3 (P1, human: ~6h / CC: ~1h) — Evidence** — 把三轴状态绑定证据元数据并自动过期降级
  - Surfaced by: ceo-review — 静态绿标不得冒充已运行。
  - Files: `dashboard-manifest.ts`、`ArchitectureModule.tsx`、对应 tests。
- [ ] **CEO-T1 (P1, human: ~4h / CC: ~30min) — Product** — 冻结首场景与价值证据合同
  - Surfaced by: ceo-review — 场景、样本、阈值与失败分母须由 DEC-SEARCH-01 冻结。
  - Files: 本计划、`PROJECT_CHARTER.md`。
- [ ] **CEO-T4 (P1, human: ~1d / CC: ~1h) — Windows** — 在 DEV-M0 增加不计正式通过的 Windows 可行性 smoke
  - Surfaced by: ceo-review — 到 M3 才暴露平台阻塞会造成高返工。
  - Files: `docs/how-to-verify-desktop.md`、`scripts`、`package.json`。
- [ ] **DES-T6 (P1, human: ~1d / CC: ~2h) — Accessibility** — 把键盘、读屏、缩放和辅助模式纳入里程碑退出证据
  - Surfaced by: design-review — 结果、错误、复制、表格、图表与焦点恢复尚缺完整验收。
  - Files: `DESIGN.md`、验证文档、Query / Dashboard component tests。
- [ ] **DES-T3 (P1, human: ~1d / CC: ~2h) — Dashboard** — 在 DEV-M4 首切片接入最小只读计分板
  - Surfaced by: design-review — 防止另建窗口或提前到 M1。
  - Files: Dashboard renderer、manifest、component tests。
- [ ] **DES-T5 (P1, human: ~1d / CC: ~3h) — Desktop** — 冻结并执行 Windows、DPI、IME 与多屏验证矩阵
  - Surfaced by: design-review — macOS 截图不能证明 Windows 原生行为。
  - Files: 验证文档、`DESIGN.md`、`tests/e2e`。
- [ ] **DES-T4 (P1, human: ~6h / CC: ~1h) — Evidence** — 实现三轴证据降级与可访问详情抽屉
  - Surfaced by: design-review — 缺 evidenceRef、verifiedAt、evidenceLevel 与过期降级。
  - Files: Dashboard manifest / Architecture / unit / component tests。
- [ ] **DES-T1 (P1, human: ~6h / CC: ~1h) — Query** — 实现 Query 逐态文案、恢复与焦点合同
  - Surfaced by: design-review — loading、source-blocked、auth、offline、copy-failed 不能只归为 ERROR。
  - Files: `QueryApp.tsx`、component tests、`DESIGN.md`。
- [ ] **ENG-T5 (P1, human: ~4d / CC: ~1d) — Application API** — 按正式 M1 实现 auth / policy / redaction / search / events，不接 UI
  - Surfaced by: eng-review — M1 是 API / domain，不是 Electron integration。
  - Files: `apps/api`、`packages/domain`、`packages/db`、contract tests。
- [ ] **ENG-T11 (P1, human: ~5d / CC: ~1.5d) — Dashboard** — 从 Overview 最小只读 scorecard 开始完成 M4
  - Surfaced by: eng-review — 正式 Dashboard 首片归 M4。
  - Files: Dashboard renderer / preload、API read models、tests。
- [ ] **ENG-T7 (P1, human: ~3d / CC: ~1d) — Electron main / preload** — 建立 role-specific capability 与 operation coordinator
  - Surfaced by: eng-review — strict main-frame、权限分面与 provider 隐藏。
  - Files: desktop main / preload / shared / tests。
- [ ] **ENG-T9 (P1, human: ~4d / CC: ~1d) — Offline snapshot** — 实现 staging → validate → FTS → atomic switch → ACK
  - Surfaced by: eng-review — 离线 snapshot 是完整子系统，不是单一 UI 状态。
  - Files: desktop main snapshot / cache / tests。
- [ ] **ENG-T8 (P1, human: ~3d / CC: ~1d) — Query operation** — 实现 query ledger、copy saga 与 terminal delivery
  - Surfaced by: eng-review — 迟到 server commit 与 clipboard / event 非原子。
  - Files: desktop operations / terminal / query renderer / tests。
- [ ] **ENG-T10 (P1, human: ~4d / CC: ~1d) — Windows desktop** — 在 M3 接 production adapter 与真实 Windows 验收
  - Surfaced by: eng-review — Windows runtime evidence 归 M3。
  - Files: desktop、Windows packaging、E2E、Windows evidence。
- [ ] **ENG-T12 (P1, human: ~3d / CC: ~1d) — capacity / readiness** — 完成 300 QPS 认证、3,000 QPS chaos 与 Pilot Readiness
  - Surfaced by: eng-review — 容量、OAuth、部署、恢复、签名需可执行证据。
  - Files: load tests、deploy、runbooks、monitoring、packaging、readiness evidence。
- [ ] **ENG-T6 (P1, human: ~5d / CC: ~1.5d) — content / worker** — 按 M2 实现 durable import、fencing、publish / rollback / announce
  - Surfaced by: eng-review — M2 仅 backend / worker，需完整失败闭环。
  - Files: content API、worker、storage、DB、integration tests。
- [ ] **ENG-T4 (P1, human: ~2d / CC: ~5h) — contracts / DB** — 建立 immutable contract ingest、codegen、runtime validator、migration 与 ACL 门
  - Surfaced by: eng-review — contract drift、未知字段、迁移和 ACL 需 fail-closed。
  - Files: upstream contracts、DB、contract package、API、CI。
- [ ] **ENG-T2 (P1, human: ~1d / CC: ~3h) — formal desktop contract** — 冻结 copy saga、query replay、terminal delivery 与最小待同步记录
  - Surfaced by: eng-review — clipboard 成功后 event 丢失 / 崩溃的合同未闭合。
  - Files: 正式 31 / 37 / 39 / 41 / 46、adapter handoff。
- [ ] **ENG-T3 (P1, human: ~1d / CC: ~3h) — workspace** — 固化 pre-move 证据并机械迁移 desktop 到 Monorepo
  - Surfaced by: eng-review — 结构与行为同批会放大回归。
  - Files: workspace、root package、desktop、scripts、tests。
- [ ] **DX-T1 (P1, human: ~1.5d / CC: ~4h) — developer CLI** — 建立 root doctor / setup / dev / verify / check 命令面
  - Surfaced by: devex-review — 当前 7～11 个操作、无 doctor，未来命令与当前 scripts 混杂。
  - Files: `package.json`、`scripts/devx/`、tutorial、tests。
- [ ] **DX-T2 (P1, human: ~1d / CC: ~2h) — documentation** — 建立 CURRENT / PLANNED / AUTHORIZED 文档入口与 Windows PowerShell quickstart
  - Surfaced by: devex-review — README 偏 Demo，正式 Windows 无首次运行路径。
  - Files: README、macOS / Windows first-run、command link checker。
- [ ] **DX-T4 (P1, human: ~1.5d / CC: ~4h) — errors / recovery** — 实现统一五段式错误与可搜索 catalog
  - Surfaced by: devex-review — registry 未成为 CLI / API / tutorial 的恢复入口。
  - Files: shared errors、CLI formatter、API mapper、troubleshooting。
- [ ] **DX-T5 (P1, human: ~2d / CC: ~5h) — migrations / upgrades** — 提供 status / plan / apply / verify 与回滚演练 runbook
  - Surfaced by: devex-review — migration 纸面设计尚无可运行入口。
  - Files: DB package、root scripts、compat fixtures、migration runbook。
- [ ] **DX-T3 (P1, human: ~2d / CC: ~4h) — profiles / dev environment** — 落地命名 profile 与 services-container / native-desktop 编排
  - Surfaced by: devex-review —变量组合可能形成灰色环境。
  - Files: config schema、compose、workspace scripts、formal-dev runbook。
- [ ] **DES-T2 (P2, human: ~4h / CC: ~45min) — Search** — 让匹配理由、风险与合成标签由证据驱动
  - Surfaced by: design-review — 合成展示可能被误读为正式判断。
  - Files: search service、unit tests、Query renderer。
- [ ] **DX-T7 (P2, human: ~4h / CC: ~1h) — governance** — 对齐版本声明并建立 escape-hatch / non-override 矩阵
  - Surfaced by: devex-review — pnpm 11.19 与 `>=9` 冲突，安全例外散落。
  - Files: `package.json`、README、config reference、doctor tests。
- [ ] **DX-T6 (P2, human: ~1d / CC: ~3h) — local DX evidence** — 实现无遥测 TTHW / recovery 本地 probe
  - Surfaced by: devex-review — TTHW 为 UNMEASURED，用户已关闭遥测。
  - Files: local probe、`.gitignore`、DX measurement docs、privacy tests。

**CROSS-MODEL：** CEO、Eng、DX 三阶段均由 Claude 与 Codex 独立复核；共同保留正式路线，同时一致要求 proof-first、Windows 早取证、单一状态所有者、安全拒退和设计 / runtime / 授权分账。Eng 的 ACK denial-audit 冲突已由主代理对正式 37 / 39 / 41 / 46、OpenAPI 与 DDL 独立复核确认。

**VERDICT：** GSTACK PLAN REVIEW **APPROVED BY USER (A)**；ENG-T1 正式合同交接已完成并在产品仓验证为未激活；**产品实施仍为 NO-GO**，直到 G0 / Scope 闭合且 `DEC-DDEV-01=PASS`。本批准与合同接收都不自动授权 DEV-M0、commit、push、PR、deploy、真实数据或 Pilot。

NO UNRESOLVED DECISIONS
