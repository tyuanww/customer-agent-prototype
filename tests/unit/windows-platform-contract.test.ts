import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const packageJson = JSON.parse(
  readFileSync(path.join(root, 'package.json'), 'utf8'),
) as {
  scripts: Record<string, string>;
  build: {
    directories: { output: string };
    win: {
      signAndEditExecutable: boolean;
      artifactName: string;
      certificateFile?: string;
      certificateSha1?: string;
    };
  };
};
const packageWindows = readFileSync(path.join(root, 'scripts/package-windows.mjs'), 'utf8');
const readme = readFileSync(path.join(root, 'README.md'), 'utf8');

describe('Windows local-unsigned packaging contract', () => {
  it('keeps package:win as an explicit UNSIGNED local proof, isolated from distribution', () => {
    expect(packageJson.scripts['package:win']).toBe('node scripts/package-windows.mjs local');
    expect(packageJson.scripts['package:win:distribution']).toBeUndefined();
    expect(packageJson.build.directories.output).toBe('release');
    expect(packageJson.build.win.signAndEditExecutable).toBe(false);
    expect(packageJson.build.win.certificateFile).toBeUndefined();
    expect(packageJson.build.win.certificateSha1).toBeUndefined();
    expect(packageJson.build.win.artifactName).toContain('-UNSIGNED.');

    expect(packageWindows).toContain("'release/local-unsigned'");
    expect(packageWindows).toContain("CSC_IDENTITY_AUTO_DISCOVERY: 'false'");
    expect(packageWindows).toContain('-UNSIGNED.${ext}');
    expect(packageWindows).toContain('-c.win.signAndEditExecutable=false');
    expect(packageWindows).toContain('local-unsigned only');
    expect(packageWindows).not.toContain('release/distribution');
    expect(packageWindows).not.toMatch(/signtool|osslsigncode|Authenticode|EV certificate/i);
  });

  it('documents the unsigned fact and forbids presenting the local artifact as a signed release', () => {
    expect(readme).toContain('pnpm package:win');
    expect(readme).toContain('release/local-unsigned/');
    expect(readme).toContain('UNSIGNED');
    expect(readme).toContain('**不是**正式外发包');
    expect(readme).toContain('release/distribution/');
    expect(readme).toContain('禁止把未签名产物写成已签名');
    expect(readme).not.toMatch(/Windows 正式签名|已签名的 Windows|Windows 安装包已签名/);
  });
});
