import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from 'pg';
import { isSeatAccountIntent, type SeatAccountIntent, type SeatAccountReply } from '../../apps/desktop/src/shared/seat-account-intent.ts';
import { createPasswordAccountFile } from './password-account-file.ts';
import { DATABASE_NAME, PG_PORT, PG_SOCKET_DIRECTORY, STACK_ROOT } from './profile.ts';
import { runSeatCommand } from './seat-account-command.ts';
import { createSubjectBindingPeople, type Sql } from './subject-binding-people.ts';

const NOT_SAVED: SeatAccountReply = { ok: false, message: '账号没有保存。' };
const INVALID: SeatAccountReply = { ok: false, message: '账号输入无效。' };

function clientSql(client: Client): Sql {
  return {
    async query(text, values) {
      const result = await client.query<Record<string, unknown>>(text, values);
      return { rowCount: result.rowCount, rows: result.rows };
    },
  };
}

export async function executeSeatIntent(intent: unknown): Promise<SeatAccountReply> {
  if (!isSeatAccountIntent(intent)) return INVALID;
  return saveSeatIntent(intent);
}

async function saveSeatIntent(intent: SeatAccountIntent): Promise<SeatAccountReply> {
  const client = new Client({ host: PG_SOCKET_DIRECTORY, port: PG_PORT, user: 'stack_owner', database: DATABASE_NAME });
  await client.connect();
  try {
    return await runSeatCommand(
      createSubjectBindingPeople(clientSql(client)),
      createPasswordAccountFile(path.join(STACK_ROOT, 'password-accounts.json')),
      intent,
    );
  } finally {
    await client.end();
  }
}

function failureCode(error: unknown): string {
  if (!error || typeof error !== 'object' || !('code' in error)) return 'unknown';
  return typeof error.code === 'string' ? error.code : 'unknown';
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<void> {
  let intent: unknown;
  try {
    intent = JSON.parse(await readStdin());
  } catch {
    process.stdout.write(JSON.stringify(INVALID));
    return;
  }
  try {
    process.stdout.write(JSON.stringify(await executeSeatIntent(intent)));
  } catch (error) {
    console.error(`seat account command failed: ${failureCode(error)}`);
    process.stdout.write(JSON.stringify(NOT_SAVED));
  }
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(path.resolve(entry)).href) {
  main().catch((error: unknown) => {
    console.error(`seat account command failed: ${failureCode(error)}`);
    process.stdout.write(JSON.stringify(NOT_SAVED));
    process.exitCode = 1;
  });
}
