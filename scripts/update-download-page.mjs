#!/usr/bin/env node
/**
 * Publish the current release on the official download page.
 *
 * The `gh-pages` branch is a hand-maintained static page with the version and
 * every asset URL hard-coded in `index.html` / `windows.html`. Nothing rewrote
 * them before, so the site silently lagged the GitHub Release. This script is
 * the missing step: it derives every value from one Release and rewrites the
 * two pages, or fails loudly when the release does not match what the page
 * expects.
 *
 * Values come from the Release, never from the page, so a stale page can only
 * be stale, not wrong. That only holds while every rewrite is accounted for: the
 * script also refuses to publish a page it cannot fully recognise, and refuses
 * to move the page backwards to an older release.
 *
 * Usage (from a `gh-pages` checkout, or its worktree):
 *   node scripts/update-download-page.mjs --dir <gh-pages dir> --from-release v0.3.25
 *   node scripts/update-download-page.mjs --dir <gh-pages dir> --manifest manifest.json
 *   node scripts/update-download-page.mjs --dir <gh-pages dir> --manifest -   # stdin
 *   node scripts/update-download-page.mjs --dir <gh-pages dir> --check       # fail if stale
 *
 * Options:
 *   --version-out <file>   write the version the Release resolved to
 *   --allow-downgrade      permit publishing an older release over a newer page
 *
 * The `--manifest` path takes the shape `manifestFromRelease` returns, which is
 * what the tests feed in so no test touches the network.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const RELEASE_REPO = 'tyuanww/customer-agent-prototype';
export const PLATFORMS = Object.freeze(['win', 'mac', 'linux']);

/** The three panels the page links, and how to recognise each asset name. */
const PLATFORM_MATCHERS = Object.freeze([
  ['win', /win-x64/u, /\.exe$/u],
  ['mac', /mac-universal/u, /\.dmg$/u],
  ['linux', /linux-x86_64/u, /\.AppImage$/u],
]);

/** The page shows MiB with an "MB" label: 91_430_255 -> "87.2". */
const BYTES_PER_MB = 1024 * 1024;

const RELEASE_BASE = `https://github.com/${RELEASE_REPO}/releases/download`;

/**
 * Which platform slot an asset name fills, or null for assets the page does not
 * link (for example the macOS `.zip` that ships alongside the `.dmg`).
 */
export function platformOf(assetName) {
  const name = String(assetName);
  for (const [platform, family, extension] of PLATFORM_MATCHERS) {
    if (family.test(name) && extension.test(name)) return platform;
  }
  return null;
}

/** Bytes to the one-decimal MiB string the page prints. */
export function formatSizeMb(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`invalid asset size: ${String(bytes)}`);
  return (value / BYTES_PER_MB).toFixed(1);
}

/** Release timestamp to the page's unpadded `2026年9月29日` (Asia/Shanghai). */
export function formatDateZh(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) throw new Error(`invalid release timestamp: ${String(iso)}`);
  const part = (type) =>
    new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    })
      .formatToParts(date)
      .find((entry) => entry.type === type)?.value;
  return `${part('year')}年${part('month')}月${part('day')}日`;
}

/**
 * Normalise a `gh release view --json tagName,publishedAt,assets` payload into
 * the manifest the renderer consumes. Fails closed: a missing platform asset or
 * an asset without a sha256 digest stops the publish instead of shipping a page
 * with a broken link or a wrong checksum.
 */
export function manifestFromRelease(release) {
  if (!release || typeof release !== 'object') throw new Error('release payload must be an object');
  const version = String(release.tagName ?? '').replace(/^v/u, '');
  if (!/^\d+\.\d+\.\d+$/u.test(version)) throw new Error(`unexpected release tag: ${String(release.tagName)}`);

  const assets = {};
  for (const asset of release.assets ?? []) {
    const platform = platformOf(asset.name);
    if (!platform) continue;
    const sha256 = String(asset.digest ?? '').replace(/^sha256:/u, '');
    if (!/^[0-9a-f]{64}$/u.test(sha256)) throw new Error(`asset ${asset.name} has no sha256 digest`);
    assets[platform] = { name: asset.name, bytes: asset.size, sha256 };
  }
  for (const platform of PLATFORMS) {
    if (!assets[platform]) throw new Error(`release v${version} is missing its ${platform} asset`);
  }
  return { version, date: formatDateZh(release.publishedAt), assets };
}

