/**
 * Asks the stack database whether a seat binding is enabled.
 *
 * The identity process is the only thing that sees the password. The database
 * is the only thing that knows a disable. A missing profile or a failed query
 * is a no, so a seat cannot log in because the check could not be made.
 */
import { Client } from 'pg';
import { readProfile } from './profile.ts';

export async function seatBindingEnabledFromStack(bindingId: string): Promise<boolean> {
  const profile = readProfile();
  if (!profile) return false;
  const client = new Client({
    host: profile.pgSocketDirectory,
    port: profile.pgPort,
    user: 'stack_owner',
    database: profile.databaseName,
  });
  try {
    await client.connect();
    const found = await client.query(
      `SELECT 1 FROM backend_identity.subject_bindings
        WHERE binding_id = $1 AND provider = 'synthetic' AND enabled`,
      [bindingId],
    );
    return (found.rowCount ?? 0) > 0;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}
