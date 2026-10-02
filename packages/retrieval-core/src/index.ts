/**
 * Retrieval algorithms with serializable inputs and outputs.
 * Tokenization, field weights, RRF k, score floors, and document fields are
 * injected by the caller. This module does not read the environment and does
 * not know about a product, a UI, or a store.
 */
export {
  characterUnigramBigramTerms,
  compactAlphanumeric,
  type TextTokenizer,
} from './tokenize.js';
export {
  buildBm25Index,
  rankBm25,
  type Bm25DocumentInput,
  type Bm25FieldInput,
  type Bm25Index,
  type Bm25Parameters,
  type FieldAverageLength,
  type FieldTermStats,
  type FieldWeight,
  type IndexedDocument,
  type IndexedField,
  type RankedHit,
  type TermCount,
} from './bm25.js';
export {
  fuseReciprocalRanks,
  takeUniqueByKey,
  type DedupeRef,
  type FusedScore,
  type RankRef,
} from './fusion.js';
export {
  cosineSimilarity,
  rankByCosine,
  type VectorRow,
} from './similarity.js';
export {
  countCoveringTerms,
  rowIsAdmitted,
  type CoverageOptions,
} from './threshold.js';