/**
 * Replace the first match inside the `id="<panelId>"` block, or throw when that
 * block is gone or does not carry the expected markup. The region stops at the
 * next panel, so a broken early panel fails instead of silently editing a later
 * one.
 */
function replaceAfterId(html, panelId, pattern, replacement, label) {
  const anchor = html.indexOf(`id="${panelId}"`);
  if (anchor === -1) throw new Error(`download page is missing the ${panelId} panel`);
  const boundary = html.indexOf('id="panel-', anchor + 1);
  const end = boundary === -1 ? html.length : boundary;
  const region = html.slice(anchor, end);
  // Match and replace separately: a correct value yielding an identical string
  // is a no-op, not a missing panel.
  if (!pattern.test(region)) throw new Error(`${panelId}: could not find ${label}`);
  return html.slice(0, anchor) + region.replace(pattern, replacement) + html.slice(end);
}

/**
 * Any release download URL, whichever repository hosts it. Owner and repository
 * are captured rather than hard-coded: anchoring on the expected repository made
 * a page pointing anywhere else simply not match, so the URL rewrite vanished
 * without a word.
 */
const RELEASE_URL = /https:\/\/github\.com\/([^/\s"]+)\/([^/\s"]+)\/releases\/download\/v([^/"]+)\/([^"]+)/gu;

/** The versions a page mentions. A page should describe exactly one release. */
const PAGE_VERSIONS = /\bv(\d+\.\d+\.\d+)\b/gu;

/**
 * Rewrite everything both pages share: release asset URLs, version strings, and
 * the `Demo-<version>-` filename prefix. The asset URL is authoritative — the
 * version inside it comes from the release, not from string surgery.
 *
 * `required` lists the platforms the page has to link. Everything is checked
 * before anything is written, so a page that has drifted is reported instead of
 * being published half-rewritten.
 */
function applyReleaseIdentity(html, manifest, required) {
  const versions = new Set(html.match(PAGE_VERSIONS) ?? []);
  if (versions.size > 1) {
    throw new Error(`page carries more than one version: ${[...versions].sort().join(', ')}`);
  }

  const seen = new Set();
  const rewritten = html.replace(RELEASE_URL, (_match, owner, repo, _version, oldName) => {
    if (`${owner}/${repo}` !== RELEASE_REPO) {
      throw new Error(`page links a release on ${owner}/${repo}, but this script publishes ${RELEASE_REPO}`);
    }
    const platform = platformOf(oldName);
    if (!platform) throw new Error(`page links an asset this script cannot map: ${oldName}`);
    seen.add(platform);
    return `${RELEASE_BASE}/v${manifest.version}/${manifest.assets[platform].name}`;
  });

  if (seen.size === 0) throw new Error('page links no release asset at all');
  for (const platform of required) {
    if (!seen.has(platform)) throw new Error(`page no longer links the ${platform} asset`);
  }

  return rewritten
    .replace(/Demo-\d+\.\d+\.\d+-/gu, `Demo-${manifest.version}-`)
    .replace(PAGE_VERSIONS, `v${manifest.version}`);
}

/** The `data-copy` chip: full digest in the attribute, `first8…last8` as text. */
function digestChip(sha256) {
  return { full: sha256, short: `${sha256.slice(0, 8)}…${sha256.slice(-8)}` };
}

/** `index.html` carries the panels, hero size, checksum chips and the date. */
export function renderIndex(html, manifest) {
  let next = applyReleaseIdentity(html, manifest, PLATFORMS);
  next = next.replace(/\d{4}年\d{1,2}月\d{1,2}日/u, manifest.date);

  const windowsSize = formatSizeMb(manifest.assets.win.bytes);
  next = next.replace(/Windows 10\+ x64 · [\d.]+ MB/u, `Windows 10+ x64 · ${windowsSize} MB`);

  for (const platform of PLATFORMS) {
    const asset = manifest.assets[platform];
    const size = formatSizeMb(asset.bytes);
    const { full, short } = digestChip(asset.sha256);
    next = replaceAfterId(
      next,
      `panel-${platform}`,
      /data-copy="[0-9a-f]{64}">SHA-256\u3000[0-9a-f]{8}…[0-9a-f]{8}/u,
      `data-copy="${full}">SHA-256\u3000${short}`,
      'checksum chip',
    );
    next = replaceAfterId(
      next,
      `panel-${platform}`,
      /下载 · [\d.]+ MB/u,
      `下载 · ${size} MB`,
      'download size',
    );
  }
  return next;
}

