# 如何管理生产身份与业务授权

这份操作说明对应 0077 的身份边界。它描述初始化合同，不表示杭州已经部署 0077，也不表示主账号、Feishu 候选或任何业务授权已经发出。当前权限决策见[职位名单权限模型](reference-job-roster-permission-model.md)。

管理流程只有一条主线：

1. 复用唯一的 `production-admin` 主体作为独立主账号。
2. 给该主体配置受限岗位和私有口令，登录后只刷新事实。
3. 主账号在权限页面预览后授予或撤销业务授权。
4. Feishu OAuth 可以登记最低候选，但登录不会自动发出授权。

## 初始化前核对

数据库初始化人员先确认以下条件，再配置主账号：

- 目标库已应用 `0076_authorization_decision` 和 `0077_manual_identity_grants`。
- `content_intake.policy_versions` 已有该 tenant/app 的唯一当前策略。
- 数据库里只有一个 enabled `production-admin` 主体，并且它对应 enabled `synthetic` owner binding。
- 该主体和 binding 已存在于数据库中。初始化函数不会补建身份。
- `public.app_users` 已有该主体的 active `owner` 账号行和显示名。`configure_production_admin_post` 和授权 bootstrap 均不创建这个主账号行。新 Feishu 用户的姓名登记是下面说明的独立路径。

若主账号仅缺 `app_users` 行，可由受控初始化调用既有 `backend_identity.set_operator_display_name(binding_id, display_name)`，依据已验证的 owner binding 创建首个姓名行，再复核其 role 和 active 状态。已有非 owner 或禁用账号必须停止，不能通过姓名更新提升或启用账号。其他条件任一项不成立时停止初始化。不要新建第二个 `production-admin`，也不要为提高成功率临时放宽唯一性检查。

## 运行环境

身份链使用现有配置通道，不新增第二套渠道：

| 配置 | 通道 | 合同 |
| --- | --- | --- |
| `AUTH_MODE=feishu` | `feishu.env` | Feishu OAuth 身份提供方 |
| `FEISHU_APP_ID` | `feishu.env` | Feishu 应用标识，不回显 |
| `FEISHU_APP_SECRET` | `feishu.env` | 只进入私有身份 bootstrap，不记录 |
| `FEISHU_REDIRECT_URI` | `feishu.env` | 精确指向 `/v1/auth/callback` |
| `FEISHU_BINDINGS` | `feishu.env` | 可选的启动绑定预置，不创建授权 |
| `AUTH_SESSION_MODE=product` | `api.env` | 启用持久产品会话 |
| `CUSTOMER_AGENT_STACK_ROOT` | 服务进程环境 | 定位 `password-accounts.json` |

`FEISHU_BINDINGS` 为空不会阻止 OAuth 后登记新的 `feishu-candidate`。不要把已知 open_id 硬编码成候选名单；OAuth 返回的 open_id 才是外部身份键。

## 配置主账号岗位

以下是受控初始化的函数合同，不包含生产值：

```text
backend_identity.configure_production_admin_post(
  admin_principal_id,
  admin_department_id,
  assigned_by
)
```

- `admin_principal_id` 是现有唯一 `production-admin` 主体，不是登录名、open_id 或口令文件里的 `bindingId`。
- `admin_department_id` 是内部受控岗位使用的部门标识。
- `assigned_by` 记录受控初始化来源，长度为 1 到 128 个字符。
- 函数只为该主体写入固定 `job-master-account` 岗位和 `director` role rule。
- 函数不创建主体、binding、口令、Feishu 身份或业务 grant。
- 函数执行权没有授予 `PUBLIC`、`intake_business`、`app_backend_auth` 或 `app_runtime`。由数据库所有者通过受控初始化通道执行。

调用后读取返回状态：

| 状态 | 含义 |
| --- | --- |
| `configured` | 岗位和匹配的 role rule 已存在 |
| `missing` | 指定主体不是现有、启用的唯一 production admin |
| `conflict` | 唯一性、岗位或策略版本不一致 |
| `policy-pending` | tenant/app 的当前策略尚未建立 |
| `invalid` | 参数格式不合法 |

