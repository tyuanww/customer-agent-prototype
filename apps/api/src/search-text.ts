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

const ENTITY_FREE_GENERIC_SIGNALS = Object.freeze([
  '活动规则',
  '如何使用',
  '使用方法',
  '怎么用',
  '怎样用',
  '如何用',
  '优惠',
  '活动',
  '规则',
]);

const GENERIC_FILLERS = Object.freeze([
  '是什么',
  '请问',
  '什么',
  '一下',
  '可以',
  '是否',
  '有',
  '吗',
  '呢',
  '的',
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

export function isEntityFreeGenericSearchText(value: string): boolean {
  const compact = normalizeSearchText(value).replace(/[^\p{L}\p{N}]+/gu, '');
  if (compact.length === 0) return false;
  const removable = [...ENTITY_FREE_GENERIC_SIGNALS, ...GENERIC_FILLERS]
    .sort((left, right) => right.length - left.length);
  let remainder = compact;
  for (const token of removable) remainder = remainder.replaceAll(token, '');
  return remainder.length === 0;
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
