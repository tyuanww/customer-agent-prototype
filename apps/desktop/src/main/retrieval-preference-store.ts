import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  DEFAULT_RETRIEVAL_PREFERENCE,
  parseRetrievalPreference,
  type RetrievalPreference,
} from '../shared/retrieval-preference';

export type RetrievalPreferenceStore = Readonly<{
  read(): RetrievalPreference;
  write(next: RetrievalPreference): RetrievalPreference;
}>;

export function loadRetrievalPreferenceStore(filePath: string): RetrievalPreferenceStore {
  let lastGood: RetrievalPreference = DEFAULT_RETRIEVAL_PREFERENCE;
  const read = (): RetrievalPreference => {
    if (!existsSync(filePath)) return lastGood;
    try {
      const parsed = parseRetrievalPreference(JSON.parse(readFileSync(filePath, 'utf8')));
      if (!parsed) return lastGood;
      lastGood = parsed;
      return parsed;
    } catch {
      return lastGood;
    }
  };
  return Object.freeze({
    read,
    write(next: RetrievalPreference) {
      mkdirSync(dirname(filePath), { recursive: true });
      const tempPath = `${filePath}.${process.pid}.tmp`;
      writeFileSync(tempPath, `${JSON.stringify(next)}\n`);
      renameSync(tempPath, filePath);
      lastGood = next;
      return next;
    },
  });
}
