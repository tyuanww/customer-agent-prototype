# Changelog

All notable changes to this private synthetic Electron demo are documented here.

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
