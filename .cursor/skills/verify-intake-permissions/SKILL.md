---
name: verify-intake-permissions
description: Drive the real Electron workbench against a real PostgreSQL 15 and the real HTTP API to prove permission behaviour — the 权限 page, a seat being created, a brand-new Feishu account's first projection, and a seat querying a shop. Use when changing content-intake authorization, the roster projection, seat provisioning, or the 权限 page, and when a claim about "the operator can grant someone" needs evidence rather than a green unit test.
---

# Verify intake permissions end to end

Unit and integration tests drive the service layer and SQL. This skill drives what an operator
actually touches: Electron windows, the real HTTP API, and a disposable PostgreSQL 15 cluster, with
Playwright attached to the Electron app. Nothing here is stubbed — the host is the same one the
product e2e gates use.

The gap this closes: permission work has passed every service-level test while the entry point was
still shut. A brand-new Feishu account projected to zero permissions, and a created seat could never
be granted, and no unit test could see either.

## Launch

Build once, then start one journey. The host owns the cluster, the API, the identity provider and the
Electron windows; there is no separate server to leave running.

```
pnpm build    # services + desktop; the e2e gate runs against out/, not a dev server
CUSTOMER_AGENT_INTAKE_E2E=1 CUSTOMER_AGENT_INTAKE_SYNTHETIC_E2E=1 \
  pnpm --filter @customer-agent/desktop exec playwright test \
  tests/e2e/content-intake-permissions-real-stack.spec.ts
```

**Ready** means the Electron query window reported `data-parked="false"` and
`data-opening="false"`, and `window.customerAgent.product.sessionStatus()` returned
`ok: true, signedIn: true`. A running process or a healthy `/health` is not ready: the host is still
seeding grants at that point.

Set `PG_BIN` to a PostgreSQL 15 `bin` directory if `pg_ctl` is not on `PATH`
(`/Users/hutou/homebrew/opt/postgresql@15/bin` on this machine). The host refuses other majors.

## Doctor

Run before trusting any observation:

```
curl -s http://127.0.0.1:<identityPort>/health      # {"status":"ok","provider":"synthetic"}
psql -h <socket> -p <port> -U stack_owner -d <db> -c 'select count(*) from content_intake.grants'
```

`createIntakeSyntheticHost` logs both ports and the socket path when it starts. A host that answers
`/health` but whose grant count is zero has not finished seeding; wait for the window, not the port.

## Drive

The harness is Playwright attached to the real Electron app, not a browser page:

```
const host = await createIntakeSyntheticHost({ prepareCandidate: false, profile: 'purpose-runtime' });
const app = await launchIntakeElectron({ desktopRoot, userDataDirectory, apiOrigin: host.apiOrigin,
  identityOrigin: host.identityOrigin, evidenceDirectory: evidence });
```

Both helpers live in `apps/api/tests/support/intake-synthetic-host.ts` and
`apps/desktop/tests/support/intake-electron.ts`. The workflows that exist today are in
`apps/desktop/tests/e2e/*-real-stack.spec.ts`; copy the shape of the nearest one instead of inventing
a launch.

Handles that stay stable:

| Target | Handle |
| --- | --- |
| Query window | `w.url().includes('role=query')`, then `getByTestId('query-shell')` |
| Login window | `w.url().includes('role=login')`, then `getByRole('button', { name: '飞书登录' })` |
| Dashboard window | `w.url().includes('role=dashboard')` |
| 权限 tab | `getByRole('tab', { name: '权限', exact: true })` |
| 权限 panel | `getByRole('region', { name: '权限配置', exact: true })` |
| Ordering a seat | `dashboardSeats.command({ action: 'create', displayName, username, password, post })` |

`app.windows()` is polled with `expect.poll`; a window can take a second to appear after the bridge
call resolves. Switch the owner identity before launching Electron, not between assertions:
`host.selectIdentity('roster-director')`.

## Evidence

Write to `.gstack/<lane>/<ISO timestamp>/` under the repo root, one directory per run. Capture the
screenshot at the state that proves the claim, and pair it with the database row that the same
action wrote:

- `query-permission-denied.png` plus the grant count.
- The seat's `subject_bindings`, `principals`, `principal_facts` and `role_rules` rows, printed with
  `psql -c`, for a create-seat claim.
- `permission-state.txt` with the `/v1/auth/job` body for a projection claim.

The real user path only. Do not set state through `host.requestAs` and call it proof of a UI action;
`requestAs` is for establishing a precondition or for the API-level journeys named below.

For a projection claim, the observable end state is the body of `/v1/auth/job`: `permission_state`
and `message`, plus `actions`. A database row is not the claim.

## Journeys that cannot run yet

Recorded here so a later run does not mistake a refusal for a regression.

- **A seat created in the 权限 page cannot log in.** `POST /exchange` on the synthetic identity
  provider admits only the four seeded bindings in `SYNTHETIC_IDENTITIES`, so a created seat's
  `synthetic_<username>` gets `401 unknown_subject`. The create journey proves the database rows and
  stops there. The reason lives in `docs/reference-intake-pages.md`.
- **A brand-new Feishu open id has no content to read.** Its projection reaches `pending` until the
  tenant publishes. Driving it to `ready` needs a published release first; without one the correct
  observation is `pending` plus the content sentence.

## Cleanup

```
await closeOwnedElectron(app);
await host.close();
rmSync(userDataDirectory, { recursive: true, force: true });
```

`closeOwnedElectron` kills only the app this run launched. `host.close()` stops the cluster, the API
and the identity server. Never kill by process name: `pnpm dev` instances and other lanes may be
running.

Cleanup removes the instance, never the evidence. Proof directories under `.gstack/` survive the
teardown by design; confirm they are still there after closing.

## Helpers

The two helpers above are the whole surface. Both are TypeScript and are imported directly by the
spec file; the e2e gate runs them through Playwright with type stripping, so no build step is needed
for the spec itself.
