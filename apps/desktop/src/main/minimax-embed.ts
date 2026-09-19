import { minimaxConfigured, type MinimaxChatOptions } from './minimax-chat.ts';
import { electronNetFetch } from './desktop-fetch.ts';
import { DENSE_MODEL_EMBO } from '../shared/dense-retrieve.ts';

export const EMBED_BATCH = 16;
export const EMBED_MAX_CHARS = 2000;

export type EmbedKind = 'db' | 'query';

function clip(text: string): string {
  return [...text].slice(0, EMBED_MAX_CHARS).join('');
}

export function parseEmbedVectors(raw: unknown, expected: number): readonly (readonly number[])[] | null {
  if (!raw || typeof raw !== 'object') return null;
  const status = Reflect.get(raw, 'base_resp');
  if (status && typeof status === 'object') {
    const code = Reflect.get(status, 'status_code');
    if (code !== 0 && code !== undefined) return null;
  }
  const vectors = Reflect.get(raw, 'vectors');
  if (!Array.isArray(vectors) || vectors.length !== expected) return null;
  const out: number[][] = [];
  for (const item of vectors) {
    if (!Array.isArray(item) || item.length < 2) return null;
    if (item.some((cell) => typeof cell !== 'number' || !Number.isFinite(cell))) return null;
    out.push(item.map((cell) => Number(cell)));
  }
  const dim = out[0]?.length;
  if (!dim || out.some((row) => row.length !== dim)) return null;
  return Object.freeze(out.map((row) => Object.freeze(row)));
}

export async function minimaxEmbed(
  texts: readonly string[],
  kind: EmbedKind,
  options: MinimaxChatOptions & { model?: string } = {},
): Promise<readonly (readonly number[])[] | null> {
  const clipped = texts.map((text) => clip(text.trim())).filter((text) => text.length > 0);
  if (clipped.length === 0 || !minimaxConfigured()) return null;
  const apiKey = process.env.MINIMAX_API_KEY?.trim();
  if (!apiKey) return null;
  const base = (process.env.MINIMAX_BASE_URL?.trim() || 'https://api.minimaxi.com/v1').replace(/\/$/, '');
  if (!base.startsWith('https://')) return null;
  const model = options.model?.trim() || process.env.MINIMAX_EMBED_MODEL?.trim() || DENSE_MODEL_EMBO;
  const netFetch = electronNetFetch();
  const fetchImpl = options.fetchImpl ?? netFetch ?? fetch;
  if (!options.fetchImpl && !netFetch) console.warn('[minimax-embed] fallback Node fetch');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 2500);
  const signal = options.signal
    ? AbortSignal.any([controller.signal, options.signal])
    : controller.signal;
  try {
    const response = await fetchImpl(`${base}/embeddings`, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model, texts: clipped, type: kind }),
      redirect: 'error',
      signal,
    });
    if (!response.ok) return null;
    const rawText = await response.text();
    if (rawText.length > 8_388_608) return null;
    return parseEmbedVectors(JSON.parse(rawText), clipped.length);
  } catch (error) {
    const detail = error instanceof Error ? error.name : 'error';
    console.warn(`[minimax-embed] fallback ${detail}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
