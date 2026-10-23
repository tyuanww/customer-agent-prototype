import { readFileSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const mainUrl = new URL('apps/desktop/src/main/main.ts', root);
const dashboardUrl = new URL('apps/desktop/src/renderer/DashboardApp.tsx', root);
const httpUrl = new URL('apps/desktop/src/main/product-http.ts', root);
const main = readFileSync(mainUrl, 'utf8');
const dashboard = readFileSync(dashboardUrl, 'utf8');
const http = readFileSync(httpUrl, 'utf8');

function die(code, message) {
  console.error(message);
  process.exit(code);
}

const wiringStart = main.indexOf('const hangzhouWorkbench =');
const wiringEnd = main.indexOf('const workbenchSession =', wiringStart);
const statementEnd = main.indexOf('\n', main.indexOf(';', wiringEnd));
if (wiringStart < 0 || wiringEnd < 0 || statementEnd < 0) {
  die(2, 'model out of sync: hangzhouWorkbench / workbenchSession markers are gone from apps/desktop/src/main/main.ts');
}
const wiring = main.slice(wiringStart, statementEnd);
const mount = new Function('productProfile', 'productSession', `${wiring}\nreturn workbenchSession;`);

const registrations = [
  'registerContentIntakeCatalogIpc(workbenchSession,',
  'registerContentIntakePermissionsIpc(workbenchSession,',
  'registerContentIntakeManagementIpc(workbenchSession,',
  'registerDeskKnowledgeIpc(workbenchSession,',
  'registerContentIntakeQueryIpc(workbenchSession,',
];
for (const call of registrations) {
  if (!main.includes(call)) die(1, `upload mount is not shared: missing ${call}`);
}
if (!main.includes('new ProductHttp(productProfile.apiOrigin)')) {
  die(1, 'the mounted session is not built with productProfile.apiOrigin');
}
if (!http.includes('new URL(path, this.origin)')) {
  die(1, 'ProductHttp.request no longer joins the path onto the profile origin');
}
if (dashboard.includes('PRODUCT_REMOTE_NAV') || dashboard.includes('remoteSeat')) {
  die(1, 'DashboardApp still swaps the Hangzhou client onto the five-page remote list');
}

const loopbacks = ['http://127.0.0.1:43115', 'http://127.0.0.1:43116', 'http://127.0.0.1:43180', 'http://127.0.0.1:43181'];
const remotes = ['https://agent-auth.jianghua.site', 'https://agent-pass.jianghua.site'];
const profiles = [undefined, null];
for (const apiOrigin of loopbacks) {
  for (const identityOrigin of loopbacks) {
    if (apiOrigin === identityOrigin) continue;
    for (const contentIntake of [undefined, 'faq-v2']) {
      profiles.push(contentIntake ? { apiOrigin, identityOrigin, contentIntake } : { apiOrigin, identityOrigin });
    }
  }
}
for (const apiOrigin of remotes) {
  for (const identityOrigin of remotes) {
    if (apiOrigin === identityOrigin) continue;
    for (const contentIntake of [undefined, 'faq-v2']) {
      profiles.push(contentIntake ? { apiOrigin, identityOrigin, contentIntake } : { apiOrigin, identityOrigin });
    }
  }
}

let checked = 0;
for (const productProfile of profiles) {
  const productSession = { apiOrigin: productProfile?.apiOrigin ?? null };
  const mounted = mount(productProfile, productSession);
  const expectMounted = Boolean(productProfile) && (
    productProfile.contentIntake === 'faq-v2'
    || (typeof productProfile.apiOrigin === 'string' && productProfile.apiOrigin.startsWith('https://'))
  );
  const label = JSON.stringify(productProfile);
  if (expectMounted && mounted !== productSession) {
    die(1, `https or faq-v2 profile left upload unmounted: ${label}`);
  }
  if (!expectMounted && mounted !== null) {
    die(1, `profile mounted an upload that cannot be the production origin: ${label}`);
  }
  checked += 1;
}

console.log(JSON.stringify({
  ok: true,
  checked,
  property: 'materials upload is mounted exactly for faq-v2 or an https API origin, on that origin',
}));
