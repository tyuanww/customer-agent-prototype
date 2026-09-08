# 正式身份与内容闭环：实施计划与工程评审

> 状态：REVIEWED · ISSUES OPEN · NOT APPROVED · 治理候选合同仍为 DRAFT。
> 本轮仅完成计划、工程评审与治理仓候选合同收尾；不构成 DEV-M2 开工、真实身份/数据接入、运行激活、合同冻结或部署批准。
> 用户已选择“先后端闭环，桌面随后”。产品基线以合并后的 `main` 为准；治理候选在独立 PR 中交付。

## 1. 目标和范围挑战（Step 0）

交付一个可运行的后端闭环：经认证和授权的操作者导入合成 CSV/XLSX，持久接收后由 worker 校验，经受限审核后发布；查询只返回当前有效内容，撤销、失效、回退和服务故障均有明确结果。正式 OAuth 能力先以模拟提供方验证工程行为，真实飞书联调单独核验环境和批准。

目前缺的是身份生命周期和内容执行链，而不是新的检索算法。复用已有 Fastify、PostgreSQL、合同校验、SearchBackend、Events、outbox 与发布事务；不增加第二套队列、数据库或检索主路。范围跨多个模块，按完整行为拆切片，不按文件数机械拆分。

本计划替代仓外 `next-stage-preparation.md` 中后端部分的粗略拆解；当前全项目清单仍由[执行清单](2026-09-06-execution-goal.md)拥有。治理旧 `05-全栈交付计划` 的 2026-09-05 状态文字不能覆盖 PR #71 的当前 T6 决定，稳定架构边界仍适用。

### What already exists

| 已有能力与证据入口 | 本计划如何复用 |
| --- | --- |
| `apps/api/src/app.ts:44` 的组合入口及 health/ready | 在同一入口组合真实能力，不另建 API host |
| `auth-service.ts:12`、`auth-routes.ts:20` 的 mock 会话 | 保留开发测试语义，拆开认证与 mock 会话创建职责 |
| `runtime-config.ts:398` 的拒启配置、隔离连接能力 | 显式增加获批配置，保留默认拒绝和秘密不外泄 |
| `search-routes.ts:93`、SearchBackend、event repository | 保留平台/商品过滤、候选来源与幂等事件；不改算法 |
| 锁定 OpenAPI 1.12.0 / schema v1.15 / 十二段 migration | 按版本化合同接收机制复用，禁止手改上游快照或改旧 migration |
| SQL 的 enqueue、claim、heartbeat、finalize、publish、rollback | API/worker 调用受限函数，不能直写底表重造状态机 |
| Vitest、Node package smoke、隔离 PG15 harness | 测试实际生产者和消费者，不以 mock 或直接 seed 代替新闭环 |

### NOT in scope

- Windows main/preload/renderer 接线、Dashboard 正式管理 UI：用户明确放在后续阶段；本轮仅定义后端消费合同。
- 飞书内容 API 自动同步：一期已有 CSV/XLSX 默认路径；同步 adapter 按后续权限增强，不阻塞导入闭环。
- 真实客户数据、原 009 数据包重跑、原评测包续期：原授权不复用。
- 自动发送、生成业务回答、教师/训练/embedding 主路：不属于本闭环。
- 工单分析、指标工作台与独立业务待办：保留既有合同，不在本轮顺手实现。
- 多实例、容器平台迁移、正式安装包和软件部署：先完成开发/测试后端候选；不能把本地目录称为共享集群存储。
- 既有 TODOS 四项桌面 P3 窄分支：与本轮后端闭环无依赖，不扩大修改面。

## 2. 架构评审

以下是计划缺口，不是把当前有意关闭的开发基线判为生产缺陷。

### F1 [P1] 正式身份缺少闭合的会话合同（confidence 10/10）

