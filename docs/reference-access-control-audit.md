# 访问控制现状审计（A1）

> 历史审计记录。文中的五分钟窗口对应当时实现。0073 后现行事实上限为 24 小时；0076 修复共享授权决策与祖先撤销检查；0077 停止自动查询签发，并加入唯一生产主账号、最低 Feishu 候选和姓名投影边界。当前规则见[权限模型](reference-job-roster-permission-model.md)，初始化步骤见[如何管理生产身份](how-to-manage-production-identities.md)。下文保留 2026-10-24 的测量和当时的失败结论，不表示当前部署仍有同样缺口。

只读审计，不含任何代码或迁移改动。审计对象：仓库 `main@6dc485b0`，生产 `customer_agent_formal`（杭州，2026-10-24 实测）。目标模型见任务卡第 2 节。

当前实现已取代本文中关于主账号、自动查询授权和登录后权限的旧路径：

- 生产复用唯一 `production-admin` 独立主账号，只允许一个 enabled synthetic owner binding。`configure_production_admin_post` 配置固定 `job-master-account` 岗位，不创建主体、绑定、口令或 grant。
- 主账号口令登录经 `password_login_allowed` 和 `project_seat_login` 只刷新 24 小时事实。再次登录不会恢复已撤销的 grant。
- 业务授权只来自权限页面。旧定时器现在只刷新 `feishu-job-roster` 的事实，不调用 `issue_roster_query`。0077 已撤销旧系统签发原因对应的查询授权，并收回 `intake_business` 的签发执行权。
- Feishu OAuth 可在没有通讯录权限时登记最低 `feishu-candidate`。内部候选岗位不是 HR 职务，也不会自动产生业务授权。
- 姓名以 `public.app_users.display_name` 为单源。Feishu 姓名只更新已有行，不创建账号，也不改变授权。

每条结论后附证据位置。标「未验证」的是我没有实际跑到或没有读到实现的。

## 0. 结论摘要

1. **主账号今天无法在生产上给任何人授权。** 缺的不是界面，是「签发人事实新鲜」这一环：`prepareGrants` 要求签发人事实新鲜。生产里持有 `allocation` 的两个主体事实都已过期（2026-10-15 与 2026-10-23），而两个登录入口都不负责刷新它们。见 §6。

   更正（2026-10-24 02:30）：**主账号是 `hz-allocator`，不是 `principal-menokin-admin`。** `shinemage2026` 这个口令账号经 `synthetic_owner` 绑定落到 `hz-allocator`，它持有 7 条 allocation。所以主账号有可用的登录路径，缺的只是口令登录不写事实。见 §6.5。
2. **「新建坐席」不是生产 API，是桌面主进程 spawn 的本地脚本。** 它把账号写进硬编码的 `customer_agent_synthetic`，口令写进运行脚本那台机器的 `STACK_ROOT`。见 §4。
3. **新建的外包坐席即使写对了库也登不上生产。** 生产 `password-accounts.json` 里没有它的行；补上之后还要有对应 `subject_bindings` 行。见 §5。
4. **前端在四个位置自己判断权限**，其中 `grant`、`uploadSop` 来自客户端硬编码的 `JOB_ROSTER` 表，不是服务端结论。见 §7。
5. **`/v1/auth/job` 的 `actions` 比真正的执行校验更严。** 它对 import/publish/rollback 额外要求 `subject_bindings.role='owner'`，而 `authorization_deadline` 不看这一列。见 §3.4。

## 1. 登录路径清单

生产只装配一条，其余为本地合成路径。

| 入口 | 是否在生产装配 | 证据 |
| --- | --- | --- |
| 飞书 OAuth（`createFeishuIdentityProvider`） | 是 | `apps/api/src/server.ts` 在 `authMode === 'feishu'` 时构造；生产 `feishu.env` 存在 `FEISHU_APP_ID`（实测 5 个键） |
| 账号密码（`password-identity-server.ts`，端口 43101） | 是 | `scripts/synthetic-stack/stack.ts:278`：`const identityEntry = feishu ? PASSWORD_IDENTITY_ENTRY : IDENTITY_ENTRY` |
| 合成身份（`identity-provider.ts`） | 否 | 同上，只有没有 `feishu.env` 时才用 |
| `issueBoundSession`（只接受 `synthetic_(coach\|owner\|quality)`） | 是（代码在），但被正则限死 | `apps/api/src/product-auth-service.ts:184` |

