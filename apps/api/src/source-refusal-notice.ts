/** The source set and the facts check raise ZA005 with their sentence in MESSAGE, while DETAIL
 * is a generic FORBIDDEN or absent. Recognising the text is the only way to keep the sentence:
 * a detail-based classifier misses both refusals and the operator reads the generic copy. */
export const SOURCE_REFUSAL_SENTENCES = Object.freeze([
  '没有权限，请找人开通。',
  '资料资格过期了，请稍后重试。',
] as const);

const SENTENCES: ReadonlySet<string> = new Set(SOURCE_REFUSAL_SENTENCES);

export function sourceRefusalOf(error: unknown): string | undefined {
  if (error === null || typeof error !== 'object') return undefined;
  const message = String(Reflect.get(error, 'message') ?? '');
  return SENTENCES.has(message) ? message : undefined;
}