证据：`apps/api/src/auth-service.ts:13–14` 为 `createMockSession` 与同步 `authenticate: (...) => AuthenticatedUser | null`；`runtime-config.ts:418` 拒绝非 mock 模式。锁定 OpenAPI 的身份路由只有 `/v1/auth/mock-login`（255 行）与 `/v1/auth/me`（299 行），没有本产品登录回调、会话刷新和退出协议。

影响：直接替换 provider 会遗漏异步 I/O、超时、撤销及所有调用方；不能把飞书 access token 假定为本产品可本地验签的 JWT。

建议：T0 先冻结产品会话与提供方交接合同，包括回调绑定、防重放、会话失效/撤销、角色来源、错误码和存储责任。认证 owner 输出已校验身份；mock 会话创建仅向开发路由暴露。所有 auth/policy/search/events 调用方统一迁移，不让每个路由自行刷新 token。外部登录端点、token 类型与刷新语义未核验前不硬编码。

### F2 [P1] 导入不能以文件上传成功或内存入队作为完成（confidence 10/10）

证据：锁定 OpenAPI `1114–1123` 要求文件持久化，batch、source bindings、outbox 同事务提交后才返回 202；schema `4993` 已有 `claim_content_import_validation`，`8524` 已有 `finalize_content_import_validation`。

建议：存储先持久写入不可变对象并校验摘要，受控 enqueue 成功后返回 202；失败保留明确结果，并用受限回收流程处理未被 batch 引用的孤儿对象。worker 只使用内容专属 claim/heartbeat/finalize/retry，不获得通用 outbox 或审核写权限。网络/解析工作不得占用数据库事务。

### F3 [P1] 正式内容审核必须有实际受限入口（confidence 10/10）

证据：schema `8556` 起拒绝 worker payload 自报 `review_mode`、审核主体和 `quality_gate_passed`；治理架构 §3 的 `INV-CONTENT-REVIEW-TRUST` 要求高风险/冲突双审异人。

建议：T3 纳入受限审核操作入口、主体绑定、质量计划与证据登记，并由数据库再验证。使用既有受限 SQL 能力，通过专用凭据/角色控制，不给普通 import worker 或 public HTTP 新增任意审核接口。入口的操作合同必须先经 T0 冻结。开发合成测试可使用不同合成主体；真实双审人员在真实内容准入前落实。

本次治理文档的“三角色由同一负责人承担”只适用于该发布候选，不覆盖内容双审异人约束。

### F4 [P1] readiness、查询和快照必须一起接上真实内容状态（confidence 10/10）

证据：`service-repository.ts:638–645` 明确 storage/content 固定 `not_ready`；`search-routes.ts:122` 与 `event-repository.ts:230` 均拒绝非 synthetic。OpenAPI `1536–1543`、`1614–1621`、`1721–1724` 规定唯一读取函数、固定 release 分页、短租约与 ACK 不续租。

建议：storage/content readiness 由各自能力 owner 证明；无 current、来源暂停、失效、租约到期必须拒绝。T5 同时完成 current/snapshot/ack 服务端链路。数据模式准入单独配置并保留双层拒绝，不因 OAuth 成功自动开放真实数据。

### 边界方案比较

| 方案 | 收益 | 代价与结论 |
| --- | --- | --- |
| A：API + 独立 TS worker，复用 PG outbox 与窄 SQL 能力；首个开发 profile 单主机共卷 | 最少新增基础设施，故障与权限所有者明确 | 共卷不支持无状态多实例；推荐作为开发/测试切片，不代表生产拓扑已批准 |
| B：API 内处理导入，通用队列/通用 repository 统一所有操作 | 初始接线较少 | 解析阻塞请求、恢复/审核/权限规则泄漏到调用方；内存队列不满足 202 合同，不采用 |

未来多实例需要对象存储或 RWX；本轮不预造插件框架，只固定 `persist/read/verify` 的窄对象能力及失败语义。审核、发布、worker 的角色分离属于安全边界，不为减少连接数而合并凭据。