要点：**生产上账号密码入口是 `password-identity-server.ts`，不是 `identity-provider.ts`。** 两者差别很关键：前者没有 `ALLOWED_BINDINGS` 白名单，只查口令文件；后者有（`scripts/synthetic-stack/identity-provider.ts` 里 `const ALLOWED_BINDINGS = new Set(SYNTHETIC_IDENTITIES.map(...))`）。`docs/reference-intake-pages.md:48` 说「用户名必须等于 `SYNTHETIC_IDENTITIES` 里的 `bindingId`，新建外包坐席仍 401」，这句话描述的是 `identity-provider.ts` 的行为；生产跑的是另一个进程，所以这句话对生产不成立。这是文档与实现的漂移，记在 §8。

飞书登录链路：

1. `createLogin` 写一次性 `login_requests`（`product-auth-service.ts:118-129`）。
2. `callback` 先 `begin_callback` 消费 state（`:133`），再 `provider.exchange(code)` 换 open id（`:139`）。
3. `complete_callback` 绑 binding（`:143`）；SQL 判据是「binding 存在且 enabled」（`packages/database/migrations/0013_backend_identity_content_v1_16.sql:226-229`）。
4. 成功后调 `afterLogin`，即 `projectRosterLogin`（`server.ts` 的闭包；`product-auth-service.ts:164-172` 把异常吞成一行日志）。
5. `exchange` 拿 access token（15 分钟，`0013:250-254`）。

## 2. 主体类型与来源

生产实测 5 个主体、7 个 binding。

| `principal_id` | `identity_scope` | 对应 binding 的 `role` | `current_facts_version` |
| --- | --- | --- | --- |
| `prin_0200eee61a1d3f659e1aa69148cd93a9` | `feishu-job-roster` | `ou_5a6b7c7a3ae19edc72676dbfff328f75` → owner | 121（定时器每 4 分钟续） |
| `principal-menokin-admin` | `production-admin` | `binding-menokin-admin` → owner | 3 |
| `hz-allocator` | `confirmed-hangzhou` | `synthetic_owner` → owner | 8（停在 2026-10-15） |
| `hz-reviewer` | `confirmed-hangzhou` | `synthetic_quality` → coach | 5（停在 2026-10-15） |
| `sys_query_dc28a40b…` | `content-intake-system` | `sys-query-binding-dc28a40b…` → owner | 57（签发时自增） |

三类来源：

- **自动投影**（`feishu-job-roster`）：`project_feishu_roster` 写主体与 5 分钟事实，`issue_roster_query` 由系统签发人发 query（`packages/database/overlays/0049_roster_lifecycle.sql`）。
- **手工生产身份**（`production-admin`）：迁移外手工写入，作为「非本人签发方」绕开 `SELF_ESCALATION`（`apps/api/src/content-intake/authority.ts:126`）。
- **历史合成身份**（`confirmed-hangzhou`）：无代码写这个 scope，是早期手工建的。

另有 3 个 binding 没有主体：`synthetic_agent`(agent)、`synthetic_coach`(coach)、`synthetic_quality` 已配对 hz-reviewer、`synthetic_agent`/`synthetic_coach` 无主体。它们能通过 `complete_callback`，但 `/v1/auth/job` 找不到主体，返回 404「职务未识别」。

**目标模型的差距：** 任务卡要求「一个真人一个主体，登录方式是属性」。现状是 `identity_scope` 承担了「哪种登录」的语义，是并列的第二身份维度，而 `principals_user_id_key` 只允许一个 `user_id` 对应一行。所以「同一真人两种登录」当前不可能共存，只能二选一。

## 3. 七个角色的真实可用动作

### 3.1 角色上限（role ceiling）

`content_intake.role_ceiling` 是唯一所有者，`apps/desktop/src/content-intake/role-ceiling.ts` 是镜像，两边由 `role-ceiling.test.ts` 对齐。生产实测 7 行：

| 角色 | business_actions | may_allocate | may_delegate | may_skip_import_parent |
| --- | --- | --- | --- | --- |
| director | query, content-manage, import, source-confirm, review, publish, candidate-cancel, rollback | true | true | true |
| manager | 同上 8 个 | true | true | true |
| engineer | 同上 8 个 | true | true | true |
| supervisor | 同上 8 个 | false | false | false |
| lead | 同上 8 个 | false | false | false |
| agent | query | false | false | false |
| enabler | query | false | false | false |

