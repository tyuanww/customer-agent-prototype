# Changelog

All notable changes to this customer-agent product implementation repository are documented here. Synthetic desktop and formal-development runtime states remain explicitly separated below.

## [0.3.6] - 2026-09-19

### Fixed

- After login, a source_gate or unavailable announce drop during search shows “内容暂不可用” / “服务暂不可用” instead of a blank overlay. It still does not show “当前版本已失效”.
- Feishu login on a desk that already ACKed as the synthetic account no longer fails query. Announce `client_id` is per user. ACK 403 keeps the issued lease and still hydrates. A 304 without `x-snapshot-lease` headers keeps the local lease.
- macOS UNSIGNED 0.3.6 product-remote: fox, Feishu login, query, and copy observed. Account login and offline rows stay unobserved. Allergy SOP is optional synthetic.

### Changed

- Product search refreshes the announcement before every query so a new publish is used on the next search, not only on the next login. Dashboard wording prefers the current hydrate release over a larger local index. VOC and work orders stay synthetic.

## [0.3.5] - 2026-09-19

### Fixed

- Feishu login completes after Feishu’s user_info hop instead of failing as OVERLOADED. Token POST still refuses redirects so a 307 cannot forward the client secret. Empty or non-HTTPS final URLs fail closed. A display-name write failure cannot fail login. The request timer no longer aborts the response body after fetch returns (`AbortError 20`).

## [0.3.4] - 2026-09-18

### Changed

