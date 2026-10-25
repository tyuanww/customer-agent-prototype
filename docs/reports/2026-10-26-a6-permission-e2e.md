# A6 权限端到端证据

本文记录五个权限场景在 PostgreSQL 15 上的自动化结果。授权判断、迁移和桌面界面都没有改。

测试文件是 `apps/api/tests/a6-permission-e2e.integration.test.ts`。用例名是 `A6 permission reads` 里的 `walks the five scenarios in order`。五个场景是文件顶部的 `SCENARIOS` 列表，按这个顺序在同一个库里走完。`CUSTOMER_AGENT_API_PG15_INTEGRATION` 不是 `1` 时，`describe.skipIf` 跳过整组，测试不会启动数据库。

2026-10-26 在本机用 Node.js v24.19.0 和 PostgreSQL 15.18 跑过下面的命令。工作目录是 `apps/api`。Vitest 报告 1 个文件、1 个测试通过，该测试用时 1364ms。

```text
CUSTOMER_AGENT_API_PG15_INTEGRATION=1 pnpm exec vitest run tests/a6-permission-e2e.integration.test.ts
```

读取分两路。`createContentIntakeService` 的 `authorization` 是资料授权读取，失败时带 `reason`。`readAuthorizationActions` 是职务接口上的 `actions`。`import`、`publish`、`rollback` 只有在 `subject_bindings.role` 为 `owner` 且 `authorization_sources` 含该动作时才为真。`query` 不要求 owner。这个测试没有改 `apps/api/src/project-roster-login.ts` 里的这条 SQL。

## feishu-new-open-id-can-query

新的飞书 open id 是 `ou_a6freshread1`。登录前 `subject_bindings` 里没有这一行。`feishuAdmitOpenId('CAPABILITY_DENIED', openId)` 返回这个 open id。随后走与 `apps/api/tests/feishu-login-link.integration.test.ts` 相同的模拟登录。`exchange` 把 code 原样交回，不访问飞书。`establish_feishu_login` 在 `CAPABILITY_DENIED` 后调用已有的 `admit_feishu_agent`。登录钩子再调用 `projectRosterLogin`。

库里已有 `publishLineage` 写下的当前发布。投影状态是 `projected`。绑定角色是 `agent`。下一次 `authorization(..., 'query')` 为 `{ ok: true, value: { sourceId: 'source-a', action: 'query' } }`。`readAuthorizationActions` 为 `{ query: true, import: false, publish: false, rollback: false }`。

## password-seat-query-after-login-projection

`backend_identity.create_seat` 以 `intake_business` 创建登录名 `a6lead`、岗位「客服主管」。返回的业务角色是 `supervisor`，主体是 `seat_a6lead`。`content_intake.project_seat_login` 返回 `projected`。`subject_bindings.role` 是 `coach`，不是 `owner`。

这两步之后，`authorization(..., 'query')` 仍是 `{ ok: false, code: 'NOT_FOUND', reason: 'SCOPE_DENIED' }`。`create_seat` 和 `project_seat_login` 都不写查询授权。

随后主账号 `user-director` 经 `grantBatch` 授予 `query`。这是现有的 `createGrants` 路径。下一次查询读取为 `ok: true`。此时发布读取仍是 `SCOPE_DENIED`。

## publish-grant-visible-on-intake-read

同一个主账号再经 `grantBatch` 把 `publish` 授给 `seat_a6lead`。客服主管的资料角色是 `supervisor`，角色上限允许接受发布。下一次 `authorization(..., 'publish')` 为 `ok: true`，动作是 `publish`，来源是 `source-a`。

同一次读取之后，`readAuthorizationActions` 仍是 `{ query: true, import: false, publish: false, rollback: false }`。发布授予改变的是资料授权读取，不是非 owner 的 `actions.publish`。

## publish-revoke-hidden-on-next-read

主账号经 `changeGrant` 撤销上一步的发布授权，变更是 `revoke`。下一次发布读取是 `{ ok: false, code: 'NOT_FOUND', reason: 'SCOPE_DENIED' }`。查询读取仍是 `ok: true`。

## stale-principal-facts-are-unavailable

`principal_facts` 不能改已有行。测试为 `seat_a6lead` 追加一个新事实版本，并把 `current_facts_version` 指过去。新行的 `checked_at` 是当前时刻减 2 分钟，`valid_until` 是当前时刻减 1 秒，所以 `valid_until` 已经过去，并且仍满足「晚于 `checked_at`、不超过 5 分钟」的检查。

下一次 `authorization(..., 'query')` 是 `{ ok: false, code: 'FORBIDDEN', reason: 'ORG_FACTS_UNAVAILABLE' }`。`requireFresh` 在 `apps/api/src/content-intake/transaction.ts`，`authorization` 进入动作判断之前就调用它。

## 没有自动化的部分

真实飞书 OAuth 没有跑。测试里的身份交换是本地 mock，`authorizeUrl` 指向 `127.0.0.1`。

Electron 窗口没有打开。没有点击桌面，也没有看界面上的按钮。

`actions.publish` 对这个客服主管保持 `false`。若要看到职务接口上的 `publish` 变为 `true`，绑定角色必须是 `owner`。本测试没有改这条规则，也没有把坐席改成 owner。
