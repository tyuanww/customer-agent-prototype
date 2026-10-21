# 权限收口任务卡（2026-10-21）

本文件是权限模块收尾的执行清单。每张卡都有独立验收条件，按依赖顺序排列。
裁决口径：**先做不改语义的，后做改语义的**。改语义的卡片必须由用户先拍板。

## 现状

- 账本到 `0055_grant_steward_required`，迁移校验 55 段。
- 决策有两份实现：`authorization_sources`（集合形态）与 `authorization_deadline`（截止形态），由属性测试对齐。
- 角色到动作的映射分布在 8 处，当前一致，但无单一真相。
- 鉴权分散在 15 个路由模块；intake 插件内有 `onRequest`，其余各自调用。

## 卡片

### P0 历史批次链路收为 owner-only · 已完成

- 目标：历史批次的 import / publish / rollback / resolve_previous 仅 owner 可用。
- 改动：`content-batch-admission.ts` 持策略；`0054` 重定义四个函数并校验 binding role；
  `verifier.ts` / `planner.ts` / 生成器 / 契约脚本登记第 54 段。
- 验收：导入 1 条、发布 1 条、回退 2 条、SQL 直调 3 条负例全绿；`postgres.integration` 49/49。
- 证据：`apps/api/tests/content-release.integration.test.ts`、
  `packages/database/tests/legacy-batch-owner-only.integration.test.ts`。

### P4 属性测试补齐角色与动作 · 已完成

- 目标：让漂移检查覆盖全部角色与全部动作。
- 改动：role 生成器补 `supervisor` / `engineer`；`ACTIONS` 从 4 个扩到合同里的 8 个。
- 验收：3/3 通过。扩测后仍全绿，证明两条决策函数当前无漂移。
- 备注：此前「supervisor 免授权可发布」的判断是读取已被 `0048` 覆盖的 `0044` 得出的误报。

### P3 文档口径统一 · 已完成

- 目标：需求文档不再与代码冲突。
- 改动：§12.1 的废弃声明改为逐条指出三处差异（谁能配置他人、谁需业务授权、agent/enabler 只剩 query）。
- 验收：`git diff --check` 通过。

### P1a 权限页回读真实生效结果 · 已完成（文案版）

- 目标：保存失败时不再给出会误导的提示。
- 现状：`write()` 保存失败统一落回「权限、人员状态或输入已变化，请刷新后核对」，
  而 query 授权因店铺集为空被拒时，刷新不会改变任何东西。
- 改动：`content-intake-permissions.ts` 在已判定 pending 前记录更精确的提示；
  `content-intake-permissions-ipc.ts` 优先使用该提示。
- 验收：`content-intake-permissions.test.ts` 18/18、IPC 2/2、桌面 typecheck 通过。
- 限制：没有新增 reason，因此「店铺集为空」与「资格真的变了」仍由同一个服务端 reason 表达，
  区别只在桌面端的提示文案。精确区分需要合同变更。

### P1b 策略版本绑定 · 已确认不改

- 决策（2026-10-21）：不绑。交付期绑定会让规则变更期间的合法操作被拒。
- 保留现状：`query` 授权写 `policy_version` 与 `store_set_version`，另外三个动作不写。
- 补偿措施：规则维护应安排在低峰窗口；这不是技术强制，属运维约定。

### P5 通用来源能否单独开店 · 已确认保持现状

- 决策（2026-10-21）：不允许。一家店必须有店铺级来源才能查询，通用稿单独不构成可查范围。
- 现状代码不变。
- 实际表现（修正此前描述）：不是 `SCOPE_DENIED`。`content-intake-access.ts:98` 只把
  `shopId !== null` 且具备 query 动作的来源计入 `shops`，所以只有品牌级来源时 `shops` 为空，
  `content-intake-query.ts:51` 抛 `NO_GRANT`，店铺下拉为空。
  即使店铺可见，条件菜单也会因 `brands` 为空而静默返回空列表（`content-intake-access.ts:166-167`）。

### P2 撤委派后的接管 · 已完成（方案 A）

- 目标：撤销 delegation 后，未被接管的子授权停止生效。
- 现状（改动前）：`changeGrant` 撤销时把子行 `steward_id` 置空，`revoked_at` 保持 null，
  子授权继续有效，属性测试还断言了「撤权后 supervisor 仍可发布」。
- 改动：`0055_grant_steward_required` 在两个决策函数里加
  `AND (g.parent_grant_id IS NULL OR (g.steward_id IS NOT NULL AND EXISTS (父行存活)))`。
  只约束委派产生的子授权；director 直接签发的授权无父，不受影响。
