import {
  normalizeQuestions,
  type Doc2QueryInput,
} from './doc2query.ts';
import type { RetrievalScript } from './hybrid-retrieve.ts';

export type RetrievalIndexRow = Readonly<{
  record: Readonly<Record<string, unknown>>;
  script: RetrievalScript | null;
}>;

export type RetrievalIndexDocument = Readonly<{
  envelope: Readonly<Record<string, unknown>>;
  rows: readonly RetrievalIndexRow[];
}>;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return { ...(value as Record<string, unknown>) };
}

function parseScript(item: unknown): RetrievalIndexRow {
  const record = asRecord(item);
  if (!record) return Object.freeze({ record: Object.freeze({}), script: null });
  const scriptId = Reflect.get(record, 'scriptId');
  const title = Reflect.get(record, 'title');
  if (typeof scriptId !== 'string' || scriptId.length < 1 || scriptId.length > 128) {
    return Object.freeze({ record: Object.freeze(record), script: null });
  }
  if (typeof title !== 'string' || title.trim().length < 1) {
    return Object.freeze({ record: Object.freeze(record), script: null });
  }
  const questionText = Reflect.get(record, 'questionText');
  const answerText = Reflect.get(record, 'answerText');
  const category = Reflect.get(record, 'category');
  const script: RetrievalScript = Object.freeze({
    scriptId,
    title: title.trim(),
    questionText: typeof questionText === 'string' ? questionText : '',
    answerText: typeof answerText === 'string' ? answerText : '',
    ...(typeof category === 'string' && category.trim().length > 0 ? { category: category.trim() } : {}),
    questions: normalizeQuestions(Reflect.get(record, 'questions'), {
      title: title.trim(),
      questionText: typeof questionText === 'string' ? questionText : '',
      answerText: typeof answerText === 'string' ? answerText : '',
    }),
  });
  return Object.freeze({ record: Object.freeze(record), script });
}

export function parseRetrievalIndex(raw: string): RetrievalIndexDocument | null {
  const value: unknown = JSON.parse(raw);
  const envelope = asRecord(value);
  if (!envelope) return null;
  const scripts = Reflect.get(envelope, 'scripts');
  if (!Array.isArray(scripts)) return null;
  const rest = { ...envelope };
  delete rest.scripts;
  return Object.freeze({
    envelope: Object.freeze(rest),
    rows: Object.freeze(scripts.map(parseScript)),
  });
}

export function scriptsOf(document: RetrievalIndexDocument): readonly RetrievalScript[] {
  return Object.freeze(document.rows.flatMap((row) => (row.script ? [row.script] : [])));
}

export function serializeRetrievalIndex(document: RetrievalIndexDocument): string {
  const scripts = document.rows.map((row) => {
    if (!row.script) return row.record;
    return {
      ...row.record,
      scriptId: row.script.scriptId,
      title: row.script.title,
      questionText: row.script.questionText,
      answerText: row.script.answerText,
      ...(row.script.category ? { category: row.script.category } : {}),
      questions: [...row.script.questions ?? []],
    };
  });
  return `${JSON.stringify({ ...document.envelope, scripts })}\n`;
}

export function withQuestions(
  document: RetrievalIndexDocument,
  updates: ReadonlyMap<string, readonly string[]>,
): RetrievalIndexDocument {
  return Object.freeze({
    envelope: document.envelope,
    rows: Object.freeze(document.rows.map((row) => {
      if (!row.script) return row;
      const generated = updates.get(row.script.scriptId);
      if (!generated) return row;
      const questions = normalizeQuestions(
        [...(row.script.questions ?? []), ...generated],
        row.script,
      );
      const script: RetrievalScript = Object.freeze({ ...row.script, questions });
      return Object.freeze({
        record: Object.freeze({ ...row.record, questions: [...questions] }),
        script,
      });
    })),
  });
}

export function replaceQuestions(
  document: RetrievalIndexDocument,
  updates: ReadonlyMap<string, readonly string[]>,
): RetrievalIndexDocument {
  return Object.freeze({
    envelope: document.envelope,
    rows: Object.freeze(document.rows.map((row) => {
      if (!row.script) return row;
      const generated = updates.get(row.script.scriptId);
      if (!generated) return row;
      const questions = normalizeQuestions(generated, row.script);
      if (questions.length === 0) return row;
      const script: RetrievalScript = Object.freeze({ ...row.script, questions });
      return Object.freeze({
        record: Object.freeze({ ...row.record, questions: [...questions] }),
        script,
      });
    })),
  });
}

export function doc2queryInputs(
  document: RetrievalIndexDocument,
  options: Readonly<{ rebuild?: boolean; limit?: number }> = {},
): readonly Doc2QueryInput[] {
  const out: Doc2QueryInput[] = [];
  for (const row of document.rows) {
    if (!row.script) continue;
    const existing = row.script.questions ?? [];
    if (!options.rebuild && existing.length > 0) continue;
    out.push(Object.freeze({
      scriptId: row.script.scriptId,
      title: row.script.title,
      questionText: row.script.questionText,
    }));
    if (options.limit !== undefined && out.length >= options.limit) break;
  }
  return Object.freeze(out);
}
