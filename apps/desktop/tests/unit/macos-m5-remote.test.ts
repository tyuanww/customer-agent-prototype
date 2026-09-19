import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const m5 = readFileSync(path.join(repoRoot, 'docs/how-to-verify-macos-m5.md'), 'utf8');

describe('M5 remote profile rows', () => {
  it('keeps product-remote as 未观察 and offline as 不适用', () => {
    expect(m5).toContain('### 7.1 新 profile：不适用与待重验');
    expect(m5).toContain('`product-remote` HTTPS');
    const remoteSection = m5.slice(m5.indexOf('### 7.1'));
    expect(remoteSection).toContain('**未观察**');
    expect(remoteSection).toContain('**不适用** 主链');
    expect(remoteSection).not.toMatch(/product-remote[\s\S]{0,200}\*\*通过\*\*/);
    expect(remoteSection).not.toContain('M5 已完成');
    expect(remoteSection).toContain('网络错误不得记成身份失效');
  });
});
