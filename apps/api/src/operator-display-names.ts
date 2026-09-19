import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const FILE = join(homedir(), '.customer-agent-synthetic-stack', 'operator-display-names.json');

export function persistOperatorDisplayName(userId: string, name: string): void {
  const trimmed = name.trim().slice(0, 64);
  if (userId.length < 1 || trimmed.length < 1) return;
  const dir = join(homedir(), '.customer-agent-synthetic-stack');
  mkdirSync(dir, { recursive: true });
  const current = readAll();
  current[userId] = trimmed;
  writeFileSync(FILE, `${JSON.stringify(current)}\n`, { mode: 0o600 });
}

function readAll(): Record<string, string> {
  if (!existsSync(FILE)) return {};
  try {
    const value: unknown = JSON.parse(readFileSync(FILE, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const out: Record<string, string> = {};
    for (const [key, name] of Object.entries(value as Record<string, unknown>)) {
      if (typeof name === 'string' && name.trim().length > 0) out[key] = name.trim().slice(0, 64);
    }
    return out;
  } catch {
    return {};
  }
}