只有 `configured` 才能进入下一步。不要把 `conflict` 当作可重试的瞬时错误。

主账号初始化不读取 `PRODUCTION_ADMIN_*` 环境变量。上述三个值是一次性初始化参数，由受控数据库通道传入。不要把它们持久化为服务端环境键，也不要让运行时调用该函数。

## Bootstrap 主账号的授权范围

先在受控生产副本核对主账号岗位、active owner 账号行和当前事实。岗位配置不会刷新事实。已有登录或受控事实投影必须产生仍有效的 `job-master-account` 事实。bootstrap 不建立账号、不设置密码、不刷新事实，也不授予任何其他主体权限。

使用 `scripts/ops/bootstrap-issuer-authority.mjs`。脚本连接指定 stack profile 的 Unix socket，以 `stack_owner` 执行。当前数据库所有者必须就是该连接角色；其他 superuser 也不能替代数据库所有者检查。

新增根业务权时，显式提供 `--sources`、`--actions` 和 `--scopes`。每个 source 必须属于选中的 scope，每个 scope 必须有选中的 source。以下命令中的环境变量必须指向已准备好的隔离副本 profile 目录，不能指向生产 stack。先核对这个目录里的 `profile.json`。

```sh
CUSTOMER_AGENT_STACK_ROOT="${CONTROLLED_COPY_STACK_ROOT:?请先指定隔离副本的 profile 目录}" \
  node scripts/ops/bootstrap-issuer-authority.mjs \
  --principal principal-menokin-admin \
  --actions query \
  --scopes scope-menokin-product \
  --sources src-menokin-sop-v2 \
  --expires-days 30 \
  --reason '受控主账号初始化，仅授予批准的查询来源。' \
  --dry-run
```

此例只预览一个 product 范围的查询来源。来源 ID 中的 `sop` 不改变其实际 scope，也不表示其他域已经准入。不要把示例扩展为全库来源名单。输出 `DRY_RUN`、`created: 0` 和逐行 `plan`，`wouldCreate` 表示实际执行时拟新增的行数。预览使用只读事务，不通过试写再回滚来模拟。预览不代表执行获准，也不能证明已有内容已经进入新查询链路。

实际执行须处于已授权的对应副本或生产范围，再使用相同选择参数去掉 `--dry-run`；现有授权已覆盖时不重复确认。脚本在一个 READ COMMITTED 事务内获取 `backend_review.lock_content()`，重新校验全部前提后提交。并发执行会串行检查。任一插入或后验失败会回滚整批写入。

脚本保留两种明确行为：

- 不传 `--sources` 时，保持原 allocation-only 调用形状。`--actions` 默认全部八个动作，`--scopes` 默认当前 tenant/app 的全部范围。仍要求唯一受控主账号，不允许给任意主体初始化。此模式不产生 business 权限。
- 传 `--sources` 时，只为白名单来源和动作补齐来源级 allocation 与根 business。已有可用的 scope allocation 会复用，不新建更大的 allocation。所有 business grant 的 recipient 和 steward 都是主账号。

business grant 不允许自签。脚本复用同 tenant/app 已存在的规范 `content-intake-system / query-signer` 主体作为签发记录。它不调用自动发权函数、不新建系统主体，也不向系统主体授予权限。系统签发主体不存在或已禁用时停止。

脚本按 `authorization_sources` 判断当前有效业务来源，并核对支撑它的根 grant：

- 有当前有效根 grant 时原样保留，包括原 ID、期限、范围和版本。增大 `--expires-days` 不会续期已有根 grant。
- 只有 parented grant 时停止并报告 `existing authority requires review`。不把依赖父授权的权限静默升级为独立根权限。
- 有失效、撤销、未生效或策略印记失配的历史匹配行，且没有有效根 grant 时停止。不会续签、改写历史、重新挂父授权或恢复子 grant。
- 没有匹配行且没有当前有效业务权限时，才插入新的白名单根 grant。

