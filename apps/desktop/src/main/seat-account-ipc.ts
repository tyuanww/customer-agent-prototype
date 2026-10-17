import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ipcMain, type WebContents } from 'electron';
import { isSeatAccountIntent, seatAccountReply, type SeatAccountReply } from '../shared/seat-account-intent';
import { isTrustedMainFrameSender } from './sender-guard';

const CHANNEL = 'dashboard:seats-command';
const NOT_SAVED: SeatAccountReply = { ok: false, message: '账号没有保存。' };
const INVALID: SeatAccountReply = { ok: false, message: '账号输入无效。' };

function seatRuntimeScript(moduleUrl = import.meta.url): string {
  return path.resolve(path.dirname(fileURLToPath(moduleUrl)), '../../../../scripts/synthetic-stack/seat-account-runtime.ts');
}

function nodeBinary(): string {
  const fromPackageManager = process.env.npm_node_execpath;
  if (fromPackageManager && existsSync(fromPackageManager)) return fromPackageManager;
  const homebrew = path.join(os.homedir(), 'homebrew/opt/node@24/bin/node');
  if (existsSync(homebrew)) return homebrew;
  return 'node';
}

function failureCode(error: unknown): string {
  if (error instanceof Error && (error.message === 'timeout' || error.message === 'overflow')) return error.message;
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') return error.code;
  return 'unknown';
}

function runRuntime(script: string, payload: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(nodeBinary(), [script], { stdio: ['pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (error?: Error, text = '') => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (error) reject(error);
      else resolve(text);
    };
    timer = setTimeout(() => {
      child.kill();
      finish(new Error('timeout'));
    }, 15000);
    child.stderr.on('data', () => undefined);
    child.stdout.on('data', (chunk: Buffer) => {
      out.push(chunk);
      if (Buffer.concat(out).length > 65536) {
        child.kill();
        finish(new Error('overflow'));
      }
    });
    child.on('error', error => finish(error));
    child.on('close', () => finish(undefined, Buffer.concat(out).toString('utf8')));
    child.stdin.end(payload);
  });
}

async function perform(intent: unknown): Promise<SeatAccountReply> {
  const script = seatRuntimeScript();
  if (!existsSync(script)) return { ok: false, message: '账号还不能在这里改。' };
  let text: string;
  try {
    text = await runRuntime(script, JSON.stringify(intent));
  } catch (error) {
    console.error(`seat account command failed: ${failureCode(error)}`);
    return NOT_SAVED;
  }
  try {
    return seatAccountReply(JSON.parse(text)) ?? NOT_SAVED;
  } catch {
    console.error('seat account command failed: invalid-reply');
    return NOT_SAVED;
  }
}

export function registerSeatAccountIpc(
  dashboard: () => WebContents | null,
  devUrl: () => string | undefined,
  enabled: () => boolean,
) {
  ipcMain.handle(CHANNEL, async (event, intent: unknown): Promise<SeatAccountReply> => {
    const contents = dashboard();
    if (!contents || !isTrustedMainFrameSender(event, [contents], devUrl())) return { ok: false, message: '无权访问此窗口能力。' };
    if (!enabled()) return { ok: false, message: '账号还不能在这里改。' };
    if (!isSeatAccountIntent(intent)) return INVALID;
    return perform(intent);
  });
  return { dispose: () => { ipcMain.removeHandler(CHANNEL); } };
}
