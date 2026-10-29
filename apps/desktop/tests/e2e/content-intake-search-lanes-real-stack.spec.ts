import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type ElectronApplication } from '@playwright/test';
import { closeOwnedElectron } from '../support/owned-electron';
import { launchIntakeElectron } from '../support/intake-electron';

/** Search lanes, driven through real Electron, preload, Main, HTTP and PostgreSQL.
 *
 * Every state reachable through the shipped capsule is expressed here as a repeatable case.
 * Each one is produced by a real database write and read back from the rendered capsule, and
 * each saves a screenshot so a reviewer sees the state the operator sees.
 *
 * The capsule answers through the intake usage surface rather than /v1/search. That surface
 * now reads the same source set, at one captured instant, so these lanes exercise the same
 * authorization the search door uses.
 *
 * Not expressed here, and why:
 * - The trunk-versus-head regression comparison and the ten-VM isolation need an environment
 *   this repository cannot create.
 * - The plan's "owner holds only query" and "owner session without a grant" reduce to the
 *   same refusal here: every roster identity signs in with the session role `owner`, and the
 *   lanes below vary what the grant and the facts window say instead.
 */
type Lane = Readonly<{
  slug: string;
  identity: 'roster-readonly' | 'roster-agent' | 'roster-nogrant';
  /** State written before sign-in, or after sign-in for `expire`. */
  before: 'revoke' | 'expire' | 'empty' | null;
  expect: 'granted' | 'pending' | 'stale';
}>;

const LANES: readonly Lane[] = [
  // A live grant: the door answers instead of refusing.
  { slug: 'pr-a-grant', identity: 'roster-readonly', before: null, expect: 'granted' },
  // The grant is withdrawn before the session exists: the projection carries no query bit, so
  // the capsule refuses without asking the server.
  { slug: 'pr-a-revoked', identity: 'roster-readonly', before: 'revoke', expect: 'pending' },
  // A director title, a fresh window, and no grant at all. The session role is `owner`, so
  // this is the state where the role alone does not open the door.
  { slug: 'pr-a-no-grant', identity: 'roster-nogrant', before: null, expect: 'pending' },
  // A seat title with role `agent` and a live query grant: the role ceiling permits reading,
  // so the grant still decides and the door answers.
  { slug: 'pr-a-agent-grant', identity: 'roster-agent', before: null, expect: 'granted' },
  // The window closes while the session is live, so the request reaches the door and the
  // database refuses it. This is the only path that can show the stale sentence: a session
  // that starts closed cannot tell "expired" from "never granted".
  { slug: 'pr-a-stale-facts', identity: 'roster-readonly', before: 'expire', expect: 'stale' },
  // No membership in the current store set, so no query grant is live. Last, because it
  // changes the answer for every principal at once, and on a principal whose window is still
  // fresh: an expired window would take precedence and hide the store-set cause.
  { slug: 'pr-a-empty-stores', identity: 'roster-agent', before: 'empty', expect: 'pending' },
];