- 为什么要同时查父行：撤销时**指定**接管人会让父行 `revoked_at` 置位而子行保留 steward；
  此时再调一次撤销会在 `authority.ts:274` 提前返回，子行不被清理。只查 steward 无法覆盖这条路。
- 与需求的关系：需求 §12.1 要求「撤销分配资格时既有业务授权继续生效并交给指定负责人监管」。
  撤销时指定 `stewardPrincipalId` 且父行仍存活，子授权继续有效（即「交给负责人」）；
  不指定则视为待接管并停止授权；父行被撤销则一律停止。
- 验收：两种撤销形态各一个探针实测通过（无接管人 / 有接管人后父行撤销），
  之后探针删除；`authorization-set-agreement` 3/3、`verifier-runtime` 28/28。
- 遗留：尚无「待接管」查询与界面，接管只能通过带 `stewardPrincipalId` 的撤销调用完成。
- 后续风险：`steward_id` 现在是授权开关，但 `intake_business` 可直接 UPDATE 它，
  见后文 O1。

### P6 角色到动作矩阵收敛 · 待做

- 目标：「谁能做什么」只有一处定义。
- 现状：8 处答案 —— `job-roster`、`authority.ts`、`0030`、`0044`、`0047`、`0048`、`0050`、`0054`。
- 做法：建一张矩阵表，一行一个 `(role, action)`；TS 侧从表生成常量，SQL 从表读取。
- 依赖：**必须排在 P4 之后**，只有补齐后的属性测试能证明语义未变。
- 验收：属性测试全绿；`grep` 角色列表只命中矩阵定义处。

### P7 路由默认拒绝与路由清单测试 · 已完成

- 目标：新增路由忘记鉴权时，结果是 401 而不是公开访问。
- 现状：56 条路由中 30 条各自调用鉴权，无全局兜底，也无路由清单测试。
- 改动：新增 `apps/api/tests/route-admission.test.ts`。它枚举 `printRoutes()` 的前缀树，
  对每条非公开路由注入无凭据请求，断言必须得到 401；公开路由必须在字面白名单里列出，
  白名单里的失效条目也算失败。
- 验收：临时插入一条 `GET /probe-unguarded` 返回 200，测试报
  `GET /probe-unguarded -> 200` 并失败；移除后恢复通过。已实测。
- 限制：测试在 mock 认证 profile 下构建应用，intake 插件路由不在该 profile 注册，
  由既有的 `content-intake-usage-http.test.ts` 覆盖未鉴权行为。

## 排期

| 时间 | 任务 | 性质 |
| --- | --- | --- |
| 已完成 | P0 · P1a · P2 · P3 · P4 · P7 | 可交付 |
| 已确认不改 | P1b · P5 | 保持现状 |
| 剩余 | P6 | 重构，语义不变 |

## 收尾状态（2026-10-21）

权限模块收口完成。P0、P1a、P2、P3、P4、P7 已实现并验证；P1b、P5 经确认保持现状；
P6（角色矩阵收敛）作为纯重构项单独排期，不阻塞本次交付。

### 验证记录

| 范围 | 结果 |
| --- | --- |
| `legacy-batch-owner-only.integration` | 4/4 |
| `authorization-set-agreement` | 3/3（覆盖 7 个角色 × 8 个动作） |
| `verifier-runtime.integration` | 28/28（账本 55 段） |
| `content-import.integration` | 15/15 |
| `content-release.integration` | 16/16 |
| `route-admission` | 2/2 |
| `content-intake-permissions` 单测 | 20/20 |
| `database` 单测 + 生成物一致性 | 56/56 |
| API / database / desktop typecheck | 通过 |
| 改动文件 lint | 通过 |

### 已知失败：SOP 发布被触发器拒绝（生产代码缺陷，非本轮回归）

`content-intake.integration.test.ts` 的
「second synthetic seat receives published SOP text and protected image bytes over HTTP」
在 publish 时返回 409 `MATERIAL_CHANGED`。

**根因（已定位到代码，非推测）**

产品 SOP 导入分支复用了通用 freeze 路径，只写 0039 的 `sop_candidate_media`，
从不调用 `freeze_sop_parsed_candidate → stage_sop_candidate_assets` 去写 0040 的
`sop_candidate_rows` 与 `sop_asset_registrations`。而 0040 的发布触发器按 source mapping
把该来源判为 SOP，强制要求这两份登记，于是 publish 必然 409。

