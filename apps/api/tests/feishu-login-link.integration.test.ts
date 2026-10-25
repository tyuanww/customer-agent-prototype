import { createHash } from 'node:crypto';
import type { Client } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Pg15Harness } from '@customer-agent/database/testkit';
import type { ProductAuthService } from '../src/auth-service.js';
import { feishuUserId } from '../src/feishu-admit.js';
import { attachFeishuLogin } from '../src/feishu-login-link.js';
import { forgetJobSnapshot, rememberJobSnapshot } from '../src/feishu-job-snapshot.js';
import { createProductAuthService } from '../src/product-auth-service.js';
import { projectRosterLogin, rosterPrincipalId } from '../src/project-roster-login.js';
import { seedLibrary } from './support/roster-library.js';

const enabled = process.env.CUSTOMER_AGENT_API_PG15_INTEGRATION === '1';
const seat = 'ou_rosterseat01';
const linked = 'ou_linkedseat1';

type GrantRow = Readonly<{
  grant_id: string;
  issuer_id: string;
  recipient_id: string;
  action: string;
  revoked_at: string | null;
  version: string;
}>;

type PrincipalRow = Readonly<{ principal_id: string; user_id: string }>;
type LinkRow = Readonly<{ open_id: string; binding_id: string }>;

async function grantRows(client: Client): Promise<GrantRow[]> {
  const found = await client.query<{
    grant_id: string;
    issuer_id: string;
    recipient_id: string;
    action: string;
    revoked_at: Date | null;
    version: string;
  }>(`SELECT grant_id, issuer_id, recipient_id, action, revoked_at, version::text AS version
      FROM content_intake.grants ORDER BY grant_id`);
  return found.rows.map((row) => ({
    grant_id: row.grant_id,
    issuer_id: row.issuer_id,
    recipient_id: row.recipient_id,
    action: row.action,
    revoked_at: row.revoked_at?.toISOString() ?? null,
    version: row.version,
  }));
}

async function principalRows(client: Client): Promise<PrincipalRow[]> {
  const found = await client.query<PrincipalRow>(
    'SELECT principal_id, user_id FROM content_intake.principals ORDER BY principal_id',
  );
  return found.rows;
}

async function linkRows(client: Client): Promise<LinkRow[]> {
  const found = await client.query<LinkRow>(
    'SELECT open_id, binding_id FROM backend_identity.feishu_login_links ORDER BY open_id',
  );
  return found.rows;
}

async function revokePublish(client: Client): Promise<void> {
  await client.query(`UPDATE content_intake.grants
    SET version = version + 1, last_change_reason = '撤销。', revoked_at = clock_timestamp()
    WHERE grant_id = 'root-publish'`);
}

