import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const FILE = join(homedir(), '.customer-agent-synthetic-stack', 'operator-display-names.json');

export function readOperatorDisplayName(userId: string): string | null {
  if (!existsSync(FILE)) return null;
  try {
    const value: unknown = JSON.parse(readFileSync(FILE, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const name = Reflect.get(value, userId);
    if (typeof name !== 'string') return null;
    const trimmed = name.trim().slice(0, 64);
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

export function humanizeUserId(userId: string): string {
  return userId.startsWith('usr_') ? userId.slice(4) : userId;
}
