# QRY-01 decision log

## Ownership

- `release-snapshot.ts` is the only `ReleaseStore` owner. It validates the ARC `ReleaseSnapshot`, preserves its `releaseId`, and returns a frozen read-only value. It does not allocate release IDs or mutate current-release state.
- `content-pipeline.ts` is the only ordinary content recall/fusion/admission/hydration owner. It consumes `@customer-agent/retrieval-core` and builds one release-scoped BM25 index at explicit activation. Query calls reuse the prepared postings and document statistics.
- `query-coordinator.ts` is the only access/release/route dispatcher. It resolves and validates access before reading the release, checks release identity and lease expiry before ranking, filters candidate scope before BM25 scoring, and maps pipeline misses to the ARC query outcome union.
- `product-search.ts` remains the existing synthetic/local adapter and was not rewritten. `retrieval-content-adapter.ts` is the connected-profile typed seam; it accepts ARC outcomes, rejects SOP, stores copy bodies behind opaque handles, and has no fixture fallback.

## Rejected approach

The first shape considered let the connected profile keep the existing local candidate type and copy fields while calling the coordinator beside it. That would create two result unions, two provenance paths, and a fixture fallback after connected failure. It was rejected.

## Query-path rules

- Access denial and expiry stop before release lookup and ranking.
- Release mismatch and release-lease expiry stop before ranking.
- Candidate scope is filtered before `rankBm25`; a prepared index view may omit documents but never rebuilds term statistics.
- Body-only matches are weak hits and do not pass admission.
- Only a content pipeline success produces the ARC `content` branch. The coordinator owns `no-hit` and `failure`.
- Optional enrichment is scheduled after the deterministic result and receives an abort signal bounded to at most 5 seconds. Its completion cannot mutate the returned result.
- Telemetry contains query ID, release ID, outcome kind, failure code, and candidate IDs/ranks. It excludes question and answer text.

## Verification record

- Red phase: missing query modules caused the initial focused suites to fail. The tests were added before implementation.
- Focused green phase: API query suite 15/15; desktop connected adapter 5/5.
- Existing affected suites: API search service 20/20, event repository 4/4, search/event routes 16/16; desktop ProductSearch/IPC/view-model/retrieval/telemetry 56/56; retrieval-core 9 unit + package smoke; unified contracts 24 + package smoke.
- Full gate: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm check:architecture`, `pnpm workspace:check`, and `git diff --check` passed. Full API test totals were 782 passed / 584 environment-gated skips; desktop was 1,759 passed / 11 skips; root workflow was 215 passed / 5 skips.
- Benchmark: Node `v24.19.0`, pnpm `11.19.0`, Apple M5 arm64, macOS `25.5.0`, 20 warmups and 200 measured interleaved observations per scale, warm state, synthetic Chinese rows.
  - 152 rows: warm ordinary query p50/p95/p99 `0.532/0.742/1.950 ms`; in-process ranking `0.527/0.699/1.533 ms`; one activation, zero query-path rebuilds, 0 errors.
  - 5,000 rows: warm ordinary query p50/p95/p99 `19.345/30.249/33.841 ms`; in-process ranking `18.961/30.211/32.366 ms`; one activation, zero query-path rebuilds, 0 errors.
  - Limiter: single-process Node.js CPU; the measured path has no network, database, dense model, or external model work, and BM25 scoring scans the eligible document view.

## Integration actions

- INT-WORKSPACE: add workspace dependencies for `@customer-agent/unified-contracts` to API/Desktop and `@customer-agent/retrieval-core` to API, then refresh the lockfile once. This branch intentionally does not edit manifests or `pnpm-lock.yaml`.
- ACL-01: inject one actor-bound `QueryAccessEvaluator` returning ARC `AccessDecision`; do not project admin/account fields into Query.
- INT-API: on publish/release activation, build the ARC content projection identity and call `ContentPipeline.activate`; compose one `QueryCoordinator` with `createReleaseStore`, content/SOP pipelines, and OBS telemetry. Wire the frozen HTTP adapter or new route at that composition boundary.
- INT-DESKTOP: instantiate `ProductContentAdapter` only for connected profiles with a `ConnectedQueryClient`; extend typed IPC for ARC outcomes and handle-only copy. Keep the current S0 path unchanged.
- SOP-01: implement `SopPipeline.matches/query`; do not add another outward outcome union.
- OBS-01: consume `QueryTelemetryEvent`; keep question and answer text out of this event.

## Delivery blocker

- On 2026-11-05, commit creation completed locally. HTTPS and SSH GitHub delivery both ended with connection resets during the TLS/SSH handshake, and the configured `gh` keyring token is invalid. The GitHub connector transport was also unavailable. No remote branch or PR is claimed; the exact local head is reported at handoff.
