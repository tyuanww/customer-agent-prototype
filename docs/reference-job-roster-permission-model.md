# JOB_ROSTER 权限模型

这份说明记录当前本地代码里的登录、签发、查询和撤权。桌面截图和录像还没有取证。核对一名坐席为什么看到固定句子，见[如何核对职位名单查询权](how-to-check-roster-permission.md)。

## 结论

运行时由数据库计算有效业务授权。`authorization_sources` 返回可用来源集合，`authorization_deadline` 返回指定来源的最晚有效截止；0076 后两者共用同一决策。主体当前事实、角色上限、业务授权的时间与撤销状态、tenant/app/scope/action/source 均须有效。带父授权的业务授权还要求 steward 存在且全部祖先有效；query 另检查当前 policy/store-set 版本和来源成员资格。`JOB_ROSTER`、`role_rules` 和身份登录都不能单独放行查询。

0073 后飞书投影及坐席登录写出的事实窗口最长为 24 小时，运行时仍以每条事实的 `valid_until` 为准；旧五分钟事实不会自动延长。事实窗口和业务授权期限分别生效，取较早截止。具体边界见[事实窗口说明](how-to-extend-principal-facts.md)。

生产只保留一个 `production-admin` 独立主账号。该账号复用现有主体、`synthetic` owner binding 和 `job-master-account` 受控岗位来刷新事实。账号口令、数据库绑定和业务授权是三件事，任何一项成立都不能推出另外两项成立。初始化合同见[如何管理生产身份](how-to-manage-production-identities.md)。

客服登录只做身份和事实投影。0077 后登录、目录刷新和定时刷新都不创建、延长或恢复业务授权；`query`、`publish`、`import` 和委派必须由有签发资格的账号在权限页面预览后显式保存，并由同一路径显式撤销。信任的应用 home 可为尚未匹配 HR 职务的已验证 Feishu 身份登记 `feishu-candidate`，它只表示身份已登记，不表示职务已核实，也没有业务权限。没有候选配置、可信 home 或最低候选 role rule 时 fail-closed。

## 流程和不变量

### 登录

1. Feishu OAuth 只证明 open id。通讯录权限可用时，服务再读取职务原文和部门 id；`normalizeJobTitle` 只做 NFKC、Unicode 空白折叠和首尾空白清理。
2. `matchJobRoster` 先按稳定 `jobId` 的正式职务匹配。别名只走有限时间窗。
3. 目录不可用或职务未知时，只有配置了 `ROSTER_CANDIDATE_DEPARTMENT_ID` 与 `ROSTER_CANDIDATE_JOB_ID`，并且该内部岗位已有 `role = 'agent'` 的 `role_rules` 行，才登记最低 `feishu-candidate`。候选岗位是部署侧的登记位置，不是 HR 职务事实。
4. 候选必须精确对应当前 open id 的 binding/user 和确定性 principal，或精确对应已持久化的 Feishu link 与既有 principal。不同 open id 不能借同一个 user id 错配。
5. 重复登记候选只续写当前内部岗位事实，不读取旧 facts。已禁用的事实不会被目录读取失败后的候选 fallback 重新启用。
6. 命中正式职务且 `role_rules` 存在时，候选可提升为 `feishu-job-roster` 并投影真实部门、职务和角色事实。
7. 独立主账号通过受控口令登录。口令服务只接受数据库中 `password_login_allowed(binding_id)` 同意的 binding；成功后 `project_seat_login` 从固定 `job-master-account` 岗位写入 24 小时事实。

不变量：任何登录路径都不发业务授权。职务字符串不能成为主体或授权的身份键；首次登录不能创建策略；部门不匹配不能套用同名职务；口令命中、Feishu OAuth 成功、主体登记和事实刷新都不能代替业务授权。

### 签发与退役

业务授权只来自权限页面的显式 `grantBatch` 或 `changeGrant`。0077 同时核对历史签发主体或确定性身份、来源结构与原因，才将旧自动查询授权标记撤销；人工授权不会仅因使用相同备注被撤销，保留 `grant_history` 和人员手工授权，并收回 `intake_business` 对 `issue_roster_query` 的执行权。

`refresh-roster-facts.mjs` 只读取仍为 `feishu-job-roster` 的主体，目录事实临近到期时续写当前事实。它传入的 `p_actions = ['query']` 是兼容既有投影函数的参数，不是签发命令。定时器不调用 `issue_roster_query`，不生成授权，也不延长授权期限。

不变量：业务授权必须有当前事实、角色上限、有效父授权和显式 issuer；重新登录或目录刷新不恢复已撤销授权，也不延长业务授权。

