import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);

const errors = [];
const appId = packageJson.build?.appId;

if (process.platform !== 'darwin') {
  errors.push('正式 macOS 包必须在 macOS 上构建。');
}

try {
  execFileSync('xcodebuild', ['-version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
} catch {
  errors.push('未检测到完整 Xcode；正式签名与公证构建不能只依赖 Command Line Tools。');
}

if (typeof appId !== 'string' || appId.startsWith('local.') || appId.includes('.demo.')) {
  errors.push(
    `当前 appId=${String(appId)} 仍是本地 Demo 身份，请先确认公司长期使用的反向域名 Bundle ID。`,
  );
}

let hasDeveloperId = false;
try {
  const identities = execFileSync(
    'security',
    ['find-identity', '-v', '-p', 'codesigning'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  );
  hasDeveloperId = identities.includes('Developer ID Application:');
} catch {
  // A certificate supplied through CSC_LINK is imported by electron-builder later.
}

const hasExternalCertificate = Boolean(process.env.CSC_LINK);
if (!hasDeveloperId && !hasExternalCertificate) {
  errors.push(
    '未发现 Developer ID Application 证书，也未设置 CSC_LINK。未签名包不得外部分发。',
  );
}

const hasApiKey = [
  process.env.APPLE_API_KEY,
  process.env.APPLE_API_KEY_ID,
  process.env.APPLE_API_ISSUER,
].every(Boolean);
const hasAppleId = [
  process.env.APPLE_ID,
  process.env.APPLE_APP_SPECIFIC_PASSWORD,
  process.env.APPLE_TEAM_ID,
].every(Boolean);
const hasKeychainProfile = [
  process.env.APPLE_KEYCHAIN,
  process.env.APPLE_KEYCHAIN_PROFILE,
].every(Boolean);

if (!hasApiKey && !hasAppleId && !hasKeychainProfile) {
  errors.push(
    '未配置 Apple 公证凭证。推荐使用 APPLE_API_KEY / APPLE_API_KEY_ID / APPLE_API_ISSUER。',
  );
}

if (errors.length > 0) {
  console.error('macOS 正式发布前置检查失败：');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  console.error('本机验证请使用 pnpm package:mac:local；它产出的未签名包禁止外发。');
  process.exit(1);
}

console.log('macOS 正式发布前置检查通过：Bundle ID、签名证书和公证凭证已就绪。');
