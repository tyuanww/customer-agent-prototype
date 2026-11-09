import { createSopQuerySyntheticHost } from '../../apps/api/tests/support/sop-query-synthetic-host.ts';

const host = await createSopQuerySyntheticHost();
process.stdout.write(`${JSON.stringify({profile:'menokin-sop-query-synthetic',apiOrigin:host.apiOrigin,identityOrigin:host.identityOrigin,contractSetId:host.contractSetId})}\n`);
for (const signal of ['SIGINT','SIGTERM'] as const) {
  process.once(signal,()=>{ void host.close().then(()=>{process.exitCode=0;},error=>{console.error(error);process.exitCode=1;}); });
}