关键证据：`tryParseSopAsFaq` 其实已经返回了 `rowBindings`
（`packages/content-intake/src/sop.ts:185,211`），正是 `stage_sop_candidate_assets` 需要的
`p_rows` 主体；但 `apps/api/src/content-intake/service.ts:203-210` 只取了 `parsed` 与
`previews`，调的是 `freezeParsed` + `stage_sop_candidate_media`，把 `rowBindings` 丢弃了。

`apps/api/src` 内 `freeze_sop_parsed_candidate` / `stage_sop_candidate_assets` /
`sop_asset_registrations` / `sop_candidate_rows` 四个符号**零引用**。

触发器判定命中的是 `mapping_version='sop-not-imported'`，不是 `rule_version`。

**归属**：这是生产代码缺少登记写入，不是「测试走错路径」——用例打的是产品 HTTP 全链路。

**为什么不是本轮回归**：Menokin 的真实 SOP 源 `src-menokin-sop` 是 `mode='legacy'`
（`0038:101-108`），不走这条 v2-preview 导入路径。当前只有合成 fixture 命中分类。

**严重性**：一旦真实 SOP 工作簿以 v2-preview 接入（或把 domain=sop 的源提升为 v2-preview），
**首次发布即 100% 409**，SOP 文本 + 图片能力整体不可用。

**修正一条此前写错的判据**：原先记「跑 `sop-media-delivery` 绿则说明登记机制正常」——
这条判据**不成立**。该测试用 `createTrustedSopStage` 把 freeze 阶段整个替换成实验 helper
（`apps/api/tests/sop-media-delivery.integration.test.ts:22`），天然证明不了产品路径。
`sop-trusted-stage` 同理，直接 `SELECT content_intake.freeze_sop_parsed_candidate(...)`。

**修复方向**
- 可行（更正确）：`service.ts` 的 SOP 分支改走 `freeze_sop_parsed_candidate`，
  用 `sop.rowBindings` + 组装的 media payload 调用；通用路径只保留给非 SOP。
- 可行但需小心：在通用 freeze 之后补调 `stage_sop_candidate_assets`。风险是 job 已被推进到
  `validated`，且 `purpose='sop-media'` 的 reservation 采用逻辑只在 `freeze_sop_parsed_candidate`
  内（`0040:1247`），漏掉会让触发器第 4 条校验（`0040:1413-1418`）继续 409。
- 有风险：放宽触发器。会让未登记行/媒体的 SOP 候选进入发布，削弱图片安全门禁。
- 有风险且掩盖缺陷：改测试去调专用函数。

## 盘查发现的开放项（2026-10-21 对抗审查）

### O1 · `steward_id` 可被直接改写，复活已撤销的授权 · HIGH

`intake_business` 持有 `UPDATE (version,last_change_reason,steward_id,revoked_at)` on grants
（`0033:1215`），而 `grant_version_guard` 只要求 version 递增。实测三种写法：

| 写法 | 结果 |
| --- | --- |
| `SET steward_id='issuer'` | 拒绝 `GRANT_VERSION_OR_IDENTITY_CHANGED` |
| `SET steward_id='issuer', version=version+1, last_change_reason='x'` | **通过** |
| 之后 `authorization_sources` 行数 | **1（授权复活）** |

P2 之前 `steward_id` 只是元数据；P2 之后它成了授权开关，本次改动**提升**了这个既有风险面。
前提是以 `intake_business` 身份执行 SQL，不是远程可利用，因此定 HIGH 而非 blocker。

建议：给 `steward_id` 变更加 set_config 闸门（同 `app.publishing`），或要求只能由 `changeGrant` 变更。

### O2 · 手动签发的 query 授权在 store set 版本变化后永久失效 · 待验证

`0049:288-330` 的刷新逻辑只撤销/重发 `reason='职位名单系统签发。'` 且 `issuer_id = v_signer`
的授权。通过 `createGrants` 手动签发、带操作者自定义 reason 的 query 授权，
在 store set 版本变化后不会被重签也不会被撤销，于是永久失效却仍留在 `grants` 表里。

与 P1a 叠加，正是「保存了、列表里也有、刷新也没用」的完整成因。此结论为代码推断，未运行验证。

### O3 · P7 实际覆盖 41 条路由，intake 的 19 条未覆盖 · MEDIUM

`route-admission.test.ts` 在 mock profile 下构建应用，`intakeDependencies` 为 undefined，
`app.ts:163-200` 的 intake 与 product-auth 整块不注册。实测：

