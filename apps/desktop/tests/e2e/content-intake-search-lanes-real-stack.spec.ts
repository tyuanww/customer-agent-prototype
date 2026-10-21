import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type ElectronApplication } from '@playwright/test';
import { closeOwnedElectron } from '../support/owned-electron';
import { launchIntakeElectron } from '../support/intake-electron';

/** PR-A search lanes, driven through real Electron, preload, Main, HTTP and PostgreSQL.
 *
 * The plan asked for ten cloud VM lanes. This machine has no VM fleet, so three of those
 * lanes are expressed as repeatable cases here instead: the states they name are produced by
 * real database writes and read back from the rendered capsule, not from a stub. Each case
 * saves its own screenshot so the review can see the state the operator would see.
 *
 * Covered here: a live query grant, and a grant revoked before the session exists. Not
 * covered, and deliberately so:
 *
 * - The stale-facts lane. The shipped capsule profile (contentIntake: faq-v2) answers through
 *   /v1/intake/query, whose expired-facts refusal is the denial sentence. The plan's
 *   "资料资格过期了" sentence belongs to the /v1/search door, which that profile does not call;
 *   it is proven at the HTTP level in search-query-deadline.integration.test.ts instead of
 *   being asserted here against a door the operator never reaches.
 * - The trunk-versus-head regression comparison and the ten-VM isolation, which need an
 *   environment this repository cannot create.
 */
const LANES = [
  // A live grant: the door answers, it does not refuse.
  { slug: 'pr-a-grant', identity: 'roster-readonly', expect: 'granted', before: null },
  // The grant is withdrawn before the session exists, which is the "second login after the
  // grant was revoked" state: the session projection carries no query bit at all.
  { slug: 'pr-a-revoked', identity: 'roster-readonly', expect: 'denied', before: 'revoke' },
  // The window closes while the session is live, so the request reaches the door and the
  // database is what refuses it. This is the only path that can show the stale sentence: a
  // session that starts closed cannot tell "expired" from "never granted".
  { slug: 'pr-a-stale-facts', identity: 'roster-readonly', expect: 'stale', before: 'expire' },
] as const;

test('the search door tells a session apart from its grant and from its facts window', async () => {
  test.skip(process.env.CUSTOMER_AGENT_INTAKE_SYNTHETIC_E2E !== '1', 'Explicit PG15/Electron synthetic gate');
  test.setTimeout(300_000);
  const { createIntakeSyntheticHost } = await import('../../../api/tests/support/intake-synthetic-host.ts');
  const host = await createIntakeSyntheticHost({ prepareCandidate: false, profile: 'purpose-runtime' });
  const directory = mkdtempSync(path.join(tmpdir(), 'intake-search-lane-'));
  const desktopRoot = fileURLToPath(new URL('../..', import.meta.url));
  const evidence = path.resolve(desktopRoot, '../../.gstack/pr-a-search-lanes',
    new Date().toISOString().replaceAll(':', '-'));
  mkdirSync(evidence, { recursive: true });
  let app: ElectronApplication | undefined;
  try {
    for (const lane of LANES) {
      if (lane.before === 'revoke') {
        expect(await host.revokeQueryFor(lane.identity)).toBeGreaterThan(0);
      }
      Reflect.apply(host.selectIdentity, host, [lane.identity]);
      app = await launchIntakeElectron({ desktopRoot, userDataDirectory: mkdtempSync(path.join(directory, `${lane.slug}-`)),
        apiOrigin: host.apiOrigin, identityOrigin: host.identityOrigin, evidenceDirectory: evidence });
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
      // The stale lane closes the window after sign-in. The window reports what the client's
      // current projection says, so wait until the session has learned the new state rather
      // than racing the poll.
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
        // No release has been published in this fixture, so a live grant answers with no hit
        // rather than a refusal. The point of this lane is that it is not refused.
        await expect(query.getByTestId('error-state')).toHaveCount(0);
        await expect.poll(async () => query.getByTestId('no-hit').isVisible()).toBe(true);
      } else {
        const sentence = lane.expect === 'stale' ? '资料资格过期了，请稍后重试。' : '没有权限，请找人开通。';
        // The sentence has to reach the rendered state, not just the HTTP body.
        await expect(query.getByTestId('error-state')).toContainText(sentence);
      }
      await query.screenshot({ path: path.join(evidence, `${lane.slug}.png`) });
      console.info(JSON.stringify({ status: 'PASS', lane: lane.slug, screenshot: path.join(evidence, `${lane.slug}.png`) }));
      await closeOwnedElectron(app);
      app = undefined;
    }
  } finally {
    try { if (app) await closeOwnedElectron(app); }
    finally { try { await host.close(); } finally { rmSync(directory, { recursive: true, force: true }); } }
  }
});
