# Permission page

An operator opens 权限, grants a named seat an action on one source, and the seat's own projection
changes as a result. Revoking it takes the access away again.

## Sub-features

- Refresh the page: sources the operator may allocate, and the people they may contain.
- Pick a source, then a person from the registered directory.
- Preview a grant without saving it.
- Save the grant; the receipt is not a promise of permanent access.
- Revoke a saved grant, with a reason.

## How to get to it (user POV)

Sign in as the owner, open the dashboard, click the 权限 tab. The panel is titled 权限配置. Pick a
source from the list, then a person; choose the actions, the window and a reason.

## Driving it with verify-intake-permissions

`host.selectIdentity('roster-director')` before launching Electron, then:

```
const dashboard = app.windows().find(w => w.url().includes('role=dashboard'))!;
await dashboard.getByRole('tab', { name: '权限', exact: true }).click();
const panel = dashboard.getByRole('region', { name: '权限配置', exact: true });
```

The existing spec that already walks this path end to end is
`apps/desktop/tests/e2e/content-intake-permissions-real-stack.spec.ts`. Copy its sequence rather than
rebuilding the login and window dance.

## End state

The grant row exists in `content_intake.grants` with the recipient's principal id, and the recipient's
`/v1/intake/authorization` answers with a `validUntil` for that action and source. After revoking, the
same call answers `NOT_FOUND`. A screenshot of the panel is supporting evidence, not the claim.

## Gotchas

- The panel is judged before a modal opens. An antd mask owns the pointer and would intercept the
  theme menu, so measure layout first.
- `closeRisk()` is true while a preview or pending write exists; the window then asks before closing.
  A run that leaves a preview open will hang on teardown.
- A saved receipt reads "此回执不代表权限永久有效" by design. Do not assert on the absence of that
  sentence.
