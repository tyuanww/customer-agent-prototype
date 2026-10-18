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
const identityCandidates = [
  'release/local-unsigned/mac-universal/客服话术浮窗 Demo.app/Contents/Resources/build-identity.json',
  'release/distribution/mac-universal/客服话术浮窗 Demo.app/Contents/Resources/build-identity.json',
].map((relative) => path.join(repositoryRoot, relative));

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function pointLabel(mode, apiOrigin) {
  if (mode === 'synthetic-offline') return '离线';
  try {
    const hostname = new URL(apiOrigin).hostname;
    if (hostname === 'agent-auth.jianghua.site') return '杭州';
    if (hostname === '127.0.0.1') return '本机';
  } catch {
    // A bad URL falls through to 未知指向.
  }
  return '未知指向';
}

let profileLine = '指向  没有 synthetic-stack.json';
if (existsSync(profilePath)) {
  const profile = readJson(profilePath);
  profileLine = profile !== null && typeof profile === 'object'
    ? `指向  ${pointLabel(profile.mode, profile.apiOrigin)}  ${profile.mode ?? ''}  ${profile.apiOrigin ?? ''}`
    : '指向  synthetic-stack.json 读不了';
}

const appIdentity = identityCandidates.find((candidate) => existsSync(candidate));
let packageLine = '安装包  没有构建身份。版本号相同也不能当成同一次构建。';
if (appIdentity) {
  const stamp = readJson(appIdentity);
  const sha = stamp !== null && typeof stamp === 'object' && typeof stamp.gitSha === 'string' && stamp.gitSha.length > 0
    ? stamp.gitSha.slice(0, 7)
    : '未知提交';
  const version = stamp !== null && typeof stamp === 'object' && typeof stamp.productVersion === 'string'
    ? stamp.productVersion
    : '未知版本';
  packageLine = `安装包  ${version}  ${sha}  ${statSync(appIdentity).mtime.toISOString()}`;
}

console.log(`代码  ${version}  ${head}  ${branch}`);
console.log(profileLine);
console.log(packageLine);
