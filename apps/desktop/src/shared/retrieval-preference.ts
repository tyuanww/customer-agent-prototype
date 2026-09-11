export type RetrievalPreference = Readonly<{
  smartEnabled: boolean;
}>;

export const DEFAULT_RETRIEVAL_PREFERENCE: RetrievalPreference = Object.freeze({
  smartEnabled: true,
});

export function parseRetrievalPreference(raw: unknown): RetrievalPreference | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const smartEnabled = Reflect.get(raw, 'smartEnabled');
  if (typeof smartEnabled !== 'boolean') return null;
  return Object.freeze({ smartEnabled });
}
