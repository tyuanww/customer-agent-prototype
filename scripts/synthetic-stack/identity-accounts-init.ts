#!/usr/bin/env node
/**
 * Creates the local identity accounts file with a RANDOM password each time.
 *
 * This replaces the old fallback that quietly seeded every synthetic subject with the
 * literal password `synthetic-password` — including `synthetic_owner`. That fallback
 * is why the public endpoint used to hand out an owner session. There is no default
 * password anywhere in this repository now; the password is printed once, here, and
 * only its scrypt hash is stored.
 *
 *   pnpm identity:accounts:init              # refuses to overwrite an existing file
 *   pnpm identity:accounts:init --force      # regenerate (invalidates old accounts)
 *
 * The file lands next to the stack's other state (CUSTOMER_AGENT_STACK_ROOT, default
 * ~/.customer-agent-synthetic-stack/password-accounts.json).
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { STACK_ROOT, SYNTHETIC_IDENTITIES } from './profile.ts';
import { buildAccount } from './identity-admission.ts';

const ACCOUNTS_FILE = path.join(STACK_ROOT, 'password-accounts.json');

function main(argv: readonly string[]): number {
  const force = argv.includes('--force');
  if (existsSync(ACCOUNTS_FILE) && !force) {
    process.stderr.write(
      `refusing to overwrite an existing accounts file: ${ACCOUNTS_FILE}\n`
      + 'Pass --force to regenerate it (every existing account password stops working).\n',
    );
    return 2;
  }

  const password = randomBytes(18).toString('base64url');
  const rows = SYNTHETIC_IDENTITIES.map((identity) => {
    const account = buildAccount(identity.bindingId, identity.bindingId, password);
    return Object.freeze({
      username: account.username,
      bindingId: account.bindingId,
      salt: account.salt,
      hash: account.hash,
      role: identity.role,
      label: identity.label,
    });
  });

  mkdirSync(STACK_ROOT, { recursive: true, mode: 0o700 });
  writeFileSync(ACCOUNTS_FILE, `${JSON.stringify(rows, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });

  process.stdout.write(
    `wrote ${String(rows.length)} accounts to ${ACCOUNTS_FILE}\n`
    + `file mode 0600; only a scrypt hash is stored, the password below is not saved anywhere.\n\n`
    + `  username / password (same for every subject listed):\n`
    + `    ${password}\n\n`
    + `  subjects: ${rows.map((row) => `${row.bindingId} (${row.role})`).join(', ')}\n`,
  );
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  process.exitCode = main(process.argv.slice(2));
}
