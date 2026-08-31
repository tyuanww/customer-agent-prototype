# Changelog

All notable changes to this private synthetic Electron demo are documented here.

## [Unreleased]

### Changed

- Clarified that Menokin is the single current customer-service pilot and the v3 synthetic implementation is its `PILOT-S0` validation stage, not a separate Demo project.
- Replaced stale Dafuyan wording and separated enterprise four-domain material availability from runtime activation, G0/Ddev, and production evidence.
- Established the `DEV-M0-W0` pre-move baseline: pinned Node 24 / pnpm 11.19.0 workspace policy, an `apps/desktop` migration target with no second runtime entry, and a frozen 50-case synthetic development contract.
- Completed the `DEV-M0-W1` mechanical move into the sole runnable package at `apps/desktop`; the repository root now owns only stable workspace commands plus contract-intake and hygiene policy.
- Pinned release version ownership to `apps/desktop/package.json`; the root workspace facade is unversioned and the tracked gstack manifest pin prevents future ship-time artifact drift.

### Fixed

- Made workspace policy checks reject runtime-version drift, canceling or duplicate package declarations, and workspace roots, members, manifests, or required targets that escape through symlinks.
- Kept Node/pnpm ownership at the workspace root, covered migrated icon lookup paths, and allowlisted only the exact legacy W0 generated icons for post-move cleanup.
- Stabilized the native close-surface E2E boundary by waiting for BrowserWindow/WebContents focus and tolerating only windows proven destroyed during concurrent snapshot readback.

### Verification

- Node.js 24.19.0 / pnpm 11.19.0: lint, typecheck, 51 unit/component files with 506 tests, build, workspace policy, immutable contract verification, and 14/14 Electron E2E passed after the W1 move.
- Packaging path contracts passed inside the test suite; no DMG, ZIP, Windows installer, signed artifact, notarization, deployment, or release was produced for W1.

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
