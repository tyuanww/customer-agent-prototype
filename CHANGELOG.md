# Changelog

All notable changes to this customer-agent product implementation repository are documented here. Synthetic desktop and formal-development runtime states remain explicitly separated below.

## [Unreleased]

### Changed

- Corrected current API setup and contract-version documentation, and separated completed cleanup from search candidates that still fail delivery review.

- Unified the current execution entry and separated historical plans from live status; documentation checks validate links, anchors and declared workspace commands.
- Routed known documentation changes through lightweight CI checks, kept full Linux/PostgreSQL/Windows verification for runtime and unknown paths, and added an aggregate fail-closed CI gate.
- Reused builds within each verification and packaging command while retaining clean formal-candidate builds, fresh tests and artifact hash checks.

### Fixed

- Suppressed unresolved support references before candidate matching, while preserving concrete product, symptom and action queries and the existing source readiness checks.

- Unified search negation and body evidence in the API decision owner: occurrence negation requests clarification without showing results, and negative confirmation requires matching statement evidence. Mixed assertions, quoted/conditional text and different product subjects retain their boundaries.
- Replaced the historical expected-failure proof with full 23-case acceptance, product hashes and fail-closed report consumption while keeping frozen round-one inputs unchanged.

- Made Windows packaging prepare Electron distribution and license inputs before building, removing its dependency on a previous application launch or smoke run.
- Rejected contradictory release/provenance claims while preserving legitimate provenance failure reports.
- Made G1a evaluation reports use one versioned, strictly validated delivery contract shared by the producer and reader, preserving complete reports for both successful and failed evaluations.
- Required synthetic E0 CI to execute all PostgreSQL delivery cases without skips, including failure reporting and cleanup refusal.

### Added

- Landed the search candidate that judges confirmation queries and conflicting assertions after database source/release/platform/product/expiry gates, without rewriting source text (`#37`, `61afa36`).
- Added an operator-only owner package assembler that derives approved content identities, validates a fresh private five-file package, and preserves historical packages; independently anchored records and all evaluation gates remain required.

- Added test-only owner-acceptance v3 packages with independent external anchors, exact scope checks and atomic offline registration; synthetic PG15 tests cover tampering, rollback, revocation and source fences while preserving v2 behavior.

- Consumed the immutable OpenAPI 1.12.0 / schema.v1.15 owner-acceptance contract from source commit `2c75d8e7670134e6aa95a4780ff09fe0422a65e8`, generating 133 component validators without runtime activation.
- Appended atomic migration `0012_owner_acceptance_v1_15` while preserving all eleven prior migrations, with exact PostgreSQL object/ACL/role verification and expanded API search-dependency fingerprints.

## [0.2.1] - 2026-09-04

### Changed

- Clarified that Menokin is the single current customer-service pilot and the v3 synthetic implementation is its `PILOT-S0` validation stage, not a separate Demo project.
- Replaced stale Dafuyan wording and separated enterprise four-domain material availability from runtime activation, G0/Ddev, and production evidence.
- Established the `DEV-M0-W0` pre-move baseline: pinned Node 24 / pnpm 11.19.0 workspace policy, an `apps/desktop` migration target with no second runtime entry, and a frozen 50-case synthetic development contract.
- Completed the `DEV-M0-W1` mechanical move into the sole runnable package at `apps/desktop`; the repository root now owns only stable workspace commands plus contract-intake and hygiene policy.
- Pinned release version ownership to `apps/desktop/package.json`; the root workspace facade is unversioned and the tracked gstack manifest pin prevents future ship-time artifact drift.
- Added the `DEV-M0-W2` contract compiler: the locked OpenAPI snapshot now deterministically produces five tracked assets, Node-executable package output, and 132 component runtime schemas while preserving `runtime_activated=false`.
- Added the `DEV-M0-W3` local Application API bootstrap: named-profile configuration rejects unsafe or unavailable runtime modes before Fastify construction, while the only registered route is a contract-validated loopback `/health` probe.
- Added the `DEV-M0-W4` PostgreSQL 15 migration control plane: nine source-locked immutable migrations, a private provenance ledger, one-session advisory locking, per-migration atomic transactions, and exact post-apply verification remain isolated from API and desktop runtime wiring.
- Added the `DEV-M0-W5` runtime repository boundary: a private local-only PostgreSQL pool, contract-valid `/ready`, single-flight deadlines, exact runtime role/ACL/search-dependency proofs, and hard-off auth/storage/content checks remain isolated from desktop and migration-owner capabilities.
- Completed `DEV-M1` through PR #17～#20 with mock auth / policy, the controlled `SearchBackend`, transactional Search + Events, and a 50-case synthetic runner that remains `NOT_SIGNED / NOT_EVALUATED`.
- Merged the `G1A-E0` T1～T3 offline admission harness through PR #21, including fail-closed external-package validation, isolated PostgreSQL 15 execution, aggregate-only reporting, and positive/negative cleanup evidence.
- Archived the next T4 boundary as an external controlled-workspace checklist; no real data read, copy, evaluation run, runtime integration, deployment, or release activation is included.

