import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readOverlay = (name: string) => readFileSync(path.join(packageRoot, 'overlays', name), 'utf8');

describe('roster permission authority boundary', () => {
  it('keeps the applied 0044 bytes free of the system signer', () => {
    const sql = readOverlay('0044_intake_role_defaults.sql');
    expect(sql).not.toContain('content-intake-system');
    expect(sql).not.toContain('query-signer');
  });

  it('requires a business grant and drops the role-only allow', () => {
    const sql = readOverlay('0047_roster_query_signer.sql');
    const authority = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION content_intake.authorization_deadline'));
    expect(authority).toContain("g.kind='business'");
    expect(authority).toContain('least(f.valid_until, max(g.expires_at))');
    expect(authority).not.toContain('COALESCE(');
  });

  it('allows only the synthetic query signer to issue parentless query grants', () => {
    const sql = readOverlay('0047_roster_query_signer.sql');
    const guard = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION content_intake.grant_parent_guard'));
    expect(guard).toContain("NEW.kind = 'business' AND NEW.action = 'query'");
    expect(guard).toContain("signer.identity_scope = 'content-intake-system'");
    expect(guard).toContain("signer.person_key = 'query-signer'");
  });

  it('keeps login from writing role rules or grants', () => {
    const sql = readOverlay('0046_project_feishu_roster.sql');
    expect(sql).toContain("RETURN 'policy-pending'");
    expect(sql).toContain('FROM content_intake.role_rules');
    expect(sql).not.toContain('INSERT INTO content_intake.role_rules');
    expect(sql).not.toContain('INSERT INTO content_intake.grants');
    expect(sql).toContain("IS DISTINCT FROM ARRAY['query']");
  });

  it('issues query only from the system signer', () => {
    const sql = readOverlay('0047_roster_query_signer.sql');
    const issue = sql.slice(sql.indexOf('CREATE FUNCTION content_intake.issue_roster_query'));
    expect(issue).toContain("'职位名单系统签发。'");
    expect(issue).toContain('content_intake.release_lineage');
    expect(issue).not.toContain("'publish'");
    expect(issue).not.toContain("'import'");
    expect(issue).not.toContain('kind IN (\'allocation\'');
  });
});