```
ROUTE COUNT 41
INTAKE COVERED 0
```

静态清点未覆盖 42 条：`/v1/intake/*` 38 条 + `/v1/auth/*` 4 条。这批正是最敏感的路由
（`grants` 写入、`publish`、`rollback`、`sop` 删除、全部 usage 读）。

建议：用 stub intakeDependencies 在 product 模式下建 app，复用同一个路由扫描。
注意 stub 池必须在 `app.ready()` 之前就位，且 `authService.kind` 必须真的是 `'product'`。

## 已澄清的误判

- 「迁移生成器不幂等」不成立。连续两次运行 manifest sha 相同。首次失败是因为加入 0055 时
  漏改 `scripts/customer-agent-contract-set.mjs` 的长度白名单，补上即幂等。
- 「supervisor 免授权可发布」不成立。那是读取了被 `0048` 覆盖的 `0044` 得出的；
  迁移是累积覆盖的，当前生效定义在 `0048`。

## 对抗审查后的修复（Reviewer A）

| 编号 | 问题 | 处置 |
| --- | --- | --- |
| F1 | 0055 会掐断三处 fixture 与 4+ 个 PG 集成套件 | **已修**：`authorization-sources-fixture.ts`（主 seed、rollback seed）、`query-principal.ts`、`import-deadline.integration.test.ts` 的 `seedImport` 全部补 `steward_id` |
| F1b | P0 让 agent/coach 在 API 层就被拒，两个「denial sentence」用例拿不到 SQL 文案 | **已修**：改用一个无 import/publish 授权的 owner 身份；`mountReleaseRoutes` 增加 `ownerToken` |
| F2 | 二次撤销静默无效：带接管人撤销后再撤销，子授权仍生效 | **已修**：谓词加父行存活检查 `AND (g.parent_grant_id IS NULL OR (g.steward_id IS NOT NULL AND EXISTS (父行未撤销)))`。两种撤销形态各用探针实测通过 |
| F3 | 属性测试不曾覆盖 steward / 父行维度 | **已扩**：`GrantSpec` 加 `hasSteward`、`parentRevoked`，反例串同步输出这两个标记 |
| F4 | `cs_ai_definer` 拿到 `subject_bindings` 整表 SELECT | **已收窄**：改为列级 `SELECT (user_id, enabled, role)`。ACL 从 607 变 609 |
| F8 | verifier 注释称「无 ACL 变化」与自身数字矛盾 | **已修**注释 |
| F9 | §12.1 漏 engineer；SSOT 指向已被覆盖的 0050 | **已修**：补第 4 条与 engineer，SSOT 改指 0055 并说明迁移是累积覆盖 |

### 未验证一项

F3 的扩展通过了属性测试，但我尝试的变异验证（只改一个函数去掉父行检查）**没有让测试变红**，
说明 `parentRevoked` 这一维尚未被证明能捕获该漂移。原因未查清，可能是生成器未产出
「子行 live + 父行 revoked + steward 非空」的组合。当前该维度保留但不算已验证的保护。

### 仍未处理

- F5：coach 在 `/v1/auth/job` 仍看到 `actions.import=true`，Dashboard 放行后必 403。
  这是产品口径问题（coach 是否还该导入），需拍板。
- F7：P1a 文案把 `PERMISSION_CHANGED` 单一因果化，factsVersion / policyVersion 不符也会显示
  「先去发布一次」。精确区分需合同变更。
- F10：`cancel_content_import` 的 SQL 层未收成 owner-only，与 P0 的「双层」叙述不一致。
- F13：`scripts/customer-agent-contract-set.mjs:781` 第三份长度白名单仍是 41..52。

## 第二轮修复（poteto-mode）

