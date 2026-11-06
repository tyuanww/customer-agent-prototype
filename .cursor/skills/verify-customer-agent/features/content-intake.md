# Content intake

An authorized operator uploads a synthetic CSV or XLSX, sees row-level validation, saves a complete error report, corrects the batch, confirms its source, records every required quality decision, and publishes through the native confirmation. An ordinary seat then queries and copies the published text. Revocation prevents further search and copy.

## Sub-features

- `intake-upload`: native file selection and actual multipart upload.
- `intake-reject`: invalid rows keep the batch out of review and produce a readable error report.
- `intake-correct`: a corrected batch reaches the ready state.
- `intake-revise`: revision creates a new candidate version and invalidates the old ready version.
- `intake-source`: source confirmation records the operator-provided evidence.
- `intake-quality`: all required manual quality decisions are captured before publication.
- `intake-publish`: native confirmation publishes exactly one direct-v1 release.
- `intake-cancel`: cancelling a separate candidate leaves the live release unchanged.
- `intake-consume`: an ordinary seat finds, displays, and copies the published text.
- `intake-revoke`: revoked scope removes results and prevents clipboard mutation.

## How to get to it (user POV)

- Sign in with a seeded synthetic operator.
- Open Dashboard and choose `资料审核`.
- Choose `上传资料`, select a CSV or XLSX file, confirm contributors, and upload.
- Complete source confirmation and human quality checks.
- Choose `发布整批资料` and accept the native confirmation.
- Sign in as an ordinary synthetic seat, select an authorized shop, query, and copy.

## Driving it with verify-customer-agent

Preconditions:

- Use Node.js 24, pnpm 11.19.0, PostgreSQL 15, and `CUSTOMER_AGENT_INTAKE_SYNTHETIC_E2E=1`.
- Use only `createIntakeSyntheticWorkbook` or `createIntakeSyntheticCsv` fixtures.
- Allocate a new temporary userData directory and let the synthetic host own its API, identity, and PostgreSQL processes.

- **XLSX complete chain.** Run `CUSTOMER_AGENT_INTAKE_SYNTHETIC_E2E=1 pnpm --filter @customer-agent/desktop exec playwright test tests/e2e/content-intake-real-stack.spec.ts`. PASS requires the invalid batch to publish zero releases, a real saved error report, revision-to-version-2 behavior, one direct-v1 publication, cancellation without withdrawing live content, ordinary-seat copy, revocation failure with unchanged clipboard, and zero approval rows.
- **CSV complete chain.** Run `CUSTOMER_AGENT_INTAKE_SYNTHETIC_E2E=1 CUSTOMER_AGENT_INTAKE_INPUT_FORMAT=csv pnpm --filter @customer-agent/desktop exec playwright test tests/e2e/content-intake-real-stack.spec.ts`. PASS has the CSV record/column coordinates and the same publication/consumer/revocation outcomes. Do not use XLSX results as CSV proof.
- **Full intake suite.** Run `CUSTOMER_AGENT_PG15_BIN="${CUSTOMER_AGENT_PG15_BIN:-$(brew --prefix postgresql@15)/bin}" pnpm test:intake:desktop`. Use this for closeout when upload, permissions, workspace, rollback, shops, Settings accounts, and cross-window logout are all in scope.
- **Proof.** Preserve `.gstack/intake-synthetic/<timestamp>/` and the Playwright transcript. The result must include the release ID, exact answer text copied, publication count, approval count, request paths, and owned-resource cleanup.

## Gotchas

- Native file and confirmation responses are controlled by the spec. This proves the Main-owned boundary with exact inputs, not a human click in the operating-system dialog.
- The batch can contain only synthetic content. Real exported workbooks and images are outside this check.
- A successful upload is not a publication. Require the release ID and downstream ordinary-seat readback.
- The revocation result must compare the clipboard before and after copy. A visible error with a mutated clipboard still fails.
- An interrupted spec must be cleaned through its owned host. Do not kill all Node or PostgreSQL processes by name.
