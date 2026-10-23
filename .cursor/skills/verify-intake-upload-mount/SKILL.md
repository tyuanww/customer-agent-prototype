---
name: verify-intake-upload-mount
description: Exhaustively check that a packaged profile mounts materials upload exactly when it is faq-v2 or its API origin is https, and that the Hangzhou client is not swapped back to the five-page remote list. Use when changing `hangzhouWorkbench`, `workbenchSession`, `ProductHttp`, `registerContentIntakeManagementIpc`, or `DashboardApp` navigation.
---

# Materials upload mounts onto the profile origin

**Property.** A materials-page upload is mounted exactly when the packaged profile is `faq-v2` or its API origin is `https`, and the mounted session is the one built with `new ProductHttp(productProfile.apiOrigin)`. The one dashboard renderer does not replace that workbench with the old five-page remote list.

**Harm.** The operator sees 资料管理, chooses a workbook, and the desktop drops it before the request can reach the database behind that origin.

## Run it

From the repository root:

```
node scripts/verify-intake-upload-mount.mjs
```

It finishes in under a second. Exit 0 prints `{"ok":true,"checked":30}`. Exit 1 is a broken property and names the profile. Exit 2 means the markers in `main.ts` moved and the check no longer describes the code; that is a modeling error, not a passing product.

## What it executes

The script cuts the two real statements out of `apps/desktop/src/main/main.ts` and runs them:

```
const hangzhouWorkbench = productProfile?.apiOrigin.startsWith('https://') === true;
const workbenchSession = productProfile?.contentIntake === 'faq-v2' || hangzhouWorkbench ? productSession : null;
```

It does not reimplement that boolean. It then checks that catalog, permissions, management, desk knowledge, and query registration all receive `workbenchSession`, that `ProductSession` is constructed with `new ProductHttp(productProfile.apiOrigin)`, and that `ProductHttp.request` joins the path onto `this.origin`. `DashboardApp.tsx` must not mention `PRODUCT_REMOTE_NAV` or `remoteSeat`.

The 30 profiles are the ones `readPackagedProductProfile` can hand this code: no profile, distinct loopback pairs on `43115`/`43116`/`43180`/`43181` with and without `contentIntake: "faq-v2"`, and the two Hangzhou origins `https://agent-auth.jianghua.site` and `https://agent-pass.jianghua.site` crossed the same way. Profiles the parser rejects never reach these lines, so they are outside the bound.

## Coverage

| Check | Code |
| --- | --- |
| Mount decision | `hangzhouWorkbench`, `workbenchSession` in `apps/desktop/src/main/main.ts` |
| Same session on the five intake registrars | `registerContentIntakeCatalogIpc`, `registerContentIntakePermissionsIpc`, `registerContentIntakeManagementIpc`, `registerDeskKnowledgeIpc`, `registerContentIntakeQueryIpc` |
| Origin of that session | `new ProductHttp(productProfile.apiOrigin)` and `ProductHttp.request` in `apps/desktop/src/main/product-http.ts` |
| No five-page swap | `apps/desktop/src/renderer/DashboardApp.tsx` |

Last confirmed that this description matches that code: `4ab774d55af7db5b6c018df6ee8b44a51d46a9cc`.

Move that commit forward only after you open the listed lines at the new commit and confirm the script still describes them. A green run on a commit that rewrote the wiring without those markers is exit 2, not a pass.

## What a failure looks like

Setting `hangzhouWorkbench` to `false` makes the office profile fail:

`https or faq-v2 profile left upload unmounted: {"apiOrigin":"https://agent-auth.jianghua.site","identityOrigin":"https://agent-pass.jianghua.site"}`

That profile is the Windows, macOS, and Linux `synthetic-stack.json` for Hangzhou. The upload handler then stays null and `dashboard:intake-current` returns `UNAVAILABLE` with `资料还不能在这里改。请把表交给客服经理。` before any `/v1/intake/` request.

## Not covered

- Whether the three Release bytes were built from this commit. Mac dmg and the Linux AppImage on the Hangzhou host were built from `60d2dd78`, which still mounts upload only when `contentIntake` is set.
- `authorization_deadline`. A mounted upload can still be refused inside PostgreSQL when `principal_facts.valid_until` has passed.
- The installer does not contain PostgreSQL. The database is whichever catalog the API at `apiOrigin` opens. On Hangzhou that is `customer_agent_formal` via `content.env`.
- A fresh install with no `synthetic-stack.json` stays offline. These lines then see no profile and leave upload unmounted on purpose.
