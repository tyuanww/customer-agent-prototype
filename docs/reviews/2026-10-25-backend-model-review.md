# 后端模型评审

只出方案。本文不改授权判断，也不改迁移。要改代码的地方都是提议，没有被接受，也没有执行。

## 口令登录与五分钟事实

飞书 open id 登录走 `afterLogin`。`content_intake.project_feishu_roster` 会插入 `principal_facts`，`valid_until` 是检查时刻加 `interval '5 minutes'`。现行函数在迁移 `0069_feishu_login_link.sql`。

其他 binding 走 `afterPasswordLogin`，调用 `content_intake.project_seat_login`。函数在迁移 `0068_seat_lifecycle.sql`。`binding_id` 不匹配 `^synthetic_seat_[A-Za-z0-9_-]{1,64}$` 时，函数返回 `missing`，不插入事实。`synthetic_owner` 不匹配这个模式。匹配的坐席 binding，在主体、岗位和角色规则都在时，会插入一份 5 分钟事实。

不匹配坐席模式的口令登录仍然不写事实，其中包括 `synthetic_owner`。

`requireFresh` 在 `apps/api/src/content-intake/transaction.ts`。事实未启用、尚未到检查时刻、已经到期，或 `valid_until` 晚于 `checked_at` 超过 `300_000` 毫秒时，它拒绝并给出 `ORG_FACTS_UNAVAILABLE`。`300_000` 毫秒等于 5 分钟。签发路径在 `apps/api/src/content-intake/authority.ts` 调用它。2026-10-24 的生产观察记在 [重构证据](2026-10-24-saas-refactor-evidence.md)。这次没有重跑那次观察，也不引用那里的行数。

提议。口令登录成功、且 `project_seat_login` 现在返回 `missing` 的主体，补写一份与飞书相同的 5 分钟事实。不新增动作。不删除 `principal-menokin-admin`。这一条没有执行，也没有被接受。要改代码，需要另行明确授权。

## 两套角色

会话角色是 `backend_identity.subject_bindings.role`。字典约束 `subject_bindings_role_check` 只允许 `agent`、`coach`、`owner`。

职务角色在 `packages/job-roster/src/index.ts` 的 `JOB_ROSTER`。7 个标题是客服总监、客服经理、客服主管、客服组长、AI赋能工程师、普通客服、客服坐席。数据库里 `content_intake.role_rules.role` 的约束 `role_rules_role_check` 允许 `agent`、`enabler`、`lead`、`supervisor`、`manager`、`director`、`engineer`。

`GET /v1/auth/job` 返回的 `import`、`publish`、`rollback` 还要求 `subject_bindings.role` 等于 `owner`，并且 `authorization_sources` 里有对应动作。`query` 不要求 owner。判定在 `apps/api/src/project-roster-login.ts` 的 `readAuthorizationActions`。`content_intake.authorization_deadline` 的现行函数在迁移 `0057_role_ceiling.sql`，不读 `subject_bindings.role`。它读 `role_rules`，再调用 `role_allows`。

提议。发布和导入只留 `authorization_deadline` 这一路。绑定角色不再单独加一道。这要先改判断，所以停在这里。这一条没有被接受。

## 一个真人一个主体

`content_intake.principals.user_id` 仍有唯一约束 `principals_user_id_key`。飞书和口令要认成同一个人，靠 `backend_identity.feishu_login_links.binding_id` 指向已有 binding，不靠删掉这个唯一约束。已经拆成两行的人，本文不合并。

## 六个授权概念

当前仍分开的有来源集合、截止函数、角色上限、父授权、会话角色、职务权利。

权限页是否打开，看授权接口返回的 `mayAllocate`。SOP 是否打开，看目录解析结果 `sopUseFromCatalog`。这两处不读 `JOB_ROSTER` 的 `rights.grant`。发布里，过敏或赔付等敏感行仍读 `rights.grant`，见 `apps/desktop/src/shared/dashboard-content.ts` 的 `contentPublishGate`。本文不把这两处收成同一个函数。
