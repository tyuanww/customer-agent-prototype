import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  manifestFromRelease,
  platformOf,
  formatSizeMb,
  formatDateZh,
  compareVersions,
  publishedVersion,
  renderIndex,
  renderWindows,
  updateDownloadPages,
} from './update-download-page.mjs';

const script = fileURLToPath(new URL('./update-download-page.mjs', import.meta.url));

const WIN_SHA = '84795e68bc316e45999287c5532b883c232a80aa9619b68c475fc202a479aac1';
const MAC_SHA = '556b3fa7afa2d1cd3b9177d995679d481c359eca35331f8d17b059884834e2f5';
const LINUX_SHA = '54ece2999c2c4a24cbaa40b3d477e58fee526f3609e416f42da53124b6deb610';
const ZIP_SHA = '22f18b4a08c9424f430f42a0573229bcd12f4d0fbb62d16f6007180f71e65998';

/** The real v0.3.25 Release, trimmed to the fields the page renderer reads. */
const RELEASE_0325 = Object.freeze({
  tagName: 'v0.3.25',
  publishedAt: '2026-09-29T14:38:07+08:00',
  assets: [
    { name: 'Demo-0.3.25-linux-x86_64-UNSIGNED.AppImage', size: 132024996, digest: `sha256:${LINUX_SHA}` },
    { name: 'Demo-0.3.25-mac-universal-UNSIGNED.dmg', size: 223846710, digest: `sha256:${MAC_SHA}` },
    { name: 'Demo-0.3.25-mac-universal-UNSIGNED.zip', size: 223124003, digest: `sha256:${ZIP_SHA}` },
    { name: 'Demo-0.3.25-win-x64-UNSIGNED.exe', size: 91430255, digest: `sha256:${WIN_SHA}` },
  ],
});

/** An older release than the page, with asset names that match its own tag. */
const RELEASE_039 = Object.freeze({
  tagName: 'v0.3.9',
  publishedAt: '2026-08-01T10:00:00+08:00',
  assets: [
    { name: 'Demo-0.3.9-linux-x86_64-UNSIGNED.AppImage', size: 100000000, digest: `sha256:${'a'.repeat(64)}` },
    { name: 'Demo-0.3.9-mac-universal-UNSIGNED.dmg', size: 200000000, digest: `sha256:${'b'.repeat(64)}` },
    { name: 'Demo-0.3.9-win-x64-UNSIGNED.exe', size: 80000000, digest: `sha256:${'c'.repeat(64)}` },
  ],
});

/** The stale v0.3.24 page: same structure and order as the shipped file. */
function indexFixture() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta name="description" content="客服话术浮窗 Demo 官方下载。Windows x64，v0.3.24。">
  <meta property="og:description" content="Windows 官方安装包 v0.3.24。登录用公司飞书。">
</head>
<body>
  <p class="kicker">v0.3.24</p>
  <a href="https://github.com/tyuanww/customer-agent-prototype/releases/download/v0.3.24/Demo-0.3.24-win-x64-UNSIGNED.exe">下载 Windows 安装包</a>
  <p class="meta">Windows 10+ x64 · 87.2 MB · 未代码签名</p>
  <p class="section-lead">v0.3.24 · 2026年9月29日</p>
  <div class="panel is-on" id="panel-win" role="tabpanel">
    <button class="chip" type="button" data-copy="c2dd941031791b8dc589fbadf1cbfa0231c72734ebc846c8809971f8e55510cd">SHA-256\u3000c2dd9410…f55510cd</button>
    <a class="btn btn-primary" href="https://github.com/tyuanww/customer-agent-prototype/releases/download/v0.3.24/Demo-0.3.24-win-x64-UNSIGNED.exe">下载 · 87.2 MB</a>
  </div>
  <div class="panel" id="panel-mac" role="tabpanel" hidden>
    <button class="chip" type="button" data-copy="476d16e7dc7258c9f2a9765bd0e88ddf3084e5335c869b2e33f1c7406f157eb3">SHA-256\u3000476d16e7…6f157eb3</button>
    <a class="btn btn-ghost" href="https://github.com/tyuanww/customer-agent-prototype/releases/download/v0.3.24/Demo-0.3.24-mac-universal-UNSIGNED.dmg">下载 · 213.5 MB</a>
  </div>
  <div class="panel" id="panel-linux" role="tabpanel" hidden>
    <button class="chip" type="button" data-copy="af48a3362379932cb8cd4a42e82be3f1eba2963986c2bd5677e473723f19068e">SHA-256\u3000af48a336…3f19068e</button>
    <a class="btn btn-ghost" href="https://github.com/tyuanww/customer-agent-prototype/releases/download/v0.3.24/Demo-0.3.24-linux-x86_64-UNSIGNED.AppImage">下载 · 125.9 MB</a>
  </div>