### Fixed

- Made workspace policy checks reject runtime-version drift, canceling or duplicate package declarations, and workspace roots, members, manifests, or required targets that escape through symlinks.
- Kept Node/pnpm ownership at the workspace root, covered migrated icon lookup paths, and allowlisted only the exact legacy W0 generated icons for post-move cleanup.
- Stabilized the native close-surface E2E boundary by waiting for BrowserWindow/WebContents focus and tolerating only windows proven destroyed during concurrent snapshot readback.
- Made contract generation fail closed on source/hash drift, external references, generated bytes, or unexpected generated members; runtime validation rejects unknown request fields and returns scrubbed schema issues without echoing payload data.
- Preserved the contract-level `x-unique-by` rule, serialized intake rollover with codegen reads/writes, removed prototype-sensitive schema-key handling, bounded runtime diagnostics, and replaced eager all-schema compilation with per-schema lazy compilation.
- Prevented `demo`, deployable profiles, Feishu auth, external bind addresses, and malformed ports or build versions from silently starting the W3 service; startup diagnostics expose stable fields/reasons without reflecting environment values.
- Made W4 reject bare pools, same-session re-entry, untracked schemas/types/relations, ledger drift, unknown transaction acknowledgements, and any ACL, function-owner/config, trigger, or Phase-1 policy-key manifest drift; generated outputs now publish and roll back as two complete directories.
- Split the ordinary workspace test lane from the PostgreSQL 15 integration lane so routine UI work stays lightweight while `pnpm test:db` remains the required full database gate.
- Closed W5 review gaps by rejecting deadline-late successes, reverse runtime-login membership, arbitrary non-owner `public` schema CREATE, transitive search helper drift, and `digest` ownership outside its `pgcrypto` extension; compiled package and main-entry smoke now exercise `/ready` and graceful SIGINT.
- Reconciled the repository charter and G1a admission plan with the merged PR #21 / `main@be33c0e` product baseline and `main@6427b8f` governance baseline, removing stale local-candidate wording.

### Verification

