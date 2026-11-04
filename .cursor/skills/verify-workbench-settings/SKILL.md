---
name: verify-workbench-settings
description: Drive the Electron workbench against the synthetic PG15 and HTTP stack to prove the five-page navigation, separate Settings grant and account capabilities, denied-write boundary, and cross-window logout. Use when changing DashboardApp, PageUseReader, intake-destination-rows, IntakePermissions, seat-account IPC, dashboard session handling, or the workbench navigation.
---

# Verify the five-page workbench and Settings

The workbench has one permission-aware navigation contract: 工作台、内容库、SOP、资料审核, plus 设置 when active grant or account capability exists. Settings contains 权限, 账号, or both according to the separate capabilities. The local draft page, `DeskKnowledge`, `dashboardDesk`, and its Main IPC channels must stay absent.

This check drives the built Electron app, HTTP, and an isolated PostgreSQL 15 cluster. Unit and component tests are supporting evidence only.

## Launch

Use Node.js 24 and the repository's locked pnpm. Build the services and desktop once:

```sh
pnpm build
```

Run the four owned journeys:

```sh
CUSTOMER_AGENT_INTAKE_SYNTHETIC_E2E=1 \
CUSTOMER_AGENT_PG15_BIN="${CUSTOMER_AGENT_PG15_BIN:-$(brew --prefix postgresql@15)/bin}" \
CI=true \
pnpm --filter @customer-agent/desktop exec playwright test \
  tests/e2e/content-intake-permissions-real-stack.spec.ts \
  tests/e2e/content-intake-permissions-denied-real-stack.spec.ts \
  tests/e2e/dashboard-handoff-real-stack.spec.ts \
  tests/e2e/settings-accounts-real-stack.spec.ts
```

Ready means the Query window reports `data-parked="false"` and `data-opening="false"`, the Dashboard window exists, and the synthetic identity is signed in. A listening port or healthy `/health` alone is not ready because the host is still seeding the database.

The synthetic host reserves an adjacent loopback API and identity port pair before either server starts. `launchIntakeElectron` can then open the `faq-v2` profile without fallback or a relaxed origin check. A missing Query window remains a failure.

## Doctor

Run these read-only checks first:

```sh
node -v
pnpm -v
PG15_BIN="${CUSTOMER_AGENT_PG15_BIN:-$(brew --prefix postgresql@15)/bin}"
"${PG15_BIN}/pg_ctl" --version
node scripts/verify-intake-upload-mount.mjs
```

Expected versions are Node 24.x, pnpm 11.19.0, and PostgreSQL 15.x. The upload-mount script currently prints `{"ok":true,"checked":27,...}`. Exit 2 means its source markers moved and the check must be updated before trusting it.

The script proves the Main wiring decision only. It does not prove the packaged UI, the settings tabs, or a real account write.

## Drive

The existing Playwright specs own login, the synthetic identity provider, HTTP, PostgreSQL, Electron launch, and cleanup. Reuse their selectors:

| Target | Stable selector |
| --- | --- |
| Navigation list | `getByRole('tablist', { name: '工作台功能' })` |
| Dashboard page | `getByTestId('dashboard-content')` |
| Settings tab | `getByTestId('nav-settings')` |
| Settings panel | `getByRole('region', { name: '设置', exact: true })` |
| Permission members | `getByRole('table', { name: '成员权限', exact: true })` |
| Account table | `getByRole('table', { name: '账号', exact: true })` |
| Signed-in account menu | `getByRole('button', { name: '账号信息' })` |

Do not invoke `window.dashboardPermissions.command`, `window.dashboardSeats.command`, or a host setter to prove a user-visible action. Use those only to establish an explicitly labelled precondition.

## Evidence

`dashboard-handoff-real-stack.spec.ts` writes screenshots under `.gstack/dashboard-handoff/<timestamp>/`. It must show the five navigation entries, the Settings navigation, the absent local-draft tab, and the signed-out Dashboard and Query windows after one logout request.

`content-intake-permissions-real-stack.spec.ts` writes under `.gstack/intake-permissions/<timestamp>/`. A permission claim needs both the screen action and the observable HTTP/PostgreSQL transition from denied to enabled and back to denied.

`content-intake-permissions-denied-real-stack.spec.ts` writes under `.gstack/intake-permissions-denied/<timestamp>/`. It must show no Settings navigation or write controls for the query-only director.

`settings-accounts-real-stack.spec.ts` writes under `.gstack/settings-accounts/<timestamp>/`. It must show only the 账号 tab for a review-only administrator, complete list/create/reset/disable through Main and the API, and show no grant controls or business-grant reads.

Keep the screenshots and test output after teardown. A screenshot of an open dialog alone does not prove a save, revoke, logout, or permission change.

The project-level `pnpm test:intake:desktop` command includes all four workbench journeys alongside the older upload, rollback, shop, and workspace real-stack specs.

## Cleanup

Each referenced spec closes only the Electron app and synthetic host it started, then removes its temporary userData and database directory in `finally`. Evidence remains under `.gstack`.

If a run is interrupted, inspect owned processes and temporary roots rather than killing all Electron, Node, or PostgreSQL processes by name.

## Helpers

No new helper is required. The repository-native helpers are:

- `apps/desktop/tests/support/intake-electron.ts`
- `apps/api/tests/support/intake-synthetic-host.ts`
- `apps/desktop/tests/support/owned-electron.ts`
- `scripts/verify-intake-upload-mount.mjs`

The feature map is in [features/README.md](features/README.md).
