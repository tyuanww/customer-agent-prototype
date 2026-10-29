/**
 * Asks the stack database whether a password binding resolves to a controlled post.
 *
 * The identity process is the only thing that sees the password. The database
 * is the only thing that knows whether the binding, principal, post and role
 * still agree. A missing profile or failed query is a no.
 */
import { Client } from 'pg';
import { readProfile } from './profile.ts';

export async function passwordBindingAllowedFromStack(bindingId: string): Promise<boolean> {
  const profile = readProfile();
  if (!profile) return false;
  const client = new Client({
    host: profile.pgSocketDirectory,
    port: profile.pgPort,
    user: 'stack_intake_business',
    database: profile.databaseName,
  });
  try {
    await client.connect();
    await client.query('SET ROLE intake_business');
    const found = await client.query(
      'SELECT content_intake.password_login_allowed($1) AS allowed',
      [bindingId],
    );
    return found.rows[0]?.allowed === true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}
