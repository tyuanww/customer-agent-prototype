---
name: verify-customer-agent
description: Drive the customer-agent Electron app through its real user surfaces and decide whether an exact candidate is ready to close. Use when proving Fox/Query, Dashboard, content intake, SOP, packaged-client behavior, or a claim that all required functionality works normally.
---

# Verify the customer agent

This skill proves behavior a user can observe. Unit tests, component tests, CI, a process that stays alive, or a package that merely exists are supporting evidence, not product proof.

Use the maintained [feature map](features/README.md). Select every feature in the approved closeout scope. Record a blocked or unobserved path as incomplete.

## Launch

Use Node.js 24 and pnpm 11.19.0 from the repository root.

```sh
node -v
pnpm -v
pnpm build
```

`pnpm build` must produce `apps/desktop/out/main/index.js`. The Playwright specs launch that build with their own temporary `--user-data-dir`; do not point a verification run at an operator profile.

For the FAQ real-stack journeys, PostgreSQL 15 must be available:

```sh
export CUSTOMER_AGENT_PG15_BIN="${CUSTOMER_AGENT_PG15_BIN:-$(brew --prefix postgresql@15)/bin}"
export CUSTOMER_AGENT_INTAKE_SYNTHETIC_E2E=1
```

Ready means the owned app has a Fox window, a Query window with `data-parked="false"` and `data-opening="false"`, and the requested synthetic identity is signed in. A listening port or successful `/health` is not enough while the synthetic host is still seeding.

## Doctor

Run these read-only checks before trusting an observation:

```sh
node -v
pnpm -v
pnpm workspace:check
test -f apps/desktop/out/main/index.js
node scripts/verify-intake-upload-mount.mjs
```

For real-stack work also run:

```sh
"${CUSTOMER_AGENT_PG15_BIN}/pg_ctl" --version
```

Expected versions are Node 24.x, pnpm 11.19.0, and PostgreSQL 15.x. Stop if the source markers used by the upload-mount check moved. Update that checker before trusting an intake result.

## Drive

Reuse the repository's Playwright harness. Do not launch a development browser against `file://` URLs.

Stable handles:

| Surface | Handle |
| --- | --- |
| Fox | window URL contains `role=fox`; `getByTestId('fox-button')` |
| Query | window URL contains `role=query`; `getByTestId('query-shell')` |
| Query input | `getByTestId('question-input')` |
| Search | `getByTestId('search-button')` |
| Results | `answer-text-<n>`, `copy-button-<n>`, `toast` |
| Login | window URL contains `role=login` |
| Dashboard | window URL contains `role=dashboard`; `getByTestId('dashboard-shell')` |
| Navigation | `getByRole('tablist', { name: '工作台功能' })` |

Use visible controls for the proof. A direct call such as `intakeQuery.search(...)`, a test-only setter, or a database write may establish a precondition, but label that evidence as API-level. Do not present it as proof that the corresponding UI action works.

## Evidence

Keep evidence under `.gstack/verify-customer-agent/<UTC timestamp>/<feature>/`. Existing specs may already own their evidence directories; leave those files in place and write a short closeout report that links them.

Each result row records:

| Field | Meaning |
| --- | --- |
| candidate | exact Git SHA, app version, and package SHA-256 when applicable |
| feature | feature file and entry point |
| environment | fixture UI, synthetic real HTTP/PG15, packaged unsigned, or real device |
| action | user-visible action that was driven |
| expected | observable state from the feature map |
| observed | actual text, state, file, row count, or package identity |
| evidence | screenshot, trace, log, API body, database readback, or artifact path |
| status | PASS, FAIL, BLOCKED, or UNOBSERVED |

Do not promote evidence between environments. A fixture UI result does not prove real-stack behavior. A synthetic real-stack result does not prove a packaged app. A packaged unsigned result does not prove signing, installation, deployment, or real-device acceptance.

Preserve evidence through cleanup. Delete only temporary userData, processes, databases, and files created by this run.

## Cleanup

Playwright specs that use `apps/desktop/tests/support/owned-electron.ts` close only the Electron instance they launched. Specs using the synthetic intake host close their API, identity server, PostgreSQL cluster, and temporary directories in `finally`.

If a stack is started for `synthetic-stack.spec.ts`, give it an isolated root and destroy it by its own command:

```sh
VERIFY_ROOT="$(mktemp -d)"
CUSTOMER_AGENT_STACK_ROOT="$VERIFY_ROOT/stack" node scripts/synthetic-stack/stack.ts start
CUSTOMER_AGENT_STACK_ROOT="$VERIFY_ROOT/stack" node scripts/synthetic-stack/stack.ts destroy
```

Never stop or destroy a stack this run did not start. Never kill processes by name.

## Closeout verdict

Freeze the candidate before the run:

```sh
git rev-parse HEAD
git status --short
node -p "require('./apps/desktop/package.json').version"
```

Then apply all of these rules:

1. Every feature and entry point in the approved scope has a PASS row bound to the frozen candidate.
2. Every required environment is covered. The matrix separately reports fixture UI, synthetic real-stack, packaged app, real device, and production checks.
3. No unaccepted P0 or P1 defect remains. A user-approved exception is listed with owner and expiry.
4. The final independent verifier reviewed the same exact SHA and package hash.
5. No required contract, business, account, device, deployment, rollback, or release gate remains open.
6. The final report labels the claim as implementation complete, PR ready, installed and verified, business accepted, or released and verified. Never promote one label into another.

Any FAIL, BLOCKED, or UNOBSERVED row means the candidate is not closed. “All features are normal” is valid only for the approved scope and named environments.

## Current limits

- The repository contains two specialized verification skills for permission revocation and identity grants. This skill covers the product surface and delegates those deeper database invariants to them.
- The SOP positive transport and business flow remain gated. The current workbench can prove navigation and fail-closed behavior, not an approved end-to-end SOP release.
- macOS local-unsigned evidence does not cover signing, notarization, Gatekeeper, real Stage Manager, Dock compositor behavior, Windows installation, or Linux installation.