新 grant 的期限为 1 到 365 天，默认 30 天。实际请求仍受事实有效期、角色上限和来源资格限制。`query` 要求当前 policy、store-set 及未过期的成员记录，并写入当前版本印记。bootstrap 不发布内容，不切换来源 mode，也不修改这些策略或集合。

规范系统签发人的 query grant 不参与现有手工授权自动重印策略。因此后续 policy/store-set 变化可能让根 query 失效。此时脚本停止并要求单独审阅，不自动重签。不要将本次初始化工具当作长期续权服务。

完成受控写入后，再用真实业务 API 验证主账号对候选发权、候选查询和撤销。仅看到 `DONE` 不能代替产品验收。脚本重复执行不改动候选授权，也不恢复已撤销的子授权。

## 登记私有口令

口令属于 `CUSTOMER_AGENT_STACK_ROOT/password-accounts.json`，不进入 PostgreSQL、Git、环境变量、日志或终端回放。该文件权限为 `0600`，每个有效行只包含 `username`、`bindingId`、`salt` 和 `hash`。由受控账号初始化流程写入，不在文档或仓库中保存明文口令。

口令生效还要求数据库 `content_intake.password_login_allowed(binding_id)` 返回 `true`。该函数要求：

- binding 是 enabled `synthetic` owner binding。
- binding 对应唯一 enabled `production-admin` 主体。
- 该主体的 `seat_posts.job_id` 是 `job-master-account`。
- 对应 `role_rules.role` 是 `director`。

口令文件命中只证明持有凭据。它不证明管理员角色，也不发出业务授权。口令文件读取失败时，`POST /password` 返回 503；binding、岗位或唯一性检查失败时返回认证失败。

若需要轮换口令，替换该账号的 salt 和 hash，保留原用户名和 binding。不要向 Git、工单正文、聊天记录或 shell 历史粘贴明文口令。

## 配置 Feishu 候选

Feishu OAuth 的最低登记依赖以下运行时环境键：

| 环境键 | 合同 |
| --- | --- |
| `ROSTER_TENANT_ID` | 内部 tenant，必须与 `ROSTER_APP_ID` 成对非空 |
| `ROSTER_APP_ID` | 内部应用，必须与 `ROSTER_TENANT_ID` 成对非空 |
| `ROSTER_CANDIDATE_DEPARTMENT_ID` | 内部候选部门，不是 Feishu 通讯录部门 |
| `ROSTER_CANDIDATE_JOB_ID` | 内部候选岗位，不是 Feishu 职务原文 |

四个键只接受 `[A-Za-z0-9][A-Za-z0-9._:-]{0,127}`。候选部门和岗位必须在同一 tenant/app 下已有 `role = 'agent'` 的 `role_rules` 行；登录不会新建策略。

这四个值属于部署身份配置，不是秘密。把四个键写入 stack 的 `api.env`。仅设置 systemd 父进程环境不会进入 API 子进程的配置，不足以启用候选登记。不回显、不拼接进日志，也不作为授权主体 ID。缺少目录权限时，OAuth 仍可登记 `feishu-candidate`；候选只获得内部最低岗位事实，身份仍没有业务权限。

如果目录读取成功，并且职务稳定命中正式 `JOB_ROSTER` 和 `role_rules`，候选可以提升为 `feishu-job-roster`。这仍然只写身份和事实，不写 grant。

候选重复登记不会读取或复制旧 facts。若前一次目录结果明确为离职，或确认流程把候选事实设为 disabled，后续目录读取失败时只能返回 `inactive`，不能把事实改回 `true`。

## 授予与撤销

1. 主账号使用私有口令登录。
2. 打开权限页，选择目标主体、店铺、动作和期限。
3. 先预览。预览只返回计划，不写授权。
4. 确认保存。服务端重新检查签发人当前事实、角色上限、父授权、目标事实和当前策略。
5. 撤销时使用同一权限页面的显式撤权命令。不要删除 grant 行，也不要直接改历史。

