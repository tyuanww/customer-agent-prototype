import { createContentObjectStore } from './content-object-store.js';
import { createContentWorker } from './content-worker.js';
import { parseApiPrivateBootstrapConfig, parseApiRuntimeConfig } from './runtime-config.js';

const POLL_MS = 1_000;

function reviewCommitment(environment: NodeJS.ProcessEnv) {
  const leadSubject = environment.CONTENT_REVIEW_LEAD_SUBJECT;
  const managerSubject = environment.CONTENT_REVIEW_MANAGER_SUBJECT;
  const evidenceId = environment.CONTENT_REVIEW_EVIDENCE_ID;
  if (!leadSubject || !managerSubject || !evidenceId) return undefined;
  return { leadSubject, managerSubject, evidenceId };
}

async function run(): Promise<void> {
  const environment = process.env;
  parseApiRuntimeConfig(environment);
  const bootstrap = parseApiPrivateBootstrapConfig(environment);
  if (!bootstrap.objectStoreDir || !bootstrap.contentWorker) {
    throw new Error('Content worker bootstrap is incomplete');
  }
  const commitment = reviewCommitment(environment);
  const worker = createContentWorker(
    bootstrap.contentWorker.database,
    createContentObjectStore(bootstrap.objectStoreDir),
    {
      intentTaxonomyVersion: environment.CONTENT_INTENT_TAXONOMY_VERSION ?? 'itax_synthetic_t3_v1',
      intentId: environment.CONTENT_INTENT_ID ?? 'intent_synthetic_t3_shipping',
      ...(commitment === undefined ? {} : { reviewCommitment: commitment }),
    },
  );
  let stopping = false;
  const stop = () => { stopping = true; };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  while (!stopping) {
    const result = await worker.runOnce().catch(() => 'idle' as const);
    if (result === 'idle') await new Promise((resolve) => { setTimeout(resolve, POLL_MS); });
  }
  await worker.close();
}

void run().catch(() => {
  process.exitCode = 1;
});