```text
已批准的会话合同 -> Auth owner -> 认证身份 + 服务端权限
                                     |
CSV/XLSX -> 持久存储 -> API enqueue [batch + source bindings + outbox] -> 202
                                     |
                       TS worker claim + lease_version
                          | 读对象 / 解析 / 规范化
                          | 冻结质量计划
受限审核入口 -> 审核/质量证据 -> finalizer -> staged / failed
                                                  |
Owner publish -> CAS + 锁 + 四域校验 -> 新 release + current + 公告 + audit
                                                  |
                            Search / current / snapshot / ACK
                            来源门 + 有效窗 + 短租约校验
```

## 3. 代码质量评审

### F5 [P2] 同步 mock 接口与组合入口需要一次受控迁移（confidence 10/10）

`app.ts:48` 默认 `createMockAuthService()`，`auth-routes.ts:24` 注册 mock-login。把正式模式加在现有默认分支上，容易在漏传依赖时退回 mock。

T1 将模式选择收口在启动组合入口：正式路径必须显式提供认证能力；缺失即拒启，mock 路由只在对应 profile 注册。异步认证失败区分未认证与提供方不可用，避免把 503 伪装成错误密码。使用 Fastify 已有生命周期/封装能力，不引入通用 DI 框架。实现后检查所有受影响调用方和关闭时序。

### F6 [P2] 不能把测试支持层升级为正式导入服务（confidence 9/10）

`apps/api/tests/support/g1a-e0/` 的包读取、审核装配和真实评测入口属于 test-only；`search-postgres.integration.test.ts:160–285` 直接 seed release 是检索测试准备，不能证明正式导入。

T2/T3 只复用已在生产模块或冻结合同中拥有的纯规则。确需迁移纯规范化知识时，给出唯一 owner 并让测试依赖它；生产不得导入 test-support，不得复制同一 canonical/hash 算法形成两份真源。现有 Events 的事务/幂等语义作为参考，不抽取只转发参数的万能仓库。

## 4. 测试评审与失败矩阵

当前框架：API 使用 Vitest，产物使用 Node test，数据库使用隔离 PG15。已检查 runtime-config 拒启测试及 Search PG15 测试结构；没有将现有测试存在写成新能力通过。本轮不运行实现测试。

新增 8 组行为覆盖要求，全部是待实施/待执行的 GAP，不报告虚构覆盖率：

```text
后端入口与用户动作                         验证层
认证 -> 成功 / 伪造 / 过期 / 撤销 / 超时    [G1 GAP] unit + API + 提供方模拟集成
启动 -> 模式冲突 / 缺凭据 / 关闭中请求     [G2 GAP] process smoke + API
上传 -> 类型/大小/路径/摘要 -> 持久接收    [G3 GAP] 文件系统 + HTTP + PG15
worker -> 崩溃 / 丢租约 / 重试耗尽 / 取消 [G4 GAP] 真实进程 + PG15
审核 -> 越权/同主体双审/换行同数量/漏审    [G5 GAP] 受限入口 + PG15
发布 -> 重放 / 并发 / CAS / COMMIT故障    [G6 GAP] API + PG15
读取 -> 无current / 暂停 / 边界时刻 / ACK [G7 GAP] API + PG15
整链 -> 导入-审核-发布-查询-撤销-回退      [G8 GAP] 构建产物 + 独立进程 E2E
```