### 3.2 上限不等于可用

真正放行的是 `authorization_deadline`（`packages/database/overlays/0057_role_ceiling.sql:150-183`），它同时要求：

1. 主体当前事实存在且 `checked_at <= at < valid_until`；
2. 有未撤销、未过期的 `kind='business'` 授权，action 与 scope/source 匹配；
3. 有 steward，且父授权未撤销（有父授权时）；
4. 角色上限允许该动作；
5. `query` 额外要求授权记录的 `policy_version`、`store_set_version` 等于当前值，且来源在当前店铺集里。

所以「角色能不能」与「这个人今天能不能」是两件事。生产里只有 `prin_…`（engineer）和 `principal-menokin-admin`（无 job roster，靠手工事实）真正持有 8 个动作的活授权。

### 3.3 实测的 8 个动作

对 `prin_…` 在事实窗口内逐动作调用 `authorization_deadline`（2026-10-24 实测）：`import`、`publish`、`query`、`review`、`source-confirm`、`content-manage`、`candidate-cancel`、`rollback` 全部返回非空。

### 3.4 `/v1/auth/job` 的 actions 与执行校验不一致

`apps/api/src/project-roster-login.ts:101-113` 的 `ACTION_SQL`：`query` 只看 `authorization_sources`；`import`/`publish`/`rollback` 额外要求 `EXISTS (SELECT 1 FROM binding WHERE is_owner)`，其中 `binding` 是 `subject_bindings.role = 'owner'`。

而 `authorization_deadline` 完全不读 `subject_bindings.role`。

后果：一个 job roster 角色为 `engineer`、且持有有效 publish 授权的人，如果其 binding 的 `role` 不是 `owner`，桌面会隐藏发布按钮，但 API 会放行同一个发布。这类分叉是 A5 要消除的对象之一。

现状之所以没暴露：生产那个飞书 binding 的 `role` 恰好是 `owner`（`feishu.env` 的绑定角色），`principal-menokin-admin` 的 binding 也是 owner。

## 4. 「创建坐席」走的是本地脚本，不是生产 API

链路：`dashboard:seats-command` → `apps/desktop/src/main/seat-account-ipc.ts`

- `seatRuntimeScript()` 解析到 `../../../../scripts/synthetic-stack/seat-account-runtime.ts`（`:14-16`）；
- `runRuntime` 用 `spawn` 起一个 Node 子进程，15 秒超时、stdout 上限 64 KiB（`:32-60`）；
- 目标文件不存在时直接返回「账号还不能在这里改。」（`:65`）；
- 生产的 `apps/api` 里**没有任何账号管理路由**。`/v1/intake/grants` 只发授权，`dashboard:seats-command` 只写本地。

`scripts/synthetic-stack/seat-account-runtime.ts` 的三个硬编码：

| 项 | 值 | 位置 |
| --- | --- | --- |
| 数据库名 | `customer_agent_synthetic` | 从 `profile.ts:289` 导入的常量，不是 `resolveProfile` 解析出来的生产库名 |
| PG 连接 | `PG_SOCKET_DIRECTORY` / `PG_PORT` | `:33`，即运行脚本那台机器的 stack root |
| 口令文件 | `path.join(STACK_ROOT, 'password-accounts.json')` | `:34` |

写入内容（`scripts/synthetic-stack/subject-binding-people.ts:66-98`）：

1. `backend_identity.subject_bindings`，`provider='synthetic'`、`tenant='synthetic-tenant'`；
2. `bindKnownPrincipal`，`identityScope='confirmed-synthetic'`，`tenantId='tenant-menokin'`、`appId='app-customer-agent'`（`:12-13`，这两个与生产一致）；
3. `content_intake.role_rules`，`department_id='dept-menokin'`，`jobId` 为 `job-seat`（客服）或 `job-seat-supervisor`（客服主管）。

**不写任何 grant。** 所以创建出来的坐席即使能登录，也没有任何授权，`authorization_deadline` 全为空，界面显示「没有权限，请找人开通。」

这也解释了 `docs/reference-intake-pages.md:22-24` 的岗位表：客服 `query`、客服主管 `content-manage`/`import`/`source-confirm`/`publish`，那是**岗位对应的 role ceiling 声明**，不是已发出的授权。