主账号给 Feishu 候选授予 `query` 后，候选下一次请求才读取到新授权。候选重新登录不会复制或恢复授权；已撤销的 grant 仍保持撤销。

Feishu 身份和独立主账号默认是两个主体。OAuth 登录不会自动把两个身份合并，也不会把 Feishu 登录人提升为 production admin。需要把 Feishu open_id 接到既有主体时，走单独、获批的身份链接流程，并重新核验主体、主体类型和授权范围。

## 姓名和显示

`public.app_users.display_name` 是操作者姓名的唯一来源。Feishu provider 在进程内把本次用户名交给 auth callback。`app_backend_auth` 调用 `backend_identity.set_operator_display_name(binding_id, name)`。函数从 enabled binding 读取 `user_id` 和 `role`，首次登记时插入 `app_users` 行。已有行发生冲突时只更新 `display_name`，保留原来的 `role` 和 `is_active`。函数不根据用户名推导或填写 `feishu_open_id`。

`principal` 鉴权不读取姓名。人员目录的 `registeredPrincipalPage` 才关联 `app_users`。业务角色中仅 `intake_business` 获得 `user_id`、`display_name` 两列的 SELECT 权限，不获得 `role`、`is_active` 的读取权。使用同一数据库角色的受限 publisher 也具有这两列权限，但发布鉴权不依赖姓名。

姓名不写入 `content_intake.principals`、`principal_facts`、`subject_bindings` 或 `grants`。候选页面固定显示「已登记候选（岗位待核实）」，这不代表 HR 职务或姓名。

## 定时刷新

`customer-agent-roster-refresh.timer` 只刷新仍然有正式职务事实的 `feishu-job-roster` 主体。脚本保持 4 分钟运维节奏，并在距到期 10 分钟以内才续写 24 小时事实，给定时器留出至少两个 tick 的余量。

定时器不刷新候选、不刷新主账号，也不签发业务授权。旧 `issue_roster_query` 函数保留仅为迁移历史；0077 已收回 `intake_business` 的执行权，stale timer 调用会 fail-closed。

## 核验

用只读查询确认身份链，不输出口令、Feishu 原始资料或不必要的个人信息：

```sql
SELECT identity_scope, count(*) AS principals
FROM content_intake.principals
GROUP BY identity_scope
ORDER BY identity_scope;

SELECT enabled, btrim(provider) AS provider, btrim(role) AS role, count(*) AS bindings
FROM backend_identity.subject_bindings
GROUP BY enabled, provider, role
ORDER BY enabled DESC, provider, role;

SELECT
  post.job_id,
  rule.role,
  facts.enabled,
  facts.checked_at,
  facts.valid_until
FROM content_intake.seat_posts AS post
JOIN content_intake.role_rules AS rule
  ON rule.tenant_id = post.tenant_id
 AND rule.app_id = post.app_id
 AND rule.department_id = post.department_id
 AND rule.job_id = post.job_id
JOIN content_intake.principal_facts AS facts
  ON facts.principal_id = post.principal_id
JOIN content_intake.principals AS person
  ON person.principal_id = post.principal_id
 AND person.current_facts_version = facts.facts_version
WHERE person.identity_scope = 'production-admin';
```

`production-admin` 的总数必须为 1。岗位必须是 `job-master-account`，role 必须是 `director`，登录后事实必须在未来 24 小时内。若总数不是 1、岗位不匹配或事实窗口无覆盖，停止授权操作。

最后从客户端验证：

- 主账号口令登录成功，并且 `/v1/auth/me` 返回 `owner`。
- 权限页能预览、保存并撤销一个测试范围内的授权。
- 重新登录不会恢复已撤销授权。
- Feishu 无目录权限时仍能以候选登记，业务动作保持拒绝。
- 目标获授后下一次请求才可用，授权到期或撤销后立即拒绝。

以上检查没有连接到杭州执行，因此不能作为生产部署或业务验收证据。