/** `windows.html` is a one-line redirect: identity plus the version string. */
export function renderWindows(html, manifest) {
  return applyReleaseIdentity(html, manifest, ['win']);
}

/** Numeric, not lexicographic: 0.10.0 sorts above 0.9.9. */
export function compareVersions(left, right) {
  const a = String(left).split('.').map(Number);
  const b = String(right).split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}

/** The version a page advertises right now, or null when it carries none. */
export function publishedVersion(html) {
  const match = /\bv(\d+\.\d+\.\d+)\b/u.exec(String(html));
  return match ? match[1] : null;
}

/**
 * Rewrite the two pages in `dir`. Returns the changed file names; an already
 * current page yields an empty list, so the publish step is idempotent.
 *
 * A page that already advertises a newer release is left alone unless
 * `allowDowngrade` is set. Backfilling an old release is a supported thing to
 * do, but it must not quietly walk the official page backwards.
 */
export function updateDownloadPages({ dir, manifest, check = false, allowDowngrade = false }) {
  const changes = [];
  const files = [
    ['index.html', renderIndex],
    ['windows.html', renderWindows],
  ];
  for (const [name, render] of files) {
    const file = path.join(dir, name);
    const before = readFileSync(file, 'utf8');
    const current = publishedVersion(before);
    if (!allowDowngrade && current !== null && compareVersions(manifest.version, current) < 0) {
      throw new Error(
        `${name} advertises v${current}; refusing to publish the older v${manifest.version}` +
          ' (pass --allow-downgrade to intend it)',
      );
    }
    const after = render(before, manifest);
    if (before === after) continue;
    changes.push(name);
    if (!check) writeFileSync(file, after);
  }
  return changes;
}

/** `gh release view --json ...` for one tag, using the caller's GH_TOKEN. */
export function fetchRelease(tag) {
  const stdout = execFileSync(
    'gh',
    ['release', 'view', tag, '--repo', RELEASE_REPO, '--json', 'tagName,publishedAt,assets'],
    { encoding: 'utf8' },
  );
  return JSON.parse(stdout);
}

function parseArgs(argv) {
  const options = {
    dir: process.cwd(),
    check: false,
    allowDowngrade: false,
    fromRelease: null,
    manifest: null,
    versionOut: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--check') options.check = true;
    else if (flag === '--allow-downgrade') options.allowDowngrade = true;
    else if (flag === '--dir') options.dir = argv[++index];
    else if (flag === '--from-release') options.fromRelease = argv[++index];
    else if (flag === '--manifest') options.manifest = argv[++index];
    else if (flag === '--version-out') options.versionOut = argv[++index];
    else throw new Error(`unknown argument: ${flag}`);
  }
  return options;
}

function loadManifest(options) {
  if (options.manifest) {
    const raw = options.manifest === '-' ? readFileSync(0, 'utf8') : readFileSync(options.manifest, 'utf8');
    return JSON.parse(raw);
  }
  if (options.fromRelease) return manifestFromRelease(fetchRelease(options.fromRelease));
  throw new Error('pass --from-release <tag> or --manifest <file|->');
}

function main(argv) {
  const options = parseArgs(argv);
  const manifest = loadManifest(options);
  const changes = updateDownloadPages({
    dir: options.dir,
    manifest,
    check: options.check,
    allowDowngrade: options.allowDowngrade,
  });
  // Written after the rewrite, so the file never records a version that failed
  // to publish. The workflow commits this value rather than the raw tag.
  if (options.versionOut) writeFileSync(options.versionOut, `${manifest.version}\n`);
  const size = Object.values(manifest.assets)
    .map((asset) => `${asset.name} ${formatSizeMb(asset.bytes)} MB`)
    .join(', ');
  if (changes.length === 0) {
    process.stdout.write(`download page already at v${manifest.version} (${size})\n`);
    return;
  }
  if (options.check) {
    process.stderr.write(`download page is stale, run without --check: ${changes.join(', ')}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`download page -> v${manifest.version} (${size}); updated ${changes.join(', ')}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