</body>
</html>
`;
}

function windowsFixture() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta http-equiv="refresh" content="0; url=https://github.com/tyuanww/customer-agent-prototype/releases/download/v0.3.24/Demo-0.3.24-win-x64-UNSIGNED.exe">
</head>
<body>
  <p><a href="https://github.com/tyuanww/customer-agent-prototype/releases/download/v0.3.24/Demo-0.3.24-win-x64-UNSIGNED.exe">如果没有开始下载，点这里。</a></p>
</body>
</html>
`;
}

function writeFixtureDir() {
  const dir = mkdtempSync(path.join(tmpdir(), 'download-page-'));
  writeFileSync(path.join(dir, 'index.html'), indexFixture());
  writeFileSync(path.join(dir, 'windows.html'), windowsFixture());
  return dir;
}

test('platformOf maps exactly the three linked platforms', () => {
  assert.equal(platformOf('Demo-0.3.25-win-x64-UNSIGNED.exe'), 'win');
  assert.equal(platformOf('Demo-0.3.25-mac-universal-UNSIGNED.dmg'), 'mac');
  assert.equal(platformOf('Demo-0.3.25-linux-x86_64-UNSIGNED.AppImage'), 'linux');
  assert.equal(platformOf('Demo-0.3.25-mac-universal-UNSIGNED.zip'), null);
  assert.equal(platformOf('Demo-0.3.25-win-x64-UNSIGNED.exe.blockmap'), null);
  assert.equal(platformOf('latest.yml'), null);
});

test('formatSizeMb and formatDateZh match the printed page', () => {
  assert.equal(formatSizeMb(91430255), '87.2');
  assert.equal(formatSizeMb(223846710), '213.5');
  assert.equal(formatSizeMb(132024996), '125.9');
  assert.equal(formatDateZh('2026-09-29T06:38:07Z'), '2026年9月29日');
  assert.equal(formatDateZh('2026-09-29T02:38:07Z'), '2026年9月29日');
  assert.throws(() => formatSizeMb(0), /invalid asset size/u);
});

test('manifestFromRelease keeps linked assets, drops the zip, and requires all three', () => {
  const manifest = manifestFromRelease(RELEASE_0325);
  assert.equal(manifest.version, '0.3.25');
  assert.equal(manifest.date, '2026年9月29日');
  assert.deepEqual(Object.keys(manifest.assets).sort(), ['linux', 'mac', 'win']);
  assert.equal(manifest.assets.win.name, 'Demo-0.3.25-win-x64-UNSIGNED.exe');
  assert.equal(manifest.assets.win.sha256, WIN_SHA);
  assert.ok(!JSON.stringify(manifest).includes('.zip'));

  const missing = { ...RELEASE_0325, assets: RELEASE_0325.assets.filter((a) => platformOf(a.name) !== 'linux') };
  assert.throws(() => manifestFromRelease(missing), /missing its linux asset/u);

  const noDigest = RELEASE_0325.assets.map((a) => (a.name.includes('win') ? { ...a, digest: undefined } : a));
  assert.throws(() => manifestFromRelease({ ...RELEASE_0325, assets: noDigest }), /no sha256 digest/u);

  assert.throws(() => manifestFromRelease({ ...RELEASE_0325, tagName: 'nightly' }), /unexpected release tag/u);
});

