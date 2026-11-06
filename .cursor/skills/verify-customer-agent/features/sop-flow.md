# SOP flow

The current FAQ synthetic profile can show the SOP workbench entry and fail-closed state. It cannot prove an approved positive SOP release, severity ordering, or D1-D7/DS/E1-E2 branch semantics until the business gates are answered and the transport contract is approved.

## Sub-features

- `sop-navigation`: the locked workbench still identifies the SOP destination.
- `sop-unavailable`: the base FAQ synthetic profile shows the explicit unavailable copy and no upload control.
- `sop-mechanism`: component tests prove deterministic rendering for voucher, severity, explain, branch, media, and copy states.
- `sop-positive`: blocked until approved SOP content, severity order, node semantics, and positive transport exist.

## How to get to it (user POV)

- Sign in and open Dashboard.
- Choose `SOP`.
- In the current base profile, read the explicit unavailable state.
- Do not expect an SOP workflow until the business and transport gates are approved.

## Driving it with verify-customer-agent

Preconditions:

- Run `pnpm build`.
- Use a temporary userData directory and synthetic identity.
- Keep `SOP_CONTENT_A`, `SOP_CONTENT_B`, positive transport, and business Gate B open unless the operator has explicitly supplied and approved all of them.

- **Navigation and unavailable state.** Run `CUSTOMER_AGENT_INTAKE_SYNTHETIC_E2E=1 pnpm --filter @customer-agent/desktop exec playwright test tests/e2e/dashboard-handoff-real-stack.spec.ts`. PASS requires the SOP destination and the explicit sentence `SOP 学习与执行尚未开放。`, with no upload control.
- **Mechanism only.** Run `pnpm --filter @customer-agent/desktop exec vitest run tests/component/SopApp.test.tsx`. Label the result `mechanism-only`; it does not prove a user can publish or consume an approved SOP workflow.
- **Positive flow.** Mark `BLOCKED` while the severity order, node semantics, transport contract, or business gate is missing. Do not substitute the allergy fixture, a component test, a 503 envelope, or ordinary FAQ content for a positive SOP journey.
- **Proof.** Preserve the Dashboard screenshot and Playwright transcript for the unavailable state. Include the exact open gate IDs in the closeout report.

## Gotchas

- The mechanism is verified, not the business process.
- A visible SOP navigation item is not a working SOP release path.
- Never infer severity priority from the historical fixture or from UI order.
- Do not weaken the unsupported path into an ordinary candidate or success.