- Node.js 24.19.0 / pnpm 11.19.0: lint, typecheck, 51 unit/component files with 506 tests, build, workspace policy, immutable contract verification, and 14/14 Electron E2E passed after the W1 move.
- Packaging path contracts passed inside the test suite; no DMG, ZIP, Windows installer, signed artifact, notarization, deployment, or release was produced for W1.
- W2 locally passed frozen install, lint, typecheck, 16 contract tests plus the compiled-package Node smoke, 508 desktop tests, build, workspace policy, immutable intake verification, and byte-for-byte codegen verification on Node.js 24.19.0 / pnpm 11.19.0.
- W2 did not rerun Electron E2E because it changes no desktop behavior or trust boundary; no database, real API, package artifact, deployment, or runtime activation was performed.
- W3 locally passed frozen install, lint, three-package typecheck, a full 535-test Vitest run plus two compiled-package Node smokes, build, workspace policy, immutable intake verification, and 132-schema byte-for-byte codegen verification on Node.js 24.19.0 / pnpm 11.19.0. The final review added API failure/shutdown boundary coverage and passed the resulting 13-test API suite plus the 23-test workspace-cleanup file without rerunning the unaffected desktop suite.
- W3 also passed an actual loopback `/health` HTTP 200 check, graceful SIGINT shutdown, and a pre-listen production/external-bind rejection. Electron E2E was not rerun because desktop code and trust boundaries remain unchanged; no DB, auth provider, business route, real data, deployment, or runtime activation exists in this slice.
- W4 locally passed Node.js 24.19.0 lint/typecheck, 18 database unit tests, compiled-package smoke, and 10 isolated PostgreSQL 15 integration tests including server-version refusal, runtime SQL non-disclosure, two-client serialization, same-client rejection, DDL/ledger rollback atomicity, exact security-manifest mutation rejection, retry, unknown COMMIT recovery, and untracked-object refusal.
- W5 review fixes passed lint, four-package typecheck, 567 Vitest tests plus 1 explicitly skipped PG15 scenario in the ordinary lane, four compiled-package/main smokes, build, workspace policy, immutable contract verification, and the explicit 18/18 API lane containing one isolated PostgreSQL 15 mutation scenario. Electron E2E was not rerun because W5 changes no desktop code or trust boundary.
- PR #21 post-merge CI run `33849888116` passed the Linux canonical, PostgreSQL 15 integration, and Windows feasibility smoke lanes; T1～T3 evidence remains synthetic and does not establish a real G1a decision.
- The 0.2.1 closeout passed lint, typecheck, 51 test files with 508 tests, 8 formal-artifact boundary tests, build, workspace policy, and deterministic contract/migration checks on Node.js 24.19.0 / pnpm 11.19.0. Real-package, Electron E2E, device, deployment, and production checks were intentionally not run because this closeout changes documentation and release metadata only.

## [0.2.0] - 2026-08-20

### Changed

- The Fox, Query, and Dashboard demo flow now has clearer module ownership while preserving the same synthetic-data behavior and renderer security boundary.
- Platform and window context are resolved through one trusted handshake, reducing startup drift across macOS, Windows, and Linux.
- Query banners and Dashboard module selection now have one layout owner, making window sizing and navigation behavior easier to change safely.
- Verification now favors fast unit/component contracts plus a small Electron native-boundary suite instead of redundant, brittle mouse-replay chains.

### Fixed

- Stage Manager checks now distinguish macOS WindowServer re-seating from application-driven movement, preventing false confidence about left-edge stability.
- Workspace cleanup now rejects unknown options and safely includes generated icon outputs while preserving source assets and configuration.
- The Dashboard is again verified against page-level horizontal overflow at 980, 1180, and 1440 pixel widths without mouse-driven E2E flakiness.

### Verification

- Node.js 24.19.0 / pnpm 11.19.0: lint, typecheck, 48 unit/component files with 427 tests, build, and a 14/14 Electron E2E run passed locally.
- The final lightweight Dashboard layout and desktop-entry suite passed 2/2 after the E2E reduction; assessed path coverage is 87% against an 80% target.
- This remains a private synthetic demo: no real customer data, backend integration, deployment, or production package release is included.

## [0.1.1] - 2026-08-18

### Added

- Documented the desktop architecture, verification lanes, failure-safe lifecycle, API adapter handoff, and extracted Query/overlay/Dashboard module contracts.
- Added unit coverage for extracted view helpers, overlay command factories, layout ACK mapping, Dashboard appearance fallbacks, and the demo test-harness boundary.

### Changed

- Extracted low-coupling Query, Dashboard, overlay-command, layout-policy, and test-harness helpers while keeping handoff, focus, bounds, and navigation state machines in their owning modules.
- Reused typed protocol factories and shared layout guards to keep renderer/main command payloads aligned.

### Fixed

- Hardened the float sleep E2E lane against late native pointer delivery so ambient sleep assertions remain deterministic without changing production hit-testing behavior.

### Verification

- Node.js 24.19.0 / pnpm 11.19.0: lint, typecheck, unit/component tests, build, and float-focused E2E were run locally for this release candidate.
- This repository is a private synthetic demo; no real customer data, external API, deployment, or production package artifact is included in this release.