test('renderIndex rewrites version, date, sizes, checksums and every URL', () => {
  const rendered = renderIndex(indexFixture(), manifestFromRelease(RELEASE_0325));

  assert.ok(!rendered.includes('0.3.24'), 'no stale version survives');
  assert.match(rendered, /<p class="kicker">v0\.3\.25<\/p>/u);
  assert.match(rendered, /v0\.3\.25 · 2026年9月29日/u);
  assert.match(rendered, /Windows 10\+ x64 · 87\.2 MB/u);
  assert.match(rendered, new RegExp(`data-copy="${WIN_SHA}">SHA-256\u300084795e68…a479aac1`, 'u'));
  assert.match(rendered, new RegExp(`data-copy="${MAC_SHA}">SHA-256\u3000556b3fa7…4834e2f5`, 'u'));
  assert.match(rendered, new RegExp(`data-copy="${LINUX_SHA}">SHA-256\u300054ece299…b6deb610`, 'u'));
  assert.match(rendered, /download\/v0\.3\.25\/Demo-0\.3\.25-win-x64-UNSIGNED\.exe/u);
  assert.match(rendered, /download\/v0\.3\.25\/Demo-0\.3\.25-mac-universal-UNSIGNED\.dmg/u);
  assert.match(rendered, /download\/v0\.3\.25\/Demo-0\.3\.25-linux-x86_64-UNSIGNED\.AppImage/u);
  assert.match(rendered, /下载 · 213\.5 MB/u);
  assert.match(rendered, /下载 · 125\.9 MB/u);
});

test('renderIndex and renderWindows are idempotent', () => {
  const manifest = manifestFromRelease(RELEASE_0325);
  const index = renderIndex(indexFixture(), manifest);
  assert.equal(renderIndex(index, manifest), index);
  const windows = renderWindows(windowsFixture(), manifest);
  assert.equal(renderWindows(windows, manifest), windows);
});

test('renderIndex fails loudly when the page loses a panel or a chip', () => {
  const manifest = manifestFromRelease(RELEASE_0325);
  assert.throws(
    () => renderIndex('<html><body>no release links at all</body></html>', manifest),
    /links no release asset at all/u,
  );
  const withoutPanel = indexFixture().replace('id="panel-win"', 'id="panel-renamed"');
  assert.throws(() => renderIndex(withoutPanel, manifest), /missing the panel-win panel/u);
  const withoutChip = indexFixture().replace(/data-copy="[0-9a-f]{64}"/u, 'data-copy=""');
  assert.throws(() => renderIndex(withoutChip, manifest), /could not find checksum chip/u);
});

test('renderIndex refuses a page that links a different repository', () => {
  // The URL rewrite used to be anchored on this repository by name, so a page
  // pointing somewhere else matched nothing and was published with its download
  // links left behind while the version strings moved.
  const moved = indexFixture().replace(/tyuanww\/customer-agent-prototype/gu, 'other-org/moved-repo');
  assert.throws(
    () => renderIndex(moved, manifestFromRelease(RELEASE_0325)),
    /links a release on other-org\/moved-repo/u,
  );
});

test('renderIndex refuses a page that stopped linking a platform', () => {
  // windows.html carries only the Windows asset, so index.html's requirements
  // reject it. A page that quietly lost its macOS link must not be published.
  assert.throws(
    () => renderIndex(windowsFixture(), manifestFromRelease(RELEASE_0325)),
    /no longer links the mac asset/u,
  );
});

test('renderIndex refuses a page carrying two different versions', () => {
  const drifted = indexFixture().replace(
    '<p class="kicker">v0.3.24</p>',
    '<p class="kicker">v0.3.24</p>\n  <p>older v0.2.0</p>',
  );
  assert.throws(() => renderIndex(drifted, manifestFromRelease(RELEASE_0325)), /more than one version/u);
});

test('compareVersions orders numerically rather than as strings', () => {
  assert.equal(compareVersions('0.10.0', '0.9.9'), 1, '0.10.0 is newer than 0.9.9');
  assert.equal(compareVersions('0.3.25', '0.3.25'), 0);
  assert.equal(compareVersions('0.3.9', '0.3.25'), -1);
});

test('publishedVersion reads the version a page advertises', () => {
  assert.equal(publishedVersion(indexFixture()), '0.3.24');
  assert.equal(publishedVersion('<html><body>no version</body></html>'), null);
});

test('renderWindows points the redirect at the release asset', () => {
  const rendered = renderWindows(windowsFixture(), manifestFromRelease(RELEASE_0325));
  assert.ok(!rendered.includes('0.3.24'));
  const expected = `releases/download/v0.3.25/Demo-0.3.25-win-x64-UNSIGNED.exe`;
  assert.equal(rendered.split(expected).length - 1, 2, 'refresh URL and fallback link both move');
});