- Query treats only an expired announce lease as “当前版本已失效”. Login-time source_gate / unavailable no longer looks like a stale release.
- Tutorial and DESIGN distinguish the synthetic-offline first-run path from product-remote. Query session chip is specified as operator name · 退出, not RBAC role.
- After login, a previous announce lease no longer flashes “当前版本已失效”. The session chip shows the operator name (Feishu `name`, otherwise the user id), not the role.
- Feishu token exchange accepts receipts up to 32KB. A 4KB cap treated a real user_access_token JSON as `DEPENDENCY_UNAVAILABLE`.
- Account HTTPS identity origin in how-tos is `https://agent-pass.jianghua.site`. Do not overwrite hostnames already used by another tunnel.
- Feishu login opens in the system browser. The 520×420 window stays a 飞书 / 账号 chooser. With off-repo `feishu.env`, you can complete official Feishu OAuth as `owner` (or another allowlisted role); account login uses the hashed loopback password server. See `docs/how-to-feishu-and-password-mac.md`.
- Cancelling the chooser after the browser opens stops the desktop login instead of still exchanging a session.
- Desktop ProductHttp, account `/password`, and MiniMax share Electron `net.fetch` (system trust store). The login isolated session uses the same permission policy as the default session. Certificate pinning is not default. See `docs/plans/2026-09-19-p6-cert-proxy-paths.md`.
- Account login POSTs `/password` to the HTTPS identity origin and callbacks the API origin. Identity timeout is 15s. The password server still binds loopback; a second named-tunnel hostname is documented. See `docs/plans/2026-09-19-p4-account-https-tunnel.md`.
- Off-repo hydrate and BM25 files are keyed by API origin, same hash as the session file. A leftover unkeyed catalog is still used until the keyed file exists. See `docs/plans/2026-09-19-p7-origin-keyed-retrieval.md`.
- Answer embeddings use the same origin-keyed path. See `docs/plans/2026-09-19-p7-origin-keyed-embeddings.md`.
- The smart-retrieval preference file is origin-keyed and loaded after packaged retrieval defaults, not at import time. See `docs/plans/2026-09-19-p7-origin-keyed-preference.md`.
- Product mode copies a leftover unkeyed catalog into the origin-keyed path once, then writes only the keyed file. See `docs/plans/2026-09-19-p7-seed-keyed-catalog.md`.
- Retrieval CLIs write origin-keyed files when `CUSTOMER_AGENT_DESKTOP_API_ORIGIN` is set. See `docs/plans/2026-09-19-p7-cli-origin-keyed.md`.
- Dashboard wording and dense catalog reads follow origin-keyed files when env is unset. See `docs/plans/2026-09-19-p7-dashboard-origin-keyed.md`.
- Retrieval telemetry is origin-keyed (`retrieval-telemetry.<id>.json`) so two API targets do not share impression logs. See `docs/plans/2026-09-19-p7-origin-keyed-telemetry.md`.
- Hydrate, BM25, and the smart-retrieval preference load origin-keyed files at query time when the desktop API origin is set. See `docs/plans/2026-09-19-p7-runtime-origin-reads.md`.
- Login snapshot persist also writes the BM25 index from the same announce page. See `docs/plans/2026-09-19-p7-login-bm25-index.md`.
- Login fills missing answer embeddings in the background when MiniMax is configured; query uses the dense lane without blocking login. See `docs/plans/2026-09-19-p7-login-embeddings.md`.
- Query corpus loading (`loadIndexScripts`) follows origin-keyed BM25 files when env is unset. See `docs/plans/2026-09-19-p7-index-scripts-origin.md`.
- Product-remote search does not fall back to leftover `/v1/search` when a desktop API origin is set. See `docs/plans/2026-09-19-p7-origin-no-leftover-search.md`.
- Product mode publishes `CUSTOMER_AGENT_DESKTOP_API_ORIGIN` from the runtime profile when unset. See `docs/plans/2026-09-19-p7-publish-desktop-origin.md`.
- Seeding an origin-keyed catalog from a leftover unkeyed file is best-effort; a copy failure does not abort packaged startup. See `docs/plans/2026-09-19-p7-seed-copy-best-effort.md`.
- Dashboard, dense catalog, and telemetry reads do not fall back to leftover unkeyed files when the desktop API origin is set. See `docs/plans/2026-09-19-p7-runtime-no-unkeyed.md`.
- Login schedules background embeddings only after hydrate writes or already matches the snapshot, not when a smaller seed is kept out. See `docs/plans/2026-09-19-p7-embed-after-persist.md`.
- Login persist does not write a smaller BM25 index or report `wrote` when hydrate keeps a larger local catalog. See `docs/plans/2026-09-19-p7-persist-no-shrink.md`.
- Query BM25 fallback loads origin-keyed retrieval-index files instead of only `CUSTOMER_AGENT_RETRIEVAL_INDEX`. See `docs/plans/2026-09-19-p7-semantic-origin-path.md`.
- The install package still does not ship PostgreSQL or the API. A missing profile notice no longer tells the operator to install a local database. See `docs/plans/2026-09-19-p10-no-bundled-stack.md`.
- On Windows, collapsing Query yields the previous app by hiding the idle fox for one frame, then `showInactive`. It does not call `app.hide()` or `app.focus({ steal: true })`. Not a Windows device pass. See `docs/plans/2026-09-19-windows-yield-focus.md`.
- M5 lists `product-remote` as a separate re-verify table, all **未观察**. `synthetic-offline` cannot tick login / search / copy. See `docs/how-to-verify-macos-m5.md` §7.1.
- Packaged and unpackaged desktop can use a `product-remote` HTTPS origin (no IP, no public HTTP, no userinfo). The API still binds `127.0.0.1`. Session files are keyed by API origin. See `docs/how-to-p4-remote-mac.md`.
- The synthetic stack writes `synthetic-stack.json` to the Electron userData directory on Windows and Linux, not only macOS Application Support. See `docs/plans/2026-09-19-p10-desktop-userdata-path.md`.
- How-tos for stack start and product-remote packaged profile include the Windows `%APPDATA%` userData path. See `docs/plans/2026-09-19-p10-userdata-docs.md`.
- How-tos also name the Linux `~/.config` userData path. See `docs/plans/2026-09-19-p10-linux-userdata-docs.md`.
- macOS M5 notes Windows/Linux userData paths without treating them as a pass. See `docs/plans/2026-09-19-p10-m5-userdata-note.md`.
- Local unpushed branches have a merge-order note: keep the origin-keyed P7 stack, drop the earlier retrieval-delivery line. See `docs/plans/2026-09-19-local-unpushed-merge-order.md`.
- Office-machine product-remote checklist exists and stays **未观察** until a new UNSIGNED build after P4/P7 lands. See `docs/how-to-office-machine-product-remote.md`.
- macOS packaged product-remote checklist exists and stays **未观察**. See `docs/how-to-macos-packaged-product-remote.md`.
- Linux packaged product-remote checklist exists and stays **未观察**. See `docs/how-to-linux-packaged-product-remote.md`.
- Merge-order note now points at `feat/linux-packaged-remote-howto` as the P10/how-to stack tip. See `docs/plans/2026-09-19-local-unpushed-merge-order.md`.
- `pnpm package:linux` is local-unsigned, Linux-host only, and writes `release/local-unsigned/linux/`. See `docs/plans/2026-09-19-p10-package-linux-local.md`.
- Linux packaging cleans temporary CA state when a step fails. See `docs/plans/2026-09-19-p10-package-linux-ca-cleanup.md`.
- `how-to-verify-desktop` documents `pnpm package:linux` as Linux-host local-unsigned only. See `docs/plans/2026-09-19-p10-package-linux-verify-howto.md`.
- CI runs `pnpm package:linux` on Ubuntu as a feasibility smoke, not a signed release. See `docs/plans/2026-09-19-p10-linux-ci-package.md`.
- Linux CI overlay smoke runs under xvfb after packaging. See `docs/plans/2026-09-19-p10-linux-e2e-smoke.md`.
- Linux CI installs Playwright/Electron OS libraries before the xvfb overlay smoke. See `docs/plans/2026-09-19-p10-linux-e2e-deps.md`.
- CI uploads the UNSIGNED Linux AppImage as a workflow artifact, not a GitHub Release. See `docs/plans/2026-09-19-p10-linux-ci-artifact.md`.
- Merge-order note now points at `feat/p10-linux-xdg-userdata` as the Linux packaging/CI stack tip. See `docs/plans/2026-09-19-local-unpushed-merge-order.md`.
- Linux packaged profile path follows Electron userData, including `XDG_CONFIG_HOME`, and is resolved at write time. See `docs/plans/2026-09-19-p10-linux-xdg-userdata.md`.
- Merge-order note now points at `feat/p7-semantic-origin-path` `3878e4b` and `feat/merge-order-p7-linux-tips`. See `docs/plans/2026-09-19-local-unpushed-merge-order.md`.
- Linux AppImage uses ASCII `executableName` `customer-agent-desktop`. Electron-builder rejects the scoped package name.
- Linux overlay feasibility smoke does not call `capturePage` (Xvfb raises UnknownVizError). Windows still checks corner alpha.
- Merge-order note records the landed PRs on `origin/main` `58dfac4`. See `docs/plans/2026-09-19-local-unpushed-merge-order.md`.
- Feishu token exchange accepts receipts up to 32KB. A 4KB cap treated a real user_access_token JSON as DEPENDENCY_UNAVAILABLE.
- Retrieval how-tos name origin-keyed catalog files when the desktop API origin is set. See `docs/how-to-run-macos-semantic-query.md`.
- Desktop retrieval explanation states product-mode catalogs are keyed by API origin. See `docs/explanation-desktop-retrieval.md`.

