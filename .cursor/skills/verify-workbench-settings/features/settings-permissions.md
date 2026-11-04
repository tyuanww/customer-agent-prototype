# Settings permissions

## Sub-features

- Settings contains separate 权限 and 账号 tabs.
- The permission tab previews without writing.
- A preview can be cancelled and restored.
- Saving grants query access that the server observes.
- Revoking the exact grant removes that access.

## How to get to it (user POV)

Sign in as the synthetic roster director, open Dashboard, select 设置, keep the 权限 tab, choose a member and post, preview the grant, save it, then revoke it with a reason.

## Driving it with Playwright

Run `tests/e2e/content-intake-permissions-real-stack.spec.ts`. The test clicks `nav-settings`, reads the `设置` region, previews and saves a grant, checks `/v1/intake/entitlements`, and revokes the saved permission.

Pair the visible action with the durable state:

```text
initial entitlement -> denied
after preview -> still denied
after save -> enabled
after revoke -> denied
```

Also run `tests/e2e/content-intake-permissions-denied-real-stack.spec.ts`. Its query-only director must not see `nav-settings`, `新增授权`, or a Settings region.

Both real-stack specs pass. The permission spec drives the named-seat preview, cancel, save, and revoke journey through Electron, Main, HTTP, and PostgreSQL. The denied spec proves the query-only director cannot open Settings, see grant controls, or call the account command.

## Gotchas

- The grant facts window is capped at five minutes by the database. Use a short synthetic window.
- An open Ant Design mask owns the pointer. Test navigation attempts through the mask rather than assuming an outer click worked.
- The receipt says the grant is not permanent. Do not assert that this sentence is absent.
- Grant and account capabilities are independent. A closed grant with recovery copy is not proof that Settings should open.
