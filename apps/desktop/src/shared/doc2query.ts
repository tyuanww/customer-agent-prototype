/**
 * Normalize customer-spoken questions for the off-repo BM25 index.
 * Generation happens elsewhere; this module never calls a model and never
 * accepts answer text as a question.
 */
export const DOC2QUERY_MAX_QUESTIONS = 8;
export const DOC2QUERY_MIN_LENGTH = 2;
export const DOC2QUERY_MAX_LENGTH = 80;

export type Doc2QueryScript = Readonly<{
  title: string;
  questionText: string;
  answerText?: string;
}>;

export type Doc2QueryInput = Readonly<{
  scriptId: string;
  title: string;
  questionText: string;
}>;

function compact(text: string): string {
  return text.normalize('NFKC').replace(/\s+/gu, '').trim();
}

function blockedByScript(text: string, script: Doc2QueryScript): boolean {
  const compactText = compact(text);
  if (compactText.length < DOC2QUERY_MIN_LENGTH) return true;
  if (compact(script.title) === compactText) return true;
  if (script.questionText.trim().length > 0 && compact(script.questionText) === compactText) return true;
  const answer = script.answerText?.trim() ?? '';
  if (answer.length === 0) return false;
  const compactAnswer = compact(answer);
  return compactText === compactAnswer || (compactAnswer.length >= 8 && compactText.includes(compactAnswer));
}

export function normalizeQuestions(
  raw: unknown,
  script: Doc2QueryScript,
  limit = DOC2QUERY_MAX_QUESTIONS,
): readonly string[] {
  if (!Array.isArray(raw)) return Object.freeze([]);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const trimmed = item.replace(/\s+/gu, ' ').trim();
    if (trimmed.length < DOC2QUERY_MIN_LENGTH || trimmed.length > DOC2QUERY_MAX_LENGTH) continue;
    if (blockedByScript(trimmed, script)) continue;
    const key = compact(trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= limit) break;
  }
  return Object.freeze(out);
}

export function mergeQuestions(
  existing: unknown,
  generated: unknown,
  script: Doc2QueryScript,
): readonly string[] {
  return normalizeQuestions(
    [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(generated) ? generated : [])],
    script,
  );
}
