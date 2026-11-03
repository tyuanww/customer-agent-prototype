---
name: verify-intake-upload-mount
description: Exhaustively check that a packaged profile mounts materials upload exactly when it is faq-v2 or product-remote, and that the client keeps the unified workbench. Use when changing `intakeWorkbench`, `workbenchSession`, `ProductHttp`, seat or intake IPC registration, or `DashboardApp` navigation.
---

# Materials upload mounts onto the profile origin

**Property.** A materials-page upload is mounted exactly when the packaged profile is `faq-v2` or `product-remote`, and the mounted session is the one built with `new ProductHttp(productProfile.apiOrigin)`. The one dashboard renderer keeps the unified workbench.

**Harm.** The operator sees 资料管理, chooses a workbook, and the desktop drops it before the request can reach the database behind that origin.

## Run it

From the repository root:

```
node scripts/verify-intake-upload-mount.mjs
```

It finishes in under a second. Exit 0 prints `{"ok":true,"checked":27,...}`. Exit 1 is a broken property and names the profile. Exit 2 means the markers in `main.ts` moved and the check no longer describes the code; that is a modeling error, not a passing product.

## What it executes

The script cuts the two real statements out of `apps/desktop/src/main/main.ts` and runs them:

```
const intakeWorkbench = productProfile?.contentIntake === 'faq-v2' || productProfile?.mode === 'product-remote';
const workbenchSession = intakeWorkbench ? productSession : null;
```

It does not reimplement that boolean. It then checks that catalog, permissions, management, seat accounts, and query registration all receive `workbenchSession`, that `ProductSession` is constructed with `new ProductHttp(productProfile.apiOrigin)`, and that `ProductHttp.request` joins the path onto `this.origin`. `DashboardApp.tsx` must not mention `PRODUCT_REMOTE_NAV` or `remoteSeat`.

The 27 profiles are the ones `readPackagedProductProfile` can hand this code: no profile, 12 distinct loopback pairs on `43115`/`43116`/`43180`/`43181` with and without `contentIntake: "faq-v2"`, and two `product-remote` HTTPS origin pairs. Impossible combinations such as HTTPS without `product-remote` or `product-remote` with HTTP origins stay outside the bound.

## Coverage

| Check | Code |
| --- | --- |
| Mount decision | `intakeWorkbench`, `workbenchSession` in `apps/desktop/src/main/main.ts` |
| Same session on the five intake registrars | `registerContentIntakeCatalogIpc`, `registerContentIntakePermissionsIpc`, `registerContentIntakeManagementIpc`, `registerSeatAccountIpc`, `registerContentIntakeQueryIpc` |
| Origin of that session | `new ProductHttp(productProfile.apiOrigin)` and `ProductHttp.request` in `apps/desktop/src/main/product-http.ts` |
| No five-page swap | `apps/desktop/src/renderer/DashboardApp.tsx` |

Last confirmed that this description matches that code: `88463a139d247bab5b2012c3f60799d9a265fc0a`.

Move that commit forward only after you open the listed lines at the new commit and confirm the script still describes them. A green run on a commit that rewrote the wiring without those markers is exit 2, not a pass.

## What a failure looks like

Setting `intakeWorkbench` to `false` makes the office profile fail:

`https or faq-v2 profile left upload unmounted: {"apiOrigin":"https://agent-auth.jianghua.site","identityOrigin":"https://agent-pass.jianghua.site"}`

That profile is the Windows, macOS, and Linux `synthetic-stack.json` for Hangzhou. The upload handler then stays null and `dashboard:intake-current` returns `UNAVAILABLE` with `资料还不能在这里改。请把表交给客服经理。` before any `/v1/intake/` request.

## Not covered

- Whether a Release artifact was built from this commit. Check the release target SHA and artifact digest separately.
- `authorization_deadline`. A mounted upload can still be refused inside PostgreSQL when `principal_facts.valid_until` has passed.
- The installer does not contain PostgreSQL. The database is whichever catalog the API at `apiOrigin` opens. On Hangzhou that is `customer_agent_formal` via `content.env`.
- A fresh install with no `synthetic-stack.json` stays offline. These lines then see no profile and leave upload unmounted on purpose.
