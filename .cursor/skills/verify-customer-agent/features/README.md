# Customer-agent verification map

Read `../SKILL.md` first. This map is the maintained source for deciding which user-visible behavior has proof and which behavior is still blocked.

| Feature | Proves | Provable today |
| --- | --- | --- |
| [Fox and Query](fox-query.md) | Fox opens Query; search, result cards, keyboard copy, close, and reopened state follow the operator path | Yes, fixture UI and synthetic real HTTP/PG15 |
| [Workbench](workbench.md) | One trusted Dashboard, navigation, publication consumption, Settings capabilities, denied controls, and cross-window logout | Yes, real Electron plus synthetic HTTP/PG15 |
| [Content intake](content-intake.md) | Native upload, validation, repair, source confirmation, quality checks, direct publication, cancellation, ordinary-seat query, and revocation | Yes, synthetic bytes through real Electron/HTTP/PG15 |
| [SOP flow](sop-flow.md) | SOP navigation and fail-closed behavior are visible; positive SOP delivery remains contract-blocked | Only the mechanism and blocked state |

## Baseline preconditions

- Use Node.js 24 and pnpm 11.19.0.
- Run `pnpm build` before development Electron specs.
- Every run gets its own temporary `--user-data-dir`.
- The real-stack specs set `CUSTOMER_AGENT_INTAKE_SYNTHETIC_E2E=1` and use an isolated PostgreSQL 15 cluster owned by the test host.
- Only synthetic identities, content, files, orders, dates, and shop names are allowed.
- Never use a real Feishu session, customer record, credential, order, image, batch, or internal URL.

## Environment ladder

Keep these labels separate in every report:

1. `fixture-ui`: built Electron UI with compile-time or test-controlled synthetic data.
2. `synthetic-real-stack`: real Electron, HTTP modules, synthetic identity transport, and isolated PostgreSQL 15.
3. `packaged-unsigned`: actual packaged application, with the unsigned marker and package hash recorded.
4. `real-device`: the named operator machine and OS, with real keyboard, display, installer, and accessibility checks.
5. `production`: the approved deployed environment, real accounts, real data boundary, health, rollback, and business owner sign-off.

## Reporting rules

- Start from the baseline state named by the feature file unless it defines another precondition.
- Prefer semantic roles and stable test IDs from the existing Playwright specs.
- Capture the action and resulting state. A final screenshot without the action does not prove the transition.
- Pair UI proof with side-effect proof when the promise includes a clipboard value, persisted file, database row, release ID, or permission change.
- Report an unreachable entry point with its attempted command and unmet precondition. Do not replace it with a more convenient internal API.
- Mark a missing environment as `UNOBSERVED`, not `PASS`.
- Do not call the candidate closed while any required row is `FAIL`, `BLOCKED`, or `UNOBSERVED`.
