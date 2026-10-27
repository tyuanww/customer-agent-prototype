# 坐席岗位和角色上限

本文只对照现在的代码。没有改授权、没有给新建坐席补授权，也没有决定「一建出来就要不要有岗位动作」。

证据来自这些文件：

- 页面岗位：`apps/desktop/src/shared/intake-post-actions.ts`，说明在[资料页与权限页](../reference-intake-pages.md)
- 建席映射：`packages/database/overlays/0068_seat_lifecycle.sql` 的 `seat_post_mapping` 和 `backend_identity.create_seat`
- 角色上限：`packages/database/overlays/0057_role_ceiling.sql`
- 动作是否生效：`packages/database/overlays/0050_authorization_sources.sql`，它只读未撤销的 business grant
- 已有读数：[A6 权限端到端证据](2026-10-26-a6-permission-e2e.md) 的 `password-seat-query-after-login-projection`

## 两套名字

页面上的岗位不是 `role_ceiling.role`。建席时 `seat_post_mapping` 把岗位拆成三列：业务角色写入 `content_intake.role_rules`，会话角色写入 `subject_bindings.role`，岗位编号写入 `content_intake.seat_posts.job_id`。

| 页面岗位 | 页面动作 | 业务角色 | 会话角色 | `job_id` |
| --- | --- | --- | --- | --- |
| 客服 | `query` | `agent` | `agent` | `job-seat` |
| 客服主管 | `content-manage`、`import`、`source-confirm`、`publish` | `supervisor` | `coach` | `job-seat-supervisor` |

页面动作是授权页用来预览和保存的那一组。客服主管这一组不含 `query`、`review`、`candidate-cancel`、`rollback`。

## 角色上限是能授什么，不是已经有什么

`content_intake.role_ceiling.business_actions` 是这个业务角色的 business grant **可以携带**的动作。`role_allows` 只查这张表。没有上限行时，建席在写身份之前就以 `SEAT_ROLE_NOT_IN_CEILING` 停住。

| 业务角色 | `business_actions` | `may_allocate` |
| --- | --- | --- |
| `agent` | 只有 `query` | 否 |
| `supervisor` | `query`、`content-manage`、`import`、`source-confirm`、`review`、`publish`、`candidate-cancel`、`rollback` | 否 |
| `director`、`manager`、`engineer` | 与 `supervisor` 同一组 | 是 |

客服的页面动作和 `agent` 的上限相同，都是 `query`。客服主管的页面动作是 `supervisor` 上限的子集：上限里还有 `query`、`review`、`candidate-cancel`、`rollback`，页面岗位不包含这四项。`supervisor` 的 `may_allocate` 是否，所以客服主管这个业务角色不能因为上限而获得给别人授权的资格。

## 新建坐席写了什么

`backend_identity.create_seat` 在校验岗位和上限之后写入：

- `subject_bindings`，角色是上面的会话角色
- `content_intake.principals`
- `content_intake.seat_posts`
- `content_intake.role_rules`，同一租户、应用、部门和岗位已有规则时 `ON CONFLICT DO NOTHING`
- `content_intake.principal_facts` 第一版，`valid_until` 是写入时刻加 5 分钟

它不写 `content_intake.grants`。`apps/api/src/content-intake/seats.ts` 的 `create` 在函数返回后只把口令写入口令文件，也不写授权。

`authorization_sources` 只连接未撤销、已生效、未过期的 business grant。没有 grant 行，就没有来源。

A6 已经量过这条路径。`create_seat` 创建登录名 `a6lead`、岗位「客服主管」之后，业务角色是 `supervisor`，`subject_bindings.role` 是 `coach`。接着 `project_seat_login` 返回 `projected`。这两步之后，`authorization(..., 'query')` 仍是 `{ ok: false, code: 'NOT_FOUND', reason: 'SCOPE_DENIED' }`。主账号经现有 `grantBatch` 授予 `query` 之后，下一次查询读取才是 `ok: true`。发布在单独再授 `publish` 之前仍是 `SCOPE_DENIED`。

所以：新建坐席立刻有岗位编号、业务角色和会话角色。它不立刻有页面上那组岗位动作。客服主管也不因为上限里有 `query` 就立刻能查。

## 还没定的事

新坐席要不要在创建的同一时刻，按页面岗位动作写入 business grant，还没有操作者决定。本文不选。在决定之前，代码保持现在这样：创建不写授权，要用就走权限页的预览和保存。