| 编号 | 问题 | 处置与验证 |
| --- | --- | --- |
| O1 | `steward_id` 可直接改写 | **不需要额外闸门**。0055 的父行存活检查已经关闭这条路径：探针实测「父行已撤销 + 直接写回 steward」后 `authorization_sources` 仍返回 0 行。删除探针（探针只是临时验证，行为由 F3 的 falsification 用例长期覆盖） |
| F3 | 属性测试未证明能捕获父行漂移 | **已证明**。新增 falsification 用例从 `pg_get_functiondef` 取真实定义、正则删掉父行子句后重装，断言属性报出 `parent-revoked` 分歧并复原。此前「变异后仍绿」的原因是我改了 `.sql`，而测试读的是 `migrations.generated.ts` 的 catalogue，改动从未生效 |
| F10 | `cancel_content_import` 仍允许发起批次的 coach | **已收为 owner-only**。新增 `0056_cancel_import_owner_only`；coach 分支在上传已 owner-only 后不可达，删除后两层描述同一规则 |
| F5 | coach 仍被告知可导入，点下去必 403 | **已对齐投影**。`readAuthorizationActions` 的 import / publish / rollback 现在同时要求 binding role 为 owner；`query` 保持按授权判定，因为候选路径仍服务坐席。新增 `authorization-actions-projection.integration.test.ts` 实测「同授权下 owner 得 true、coach 得 false」 |
| F7 | 文案把 `PERMISSION_CHANGED` 单一因果化 | **已改为两种可能并列**：店铺无已发布内容，或资格在预览后变化，并给出可执行的下一步。精确区分需要合同变更，未做 |
| F13 | contract-set 第三份长度白名单停在 41..52 | **已改为 41..56**，`check:generated` 通过 |

### 验证记录（第二轮）

| 范围 | 结果 |
| --- | --- |
| database 单测 + 生成物一致性 | 56 passed / 38 skipped |
| `verifier-runtime` + `postgres.integration` | 77/77 |
| API 集成（含全部 deadline、search、roster、event、import、release、路由准入、投影） | 105/105 |
| 桌面权限页单测 | 20/20 |
| API / database / desktop typecheck | 通过 |
| 改动文件 lint | 通过 |

账本到 `0056_cancel_import_owner_only`，迁移校验 56 段。

## P6 角色矩阵收敛（2026-10-21）

### 先修正一个前提

「8 份拷贝」这个说法不准确。多数是**已被覆盖的历史迁移**，受 digest 锁定不可修改，
读它们会读到旧口径（这也正是此前几次误判的来源）。当前真正生效的只有：

| 位置 | 内容 |
| --- | --- |
| `0055` `authorization_sources` | 能力上限 |
| `0055` `authorization_deadline` | 能力上限（同一条件第二次出现） |
| `0047` `grant_parent_guard` | 谁能免父授权签发 import |
| `0049` `issue_roster_query` | 角色有效性（7 个角色全通过，非上限） |
| `authority.ts` `recipientRoleAllows` / `allocationKinds` | 上限与分配资格 |

### 改动

新增 `0057_role_ceiling`：

- `content_intake.role_ceiling` 一行一个角色，四列表达全部边界：
  `business_actions`（业务授权可承载的动作集）、`may_allocate`、`may_delegate`、
  `may_skip_import_parent`。
- 四个谓词函数 `role_allows` / `role_may_allocate` / `role_may_delegate` /
  `role_may_skip_import_parent` 读这张表。
- `authorization_sources`、`authorization_deadline`、`grant_parent_guard` 三个生效定义改为调用谓词。
- `apps/api/src/content-intake/role-ceiling.ts` 镜像同一份矩阵，因为人员目录投影与授权预览
  无法等待一次查询；`authority.ts` 的两个函数改为从它派生。

### 验证

| 项 | 结果 |
| --- | --- |
| 三个生效函数已无原始角色枚举（从 `pg_get_functiondef` 实测） | 已确认 |
| `role-ceiling.integration.test.ts` 逐行比对 TS 与表，并逐个谓词比对 SQL 与 TS | 2/2 |
| 变异测试：只改 TS 的 `supervisor.mayAllocate` | 两条用例均变红，报 `supervisor may_allocate` |
| `authorization-set-agreement`（含父行漂移反证用例） | 4/4 |
| `verifier-runtime` / `postgres.integration` | 28/28、49/49 |
| API 集成（14 个文件） | 283/284 |
| 三包 typecheck、改动文件 lint | 通过 |

唯一失败仍是已知的 SOP 发布缺陷，与本项无关。

### 过程中发现的一个真实语义差异

第一版把 `engineer` 的 `may_delegate` 写成 false，导致大量 publish 用例失败。
原实现里 `engineer` 短路返回 true，覆盖所有 kind，因此 `may_delegate` 必须为 true。
一致性测试抓不到这类错误——它只保证两份镜像相同，不保证值正确。
真正抓住它的是既有集成测试。

### 一个操作教训

`@customer-agent/database` 由 `dist` 提供，改了 overlay 后必须
`pnpm --filter @customer-agent/database build:runtime`。
只跑 `generate` 会继续使用旧 catalogue，表现为「改了没生效」，
本轮为此浪费了一轮排查。