## [0.3.3] - 2026-09-18

### Added

- Unpackaged product mode loads the off-repo hydrate and BM25 indexes without extra shell env.

### Changed

- Query ranks the current hydrate snapshot, or the larger local index when a seed snapshot is smaller. Login persist will not shrink a bigger hydrate.
- Login window title is 登录. Help actions are 复制联系方式 / 打开求助入口. The version ACK banner is hidden under the search box.
- Idle lease expiry stays on the announce slot instead of 查询未完成.

### Fixed

- Logging in no longer treats session teardown as a failed query.

## [0.3.2] - 2026-09-18

### Added

- Dashboard 话术库 reads the same off-repo hydrate / retrieval index as Query (prefers the larger file). Dedicated `dashboard.cjs` preload exposes only `dashboardWording.list()`.

### Changed

- Wording library no longer shows DEMO · SYNTHETIC fixture samples or NOT_CREATED for empty domains.
- Dashboard chrome disclaimer: VOC stays synthetic; the wording library is the local catalog.

## [0.3.1] - 2026-09-18

### Added

- After collapsing the query overlay, macOS returns keyboard focus to the previous app (Qianniu, Grok Build, or any other) so the agent can keep typing without clicking that window. See `docs/how-to-verify-desktop.md` D2.
- The query capsule login control is labeled 登录. Unsigned placeholder is 登录后查询话术; signed-in placeholder is 输入或粘贴客户问题，回车查询.
- Smart retrieval is a compact right-side switch with a sliding thumb, not ON/OFF text.
- Clicking the dashboard icon while unsigned starts login first, then opens the dashboard on success.

### Changed

- Capsule tools (登录, dashboard, smart retrieval) share a 28px row; the switch itself is 34×20.
- Unsigned search no longer writes a separate 请先合成登录 notice; the placeholder carries that state.

### Fixed

- Closing the overlay no longer leaves keystrokes in a hidden query field.
- Yielding focus ignores Electron DevTools windows, so `pnpm dev` with DevTools open still returns the previous app.
- `app.hide()` is skipped when Dashboard, login, or SOP is visible, so those windows are not hidden with the overlay.

