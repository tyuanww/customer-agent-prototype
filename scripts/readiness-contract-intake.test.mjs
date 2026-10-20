import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync, symlinkSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ingestContractSet, verifyContractSetDirectory, withVerifiedContractSetSnapshot } from './customer-agent-contract-set.mjs';
import { generateDatabaseMigrations, buildDatabaseMigrationOutputs } from '../packages/database/scripts/generate-migrations.mjs';
import { buildGeneratedArtifacts } from '../packages/contracts/scripts/generate-contracts.mjs';
import { READINESS_LOCK, READINESS_MEMBERS, composeReadiness, verifyReadinessReferences } from './readiness-contract.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)), upstream='contracts/upstream/customer-agent';
const json=x=>JSON.stringify(x,null,2)+'\n';
async function fixture(t) {
  const temp=mkdtempSync(path.join(tmpdir(),'readiness-intake-'));t.after(()=>rmSync(temp,{recursive:true,force:true}));
  const product=path.join(temp,'product'),source=path.join(temp,'source'),bundle=path.join(temp,'bundle');
  for(const d of [product,source,bundle])mkdirSync(d);
  writeFileSync(path.join(product,'package.json'),json({name:'customer-agent-demo'}));
  for(const rel of [upstream,'packages/database/migrations','packages/database/seeds','packages/database/overlays','packages/database/src/generated']) {
    mkdirSync(path.dirname(path.join(product,rel)),{recursive:true});cpSync(path.join(root,rel),path.join(product,rel),{recursive:true});
  }
  const input=process.env.CUSTOMER_AGENT_READINESS_TEST_BUNDLE ?? path.join(root,upstream,JSON.parse(readFileSync(path.join(root,upstream,READINESS_LOCK))).contract_set_id);
  // Rebuild the exact 40-migration predecessor without changing the real checkout.
  rmSync(path.join(product,upstream,READINESS_LOCK),{force:true});
  const priorManifestPath=path.join(product,'packages/database/migrations/manifest.generated.json');
  const priorManifest=JSON.parse(readFileSync(priorManifestPath));
  while (priorManifest.migrations.length > 40) {
    const last=priorManifest.migrations.pop();
    rmSync(path.join(product,'packages/database/migrations',last.file),{force:true});
  }
  delete priorManifest.compatibility.readiness_successor;
  writeFileSync(priorManifestPath,json(priorManifest));
  await generateDatabaseMigrations({projectRoot:product});
  const original=verifyContractSetDirectory(input);
  const descriptors=[original.manifest.openapi,original.manifest.database,...Object.values(original.manifest.readiness)];
  const sources=verifyReadinessReferences(input,original.manifest);
  const composed=await withVerifiedContractSetSnapshot({projectRoot:product},s=>composeReadiness(original.manifest,sources,s.repair));
  for(const descriptor of descriptors) {
    const bytes=descriptor===original.manifest.openapi?composed.openapi_source:descriptor===original.manifest.database?composed.database_source:readFileSync(path.join(input,descriptor.file));
    const target=path.join(source,descriptor.source_path);mkdirSync(path.dirname(target),{recursive:true});writeFileSync(target,bytes);
    if(Object.values(READINESS_MEMBERS).includes(descriptor.file)) writeFileSync(path.join(bundle,descriptor.file),bytes);
  }
  const git=args=>execFileSync('git',['-C',source,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git(['init','-q']);git(['add','--','business-docs']);git(['-c','user.name=Contract Test','-c','user.email=test@example.invalid','commit','--no-verify','-qm','synthetic approved readiness closure']);
  const sha=git(['rev-parse','HEAD']);const manifest={...original.manifest,source_git_sha:sha,contract_set_id:`cs-ai-c11-openapi-1.24.0-schema-1.29-${sha.slice(0,12)}`};
  writeFileSync(path.join(bundle,'contract-set.json'),json(manifest));
  return {product,source,bundle,manifest,run:()=>ingestContractSet({projectRoot:product,sourceDirectory:bundle,sourceRepositoryRoot:source})};
}
test('compact intake reconstructs exact contracts, preserves forty migrations and replays after generation',async t=>{
  const f=await fixture(t);const original=readFileSync(path.join(f.product,upstream,'repair-contract-set.lock.json'));
  assert.equal(f.run().status,'CREATED');assert.equal(f.run().status,'REUSED');
  const built=await generateDatabaseMigrations({projectRoot:f.product});assert.equal(built.migrations.length,49);
  assert.equal(built.migrations[40].id,'0041_intake_readiness_v1_29');
  assert.equal(built.migrations[48].id,'0049_roster_lifecycle');
  assert.equal(f.run().status,'REUSED');await generateDatabaseMigrations({projectRoot:f.product,check:true});
  assert.deepEqual(readFileSync(path.join(f.product,upstream,'repair-contract-set.lock.json')),original);
  const generated=await buildGeneratedArtifacts({projectRoot:f.product});assert.equal(generated.contract_set_id,f.manifest.contract_set_id);
  const provenance=JSON.parse(generated.files.get('packages/contracts/src/generated/codegen-manifest.generated.json'));
  assert.equal(provenance.database_sha256,f.manifest.database.sha256);
  assert.equal(existsSync(path.join(f.product,upstream,f.manifest.contract_set_id,'schema-v1.29.sql')),false);
  await withVerifiedContractSetSnapshot({projectRoot:f.product},s=>{
    assert.equal(s.readiness.runtime_activated,false);
    assert.throws(()=>buildDatabaseMigrationOutputs({...s,readiness:{...s.readiness,readiness_sources:{...s.readiness.readiness_sources,upgrade:'SELECT 2;'}}},{projectRoot:f.product}),/Readiness upgrade/);
  });
  const migration=path.join(f.product,'packages/database/migrations/0041_intake_readiness_v1_29.sql');writeFileSync(migration,readFileSync(migration,'utf8')+'\nSELECT 2;');
  await assert.rejects(withVerifiedContractSetSnapshot({projectRoot:f.product},()=>true),/Readiness migration/);
});
test('missing member and delta drift fail before publishing a lock',async t=>{
  const f=await fixture(t);rmSync(path.join(f.bundle,'upgrade.v1.sql'));assert.throws(f.run);
  assert.equal(existsSync(path.join(f.product,upstream,READINESS_LOCK)),false);
});
test('changed predecessor bytes are rejected rather than loaded from the source checkout',async t=>{
  const f=await fixture(t);const p=path.join(f.product,upstream,'cs-ai-c11-openapi-1.24.0-schema-1.28-379b793811ed/schema-v1.28.sql');
  chmodSync(p,0o644);writeFileSync(p,readFileSync(p,'utf8')+'\n');assert.throws(f.run);
  assert.equal(existsSync(path.join(f.product,upstream,READINESS_LOCK)),false);
});
test('symlink companion and altered approved assembly are rejected',async t=>{
  const f=await fixture(t);const file=path.join(f.bundle,'assembly.v1.json'),bytes=readFileSync(file);rmSync(file);const other=path.join(f.source,'outside.json');writeFileSync(other,bytes);symlinkSync(other,file);
  assert.throws(f.run,/regular|symlink/i);rmSync(file);writeFileSync(file,'{}\n');assert.throws(f.run);
});
test('stale migration receipt bytes and downgraded profile cannot replace readiness lock',async t=>{
  const f=await fixture(t);const migration=path.join(f.product,'packages/database/migrations/0040_intake_repair_successor_v1_28.sql'),bytes=readFileSync(migration);
  writeFileSync(migration,Buffer.concat([bytes,Buffer.from('\n')]));assert.throws(f.run);writeFileSync(migration,bytes);f.run();
  // Current readiness approval in source history cannot be repackaged as v6.
  const old=path.join(f.product,upstream,'cs-ai-c11-openapi-1.24.0-schema-1.28-379b793811ed');
  assert.throws(()=>ingestContractSet({projectRoot:f.product,sourceDirectory:old,sourceRepositoryRoot:f.source}));
});
