/**
 * MiniMax OpenAI-compatible chat. Electron main uses Chromium net.fetch.
 * Never used to generate customer-facing script text.
 */
import { createRequire } from 'node:module';

const DEFAULT_BASE = 'https://api.minimaxi.com/v1';
const DEFAULT_MODEL = 'MiniMax-M3';

export type MinimaxChatOptions = Readonly<{
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}>;

function electronFetch(): typeof fetch | null {
  try {
    const electron = createRequire(import.meta.url)('electron') as { net?: { fetch?: typeof fetch } };
    return typeof electron.net?.fetch === 'function' ? electron.net.fetch.bind(electron.net) : null;
  } catch {
    return null;
  }
}

export function minimaxConfigured(): boolean {
  return Boolean(process.env.MINIMAX_API_KEY?.trim());
}

export async function minimaxChatContent(
  messages: readonly { role: 'system' | 'user'; content: string }[],
  options: MinimaxChatOptions = {},
): Promise<string | null> {
  const apiKey = process.env.MINIMAX_API_KEY?.trim();
  if (!apiKey) return null;
  const base = (process.env.MINIMAX_BASE_URL?.trim() || DEFAULT_BASE).replace(/\/$/, '');
  if (!base.startsWith('https://')) return null;
  const model = process.env.MINIMAX_MODEL?.trim() || DEFAULT_MODEL;
  const netFetch = electronFetch();
  const fetchImpl = options.fetchImpl ?? netFetch ?? fetch;
  if (!options.fetchImpl && !netFetch) console.warn('[minimax-chat] fallback Node fetch');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 2500);
  const signal = options.signal
    ? AbortSignal.any([controller.signal, options.signal])
    : controller.signal;
  try {
    const response = await fetchImpl(`${base}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens: options.maxTokens ?? 200,
        thinking: { type: 'disabled' },
        messages,
      }),
      redirect: 'error',
      signal,
    });
    if (!response.ok) return null;
    const raw = await response.text();
    if (raw.length > 1_048_576) return null;
    const body: unknown = JSON.parse(raw);
    const content = (body as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content;
    return typeof content === 'string' && content.trim().length > 0 ? content : null;
  } catch (error) {
    const detail = error instanceof Error ? error.name : 'error';
    console.warn(`[minimax-chat] fallback ${detail}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