## [0.3.0] - 2026-09-11

### Added

- Query overlay can take a customer sentence and retrieve original scripts via local field-weighted BM25 + RRF (pool 24), then show Top 3 for copy. It does not generate replies.
- Optional 智能检索, default on: MiniMax plans 1–3 retrieval queries and reranks existing script ids only. Timeout or error falls back to BM25.

### Changed

- After a successful copy the overlay yields focus so the agent can paste immediately; search defaults to unscoped products.
- Live script cards no longer show `DEMO · 合成数据`. Identity chrome is still synthetic login / MOCK AUTH.
- When a local hydrate snapshot is loaded, search no longer calls leftover `/v1/search`.

### Fixed

- **BACKEND-CI-503 closed.** The invalid-lease snapshot assertion (`announce.integration.test.ts:396`) failed twice in CI with 500 instead of the contract's 403. Root cause: `pg` enforces `query_timeout` on the client and, when the timer wins, raises a bare `Error('Query read timeout')` with no `code`, `detail` or `fields` — discarding the `ZA004` / `OFFLINE_LEASE_INVALID` already in flight so `announceFailure` lost its only discriminator and fell through to the `INTERNAL` mapping. Fix (PR #91): after an undetermined read, re-ask `validate_snapshot_offline_lease` on its own pooled client — invalid lease still returns the contract's 403, a confirmed-good lease returns a retryable 503, and a blind revalidation stays 503 rather than guessing. Verified by merge push run `35090745771`, whose PostgreSQL 15 job actually executed the integration lane.
- MiniMax calls go through Electron `net.fetch` so corporate TLS no longer fail-opens every smart search.
- Hydrate rows must match the copy contract (`content_hash` 64 hex, non-empty answer). Cancelled searches no longer commit. Long customer sentences stay in the MiniMax plan.
- The retrieval toggle is visually separate from 合成登录, cancels an in-flight search when flipped, and keeps the last good OFF value if the preference file is corrupt.

## [Unreleased]

