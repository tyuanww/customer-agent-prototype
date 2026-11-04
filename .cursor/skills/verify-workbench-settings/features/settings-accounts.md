# Settings accounts

## Sub-features

- The 账号 tab lists name, login name, post, and enabled state.
- Create accepts name, login name, password, and 客服 or 客服主管.
- Reset changes only the password.
- Disable preserves the identity row and marks it unavailable.
- Account creation does not grant business access.

## How to get to it (user POV)

Sign in as the review-only synthetic administrator. Open Dashboard, select 设置, confirm only 账号 is present, create a synthetic account, reset its password, and disable it.

## Driving it with Playwright

Run `tests/e2e/settings-accounts-real-stack.spec.ts`. It opens 设置 as `roster-review-only`, asserts that the 权限 tab and grant controls are absent, then completes list, create, reset, and disable through the real Electron Main, HTTP API, and PostgreSQL writer. It also reads the persisted seat list back from the host and asserts that grant source and principal lists were never requested.

The synthetic identity entry intentionally admits only registered subjects, so this journey does not claim that a newly created account can exchange a token from the local `/password` route.

## Gotchas

- Do not call `window.dashboardSeats.command` as proof of the UI path.
- Creating an account does not grant business access.
- The local synthetic identity entry admits only its explicit allowlist. A create or reset success does not mean a new account can use that entry.
- The review-only administrator must see accounts without receiving grant permissions.
- Identity creation and password-file writes are separate boundaries. A failure must say the identity exists and direct the operator to reset the password.
- Changes to seat authorization, `seats.ts`, or the seat database functions also require [verify-seat-administration-revocation](../../verify-seat-administration-revocation/SKILL.md).
- Seat authorization is request-time. A command admitted before revocation may finish, but a command checked after revocation must fail.
- Stop waiting does not cancel a server write that was already accepted.
