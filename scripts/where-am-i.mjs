import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = readFileSync(path.join(repositoryRoot, 'VERSION'), 'utf8').trim();
const head = execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).trim();
const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).trim();
const profilePath = path.join(homedir(), 'Library/Application Support/客服话术浮窗 Demo/synthetic-stack.json');
const appIdentity = path.join(
  repositoryRoot,
  'release/local-unsigned/mac-universal/客服话术浮窗 Demo.app/Contents/Resources/build-identity.json',
);

function pointLabel(mode, apiOrigin) {
  if (mode === 'synthetic-offline') return '离线';
  try {
    const hostname = new URL(apiOrigin).hostname;
    if (hostname === 'agent-auth.jianghua.site') return '杭州';
    if (hostname === '127.0.0.1') return '本机';
  } catch {
    // The profile is unreadable or not a URL.
  }
  return '未知指向';
}

let profileLine = '指向  没有 synthetic-stack.json';
if (existsSync(profilePath)) {
  const profile = JSON.parse(readFileSync(profilePath, 'utf8'));
  profileLine = `指向  ${pointLabel(profile.mode, profile.apiOrigin)}  ${profile.mode ?? ''}  ${profile.apiOrigin ?? ''}`;
}

let packageLine = '安装包  没有构建身份。版本号相同也不能当成同一次构建。';
if (existsSync(appIdentity)) {
  const stamp = JSON.parse(readFileSync(appIdentity, 'utf8'));
  const when = statSync(appIdentity).mtime.toISOString();
  packageLine = `安装包  ${stamp.productVersion}  ${String(stamp.gitSha).slice(0, 7)}  ${when}`;
}

console.log(`代码  ${version}  ${head}  ${branch}`);
console.log(profileLine);
console.log(packageLine);
