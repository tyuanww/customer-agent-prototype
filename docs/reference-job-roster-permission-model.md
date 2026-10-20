# JOB_ROSTER 权限模型

这份说明记录当前本地代码里的登录、签发、查询和撤权。桌面截图和录像还没有取证。核对一名坐席为什么看到固定句子，见[如何核对职位名单查询权](how-to-check-roster-permission.md)。

## 结论

运行时唯一决定因素是 `content_intake.authorization_deadline` 返回的有效业务授权。它同时要求：主体当前事实存在且在五分钟租约内、业务授权未撤销且未过期、授权的 tenant/app/scope/action/source 与请求一致。`JOB_ROSTER` 是稳定职务目录，`role_rules` 是预先配置的签发策略，五分钟事实是 Feishu 对主体的短期证明；这三者都不能单独放行查询。

客服登录只做身份和策略投影：命中既有 `role_rules` 后登记主体和五分钟事实，查询授权由 `content-intake-system/query-signer` 按当前发布内容签发。登录路径永远只传 `query`；`publish`、`import` 和 `grant` 必须走已有的显式签发流程。没有匹配策略时返回 `policy-pending`，不写主体、事实或授权。

## 流程和不变量

### 登录

1. Feishu 证明 open id、职务原文和部门 id；`normalizeJobTitle` 只做 NFKC、Unicode 空白折叠和首尾空白清理。
2. `matchJobRoster` 先按稳定 `jobId` 的正式职务匹配。别名只走有限时间窗。过期或指向两个职务的别名不登记。空库时 tenant 和 app 只来自 `ROSTER_TENANT_ID` 与 `ROSTER_APP_ID`。未配置则跳过，不从历史主体猜测。
3. 数据库要求同一 tenant/app、部门交集、稳定 `jobId` 和角色的 `role_rules` 已存在。策略不存在时返回 `policy-pending`，不登记人。
4. 策略存在时登记主体和新的五分钟事实。重复登录递增 `facts_version`，旧事实自然失效。

不变量：职务字符串不能成为主体或授权的身份键；首次登录不能创建策略；部门不匹配不能套用同名职务；登录失败不会把主体当成有查询权的人。

### 签发

`content-intake-system/query-signer` 是唯一的自动查询签发人。它不是登录人，也不复制任何 allocation/delegation 父授权。有内容的店是当前发布谱系上仍有效的 `v2-preview` 来源，记成一版店铺集。系统查询授权写下当时的策略版本和店铺集版本。来源不在这一版里时，查询截止时间为空。店铺集在 `0048_roster_store_set`。现行签发函数、撤权和读状态函数在 `0049_roster_lifecycle`。`0047` 和 `0048` 保留已经应用过的函数正文，以后只改 `0049`。

不变量：自动路径不产生 `publish`/`import`；业务授权必须有可追溯的 issuer；没有当前内容的店不会获得查询授权；已有人工授权不被登录投影冒充或覆盖。

### 查询

查询服务只调用 `authorization_deadline`，不读取 `JOB_ROSTER` 或 `role_rules` 作为放行条件。返回的店集合来自当前发布内容中存在有效 lineage 的来源，店目录只是显示投影。有业务库时，`GET /v1/auth/job` 的 `permission_state` 来自 `content_intake.roster_permission_for_user`。函数使用一次 `clock_timestamp()`，再对当前店铺集的每一行调用 `authorization_deadline`。没有主体时函数返回空，接口再看进程快照。两边都没有职务时返回 404，正文是「职务未识别」。进程快照只提供本次登录采集到的职务原文，不能把内存里的 `ready` 当成放行。

函数找到主体之后：事实未启用返回 `revoked`；事实窗口不包含当前时刻返回 `expired`；当前店铺集里至少一行截止时间非空返回 `ready`；已有被撤销的系统查询授权返回 `revoked`；未撤销但已过 `expires_at` 返回 `expired`；其余返回 `pending`。事实里的 `job_id` 对不上 `JOB_ROSTER` 时，状态改为 `denied`，标题用进程快照里的职务原文，不用未知编号当标题。`ready`，以及没有业务库时的 `unknown`，`message` 为 `null`。其它状态的 `message` 只能是「没有权限，请找人开通。」。这条路由不在冻结 OpenAPI 里。桌面主进程用 `@customer-agent/job-roster` 的 `parseRosterJobResponse` 收口，多出来的字段直接拒绝。预加载不能引用这个包，权利表仍手写同一份句子。

桌面 `JOB_ROSTER` 决定按钮是否显示。客服坐席的查询按钮可以仍为可见，同时数据库状态是 `revoked`，发布按钮可见也不产生自动 `publish`。预加载权利表与 `JOB_ROSTER` 的五元组一致。

不变量：查询按钮可见性和服务端放行分开；事实或授权任一到期都立即拒绝；未知职务、策略待配置、主体缺失、事实过期和无查询授权最终都显示「没有权限，请找人开通。」。

桌面截图和 30 到 60 秒录像没有取证。跑通那条界面需要已登录的产品桌面会话，这次本地证明停在会话对象、顶栏代码和 Postgres。

### 撤权

下一次登录按当前发布谱系重算系统查询授权。来源离开当前谱系、职务变化、部门对不上 `role_rules`，或人员离职时，只撤销签发人是 `query-signer`、原因是「职位名单系统签发。」的未过期查询授权。人工查询授权留在原处。离职和部门不匹配会提高 `roster_terms`，之后重新符合条件时插入新的授权编号，旧行的 `revoked_at` 保持不变。缺少部门时不写 `dept-login-unassigned`。缺少部门或已离职时先调用 `withdraw_roster_query`，再读 `roster_permission_for_user`。函数还有行就返回那一行的状态。没有行时，离职返回 `unmatched`，缺部门返回 `denied`。

`roster_day_one` 只读取当前策略版本和当前店铺集，列出仍有效的系统查询授权。它不更新授权。店铺集的 `provenance` 记下产生这一版的当前发布编号。

不变量：撤权不删除授权行；系统签发人的事实在过期后于下一次签发时追加新版本。

## 已落地

有效业务 grant 加五分钟事实决定 `authorization_deadline`。登录只登记命中 `role_rules` 的人，并只自动签发 `query`。`projected` 只表示当前谱系上仍有系统签发的查询授权。没有业务库时登录继续，并记录 `roster projection skipped`。权限状态在有业务库时从数据库重算。最近一次本地测量里，店铺范围中位数 0.486 毫秒，范围 0.440 到 0.573 毫秒。登录到可查询中位数 1.001 毫秒，范围 0.957 到 2.081 毫秒。撤权后下一次拒绝用了 0.507 毫秒。这些数字不是 p95 预算。

## 首日行为

现有配置和当前发布内容都通过时，客服首次登录后看到客服职务和查询入口，查询只能覆盖当前已有内容的店；发布、上传 SOP 和发授权仍由显式流程控制。策略缺失、部门不匹配、未知职务、主体未登记、事实过期、授权过期或撤销时，登录本身可以成功，但查询保持拒绝并显示固定句子「没有权限，请找人开通。」。

