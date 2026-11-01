import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { INTAKE_POLICY as P, failedParse, isParseResult, CSV_TEMPLATE_VERSION, CSV_POLICY_VERSION, TEMPLATE_VERSION, type IntakeParseContext, type ParseResult } from './policy.js';
import { decodeSopOutcome, type SopOutcome, type SopScope } from './sop-process.js';

export type ProcessResult = Readonly<{ result: ParseResult; elapsedMs: number; maxRssKiB: number; networkAttempts: number }>;
export type SopProcessResult = SopOutcome | { kind: 'failure'; result: ParseResult };
type RunOptions = Readonly<{ signal?: AbortSignal; timeoutMs?: number }>;
type ChildResult = { kind: 'response'; result: unknown; elapsedMs: number; maxRssKiB: number }
  | { kind: 'failure'; code: string; elapsedMs: number };

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,128}$/u.test(value);

/** One owner serializes FAQ and SOP children and waits for exit after cancel or timeout. */
export function createParseRunner(config: Readonly<{ sopDecoderUrl?: URL }> = {}) {
  let active = false;
  async function run(bytes: Buffer, context: unknown, options: RunOptions): Promise<ChildResult> {
    const started = performance.now();
    const failed = (code: string): ChildResult => ({ kind: 'failure', code, elapsedMs: performance.now() - started });
    if (options.signal?.aborted) return failed('CANCELLED');
    if (active) return failed('BUSY');
    if (bytes.length > P.fileBytes) return failed('FILE_TOO_LARGE');
    const timeoutMs = options.timeoutMs ?? P.timeoutMs;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > P.timeoutMs) return failed('INVALID_TIMEOUT');
    active = true;
    try {
      return await new Promise<ChildResult>(resolve => {
        const child = spawn(process.execPath, ['--max-old-space-size=192', fileURLToPath(new URL('./parser-process.js', import.meta.url)), JSON.stringify(context)], {
          env: {}, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
        });
        let reason: string | undefined, size = 0;
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
        child.stderr.resume();
        child.on('error', () => { reason ??= 'PROCESS_FAILURE'; });
        child.stdin.on('error', () => { reason ??= 'PROCESS_FAILURE'; });
        child.on('close', code => {
          clearTimeout(timer); options.signal?.removeEventListener('abort', cancel);
          if (reason || code !== 0) { resolve(failed(reason ?? 'PROCESS_FAILURE')); return; }
          try {
            const message: unknown = JSON.parse(Buffer.concat(output).toString('utf8'));
            if (!object(message) || typeof message.maxRssKiB !== 'number' || !Number.isFinite(message.maxRssKiB)
              || message.maxRssKiB < 0 || message.networkAttempts !== 0) throw new Error('INVALID_OUTPUT');
            resolve({ kind: 'response', result: message.result, maxRssKiB: message.maxRssKiB, elapsedMs: performance.now() - started });
          } catch { resolve(failed('PROCESS_FAILURE')); }
        });
        child.stdin.end(bytes);
      });
    } finally { active = false; }
  }
  return {
    async parse(bytes: Buffer, context: IntakeParseContext, options: RunOptions = {}): Promise<ProcessResult> {
      const policyVersion = context?.templateVersion === CSV_TEMPLATE_VERSION ? CSV_POLICY_VERSION : P.version;
      if (!context || ![CSV_TEMPLATE_VERSION, TEMPLATE_VERSION].includes(context.templateVersion)) {
        return { result: failedParse('INVALID_CONTEXT', policyVersion), elapsedMs: 0, maxRssKiB: 0, networkAttempts: 0 };
      }
      const output = await run(bytes, context, options);
      if (output.kind === 'failure') return { result: failedParse(output.code, policyVersion), elapsedMs: output.elapsedMs, maxRssKiB: 0, networkAttempts: 0 };
      return { result: isParseResult(output.result, policyVersion) ? output.result : failedParse('PROCESS_FAILURE', policyVersion),
        elapsedMs: output.elapsedMs, maxRssKiB: output.maxRssKiB, networkAttempts: 0 };
    },
    async parseSop(bytes: Buffer, scope: SopScope, options: RunOptions = {}): Promise<SopProcessResult> {
      const decoder = config.sopDecoderUrl;
      if (!decoder || decoder.protocol !== 'file:' || !scope || !identifier(scope.sourceId) || !identifier(scope.brandId)
        || (scope.shopId !== null && !identifier(scope.shopId))) return { kind: 'failure', result: failedParse('INVALID_CONTEXT') };
      const request = { kind: 'sop', scope: { sourceId: scope.sourceId, brandId: scope.brandId, shopId: scope.shopId }, decoderUrl: decoder.href };
      const output = await run(bytes, request, options);
      if (output.kind === 'failure') return { kind: 'failure', result: failedParse(output.code) };
      return decodeSopOutcome(output.result) ?? { kind: 'failure', result: failedParse('PROCESS_FAILURE') };
    },
  };
}