| 路径 | 现实失败 | 计划要求的处理和验证 | 操作者所见 |
| --- | --- | --- | --- |
| 会话 | 提供方超时、刷新重放、撤销后旧请求 | 有界 I/O、统一失效、禁止降级 mock；G1；真实提供方联调另计 | 稳定未认证/暂不可用错误，不暴露 token |
| 启动 | 正式模式误注册 mock、存储不可读 | 监听前拒启或准确 not_ready；G2 | 配置项名及诊断 ID，无秘密值 |
| 文件接收 | 断流、磁盘满、路径穿越、解析炸弹 | 不返回 202，不建可执行 batch；孤儿对象可审计回收；G3 | 导入失败或超限，允许修正后重提 |
| worker | 写入前崩溃、租约失效、取消竞态 | lease_version fencing，失败整批原子化，有限重试与耗尽归档；G4 | validating/staged/failed 状态准确，无永久假处理中 |
| 审核 | 普通 worker 自报通过、同主体双审 | SQL/角色双重拒绝，缺证据不能 staged/publish；G5 | 稳定拒绝原因，内部原文不回显 |
| 发布/回退 | 同时发布、旧 base、事务中断 | try-lock/CAS/幂等；旧 current 不变；回退创建新 seq；G6 | 409 或失败，可重新读取状态，不盲重试 |
| 来源审计 | 业务回滚后审计提交失败 | 独立事务、稳定诊断、禁止返回成功；遵循路由错误合同；G6/G7 | 来源拒绝/服务不可用，不泄露底层异常 |
| 公告/快照 | 翻页期间来源暂停、ACK 过期 | 每页验证固定 release 与租约；ACK 不续租；G7 | 明确拒绝并重新取得 current，不拼混合快照 |
| 整链产物 | worker 未打包、关闭残留、共享目录不一致 | 从构建候选启动 API/worker，重启恢复再查询；G8 | 明确不可用；不能只凭内部函数通过宣称闭环 |

候选测试文件名（实施时创建，不表示已存在）：`auth-provider.test.ts`、`content-import.integration.test.ts`、`content-worker.integration.test.ts`、`content-review.integration.test.ts`、`content-release.integration.test.ts`、`announce.integration.test.ts`、`backend-runtime.smoke.mjs`。沿现有 API tests 目录组织；新增 PG 测试必须加入显式 integration 命令和 CI，避免默认 skip 后假绿。

每个切片先跑对应 Vitest/API/PG15；最终公共合同/权限/构建验收运行 `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm workspace:check` 及实际新增 PG/产物命令。现有 `test:integration` 是显式文件列表，实施时必须更新。真实 OAuth、部署与 Windows 实机不由本轮合成测试替代。

## 5. 性能评审

### F7 [P2] 导入解析不能占用请求线程和长期数据库连接（confidence 9/10）

依据 OpenAPI 异步持久接收合同和 schema 的短 claim + fencing：上传采用限量流式持久化，解析在独立 worker，数据库事务仅包裹需要原子性的 SQL。批量处理不得逐行调用外部提供方或重复读取完整来源集合。CSV/XLSX 的上传字节、解压大小、行数、单行字符及 worker 并发限制在 T0/T2 核对，不凭经验硬写生产阈值。

### F8 [P2] 缓存命中不能绕过撤销与当前版本校验（confidence 9/10）

发布、暂停与租约决定候选可用性；缓存只能缓存不可变内容，不能把鉴权/来源门的旧成功作为当前许可。T5/G7 覆盖缓存命中时撤销、分页与 effective_to 边界。每请求只认证一次，禁止多处独立刷新；限流和回退不放宽 source gate。

性能验收记录最大合同输入下的峰值内存、队列等待、claim/发布锁耗时、查询 p95 和连接数；阈值引用治理 NFR 真源，未冻结的预算在 T0 明确，不以本机 50 题时延替代负载 SLO。先用实际 PG 执行计划和有界负载定位瓶颈，不预加 Redis 或消息中间件。