## 5. 新建外包坐席能否真正登录生产

**今天不能。** 三个独立原因，任一都足以拦住：

1. **写错库。** 脚本连 `customer_agent_synthetic`（`seat-account-runtime.ts` 导入的 `DATABASE_NAME` 常量）。生产数据在 `customer_agent_formal`。
2. **写错机器。** 脚本由桌面应用的 Electron 主进程 spawn，运行在办公机；它要连的 PG socket 在生产机的 stack root 下，办公机没有。打包后该脚本路径在 asar 内，`existsSync` 为假，直接返回「账号还不能在这里改。」
3. **口令文件不在服务端。** 生产 43101 读的是 `/srv/customer-agent/stack/password-accounts.json`（`password-identity-server.ts:26`）。办公机写的是它自己的 `STACK_ROOT`。

值得记录的是：**登录入口本身并不拦新坐席。** `POST /password` 只查口令文件里 `accounts.get(username)` 并用 scrypt 比对（`password-identity-server.ts:89-99`），成功后把 `account.bindingId` 放进一次性 code；`complete_callback` 只要求该 binding 存在且 enabled（`0013:226-229`）。所以 A2 不需要改冻结合同，也不需要动授权语义——只要把「写哪个库、写哪台机的口令文件、补 binding」这三件事做对。

`job-seat` / `job-seat-supervisor` 这两个 jobId 在生产 `role_rules` 里不存在（实测 16 行里只有 `dept-menokin` 的 `job-director`、`job-supervisor`，以及两个真实部门的 `job-customer-service-*`）。所以 A2 要么沿用现有 jobId 命名，要么让创建时自带 role_rules 行（现在的脚本正是后者）。

## 6. 主账号如何给某个人授权，今天能不能走通

**不能走通。** 断在两处，且都在服务端而不是界面。

### 6.1 授权要求签发人事实新鲜

`authorize` / `prepareGrants` 都先 `requireFresh(issuer)`（`apps/api/src/content-intake/authority.ts:29-30`、`:118-119`），再要求签发人持有同范围、同动作的 `allocation`/`delegation` 且带 steward（`parentAuthority`，`:69-88`）。SQL 侧同样在 `grant_parent_guard` 里查签发人事实与角色（`packages/database/overlays/0060_grant_issuer_authority.sql:29-45`）。

### 6.2 生产里唯一能签发的两个主体都不可用

| 主体 | 持有 | 事实 | 能否自己续期 |
| --- | --- | --- | --- |
| `hz-allocator` | 7 条 allocation（缺 `rollback`） | v8，2026-10-15 到期 | 不能，但原因不是没有登录路径（见 §6.5） |
| `principal-menokin-admin` | 8 条 allocation | v3，由手工迁移写入 | 不能。`identity_scope='production-admin'`，无登录路径 |

`hz-reviewer` 只有 2 条 business grant，不是 allocation 持有人。

所以：即使 A4 的界面今天就做好，主账号点「授权」也会在服务端收到 `GRANT_AUTHORITY_DENIED` 或 `PERMISSION_CHANGED`。

### 6.3 一个真人不能既签发又接收

`authority.ts:126` 的 `SELF_ESCALATION` 与 `content_intake.grants` 的 `CHECK (kind='allocation' OR issuer_id <> recipient_id)` 共同禁止自签。这就是为什么需要一个独立的签发方主体，也是当前 `principal-menokin-admin` 存在的原因。

### 6.4 结论

A2 的「主账号能分配权限」必须先解决「谁是能签发的活主体」。三条可行方向，都需要规划方定：

- 给 `principal-menokin-admin` 一条可续期的事实来源（例如把它纳入定时任务，像 `refresh-roster-facts` 那样每次签发前刷新事实）；
- 或引入「平台管理员」这一服务端概念，用受限的 SQL 权限而不是 `role_rules` 来签发；
- 或允许同一真人的两个主体在授权场景下视为同一人以外的可信签发方（需要改 `SELF_ESCALATION` 语义，属于任务卡禁止的范围，须先评审）。

### 6.5 更正：主账号是 `hz-allocator`，且它已有登录路径

2026-10-24 02:30 复核口令文件与主体绑定，6.2 的表述需要更正。

