export type ValidityKind = 'active' | 'expired' | 'upcoming' | 'invalid';

export type ValidityInfo = {
  kind: ValidityKind;
  text: string;
};

export function parseValidityRange(
  effectiveFrom: string,
  effectiveTo: string,
): { start: Date; end: Date } | null {
  const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/;
  const fromParts = effectiveFrom.match(datePattern);
  const toParts = effectiveTo.match(datePattern);
  if (!fromParts || !toParts) {
    return null;
  }
  const start = new Date(
    Number(fromParts[1]),
    Number(fromParts[2]) - 1,
    Number(fromParts[3]),
    0,
    0,
    0,
    0,
  );
  const end = new Date(
    Number(toParts[1]),
    Number(toParts[2]) - 1,
    Number(toParts[3]),
    23,
    59,
    59,
    999,
  );
  const isExactDate = (date: Date, parts: RegExpMatchArray): boolean =>
    date.getFullYear() === Number(parts[1]) &&
    date.getMonth() === Number(parts[2]) - 1 &&
    date.getDate() === Number(parts[3]);
  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    !isExactDate(start, fromParts) ||
    !isExactDate(end, toParts) ||
    start > end
  ) {
    return null;
  }
  return { start, end };
}

export function getValidityInfo(
  effectiveFrom: string,
  effectiveTo: string,
  now: Date = new Date(),
): ValidityInfo {
  const range = parseValidityRange(effectiveFrom, effectiveTo);
  if (!range) {
    return { kind: 'invalid', text: '有效期异常' };
  }
  if (now < range.start) {
    return { kind: 'upcoming', text: `未开始 ${effectiveFrom}` };
  }
  if (now > range.end) {
    return { kind: 'expired', text: `已过期 ${effectiveTo}` };
  }
  return { kind: 'active', text: `有效至 ${effectiveTo}` };
}

export function isCurrentlyEffective(
  effectiveFrom: string,
  effectiveTo: string,
  now: Date = new Date(),
): boolean {
  const range = parseValidityRange(effectiveFrom, effectiveTo);
  return Boolean(range && now >= range.start && now <= range.end);
}