async function attach(client: Client, openId: string, principalId: string) {
  await client.query('BEGIN');
  try {
    await client.query('SET LOCAL ROLE intake_business');
    const status = await attachFeishuLogin(client, { openId, principalId });
    await client.query('COMMIT');
    return status;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

function openAuth(
  harness: Pg15Harness,
  databaseName: string,
  client: Client,
  afterLogin: (openId: string) => Promise<void>,
  afterPasswordLogin: (bindingId: string) => Promise<void>,
): Promise<ProductAuthService> {
  return client.query('CREATE ROLE synthetic_intake_auth LOGIN NOINHERIT')
    .then(() => client.query('GRANT app_backend_auth TO synthetic_intake_auth'))
    .then(() => createProductAuthService(
      {
        connectionString: `postgresql://synthetic_intake_auth@localhost/${databaseName}?${new URLSearchParams({
          host: harness.socket,
          port: String(harness.port),
        })}`,
        poolMax: 2,
        connectionTimeoutMs: 2_000,
        readinessTimeoutMs: 3_000,
      },
      {
        authorizeUrl: (state) => `http://127.0.0.1:45000/authorize?state=${state}`,
        exchange: async (code) => code,
        close: () => undefined,
      },
      'mock',
      afterLogin,
      afterPasswordLogin,
    ));
}

async function signIn(auth: ProductAuthService, code: string) {
  const verifier = 'v'.repeat(43);
  const login = await auth.createLogin(createHash('sha256').update(verifier).digest('base64url'));
  const state = new URL(login.authorize_url).searchParams.get('state');
  if (!state) throw new Error('login state missing');
  await auth.callback(state, code);
  const session = await auth.exchange(login.login_id, verifier);
  if (!session) throw new Error('session missing');
  const user = await auth.authenticate({ authorization: `Bearer ${session.access_token}` });
  if (!user) throw new Error('user missing');
  return user;
}

describe.skipIf(!enabled)('one Feishu open id shares an existing principal', () => {
  let harness: Pg15Harness;
  beforeEach(() => { harness = new Pg15Harness(); harness.start(); }, 120_000);
  afterEach(() => {
    forgetJobSnapshot(seat);
    forgetJobSnapshot(linked);
    harness.stop();
  });

  it('logs the same open id twice without a second principal', async () => {
    const database = harness.createDatabase('feishu_twice');
    const client = await harness.connect(database.config);
    const feishu: string[] = [];
    const projected: string[] = [];
    let auth: ProductAuthService | undefined;
    try {
      await seedLibrary(client);
      await revokePublish(client);
      const beforeGrants = await grantRows(client);
      rememberJobSnapshot(seat, { title: '客服坐席', directory: [{ name: '客服坐席', enabled: true }], departmentIds: ['dept-a'] });
      auth = await openAuth(harness, database.name, client, async (openId) => {
        feishu.push(openId);
        await client.query('SET ROLE intake_business');
        try {
          projected.push(await projectRosterLogin(client, openId));
        } finally {
          await client.query('RESET ROLE');
        }
      }, async () => {
        throw new Error('password hook');
      });
      const first = await signIn(auth, seat);
      const second = await signIn(auth, seat);
      expect(first.user_id).toBe(feishuUserId(seat));
      expect(second.user_id).toBe(feishuUserId(seat));
      expect(feishu).toEqual([seat, seat]);
      expect(projected).toEqual(['registered', 'registered']);
      const people = (await principalRows(client)).filter((row) => row.user_id === feishuUserId(seat));
      expect(people).toEqual([{ principal_id: rosterPrincipalId(seat), user_id: feishuUserId(seat) }]);
      expect(await grantRows(client)).toEqual(beforeGrants);
    } finally {
      await auth?.close();
      await client.end();
    }
  }, 180_000);

  it('uses the attached binding and leaves grant rows unchanged', async () => {
    const database = harness.createDatabase('feishu_attach');
    const client = await harness.connect(database.config);
    const feishu: string[] = [];
    const passwords: string[] = [];
    let auth: ProductAuthService | undefined;
    try {
      await seedLibrary(client);
      await revokePublish(client);
      const beforeGrants = await grantRows(client);
      const beforePeople = await principalRows(client);
      expect(await attach(client, linked, 'director')).toBe('attached');
      expect(await attach(client, linked, 'director')).toBe('already-attached');
      expect(await linkRows(client)).toEqual([{ open_id: linked, binding_id: 'director' }]);
      expect(await principalRows(client)).toEqual(beforePeople);
      auth = await openAuth(harness, database.name, client, async (openId) => {
        feishu.push(openId);
      }, async (bindingId) => {
        passwords.push(bindingId);
        await client.query('SET ROLE intake_business');
        try {
          await client.query('SELECT content_intake.project_seat_login($1)', [bindingId]);
        } finally {
          await client.query('RESET ROLE');
        }
      });
      const user = await signIn(auth, linked);
      expect(user).toMatchObject({ user_id: 'user-director', role: 'owner' });
      expect(feishu).toEqual([]);
      expect(passwords).toEqual(['director']);
      expect(await principalRows(client)).toEqual(beforePeople);
      expect(await grantRows(client)).toEqual(beforeGrants);
      expect((await principalRows(client)).some((row) => row.principal_id === rosterPrincipalId(linked))).toBe(false);
    } finally {
      await auth?.close();
      await client.end();
    }
  }, 180_000);

  it('returns already-split and writes nothing when the open id has its own principal', async () => {
    const database = harness.createDatabase('feishu_split');
    const client = await harness.connect(database.config);
    try {
      await seedLibrary(client);
      await revokePublish(client);
      rememberJobSnapshot(seat, { title: '客服坐席', directory: [{ name: '客服坐席', enabled: true }], departmentIds: ['dept-a'] });
      await client.query('SET ROLE intake_business');
      await expect(projectRosterLogin(client, seat)).resolves.toBe('registered');
      await client.query('RESET ROLE');
      const beforeGrants = await grantRows(client);
      const beforePeople = await principalRows(client);
      const beforeLinks = await linkRows(client);
      expect(beforePeople.some((row) => row.principal_id === rosterPrincipalId(seat))).toBe(true);
      expect(await attach(client, seat, 'director')).toBe('already-split');
      expect(await grantRows(client)).toEqual(beforeGrants);
      expect(await principalRows(client)).toEqual(beforePeople);
      expect(await linkRows(client)).toEqual(beforeLinks);
    } finally {
      await client.end();
    }
  }, 180_000);

  it('completes a password binding without roster projection', async () => {
    const database = harness.createDatabase('feishu_password');
    const client = await harness.connect(database.config);
    const feishu: string[] = [];
    const passwords: string[] = [];
    let auth: ProductAuthService | undefined;
    try {
      await seedLibrary(client);
      auth = await openAuth(harness, database.name, client, async (openId) => {
        feishu.push(openId);
      }, async (bindingId) => {
        passwords.push(bindingId);
      });
      const user = await signIn(auth, 'director');
      expect(user).toMatchObject({ user_id: 'user-director', role: 'owner' });
      expect(feishu).toEqual([]);
      expect(passwords).toEqual(['director']);
      expect(await linkRows(client)).toEqual([]);
    } finally {
      await auth?.close();
      await client.end();
    }
  }, 180_000);
});
