import { spawnSync } from 'node:child_process';
import { clipboard } from 'electron';

export function writeSystemClipboard(text: string): void {
  clipboard.writeText(text);
  if (clipboard.readText() === text) return;
  if (process.platform === 'darwin') {
    const result = spawnSync('pbcopy', { input: text, encoding: 'utf8' });
    if (result.status === 0) return;
  }
  throw new Error('clipboard write did not stick');
}