生产 `password-accounts.json` 只有 6 个账号，其中面向人的是 `shinemage2026` 与 `shinemage2026-1`，两者都映射到 binding `synthetic_owner`。而 `synthetic_owner` 的 `user_id = usr_synthetic_owner`，对应的主体是 **`hz-allocator`**，它持有 7 条带 steward 的 allocation（除 `rollback`）。

没有 `binding-menokin-admin` 的口令账号，所以 `principal-menokin-admin` 仍然是不可登录的。

于是 6.2 的结论要改写。真实缺口不是「主账号没有登录路径」，而是：

> 口令登录成功后，服务端不给主体写事实。只有飞书登录会走 `project_feishu_roster` 写五分钟事实（`apps/api/src/product-auth-service.ts:164-172` 的 `afterLogin` 被 `isFeishuOpenId(binding)` 挡住）。

所以 `shinemage2026` 每天能登录成功，但每次签发都在 `requireFresh` 处被拒。这是两个登录入口之间的行为不一致，不是缺一个概念。

修法比 6.4 的三个方向都小：给口令登录一条写自己主体事实的路径。约束是

1. `content_intake.project_feishu_roster` 只接受 roster 主体（角色取自 `role_rules`，`p_actions` 必须是 `['query']`），不能复用它；
2. 需要新增一个只服务口令登录的事实写入函数，属于新迁移；
3. 事实仍在五分钟内有效，仍然只证明「刚刚登录过」，不产生任何长期授权。

这条改动不碰 `authorization_deadline`，不碰 `role_rules`，不碰 `SELF_ESCALATION`，也不新增授权概念。它把「登录即证明身份」这条规则补齐到第二种登录方式上。

`hz-allocator` 缺 `rollback`，所以主账号今天仍然签不出回滚授权，这一条独立于事实问题，另议。

### 6.6 已解决（2026-10-24 13:30）

6.5 的三个方向都不用做。真实缺口是「allocation 挂在错的 principal 上」。

生产实测的三方对照：

| 主体 | allocation | facts 来源 | 能否自持 |
| --- | --- | --- | --- |
| `hz-allocator` | 7 条 | 无，停在 2026-10-15 | 否 |
| `principal-menokin-admin` | 8 条 | 手工迁移写入 | 否 |
| `prin_0200…`（运营本人） | 0 条 | 飞书，定时器每 4 分钟 | **是** |

缺的不是新概念，是把 allocation 放到本来就自持的主体上。
`scripts/ops/bootstrap-issuer-authority.mjs` 写入 40 条根 allocation（5 scope × 8 action），
签发人、接收人、steward 都是该主体，无父授权。

写前写后对照，用真实写入路径（`grant_parent_guard` 触发器）在事务内回滚：

| 时点 | 结果 |
| --- | --- |
| bootstrap 前 | `RESULT=NO_ROOT_ALLOCATION` |
| bootstrap 后 | `RESULT=DELEGATION_ALLOWED parent=grant_e6b3d079…` |
| 回滚后残留行 | 0 |

能力仍然跟着事实走，不是永久授权。集成测试
`apps/api/tests/issuer-bootstrap.integration.test.ts` 在真实 PG15 上证明了两个方向：
根授权持有人可以对外签发，事实窗口一关就立刻被拒。

**仍然受限的一点。** `authorization_sources` 只读 business 授权，不读 allocation。
所以 allocation 决定「能不能往外授」，主体自己的 business 授权决定「能授哪些来源」。
实测运营本人只能授出 `src-menokin-sop-v2` 上的 8 个动作；`src-menokin-faq` 与
presale / aftersale / campaign / sop legacy 五个来源仍授不出去。这是第二层决定，未动。

## 7. 前端判定权限的全部位置

| 位置 | 判定依据 | 来源 |
| --- | --- | --- |
| `apps/desktop/src/renderer/DashboardApp.tsx:159` | `window.dashboardPermissions !== undefined` | preload 是否挂载，不是权限 |
| `DashboardApp.tsx:84-92`（`sidebarItems`） | 同上布尔值，决定「权限」是否进侧栏 | 同上 |
| `DashboardApp.tsx:188-191`（`canGrant`） | `jobKnown && signedIn && status==='resolved' && rights.grant===true` | `rights.grant` 来自客户端 `JOB_ROSTER` |
| `DashboardApp.tsx:192-193`（`canUploadSop`） | `sopUploadControl()` → `sopUploadRefusal(job)` | `rights.uploadSop`，同上 |
| `DashboardApp.tsx:194-198`（`grantBlock`） | `rights.grant` | 同上 |
| `apps/desktop/src/shared/dashboard-content.ts:223` | `job.rights.publish !== true` | `publish` 来自服务端 `actions` |
| `apps/desktop/src/shared/dashboard-content.ts:226` | `job.rights.grant !== true` | 客户端 `JOB_ROSTER` |
| `apps/desktop/src/shared/dashboard-ops-loop.ts:91` | `job.rights.uploadSop === true` | 客户端 `JOB_ROSTER` |

