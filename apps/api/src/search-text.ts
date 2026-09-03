import { createHmac, type BinaryLike, type KeyObject } from 'node:crypto';

const PUNCTUATION_MAP = new Map<string, string>([
  ['，', ','],
  ['。', '.'],
  ['！', '!'],
  ['？', '?'],
  ['：', ':'],
  ['；', ';'],
  ['（', '('],
  ['）', ')'],
  ['【', '['],
  ['】', ']'],
  ['“', '"'],
  ['”', '"'],
  ['‘', "'"],
  ['’', "'"],
  ['、', ','],
]);

export function normalizeSearchText(value: string): string {
  const punctuationNormalized = Array.from(value.normalize('NFKC').toLowerCase())
    .map((codePoint) => PUNCTUATION_MAP.get(codePoint) ?? codePoint)
    .join('');
  return punctuationNormalized.replace(/\s+/gu, ' ').trim();
}

export function unicodeBigramTokens(normalizedText: string): readonly string[] {
  const segments = normalizedText.match(/[\p{L}\p{N}]+/gu) ?? [];
  const tokens: string[] = [];
  for (const segment of segments) {
    const codePoints = Array.from(segment);
    for (let index = 0; index + 1 < codePoints.length; index += 1) {
      tokens.push(`${codePoints[index]}${codePoints[index + 1]}`);
    }
  }
  return Object.freeze(tokens);
}

export function hmacRedactedQuery(
  redactedText: string,
  keyVersion: string,
  secretKey: BinaryLike | KeyObject,
): string {
  if (keyVersion.length === 0 || keyVersion.trim() !== keyVersion) {
    throw new RangeError('keyVersion must be a non-empty exact string');
  }
  const canonical = `${keyVersion}\0${normalizeSearchText(redactedText)}`;
  return createHmac('sha256', secretKey).update(canonical, 'utf8').digest('hex');
}
