/**
 * Generic character tokenizer. Callers inject it; the package does not choose
 * a language, stop list, or domain dictionary.
 */
export type TextTokenizer = (text: string) => readonly string[];

export function compactAlphanumeric(value: string): string {
  return Array.from(value.normalize('NFKC').toLowerCase()).join('').replace(/[^\p{L}\p{N}]+/gu, '');
}

/** Unicode code-point unigrams plus adjacent bigrams of compactAlphanumeric. */
export function characterUnigramBigramTerms(text: string): readonly string[] {
  const chars = Array.from(compactAlphanumeric(text));
  if (chars.length === 0) return [];
  const terms: string[] = [];
  for (let index = 0; index < chars.length; index += 1) {
    const current = chars[index];
    if (current === undefined || current.length === 0) continue;
    terms.push(current);
    const next = chars[index + 1];
    if (next !== undefined && next.length > 0) terms.push(`${current}${next}`);
  }
  return terms;
}
