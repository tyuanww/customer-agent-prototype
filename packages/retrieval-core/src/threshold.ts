/**
 * Score floor and term coverage. Stop terms and the minimums are caller policy.
 */
export type CoverageOptions = Readonly<{
  minimumLength: number;
  ignoredTerms: readonly string[];
}>;

export function countCoveringTerms(
  queryTerms: readonly string[],
  documentTerms: readonly string[],
  options: CoverageOptions,
): number {
  const ignored = new Set(options.ignoredTerms);
  const document = new Set(documentTerms.filter((term) => term.length >= options.minimumLength));
  const seen = new Set<string>();
  let hits = 0;
  for (const term of queryTerms) {
    if (term.length < options.minimumLength || ignored.has(term) || seen.has(term)) continue;
    seen.add(term);
    if (document.has(term)) hits += 1;
  }
  return hits;
}

export function rowIsAdmitted(
  score: number,
  coveringHits: number,
  minimumScore: number,
  minimumHits: number,
): boolean {
  return score >= minimumScore && coveringHits >= minimumHits;
}
