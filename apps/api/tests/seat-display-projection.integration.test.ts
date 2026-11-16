import { describe, expect, it } from 'vitest';
import { applyDatabaseMigrations, applyMigrationPrefix } from '@customer-agent/database';
import { Pg15Harness } from '@customer-agent/database/testkit';
import { seedIntakeSyntheticHost } from './support/intake-synthetic-seed.ts';

describe.skipIf(process.env.CUSTOMER_AGENT_API_PG15_INTEGRATION !== '1')('seat display projection migration', () => {
  it('projects both posts and 256-character names atomically and repairs legacy names without reviving roles or grants', async () => {
    const harness = new Pg15Harness();
    harness.start();
    const config = harness.createDatabase('seat_display_upgrade').config;
    const admin = await harness.connect(config);
    const business = await harness.connect(config);
    const createSeat = (username: string, displayName: string, post: '客服' | '客服主管' = '客服') => business.query(
      'SELECT * FROM backend_identity.create_seat($1,$2,$3,$4,$5,$6,$7)',
      [username, displayName, post, 'tenant-a', 'app-a', 'dept-a', 'director']);
    try {
      await applyMigrationPrefix(admin, 88);
      await seedIntakeSyntheticHost(admin);
      await business.query('SET ROLE intake_business');
      for (const username of ['missing', 'inactive', 'kept']) {
        await createSeat(username, `合成${username}`);
      }
      await business.query('SELECT backend_identity.disable_seat($1,$2,$3)', ['inactive', 'tenant-a', 'app-a']);
      await admin.query(`INSERT INTO public.app_users(user_id,display_name,role,is_active)
        SELECT user_id, '人工保留姓名', 'coach', false FROM backend_identity.subject_bindings WHERE binding_id='synthetic_seat_kept'`);
      const before = (await admin.query('SELECT * FROM content_intake.grants ORDER BY grant_id')).rows;
      await applyDatabaseMigrations(admin);
      expect((await admin.query('SELECT * FROM content_intake.grants ORDER BY grant_id')).rows).toEqual(before);
      expect((await admin.query(`SELECT b.binding_id,u.display_name,u.role,u.is_active
        FROM backend_identity.subject_bindings b JOIN public.app_users u USING(user_id)
        WHERE b.binding_id LIKE 'synthetic_seat_%' ORDER BY b.binding_id`)).rows).toEqual([
        { binding_id: 'synthetic_seat_inactive', display_name: '合成inactive', role: 'agent', is_active: false },
        { binding_id: 'synthetic_seat_kept', display_name: '人工保留姓名', role: 'coach', is_active: false },
        { binding_id: 'synthetic_seat_missing', display_name: '合成missing', role: 'agent', is_active: true },
      ]);
      await createSeat('agent', '合成客服');
      await createSeat('coach', '合成客服主管', '客服主管');
      expect((await admin.query(`SELECT u.display_name,u.role,u.is_active
        FROM public.app_users u JOIN backend_identity.subject_bindings b USING(user_id)
        WHERE b.binding_id IN ('synthetic_seat_agent','synthetic_seat_coach') ORDER BY b.binding_id`)).rows).toEqual([
        { display_name: '合成客服', role: 'agent', is_active: true },
        { display_name: '合成客服主管', role: 'coach', is_active: true },
      ]);
      const longName = '合'.repeat(256);
      await createSeat('longname', longName);
      expect((await admin.query(`SELECT display_name FROM public.app_users
        WHERE user_id=(SELECT user_id FROM backend_identity.subject_bindings WHERE binding_id='synthetic_seat_longname')`)).rows)
        .toEqual([{ display_name: longName }]);
      expect((await admin.query('SELECT grant_id FROM content_intake.grants ORDER BY grant_id')).rows)
        .toEqual(before.map(row => ({ grant_id: row.grant_id })));
      await admin.query(`CREATE FUNCTION public.reject_seat_name() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'synthetic projection refused'; END $$`);
      await admin.query(`CREATE TRIGGER reject_seat_name BEFORE INSERT ON public.app_users
        FOR EACH ROW EXECUTE FUNCTION public.reject_seat_name()`);
      await expect(createSeat('rollbackname', '事务回滚合成')).rejects.toThrow('synthetic projection refused');
      expect((await admin.query(`SELECT 1 FROM backend_identity.subject_bindings WHERE binding_id='synthetic_seat_rollbackname'`)).rows).toEqual([]);
      expect((await admin.query(`SELECT 1 FROM content_intake.principals WHERE principal_id='seat_rollbackname'`)).rows).toEqual([]);
    } finally { await business.end(); await admin.end(); harness.stop(); }
  }, 180_000);
});
