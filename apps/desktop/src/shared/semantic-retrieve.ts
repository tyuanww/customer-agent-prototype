/**
 * Retrieval facade. Ranking is hybrid BM25 + RRF in hybrid-retrieve.ts.
 * This file keeps the previous import path so main/product-search stays stable.
 */
export {
  rankScripts,
  type RankedRetrieval,
  type RetrievalScript,
} from './hybrid-retrieve.js';