`apps/desktop/src/shared/product-session.ts:82-88` 是混合点：

```
rights: {
  ...lookup.rights,          // 客户端 JOB_ROSTER 表，按职务标题匹配
  publish: actions.publish,  // 服务端 /v1/auth/job
  grant: lookup.rights.grant,// 客户端
  search: actions.query,     // 服务端
  readCatalog: lookup.rights.readCatalog && actions.query,
}
```

即：同一个 `rights` 对象里，`publish`/`search` 是服务端结论，`grant`/`uploadSop`/`readCatalog` 是客户端表。A5 要改的就是这一点。

## 8. 顺带记录的漂移

- `docs/reference-intake-pages.md:48` 说新建坐席仍会 401，理由是户名不在 `SYNTHETIC_IDENTITIES`。生产跑的是 `password-identity-server.ts`，它没有这个白名单。描述与实现不符，未改文档（超出 A1 范围）。
- 生产仍有 3 个无主体的合成 binding（`synthetic_agent`、`synthetic_coach`、`synthetic_quality` 中无主体者）。它们能通过 `complete_callback`，但 `/v1/auth/job` 返回 404。属于历史残留，不影响当前授权。

## 9. 未验证

- 没有用真实飞书账号重放完整 OAuth（会触发真实租户授权与数据读取，超出本次范围）。
- 没有在办公机上实际点击「新建坐席」，因此 §5 第 2 条（打包后路径失效）是读码结论，不是运行证据。
- 没有实测 `/v1/auth/job` 在两个 binding role 不同时的差异输出，§3.4 是 SQL 读码结论。
- 没有验证 `job-seat` 这个 jobId 是否被 `JOB_ROSTER` 认识（`packages/job-roster/src/index.ts` 里是 `job-customer-service-seat`）。这会让新建坐席在桌面端显示「职务未识别」，读码倾向如此，未实测。

## 10. 对 A2~A6 的直接影响

| 卡 | 受本审计约束的点 |
| --- | --- |
| A2 | 必须写生产库、写服务端口令文件、补 binding；不需要改冻结合同 |
| A3 | 合并主体会撞 `principals_user_id_key`（单列唯一），且 `identity_scope` 当前承担登录方式语义 |
| A4 | 界面做得再好也会被 §6 卡住；需要先定「活签发方」 |
| A5 | 必须同时消掉 `window.dashboardPermissions !== undefined` 与客户端 `JOB_ROSTER` 两个来源，并处理 §3.4 的服务端分叉 |
| A6 | 「主账号授予后对方下次请求立即生效」依赖事实新鲜；事实窗口仍是 5 分钟，靠定时器续 |

## 11. 2026-10-25 补记

本次只读核对当前 `origin/main` `b29e8586594f7aee835677c9e2d3735db073b691`（Merge pull request #108）的代码，并引用仓库里已有的 2026-10-24 生产记录。没有连接杭州，没有重跑生产查询。上文的生产数字保持原样。

头部仍把审计对象写成 `main@6dc485b0`。该对象在 GitHub 上是 `6dc485b0d07f43b095c98c3df9b415a5f0395d38`（2026-10-23），不在 `b29e8586` 的提交历史上。正文最后一次提交是 `11b57260729754a37040ae2381670c5d486703a4`，它是 `b29e8586` 的祖先。§4 写的 `seat-account-ipc.ts:14-16`、`:32-60`、`:65` 对得上 `11b5726` 里的 `spawn`，对不上当前文件。

### 11.1 已被当前 main 的代码取代

这些段落写的是 `11b5726` 当时的代码。`b29e8586` 上对应实现已经换过。