- After-sale allergy SOP is a dedicated draggable window (PR #95). Query search stays Top 3; agents open「打开过敏售后流程」from the gold query. SOP copy is local feedback only, not Query `COPIED`. Slice 1 is the synthetic allergy tree.
- Coach「内容与发布」parses a local CSV into unpublished drafts (PR #96). Publish stays disabled. After-sale remains a DEMO sample and does not take this page's upload.
- Query script cards can mark「话术不准」locally (PR #97) without IPC, tickets, or copy-adopt. SOP cards do not show that control.
- Dashboard「话术优化待办」shows open P0 reminders and a session-local CAS drill (PR #98). No HTTP start/close and no Feishu push.
- Packaged `file://` login can mount the Feishu / account chooser (PR #99) by allowing nested renderer assets and stripping Vite `crossorigin`. Login and SOP use independent preloads and stay out of `trustedContents()`. Real Feishu credentials and `AUTH_MODE=feishu` without creds stay closed.
- SOP overlay polish (PRs #101–#105): hug no longer loops; the constraint banner is only on voucher / high-risk copyable steps; decision and internal steps show a sitters-facing prompt; the copy card no longer looks like Query rank 1; Query says「继续过敏售后流程」when progress is remembered, and「结束并清除进度」destroys the window.
- Coach upload polish (PRs #106, #108): fail-close names the sheet row and the 50-row / 64KiB caps; picking a file shows「正在读取」; the picker copy says binary xlsx fail-closes.
- Query「话术不准」stays for the overlay session (PR #107) until collapse. Still no IPC or tickets.
- Dashboard P0 reminder stays visible when no open P0 remain (PR #109), and「重置演练」is disabled until the in-memory drill changes.
- Packaged S0 is explicit: `{ "mode": "synthetic-offline" }` only (PR #111). extraResources can seed an empty userData file and never overwrite `synthetic-local` (PR #112). Windows/mac package gates require that exact document (PR #113).
- `package:mac:local` extracts Electron dist before copying license extraResources (PR #114). Local unsigned Windows extraResources proof is recorded (PR #115). Office-machine first-round checklist is in `docs/how-to-office-machine-first-round.md` (PR #116).
- Health Stack includes `shellcheck apps/desktop/scripts/generate-mac-icon.sh` (PR #117). The script quotes empty `CDPATH` (PR #118).

- Logged the 2026-09-16 desktop delivery-shape review at `docs/plans/2026-09-16-desktop-delivery-shape-review.md`: a read-only re-check of whether a packaged Windows build is usable on the office machine, which reverses several earlier assumptions. This is a review record, not a Windows implementation, install acceptance, or approval to start the phase, and it does not move the loopback red line.
- Added an Open section (P1–P10) to `TODOS.md` for that review's follow-ups, without re-opening any Completed entry. Each Open item carries its own status and needs its own authorization. P10 records the still-unsolved part: the installer ships only the desktop output and assets, so the API, worker, synthetic identity, PostgreSQL 15, and the off-repo index still have to be prepared on the target machine — this is not "no external dependencies".
- Corrected the Windows DRAFT plan where it contradicted the startup code: the plan said a packaged build without a topology starts on the S0 synthetic fixture and can still verify the overlay, but `product-runtime-config.ts` throws on a missing, invalid, or unreadable `synthetic-stack.json` and `main.ts` quits — there is no S0 middle state. The plan now states the app does not start. Documentation only: the plan stays DRAFT and no `package:win`, install, signing, notarization, or deploy was performed.
- Gave that packaged configuration failure a visible notice, a retry entry point, and split causes. `product-runtime-config.ts` now distinguishes a missing file (`ENOENT`) from an unreadable one (present but not readable — an untraversable profile directory, or a file whose open fails with `EACCES`/`EPERM`/`EBUSY`) from a rejected one, instead of reporting every `lstatSync` failure as "missing" and sending the operator after the wrong problem. Reading is a step of its own, so a file that exists and stats cleanly but cannot be opened is reported as unreadable rather than as a file that failed a validation which never ran. `startup-failure-notice.ts` maps each kind to its own message through `dialog.showMessageBoxSync` and offers 重试 only where the operator can actually act on it — missing and unreadable offer 重试 (`app.relaunch()`) alongside 退出, while a rejected profile and an unrecognized error offer 退出 alone, because retrying those would land in the same state. Fail-closed startup is unchanged — the app still refuses to run and never falls back to the offline fixture. **Verified on a real packaged `.app`:** a missing profile and a profile pointing at a non-loopback host each produced the expected native dialog with the expected text and buttons, the process blocks on it instead of exiting unseen, and a press on the default 重试 button took the `app.relaunch()` path — the original process spawned a relaunch child, quit, and a fresh instance came up and showed the dialog again. Still not verified: an `unreadable` profile on a real artifact (reproducing it needs an untraversable profile directory, which breaks the rest of Electron's userData handling), and the Windows `.exe` path.
- Prepared (not started) the Windows installer phase: pinned the Electron 43.4.0 platform floor to Windows 10 and up, and wrote down the current NSIS install/upgrade/uninstall boundaries, the fact that the desktop app has no file-logging facility (stack logs come from `stack.ts` stdio redirects, not the app), and the Chinese-named userData path as a device-verification risk. The plan stays DRAFT and unapproved; no `package:win`, install, signing, notarization, deploy, or external distribution was performed.
- Added a preparation-only contract for the real MENOKIN SKU swap: input format restricted to `sku_id` / `sku_label` / `answer_text` with orders, employees, couriers, and customer utterances refused, plus validation and a rollback plan to `rel_17`. It records that the swap is not data-only — `query-route.ts` matches `SYNTHETIC_CATALOG` labels, so the in-repo catalog must change under separate code authorization. No real SKU input was approved or loaded.
- Read-only diagnosis of BACKEND-CI-503: the failing assertion is `announce.integration.test.ts:396` (`/v1/announce/snapshot` with an unknown lease expecting 403, getting 500), the same assertion PR #79 already fixed once but which recurred on 2026-09-15 and 2026-09-16. Also recorded that docs-scope pushes skip the entire PostgreSQL 15 integration step, so recent five-job green runs are not regression evidence. The item stays OPEN; nothing was fixed or closed.
- Reproduced the BACKEND-CI-503 root cause on a throwaway local PostgreSQL 15 cluster (no TCP, isolated socket, removed afterwards; the synthetic stack was only read via `status`). node-pg's `query_timeout` raises a plain `Error` with no `code`, `detail`, or `fields`, which strips `announceFailure` of its only ZA004 discriminator and falls through to the `INTERNAL` mapping — 500 instead of 403. `mapDatabaseContractError` also returns `INTERNAL` for ZA004 itself, so the 403 path has a single line of defence. Still not fixed; the item remains OPEN.

- Packaged unsigned macOS app loads the known off-repo hydrate and BM25 index when those files exist, so synthetic login search does not depend on a developer shell. Leftover `/v1/search` is not the packaged main chain in that case. This is not a signed or distributable build.
- Recorded 2026-09-16 macOS M5 human observations: session expiry copy passed (later flipped to unsigned), M4 UNSIGNED query and copy passed, STALE copy failed with「内容已变化，请重新查询」. Login-window cancel remains unobserved (Command+W hid Query; returning showed login success) and is deferred. This is not M5 acceptance.

- Recorded product PRs #80–#85 on the execution list and retrieval docs: off-repo `questions[]`, answer embeddings, hydrate alignment, query-route/non-activating palette, and 2026-09-15 M5 overlay observations. The #80 merge-commit PostgreSQL 15 job failed (announce 500 vs 403); #81–#85 merge-commit checks were green. This is not M5 acceptance, not BACKEND-CI-503 closed, not Windows start, and not a real SKU load.

- Recorded 2026-09-15 macOS M5 human observations on the development overlay in `docs/how-to-verify-macos-m5.md`. This is not M5 acceptance.

- Added off-repo Doc2Query ingest (`pnpm retrieval:questions`) that writes customer-spoken `questions[]` into the local BM25 index from title and shortcut question only. Script bodies stay off MiniMax; the index file is refused if it sits inside the git worktree.
- Replaced the hybrid second lane with off-repo MiniMax `embo-01` answer embeddings (`pnpm retrieval:embeddings`). Vectors bind `sha256(answerText)`. Query embed failure or hash mismatch falls back to BM25(answer).
- Auto-aligns the off-repo hydrate snapshot to the current announce release on synthetic login (`pnpm retrieval:hydrate` for a manual dump). Empty snapshots do not overwrite. Search reloads the file instead of staying STALE on a previous `releaseId`.
- Query overlay follows the Spotlight/Raycast panel model on macOS: Query is a non-activating panel, opening does not steal app activation, and dismiss hides Query only so the idle fox and help window stay visible. Windows/Linux Query is still a normal always-on-top window and uses `app.focus()` without steal.
- Query no longer asks the agent to pick platform, category, or SKU. MiniMax plan `intent` routes storewide / campaign / product mentions; default is storewide, not an unscoped scan of every SKU.
- Local retrieval abstains instead of forcing Top 3: query bigrams must hit title/questions (not answer body) and RRF must beat a one-lane rank-20 score. Leftover `judgeSearch` is unchanged.
- Desktop retrieval writes an off-repo impression ledger (no query text) and `pnpm retrieval:never-hit` reports catalog scripts never shown or shown but never copied. Hydrate search still does not call leftover `/v1/search`.
- Recorded D0–D5 closeout status, user-reported synthetic observation boundaries, and a DRAFT Windows installer/device-verification plan. This is documentation only: not a Windows implementation, install acceptance, or deployment.
- Recorded the backend identity and content closed-loop implementation plan, including T1–T6 order and remaining DRAFT contract boundaries. No DEV-M2 start, runtime activation, or contract freeze is implied.
- Added an offline same-session keyword comparison with pinned historical ranking, independently bound report consumption, and synthetic PostgreSQL verification. No real admission or runtime activation is implied.


### Changed

- Corrected current API setup and contract-version documentation, and separated completed cleanup from search candidates that still fail delivery review.

- Unified the current execution entry and separated historical plans from live status; documentation checks validate links, anchors and declared workspace commands.
- Routed known documentation changes through lightweight CI checks, kept full Linux/PostgreSQL/Windows verification for runtime and unknown paths, and added an aggregate fail-closed CI gate.
- Reused builds within each verification and packaging command while retaining clean formal-candidate builds, fresh tests and artifact hash checks.

### Fixed

- Kept announce invalid-lease denials at 403 when the denial audit can be written: snapshot/current now release the request client before opening the audit connection, destroy broken pooled clients, retry a failed audit BEGIN once, retry a snapshot read once after a connection or query-timeout error, keep ZA004 even when a driver `cause` has no SQLSTATE, and stop rewriting connection errors as `OFFLINE_LEASE_INVALID`. Unaudited denials still fail closed as 503.
- Stopped the runtime pool late-connect guard from destroying idle clients older than `connectionTimeoutMs`, so checkout reuse is no longer treated as a hung connect.
- Printed G1A E0 failing test names before deleting the CI JSON report, and isolated that job's temporary PostgreSQL roots from leftover `/tmp` directories.

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
