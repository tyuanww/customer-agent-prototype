# First projection

A brand-new Feishu account signs in for the first time. Its projection must state the real reason it
has no access, because the sentence decides what the operator does next.

## Sub-features

- Admit a new open id and register it as an agent seat.
- Match its job title to a role.
- Project the permission state and the sentence that goes with it.
- Re-project on the next sign-in after content is published.

## How to get to it (user POV)

A person who has never signed in clicks 飞书登录 and authorises. There is no page to visit; the
outcome is the workbench's own permission notice.

## Driving it with verify-intake-permissions

This one is API-level, because the account has no local seat to drive. Establish the state through
the host, then read the projection:

```
await host.requestAs('newcomer', '/v1/auth/callback?...')     // first sign-in, unmatched open id
GET /v1/auth/job                                              // the claim lives here
```

Copy the sequence from `apps/api/tests/project-roster-login.integration.test.ts`
("keeps a query grant outside the current store set closed"), which drives the same projection
against a real cluster.

## End state

Before anything is published: `permission_state: "pending"`, and
`message: "资料尚未发布，暂时没有可查询内容。发布后重新登录即可。"`, with all four `actions` false.

A closed facts window gives `expired` with `资料资格过期了，请稍后重试。`. A missing grant gives
`denied` with `没有权限，请找人开通。`. Three states, three sentences; the same sentence for all
three is the defect this journey exists to catch.

## Gotchas

- `pending` is not `denied`. Registration succeeded and eligibility holds; only content is missing.
  A run that reports 没有权限 for a new account has regressed the projection.
- The sentence mapping has one owner, `rosterMessageFor` in `@customer-agent/job-roster`. The API body
  and the desktop `permissionNotice` both read it. Do not assert against a literal copied from
  somewhere else.
- Publishing later does not heal an open session. The next sign-in re-projects; a seated session keeps
  its old state until then.