**坐席创建。** §0 第 2 条、§4、§5 第 1 条和第 2 条、§10 的 A2 行，写的是桌面主进程 `spawn` 本地 `seat-account-runtime.ts`。当前 `apps/desktop/src/main/seat-account-ipc.ts:11-18` 说明这条路径已经离开；同文件 `:74-101` 把 `dashboard:seats-command` 送到 `GET/POST /v1/intake/seats`、`POST /v1/intake/seats/:username/password`、`DELETE /v1/intake/seats/:username`。路由在 `apps/api/src/content-intake/seats-http.ts:65-91`。`apps/api/src/content-intake/seats.ts:106-109` 在写之前调用 `content_intake.seat_administration_allowed`。函数在 `packages/database/migrations/0068_seat_lifecycle.sql:341-378`，`REVOKE`/`GRANT` 在 `:381-382`，执行权只给 `intake_business`。身份行由同文件 `backend_identity.create_seat`（`:67`）写入。`scripts/synthetic-stack/seat-account-runtime.ts` 在这个树上已经没有该文件。口令行由 `seats.ts:147` 写成 `synthetic_seat_${username}`。

**坐席口令登录。** §1 写生产口令入口只查口令文件；§5 末段写登录入口本身不拦新坐席，并以 `password-identity-server.ts:89-99` 的 scrypt 比对为据。当前生产入口的选择没变：`scripts/synthetic-stack/stack.ts:278` 在有飞书配置时仍用 `PASSWORD_IDENTITY_ENTRY`。对坐席绑定，`password-identity-server.ts:106-120` 还要求 `bindingId` 等于 `seatBindingIdFor(username)`，并且 `seatBindingEnabled` 返回 true。`seatBindingIdFor` 在 `scripts/synthetic-stack/identity-admission.ts:162-169`，格式是 `synthetic_seat_<username>`。本地合成入口 `identity-provider.ts:137-145` 走同一条判定；固定名单仍是 `SYNTHETIC_IDENTITIES`（`:48-55`、`:126-136`）。非坐席账号在 `password-identity-server.ts:122-125` 仍只凭口令文件发码。§0 第 3 条里「今天登不上生产」仍是 §11.2 的生产实测；被取代的是「入口只查口令文件、不看 `synthetic_seat_` 绑定是否启用」这句代码描述。

**口令登录与事实。** §6.5 写口令登录不写事实，`product-auth-service.ts:164-172` 的 `afterLogin` 被 `isFeishuOpenId` 挡住。当前 `product-auth-service.ts:163-177` 对飞书 open id 仍调 `afterLogin`，对其他 binding 调 `afterPasswordLogin`。`apps/api/src/server.ts:128-140` 让后者执行 `content_intake.project_seat_login`。该函数在 `0068_seat_lifecycle.sql:283-284` 对不匹配 `^synthetic_seat_[A-Za-z0-9_-]{1,64}$` 的 binding 直接返回 `missing`，不插入 `principal_facts`。`synthetic_owner` 不匹配这个正则，所以主账号这条口令登录在当前代码里仍然不刷新自己的事实。能被刷新的是坐席 binding，而且函数本身在迁移 0068 里。

**同一真人的两种登录。** §2 写两种登录不能共存，依据是 `principals.user_id` 唯一。该唯一约束仍在 `packages/database/migrations/0021_content_intake_v1_20.sql:20`。`0069_feishu_login_link.sql:10-12` 增加 `backend_identity.feishu_login_links`，一行 open id 指向一个已有 `binding_id`。`establish_feishu_login`（`:45-61`）在已有链接时用那个 binding 完成回调。`product-auth-service.ts:145-146` 在回调里调用它。`attach_feishu_login`（`0069_feishu_login_link.sql:83-121`）可以把 open id 挂到另一个主体已有的 binding 上；仓库里的调用点是 `apps/api/src/feishu-login-link.ts:58-66`，没有 HTTP 路由。

### 11.2 仍是 2026-10-24 生产实测，本次未重探

下列内容本次没有重新测量，数字以上文为准：

