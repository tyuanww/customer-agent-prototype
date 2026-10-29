---
name: verify-manual-identity-grants
description: Verify the PostgreSQL identity boundary where password and Feishu login never create or revive business grants, disabled candidates stay disabled, and only the sole production-admin principal can use the configured master post.
---

# Verify manual identity grants

Run this after changing identity admission, roster projection, password login,
production-admin configuration, grants, or migration 0077.

## Properties

1. Password possession and repeated Feishu fallback create zero business grants.
2. A disabled or explicitly departed Feishu candidate cannot be re-enabled by a
   later login whose directory lookup fails.
3. A revoked manual query grant remains revoked after re-login.
4. Only one enabled `production-admin` principal with a synthetic owner binding
   can configure and use `job-master-account`; ordinary candidates cannot
   allocate or delegate authority.
5. `backend_identity.configure_production_admin_post` is callable by the
   database owner only, while `backend_identity.set_operator_display_name` is
   callable only through `app_backend_auth`.
6. A verified binding can create its first display row. Later name changes do
   not change an existing account role or active state. Only the authorized
   directory reads names; query authorization does not require name access.

7. A linked Feishu departure disables the actual bound principal, rejects other
   application homes, and never revokes an unrelated derived identity.
8. Legacy grant retirement requires historical provenance beyond a human-entered
   reason; matching manual reasons alone preserve grants.
9. Concurrent fallback and password renewal cannot undo a departure. Expired
   enabled password facts may renew; disabled facts may not.
10. Verified directory promotion changes only candidate classification and facts;
    stable identity keys and direct capability restrictions remain intact.

## Run

Use Node.js 24 and PostgreSQL 15:

```sh
PATH=/Users/hutou/homebrew/opt/node@24/bin:$PATH \
CUSTOMER_AGENT_PG15_BIN=/Users/hutou/homebrew/opt/postgresql@15/bin \
CUSTOMER_AGENT_API_PG15_INTEGRATION=1 \
pnpm --filter @customer-agent/api exec vitest run \
  tests/manual-identity-grants.integration.test.ts \
  tests/manual-identity-property.test.ts \
  tests/project-roster-login.integration.test.ts \
  tests/roster-authority.integration.test.ts \
  tests/a6-permission-e2e.integration.test.ts \
  tests/p0-live-lanes.integration.test.ts \
  tests/feishu-login-link.integration.test.ts
```

The tests use the checked-in migration catalogue. Do not apply an overlay a
second time after `applyDatabaseMigrations`; a SQL change requires regenerating
0077 before running this command.

## Coverage

`manual-identity-property.test.ts` exhausts every two-action transition sequence
through depth six over candidate login and disable. The integration files cover
the password/session chain, exact open-id binding, 24-hour fact renewal, explicit
departure, manual grant/revoke, legacy grant retirement, capability ACLs, and
the auth callback's database name projection.

The checks cover PostgreSQL behavior and the TypeScript auth boundary. They do
not cover real Feishu network responses, operator UI rendering, production
credentials, deployment, or an actual macOS/Windows install.

## Keep it current

When 0077 or its tests change, regenerate the migration and pins, rerun the
command, and record the tested source hashes with the result. A matching Git
base alone does not identify an uncommitted candidate.

## Source provenance

The worktree base is `4635ef01581877edfd17b3763b7de66e4a60393c`.
Migration 0077 and these checks are uncommitted candidate changes; that base
does not contain or prove the candidate implementation.

Read the current SQL hash from `packages/database/migrations/manifest.generated.json`
and the expected PostgreSQL function/ACL pins from `packages/database/src/verifier.ts`.
The per-run report must bind those files and the overlay by SHA-256; this skill
does not maintain a second copy of mutable candidate fingerprints.

Per-run source hashes, environment, command, results and limitations belong in
the private `identity-final*` evidence under
`/Users/hutou/.codex/warehouse-remediation/2026-10-29/`.
This is bounded state-sequence verification plus integration testing, not an
unbounded formal proof or production acceptance.
