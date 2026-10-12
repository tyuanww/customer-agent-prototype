import type { Client } from 'pg';

/** One throwaway fixture, after migrations and seedIntakeSyntheticHost. This is
 * synthetic bootstrap, not runtime registration or a real directory writer. */
export async function seedIntakeSyntheticDirectory(admin: Client, options: { duplicateShopNames?: boolean } = {}) {
  await admin.query('BEGIN');
  try {
    await admin.query('SELECT backend_review.lock_content()');
    await admin.query("SELECT set_config('content_intake.directory_steward_write','writing',true)");
    await admin.query(`INSERT INTO content_intake.shop_directory_stewards VALUES
      ('tenant-a','app-a','director',clock_timestamp(),1,true,clock_timestamp()+interval '4 minutes')`);
    await admin.query("SELECT content_intake.upsert_shop_display('director','tenant-a','app-a','shop-a','合成示例店',NULL)");
    await admin.query(`SELECT content_intake.rotate_shop_directory_key('tenant-a','app-a','synthetic-directory-key',repeat('c',64),
      clock_timestamp()+interval '4 minutes',0,'合成目录密钥','synthetic-directory-bootstrap')`);
    if (options.duplicateShopNames) {
      await admin.query("SELECT content_intake.upsert_shop_display('director','tenant-a','app-a','shop-b','合成示例店',1)");
      await admin.query(`INSERT INTO content_intake.grants(grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,action,starts_at,expires_at,reason,steward_id)
        VALUES ('directory-root-b','allocation','director','director','tenant-a','app-a','scope-b','query',clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour','合成同名店验收','director')`);
      await admin.query(`INSERT INTO content_intake.grants(grant_id,kind,issuer_id,recipient_id,tenant_id,app_id,scope_id,source_id,action,starts_at,expires_at,reason,steward_id,parent_grant_id)
        VALUES ('directory-query-b','business','director','agent','tenant-a','app-a','scope-b','source-b','query',clock_timestamp()-interval '1 minute',clock_timestamp()+interval '30 minutes','合成同名店验收','director','directory-root-b')`);
    }
    await admin.query('COMMIT');
  } catch (error) { await admin.query('ROLLBACK'); throw error; }
}