- §2 的 5 个主体、7 个 binding，以及各类事实版本和到期说明。
- §3.1 的 7 行角色上限，§3.3 对 `prin_…` 八个动作的 `authorization_deadline` 结果。
- §5 关于生产口令文件位置、生产 `role_rules` 16 行，以及 `job-seat` 不在其中的实测。
- §6.2、§6.5、§6.6 的主体、allocation 条数、事实停在 2026-10-15、口令账号个数、bootstrap 前 `RESULT=NO_ROOT_ALLOCATION`、回滚后残留行 0、运营本人只能授出 `src-menokin-sop-v2`。
- 杭州迁移账本。`docs/reference-backup-and-restore.md:104-112` 与 `:149` 记录 `0065` 部署后账本为 `65 0065_legacy_orphan_fk_not_valid`。`docs/reports/2026-10-24-seat-accounts-withdrawal.md:90` 记录生产未部署 0066、账本仍是 65。当前目录里 0068、0069 排在 0065 之后（`packages/database/src/verifier.ts:1114-1118`）。那次实测的库因此还没有 `seat_administration_allowed`、`create_seat`、`project_seat_login`、`feishu_login_links`。本次未重探。

### 11.3 主账号如何给某个人授权，生产上今天能不能走通

代码链路（`b29e8586`）：

1. 权限页命令进 `apps/desktop/src/main/content-intake-permissions-ipc.ts:18-24`。预览、保存、撤销先看 `job.rights.grant === true`。`rights.grant` 仍来自客户端职务表，见 `apps/desktop/src/shared/product-session.ts:81-84`。
2. 预览是 `POST /v1/intake/grants/preview`，保存是 `POST /v1/intake/grants`（`apps/desktop/src/main/content-intake-permissions.ts:162-172`）。
3. 路由在 `apps/api/src/content-intake/grants-http.ts:18-21`，服务在 `apps/api/src/content-intake/service.ts:329-335`，落到 `previewGrants` / `createGrants`。
4. `prepareGrants`（`authority.ts:113-132`）核对签发人事实版本，调用 `requireFresh`（实现在 `transaction.ts:99-102`，事实过期则 `ORG_FACTS_UNAVAILABLE`），以 `samePerson` 拒绝自己给自己签（`authority.ts:126`），再经 `parentAuthority`（`:68-86`）要求签发人持有未撤销、未过期、带 steward 的 allocation 或 delegation。没有父授权时抛 `GRANT_AUTHORITY_DENIED`（`:84`）。
5. `createGrants`（`authority.ts:226-227`）写入。SQL 侧 `grant_parent_guard` 再查签发人事实（`packages/database/overlays/0060_grant_issuer_authority.sql:28-47`）。

生产：按 2026-10-24 实测，这条链路走不通。签发人事实不新鲜时，`requireFresh` 在父授权检查之前就拒绝。§6.6 的 bootstrap 在事务里看到 `DELEGATION_ALLOWED`，回滚后残留行是 0，这 40 条根 allocation 没有留在生产库。本次未重探。当前 main 的 `project_seat_login` 也不给 `synthetic_owner` 写事实（见 §11.1），而且该函数在 0068，不在上述账本 65 的实测里。

### 11.4 代码结论仍在，行号有的已移动

- §3.4 的 `ACTION_SQL` 仍在 `apps/api/src/project-roster-login.ts:101-112`。`authorization_deadline` 仍不读 `subject_bindings.role`。
- §6.1 的 `requireFresh` 调用点仍是 `authority.ts:29` 与 `:118`。
- §1 的生产口令进程选择仍是 `stack.ts:278`。`issueBoundSession` 的正则仍是 `synthetic_(coach|owner|quality)`，现位于 `product-auth-service.ts:189-190`。
- §7 的分工还在：`publish` / `search` 用服务端 actions，`grant` / `uploadSop` 用客户端职务表。`DashboardApp.tsx` 现为 `canOpenPermissions` `:108`、`canGrant` `:118-121`、`canUploadSop` `:122-123`、侧栏 `:131`。`product-session.ts:81-87`、`dashboard-content.ts:223` 与 `:226`、`dashboard-ops-loop.ts:91` 仍是原文说的那几处。`grant` 的另一处拦截在 `apps/desktop/src/shared/workbench-access.ts:22`。

### 11.5 一处源码行号对不上原文

§5 把生产口令文件写成 `password-identity-server.ts:26` 的 `/srv/customer-agent/stack/password-accounts.json`。`11b5726` 的第 26 行是 `CODE_TTL_MS`；同文件第 29 行是 `path.join(STACK_ROOT, 'password-accounts.json')`。当前文件同一表达式在 `password-identity-server.ts:32`。`/srv/customer-agent/stack` 这一绝对路径本次未重探，上文不改。