### 查询

查询资格读取 `authorization_sources`，单来源授权入口读取 `authorization_deadline`；两者共享数据库决策，不以桌面的 `JOB_ROSTER` 按钮投影代替服务端授权。返回的店集合来自当前发布内容中存在有效 lineage 的来源，店目录只是显示投影。有业务库时，`GET /v1/auth/job` 的 `permission_state` 来自 `content_intake.roster_permission_for_user`。函数使用一次 `clock_timestamp()`，再对当前店铺集的每一行调用 `authorization_deadline`。没有主体时函数返回空，接口再看进程快照。两边都没有职务时返回 404，正文是「职务未识别」。进程快照只提供本次登录采集到的职务原文，不能把内存里的 `ready` 当成放行。

该接口的动作提示结合当前请求已认证的账号角色与 `authorization_sources`；业务连接不直接读取身份表的角色列。认证后的角色变化可能使在途提示短暂过时，实际写入仍按原有服务端事务重新检查授权。

函数找到主体之后：事实未启用返回 `revoked`；事实窗口不包含当前时刻返回 `expired`；当前店铺集里至少一行截止时间非空返回 `ready`；其余返回 `pending`。`feishu-candidate` 的标题固定显示「已登记候选（岗位待核实）」，真实部门/职务只有在正式投影成功后才显示。事实里的正式 `job_id` 对不上 `JOB_ROSTER` 时为 `denied`。`ready`，以及没有业务库时的 `unknown`，`message` 为 `null`。这条路由不在冻结 OpenAPI 里。桌面主进程用 `@customer-agent/job-roster` 的 `parseRosterJobResponse` 收口，多出来的字段直接拒绝。

桌面 `JOB_ROSTER` 决定按钮是否显示。客服坐席的查询按钮可以仍为可见，同时数据库状态是 `revoked`，发布按钮可见也不产生自动 `publish`。预加载权利表与 `JOB_ROSTER` 的五元组一致。

不变量：查询按钮可见性和服务端放行分开；事实或授权任一到期都立即拒绝。`pending` 不能区分缺授权与资料不可用，显示「查询权限或资料尚未就绪，请联系管理员核对。」；事实过期和明确拒绝分别使用对应提示。

桌面截图和 30 到 60 秒录像没有取证。跑通那条界面需要已登录的产品桌面会话，这次本地证明停在会话对象、顶栏代码和 Postgres。

### 撤权

已离职的 Feishu 身份调用 `withdraw_feishu_roster`，以已保存的 OAuth binding 解析实际主体并核对 tenant/app，再由 `withdraw_roster_query` 追加 disabled 事实并撤销该函数仍识别的旧系统授权。关联账号不按 open_id 推导另一个主体。人工 grant 只能通过权限页面的 `changeGrant` 撤销；之后任何登录、目录刷新或候选 fallback 都不会重建它。撤权不删除 grant 行，新版本和 `grant_history` 保留。候选回退与口令续期先锁定主体，再检查当前事实；enabled=false 不能靠这些登录路径恢复，enabled=true 仅过期时允许续期。新的可信目录事实仍可重新确认在职，既有人工撤销不会恢复。候选转目录身份只允许受控函数执行单向分类变更，稳定身份键不变。

不变量：撤销状态优先于后续 login；disabled 候选不能用候选 fallback 复活；人工撤权和审计历史不被目录投影覆盖。

### 姓名

操作者姓名只来自 `public.app_users.display_name`。Feishu 登录可依据已启用 binding 创建首个显示名行；已有账号只更新姓名，不改角色或启用状态。候选标题「已登记候选（岗位待核实）」和 `JOB_ROSTER` 职务都不是姓名。姓名不进入 principal、绑定、事实或 grant 的身份键。

## 已落地

有效业务 grant 加未过期的当前事实决定 `authorization_deadline`。登录只登记身份与事实，不签发 grant。主账号必须同时满足唯一 `production-admin` principal、enabled synthetic owner binding、受控 `seat_posts` 行和匹配 role rule；口令文件命中本身不构成授权。没有业务库时登录继续，并记录 `roster projection skipped`。权限状态在有业务库时从数据库重算。

## 首日行为

主账号完成数据库初始化、私有口令登记和服务端校验后，可以登录并在权限页给目标主体授予或撤销指定动作。新登记的 Feishu 候选即使没有通讯录权限也能出现在授权目标中，但首次登录仍显示「已登记候选（岗位待核实）」和「没有权限，请找人开通。」。策略缺失、部门不匹配、未知职务、主体未登记、事实过期、授权过期或撤销时，登录本身可以成功，但业务动作保持拒绝。

