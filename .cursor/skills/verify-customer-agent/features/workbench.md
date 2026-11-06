# Workbench

The Dashboard is one trusted system window opened from the Query capsule or a native desktop entry. In the FAQ synthetic profile it exposes the workbench, content library, SOP, material review, and conditional Settings navigation. Logout clears the shared session in every window.

## Sub-features

- `dashboard-single`: trusted entries open or restore one Dashboard, never a second concurrent window.
- `dashboard-navigation`: 工作台, 内容库, SOP, and 资料审核 are reachable; 本机草稿 is absent.
- `dashboard-publication`: the content library reads the currently qualified publication by domain and scope.
- `dashboard-settings`: Settings appears only when the grant or account capability is open.
- `dashboard-denied`: a query-only principal sees no management controls.
- `dashboard-logout`: one logout clears the Dashboard and Query session and removes query-selection capability.

## How to get to it (user POV)

- Open Query from Fox and choose the Dashboard icon.
- Use Tray, application menu, or Dock entry where the approved platform path requires it.
- Use the Dashboard navigation list.
- Open `账号信息` and choose `退出登录`.

## Driving it with verify-customer-agent

Preconditions:

- Run `pnpm build`.
- For real workbench data and Settings, provide PostgreSQL 15 and set `CUSTOMER_AGENT_INTAKE_SYNTHETIC_E2E=1`.
- Use a new temporary userData directory owned by the spec.

- **Shell and single-window behavior.** Run `pnpm --filter @customer-agent/desktop exec playwright test tests/e2e/dashboard.spec.ts`. PASS requires one visible trusted Dashboard, no renderer Node access, no horizontal overflow at 980 by 680, 1180 by 760, and 1440 by 820, and close/reopen behavior that leaves Fox available.
- **Navigation and publication.** Run `CUSTOMER_AGENT_INTAKE_SYNTHETIC_E2E=1 pnpm --filter @customer-agent/desktop exec playwright test tests/e2e/content-intake-workspace-real-stack.spec.ts`. PASS requires the expected domain rows, the displayed-count sentence, no legacy content requests, retained Query qualification, denial after revocation, and no renderer errors.
- **Logout across windows.** Run `CUSTOMER_AGENT_INTAKE_SYNTHETIC_E2E=1 pnpm --filter @customer-agent/desktop exec playwright test tests/e2e/dashboard-handoff-real-stack.spec.ts`. PASS requires exactly one logout request, Dashboard signed out, Query signed out, shop filters disabled, and results removed.
- **Settings depth.** Run the existing `verify-workbench-settings` skill when the claim includes grant or account management. This feature file proves the shared Dashboard boundary; the specialized skill owns permission and account journeys.
- **Proof.** Preserve `.gstack/dashboard-handoff/<timestamp>/` and `.gstack/intake-workspace/<domain>-<timestamp>/`. Include the window security readback and expected request absence in the result row.

## Gotchas

- A visible Dashboard shell does not prove signed-in publication data.
- Opening Dashboard can park Query and invalidate its old selection. Acquire the API-level qualification after that lifecycle boundary when testing retained qualification.
- Do not use a renderer management call to prove a Settings button. The specialized Settings skill must drive the visible control.
- macOS Dock activation in Playwright is program evidence, not a human Dock click or real Stage Manager observation.