test('updateDownloadPages writes both pages once, then reports no changes', () => {
  const dir = writeFixtureDir();
  const manifest = manifestFromRelease(RELEASE_0325);

  assert.deepEqual(updateDownloadPages({ dir, manifest }).sort(), ['index.html', 'windows.html']);
  assert.deepEqual(updateDownloadPages({ dir, manifest }), [], 'second run is a no-op');
  assert.match(readFileSync(path.join(dir, 'index.html'), 'utf8'), /v0\.3\.25/u);
  assert.match(readFileSync(path.join(dir, 'windows.html'), 'utf8'), /v0\.3\.25/u);
});

test('--check reports staleness without writing', () => {
  const dir = writeFixtureDir();
  const manifest = manifestFromRelease(RELEASE_0325);

  assert.deepEqual(updateDownloadPages({ dir, manifest, check: true }).sort(), ['index.html', 'windows.html']);
  assert.match(readFileSync(path.join(dir, 'index.html'), 'utf8'), /0\.3\.24/u, 'check mode leaves the file alone');
});

test('the CLI republishes a stale page from a manifest', () => {
  const dir = writeFixtureDir();
  const manifestPath = path.join(dir, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifestFromRelease(RELEASE_0325)));

  const result = spawnSync(process.execPath, [script, '--dir', dir, '--manifest', manifestPath], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /download page -> v0\.3\.25/u);
  assert.match(readFileSync(path.join(dir, 'index.html'), 'utf8'), /v0\.3\.25/u);

  const checked = spawnSync(process.execPath, [script, '--dir', dir, '--check', '--manifest', manifestPath], { encoding: 'utf8' });
  assert.equal(checked.status, 0, checked.stderr);
  assert.match(checked.stdout, /already at v0\.3\.25/u);

  const noManifest = spawnSync(process.execPath, [script, '--dir', dir], { encoding: 'utf8' });
  assert.equal(noManifest.status, 1);
  assert.match(noManifest.stderr, /pass --from-release/u);
});

test('updateDownloadPages refuses to walk the page backwards', () => {
  // Backfilling is a supported thing to do, but publishing an older release over
  // a newer page must not happen by accident.
  const dir = writeFixtureDir();
  assert.throws(
    () => updateDownloadPages({ dir, manifest: manifestFromRelease(RELEASE_039) }),
    /refusing to publish the older v0\.3\.9/u,
  );
  assert.match(readFileSync(path.join(dir, 'index.html'), 'utf8'), /0\.3\.24/u, 'the page is left alone');
});

test('updateDownloadPages publishes an older release only when told to', () => {
  const dir = writeFixtureDir();
  const older = manifestFromRelease(RELEASE_039);
  assert.deepEqual(updateDownloadPages({ dir, manifest: older, allowDowngrade: true }).sort(), ['index.html', 'windows.html']);
  assert.match(readFileSync(path.join(dir, 'index.html'), 'utf8'), /v0\.3\.9/u);
});

test('the CLI reports the resolved version and refuses a downgrade', () => {
  const dir = writeFixtureDir();
  const forwardPath = path.join(dir, 'forward.json');
  const backwardPath = path.join(dir, 'backward.json');
  const versionPath = path.join(dir, 'version.txt');
  writeFileSync(forwardPath, JSON.stringify(manifestFromRelease(RELEASE_0325)));
  writeFileSync(backwardPath, JSON.stringify(manifestFromRelease(RELEASE_039)));

  const forward = spawnSync(
    process.execPath,
    [script, '--dir', dir, '--manifest', forwardPath, '--version-out', versionPath],
    { encoding: 'utf8' },
  );
  assert.equal(forward.status, 0, forward.stderr);
  assert.equal(readFileSync(versionPath, 'utf8').trim(), '0.3.25', 'the version file carries what was validated');

  const backward = spawnSync(process.execPath, [script, '--dir', dir, '--manifest', backwardPath], { encoding: 'utf8' });
  assert.equal(backward.status, 1);
  assert.match(backward.stderr, /refusing to publish the older v0\.3\.9/u);
  assert.match(readFileSync(path.join(dir, 'index.html'), 'utf8'), /v0\.3\.25/u, 'the page stays forward');

  const forced = spawnSync(process.execPath, [script, '--dir', dir, '--manifest', backwardPath, '--allow-downgrade'], { encoding: 'utf8' });
  assert.equal(forced.status, 0, forced.stderr);
  assert.match(readFileSync(path.join(dir, 'index.html'), 'utf8'), /v0\.3\.9/u);
});