test('the search door tells a session apart from its grant, its facts and its store set', async () => {
  test.skip(process.env.CUSTOMER_AGENT_INTAKE_SYNTHETIC_E2E !== '1', 'Explicit PG15/Electron synthetic gate');
  test.setTimeout(600_000);
  const { createIntakeSyntheticHost } = await import('../../../api/tests/support/intake-synthetic-host.ts');
  const evidence = path.resolve(fileURLToPath(new URL('../..', import.meta.url)), '../../.gstack/pr-a-search-lanes',
    new Date().toISOString().replaceAll(':', '-'));
  mkdirSync(evidence, { recursive: true });
  for (const lane of LANES) {
    const host = await createIntakeSyntheticHost({ prepareCandidate: false, profile: 'purpose-runtime' });
    const userData = mkdtempSync(path.join(tmpdir(), `${lane.slug}-`));
    let app: ElectronApplication | undefined;
    try {
      // State that must exist before the session is created.
      if (lane.before === 'revoke') {
        expect(await host.revokeQueryFor(lane.identity), `${lane.slug}: revoke`).toBeGreaterThan(0);
      }
      if (lane.before === 'empty') {
        expect(await host.emptyStoreSet(), `${lane.slug}: empty store set`).toBeGreaterThan(0);
      }
      Reflect.apply(host.selectIdentity, host, [lane.identity]);
      app = await launchIntakeElectron({ desktopRoot: fileURLToPath(new URL('../..', import.meta.url)),
        userDataDirectory: userData, apiOrigin: host.apiOrigin, identityOrigin: host.identityOrigin,
        evidenceDirectory: evidence });
      await expect.poll(() => app!.windows().some(w => w.url().includes('role=query')), { timeout: 30_000 }).toBe(true);
      const query = app.windows().find(w => w.url().includes('role=query'))!;
      await query.waitForFunction(() => Boolean(window.customerAgent?.product));
      await app.evaluate(({ app: electronApp }) => electronApp.focus({ steal: true }));
      await query.evaluate(() => window.customerAgent!.openSearch());
      await query.getByRole('button', { name: '登录', exact: true }).click();
      await expect.poll(() => app!.windows().some(w => w.url().includes('role=login'))).toBe(true);
      await app.windows().find(w => w.url().includes('role=login'))!.getByRole('button', { name: '飞书登录' }).click();
      await expect.poll(() => query.evaluate(async () => {
        const status = await window.customerAgent!.product!.sessionStatus();
        return status.ok && status.signedIn;
      }), { timeout: 30_000 }).toBe(true);

      // The window closes after sign-in. The capsule reports what its current projection says,
      // so wait for the session to learn the new state rather than racing the poll.
      if (lane.before === 'expire') {
        expect(await host.expireFactsFor(lane.identity)).toBe(true);
        await expect.poll(() => query.evaluate(async () => {
          const status = await window.customerAgent!.product!.sessionStatus();
          return status.ok && status.signedIn ? status.job?.permission ?? null : null;
        }), { timeout: 20_000 }).toBe('expired');
      }

      await query.getByTestId('question-input').fill('合成');
      await query.getByTestId('search-button').click();

      if (lane.expect === 'granted') {
        // No release is published in this fixture, so a live grant answers with no hit rather
        // than a refusal. The point of the lane is that it is not refused.
        await expect(query.getByTestId('error-state')).toHaveCount(0);
        await expect.poll(async () => await query.getByTestId('no-hit').isVisible()).toBe(true);
      } else {
        const sentence = lane.expect === 'stale' ? '资料资格过期了，请稍后重试。' : '查询权限或资料尚未就绪，请联系管理员核对。';
        await expect(query.getByTestId('error-state')).toContainText(sentence);
        await expect(query.getByTestId('error-state')).not.toContainText(
          lane.expect === 'stale' ? '查询权限或资料尚未就绪，请联系管理员核对。' : '资料资格过期了，请稍后重试。');
        const denied = await host.requestAs(lane.identity, '/v1/intake/entitlements', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ shopId: 'shop-a', contextGeneration: 1, productIds: [], scenarioIds: [], releaseId: null }),
        });
        expect([403, 404]).toContain(denied.status);
        const filter = query.getByRole('button', { name: '筛选', exact: true });
        if (await filter.count()) await filter.click();
        await expect.poll(() => query.evaluate(() => {
          const select = document.querySelector<HTMLSelectElement>('select[aria-label="当前店铺"]');
          return select === null ? 0 : [...select.options].filter(option => option.value !== '').length;
        })).toBe(0);
      }
      // Re-focus before capturing: a background window never finishes a screenshot, and this
      // loop opens a new window per lane.
      await app.evaluate(({ app: electronApp }) => electronApp.focus({ steal: true }));
      await query.screenshot({ path: path.join(evidence, `${lane.slug}.png`), animations: 'disabled', timeout: 20_000 });
      console.info(JSON.stringify({ status: 'PASS', lane: lane.slug, expect: lane.expect,
        screenshot: path.join(evidence, `${lane.slug}.png`) }));
    } finally {
      try { if (app) await closeOwnedElectron(app); }
      finally { try { await host.close(); } finally { rmSync(userData, { recursive: true, force: true }); } }
    }
  }
});
