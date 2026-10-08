import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { INTAKE_POLICY as P, failedParse, isParseResult, CSV_TEMPLATE_VERSION, CSV_POLICY_VERSION, TEMPLATE_VERSION, type IntakeParseContext, type ParseResult } from './policy.js';

export type ProcessResult = Readonly<{ result: ParseResult; elapsedMs: number; maxRssKiB: number; networkAttempts: number }>;
/** Owns one bounded parsing process at a time. Cancel/timeout resolve only after exit,
 * so a late stdout callback cannot revive an old job or consume the next job's slot.
 * No session environment or file path is accepted. Electron utilityProcess packaging
 * and an OS memory/network sandbox remain separate P2/P4 work. */
export function createParseRunner() {
  let active = false;
  return {
    async parse(bytes: Buffer, context: IntakeParseContext, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<ProcessResult> {
      const started = performance.now();
      const policyVersion = context?.templateVersion === CSV_TEMPLATE_VERSION ? CSV_POLICY_VERSION : P.version;
      const failed = (code: string): ProcessResult => ({ result: failedParse(code, policyVersion), elapsedMs: performance.now() - started, maxRssKiB: 0, networkAttempts: 0 });
      if (!context || ![CSV_TEMPLATE_VERSION, TEMPLATE_VERSION].includes(context.templateVersion)) return failed('INVALID_CONTEXT');
      if (options.signal?.aborted) return failed('CANCELLED');
      if (active) return failed('BUSY');
      if (bytes.length > P.fileBytes) return failed('FILE_TOO_LARGE');
      const timeoutMs = options.timeoutMs ?? P.timeoutMs;
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > P.timeoutMs) return failed('INVALID_TIMEOUT');
      active = true;
      try {
        return await new Promise<ProcessResult>((resolve) => {
          const child = spawn(process.execPath, ['--max-old-space-size=192', fileURLToPath(new URL('./parser-process.js', import.meta.url)), JSON.stringify(context)], {
            env: {}, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
          });
          let reason: string | undefined;
          let size = 0;
          const output: Buffer[] = [];
          const stop = (code: string) => { reason ??= code; child.kill('SIGKILL'); };
          const cancel = () => stop('CANCELLED');
          options.signal?.addEventListener('abort', cancel, { once: true });
          if (options.signal?.aborted) cancel();
          const timer = setTimeout(() => stop('TIMEOUT'), timeoutMs);
          child.stdout.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > P.outputBytes) stop('OUTPUT_LIMIT'); else output.push(chunk);
          });
          child.stderr.resume(); // Untrusted library diagnostics are never reflected to a caller.
          child.on('error', () => { reason ??= 'PROCESS_FAILURE'; });
          child.stdin.on('error', () => { reason ??= 'PROCESS_FAILURE'; });
          child.on('close', (code) => {
            clearTimeout(timer); options.signal?.removeEventListener('abort', cancel);
            if (reason || code !== 0) { resolve(failed(reason ?? 'PROCESS_FAILURE')); return; }
            try {
              const message = JSON.parse(Buffer.concat(output).toString('utf8'));
              if (!isParseResult(message.result, policyVersion) || !Number.isFinite(message.maxRssKiB)
                || message.maxRssKiB < 0 || message.networkAttempts !== 0) throw new Error('INVALID_OUTPUT');
              resolve({ result: message.result, maxRssKiB: message.maxRssKiB, networkAttempts: 0, elapsedMs: performance.now() - started });
            } catch { resolve(failed('PROCESS_FAILURE')); }
          });
          child.stdin.end(bytes);
        });
      } finally { active = false; }
    },
  };
}