技术核验：Fastify 原生 hooks 可作用于限定路由，足以承载统一异步认证；PG15 提供事务锁和 advisory lock，可支撑既有数据库合同，不能用会话锁替代事务边界。参考 [Fastify hooks](https://fastify.dev/docs/latest/Reference/Hooks/)、[PG15 locks](https://www.postgresql.org/docs/15/explicit-locking.html)。飞书官方刷新文档入口可访问但本次未取得正文，故未核验其端点/参数，不写入实现定案。

## 6. Implementation Tasks 与依赖

以下估算仅用于拆解，T0 后根据合同范围调整；不提供未经实测的人类/AI 固定压缩比。

| 任务 | 来源 | 完整交付与主要模块 | 依赖 | 验收 |
| --- | --- | --- | --- | --- |
| T0 P1 合同收口（M） | F1/F2/F3/F7 | 治理身份、审核入口、存储 profile、限制与 NFR 决定；如新增 HTTP/DDL，按上游版本快照消费 | 本计划采用及范围批准 | 无猜测端点/角色/错误码；合同正反例、双哈希与变更清单 |
| T1 P1 身份闭环（M） | F1/F5 | API auth、启动配置、所有认证调用方与服务生命周期；notice 子能力按冻结合同接入 | T0 + 开工批准 | G1/G2；模拟提供方完整链，真实联调单列 |
| T2 P1 持久接收（M） | F2/F7 | 内容专属 API、存储 owner、enqueue 与 batch 查询/取消 | T1 | G3；确认持久化及事务提交后才 202 |
| T3 P1 worker 与审核（L） | F2/F3/F6 | 独立 TS worker、内容角色池、受限审核入口、质量计划/证据、fenced finalizer | T2 | G4/G5；崩溃/取消/重试/双审拒绝；staged 可实际消费 |
| T4 P1 发布与回退（M） | F4/F6 | 内容发布 API、角色/CAS/幂等、来源审计与旧版本保护 | T3 | G6；实际新 release 与回退新 seq |
| T5 P1 读取与就绪（M） | F4/F8 | API announce/current/snapshot/ack、storage/content readiness、搜索准入 | T4 | G7；完整分页/租约/撤销链，不开启真实模式 |
| T6 P1 后端整链验收（M） | G8 | API/worker 实际构建入口、候选产物清单、CI 与操作文档 | T1–T5 | G8 + 全量门；纯合成环境可重复运行 |

每项的实现、测试、错误反馈、产物和文档在同一可验收切片内交付；按 `/review` → 已授权 `/ship` → CI → 已授权合并推进。正式部署不包含在 T6 的构建产物验收内。

### 并行策略

| 工作线 | 模块 | 可并行条件 |
| --- | --- | --- |
| 合同/集成 owner | 治理合同、产品 contracts/database、根脚本、API 组合入口 | T0 先行；这些共享文件唯一写入者 |
| 后端实现 | `apps/api/src` 与 tests、后续 worker 模块 | T1→T2→T3→T4→T5；当前身份/内容共用目录和组合入口，默认串行 |
| QA/操作准备 | 验收用例与合成数据规格、安装/运行说明草稿 | 可与 T0/T1 并行；不修改共享 fixture 或生产合同 |

T0 冻结后，若 worker 成为独立且已确定接口的模块，可以与只读审核并行；目前不预建 worktree 强行拆开。迁移编号、锁文件、生成物、`app.ts`、runtime-config 和 CI 不允许两条线同时写。主线集成后统一验证，不能用两个分支分别通过代替整链通过。

## 7. 后续任务和开工输入

保留 3 项后续任务，不追加到既有桌面 TODOS：

1. Windows adapter：解决实际查询/复制/转交；依赖后端合同与对应批准，收益是用户可操作，代价是跨进程安全和实机验收。
2. 真实身份与内容联调：验证模拟无法覆盖的提供方/ACL/审核主体；依赖测试应用、环境、真实范围和正式批准，不需要现在提供凭据值。
3. 内部灰度与部署：验证安装、恢复和业务运行；依赖前两项及环境/回退批准，不以治理站点上线替代。

下一可执行动作是 T0 的合同收口，而非直接编写 OAuth 或打开真实数据开关。T0 必须明确：身份提供方到产品会话的协议；受限审核操作方式；首个开发 profile（推荐单主机 API/worker 共卷）；输入和超时预算；未来真实联调的负责人和环境。只有对应合同/计划成为 APPROVED 后才启动依赖实现。

## 8. T0 合同候选包（2026-09-08，设计方向已采用）

用户已同意开始治理合同设计。本节保留初始方案；后续协议细化由治理仓 `20-设计-进行中/51-后端身份与内容闭环-合同设计草案.md` 承接，新增审核等待/恢复边界须在机器合同冻结前完成工程复核。不表示合同已经冻结或 DEV-M2 已获准。上游合同仍为事实真源，当前锁定快照不修改。以下新增路径、时效和资源值全部是候选，已有审核/发布/来源约束保持有效。

### 8.1 身份和会话

推荐由 API 持有提供方凭据，并签发独立、不透明的产品会话；数据库只存会话 token 的摘要。相比直接把提供方 token 作为产品 bearer，此方案把外部撤销语义、产品权限和客户端凭据分开管理。角色由服务端登记表解析，客户端不能提交角色取得权限。

| 候选入口 | 输入与结果 | 失败和幂等语义 |
| --- | --- | --- |
| POST /v1/auth/login-requests | S256 client challenge；返回 login_id、授权 URL、到期时间 | 不接受任意 redirect URI；每次创建独立请求 |
| GET /v1/auth/callback | 提供方 code/state；服务端交换并验证身份 | state 一次性消费；不把产品 bearer 放进 URL；未知交换结果要求重登，不盲目重试 code |
| POST /v1/auth/login-requests/{id}/exchange | client verifier；等待时 202，完成后返回产品 bearer | 原子消费；过期或重复消费拒绝；响应丢失须重新登录，不重放 bearer |
| POST /v1/auth/logout | 当前产品 bearer | 撤销当前会话；重复退出无副作用；不宣称撤销飞书登录 |
| GET /v1/me | 产品 bearer | 每次验证过期、禁用和当前角色；角色缺失沿用 403 |

登录请求状态为 pending → ready → consumed，或 pending/ready → expired/failed。候选有效期 5 分钟；state、verifier、token 使用密码学随机值，至少 32 字节熵；服务端保存必要摘要和时效，日志不记录 code、verifier、token 或授权 URL 查询串。登录请求与会话持久化，进程重启不得恢复已消费请求。

首个后端切片推荐产品会话绝对有效期 15 分钟、不自动续期；提供方身份查询完成后不保留 refresh token。到期重新登录，代价是登录频率较高，收益是无需先引入长期刷新凭据管理。应用内退出/禁用在下一次请求检查时生效；飞书侧撤销不会被宣称即时同步，最长残余产品会话窗口为 15 分钟。若业务需要更长会话，应另定提供方复核/撤销机制后再延长。

提供方适配先用合成模拟服务；真实授权地址、交换地址、身份字段、错误映射和 PKCE 支持须取得官方正文并核验后才能冻结。上述 client challenge 是产品兑换绑定，不能当成已核验飞书支持 PKCE 的证据。官方页面本轮只返回标题，没有正文，不据此编造参数。安全设计参考 [OAuth 安全最佳实践 RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html)。

需新增的持久模型：登录请求（摘要、状态、时效、受控身份关联）、产品会话（token 摘要、用户、到期/撤销时间）、受控身份到角色的映射。迁移编号及 OpenAPI 版本在治理变更建立时分配；本候选包不创建第二份 schema。

### 8.2 可执行的受限审核入口

推荐受限审核 CLI 调用服务端管理入口，使用审核人的产品会话；服务端以受限审核数据库池执行既有记录函数。与直接给 CLI 数据库凭据相比，这样身份解析、能力授权和审计都由服务端统一拥有。CLI 不能用 --actor 或 --role 指定审核人，不能读取普通坐席之外的数据库凭据。

候选操作为“列出待审批次/冻结计划”“提交内容决定”“提交质量证据”。每次提交绑定 batch、script/content hash 或 plan/population hash、决定和受控证据引用；审核主体由服务端认证生成。管理入口与 public search/snapshot 投影分离，返回值不包含内部 locator 或凭据。

- 内容决定仅调用 record_content_review_decision；质量证据仅调用 record_content_quality_review_evidence。
- 普通 worker 仅冻结计划，不能记录审核决定或自报质量通过。CLI 需展示实际待审候选和冻结样本，不能只给一个无证据的“通过”按钮。
- 普通内容要求 ROLE-CONTENT-LEAD；高风险/冲突要求它与 ROLE-CS-MANAGER 两个不同主体。此前用户承担文档发布三个角色的批准，不替代此约束。
- 重复提交按请求键和内容摘要去重；同键不同内容拒绝。主体资格、内容 hash 或 population 变化时拒绝，要求重新取证，不覆盖旧事实。

准确请求/响应 schema、数据库角色映射与错误码由治理增量定义；沿用已有质量全审、抽样、扩样和阻断规则，不另造阈值。

### 8.3 存储、接收与恢复

首个开发 profile 采用单主机 API/worker 共享持久卷；启动时验证两者指向同一存储命名空间且可读写。多实例配置不能使用此 profile。生产对象存储或 RWX 卷留待部署批准。

上传链为有界流式写独占临时对象 → 校验大小/摘要与安全结构 → 持久化并原子归位 → 验证可读 → 在同一数据库事务创建 batch + outbox → 提交后 202。内部键由服务端生成，不以文件名组成路径。解析和外部请求不放进数据库事务。

若存储成功而数据库失败，返回失败并留下可追踪的孤立对象；回收器仅处理已确认无数据库引用、超出宽限期的临时对象，不能删除未知对象或当前发布依赖。首轮只演练合成对象回收，真实内容保留/删除周期仍需独立政策。worker 通过既有 claim、heartbeat、lease_version 和 fenced finalizer 恢复；失去 lease 的 worker 不得提交结果。

### 8.4 预算候选与既有约束

| 项目 | 建议 | 状态与验收 |
| --- | --- | --- |
| 单文件上传 | 10 MiB；流式超限立即停止 | 新候选；测试边界和超一字节 |
| XLSX 解压 | 累计 50 MiB、最多 128 个 ZIP 条目 | 新候选；拒绝路径穿越、炸弹、公式及不支持结构 |
| 批次规模 | 首轮单文件最多 5,000 条数据行；字段长度按锁定 schema | 新候选收窄输入；现有质量批次本已最多 5,000，不把两者混为同一合同 |
| 上传/解析时限 | 上传 30 秒；解析 60 秒 | 新候选；解析须可终止，不能只用不取消工作的 Promise 超时 |
| worker | 并发 1；lease 60 秒、heartbeat 20 秒；最大尝试沿用 5 次 | 并发/心跳为候选；lease 和重试受现有数据库函数约束 |
| 提供方调用 | 单次 5 秒，总预算 10 秒 | 新候选；失败关闭，不返回 mock 成功 |
| 数据库池 | 首轮所有 API/worker 能力池合计最多 20 | 比既有单实例 API 20 更保守；分配在组合入口统一管理，不给每个角色各开 20 |
| 数据库等待 | 连接等待 2 秒；搜索/事件 3 秒、发布 30 秒；事务空闲 10 秒 | 沿用治理 NFR；不在事务内等待审核或网络 |
| 发布限流 | 5/min/owner，并保持全局 single-flight | 沿用治理 NFR；数据库锁仍是最终并发门 |

这些候选不是压测成绩。T2/T3 在最大输入下记录峰值内存、执行时间和连接占用；若无法满足预算，提交实测与调整建议，不静默扩大限制。管理登录与审核入口的独立限流策略、对象保留政策随治理合同补齐，不能误用工单导入限流。

### 8.5 合同交付清单及剩余门

T0 的方案产物已形成，合同冻结仍需以下顺序：

1. 采用本节候选决策，并明确 DEV-M2 仅合成模拟提供方的开发范围；真实接入另列。
2. 在治理仓完成身份/审核 HTTP 封闭 schema、持久模型、权限、限流和错误码增量，以及成功/拒绝/重放/超限例子；真实提供方 wire 未核验部分保持禁用。
3. 审查并按授权提交治理合同，固定上游提交与文件摘要；产品仓按正式 intake 更新快照、生成类型和迁移。不手改当前上游快照。
4. 对照 G1–G8 建立可执行验收：兑换重放/响应丢失、禁用和到期；持久化后崩溃；失 lease；双审同人拒绝；总体 hash 漂移；发布/CAS/回退；来源撤销与分页租约；实际 API/worker 构建入口整链。

T1 依赖内部合同冻结及开发批准；真实飞书正文不足只阻塞真实 provider 实现，不阻塞已明确协议的合成测试准备。治理仓现有 DRAFT 候选增量，产品仓仍无新增运行路由或可运行审核 CLI，不把候选表格写成已实现功能。

## GSTACK REVIEW REPORT

| 评审项 | 结果 |
| --- | --- |
| Step 0 | 已按用户选择限定后端闭环，桌面随后 |
| Architecture | 4 项计划问题，已给出处理建议与 T0–T5 入口 |
| Code quality | 2 项，要求认证边界迁移与 test-support 隔离 |
| Tests | 已产出覆盖图，8 组新能力 GAP；均列入实施验收，尚未执行 |
| Performance | 2 项，异步解析/连接占用与撤销一致性 |
| 失败处理 | 矩阵覆盖全部新路径；不宣称尚未实现的处理已存在 |
| 已有能力 / NOT in scope | 已列明 |
| TODO | 3 项记录在本计划；原 TODOS 未改 |
| 外部模型 | 本轮未调用，不复用之前文档代码审查为本计划背书 |
| 并行 | 3 条职责线；合同先行、后端串行、QA 准备可并行 |
| 完整方案选择 | 用户已确定后端优先；其他建议未冒充批准 |

结论：计划与四项工程评审已完成；开工条件未齐，不标记 CLEARED/APPROVED。

**UNRESOLVED DECISIONS:**
- T0：治理 `backend-runtime-candidate` 仍为 DRAFT（[tianyuan-ai-brief#72](https://github.com/weiweity/tianyuan-ai-brief/pull/72)）。静态 schema 例子与隔离 PG15 行为已在治理仓验证；合同未冻结、未 intake。真实提供方 wire 尚待核验。
- DEV-M2 开工及真实身份/数据联调范围尚未批准。

## 9. 下一阶段后端实施顺序（只整理，不开工）

依赖：治理候选经阶段批准冻结，并由产品仓正式 intake 生成类型与迁移。两仓保持独立 Git 历史。建议顺序：

1. **HTTP 身份入口（T1）**：会话创建/兑换/退出、启动组合拒启、mock 与正式路径分离。依赖已冻结的 login/session 合同。
2. **持久接收（T2）**：CSV/XLSX 落盘、摘要、batch+outbox 同事务 202。依赖 T1 与存储 profile。
3. **worker 与审核入口（T3）**：claim/park、受限审核 HTTP/CLI、质量证据、异人审核。依赖 T2 与 review SQL。
4. **发布与回退（T4）**：CAS/锁/四域校验。依赖 T3 staged。
5. **读取与就绪（T5）**：current/snapshot/ACK 与 storage/content readiness。依赖 T4。
6. **整链产物（T6）**：API/worker 构建入口与合成 E2E。依赖 T1–T5。
7. **Windows 桌面接入**：在后端合同可消费之后单独批准，不并入 T1–T6。

不在本阶段自动实现上述任一项。
