import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ingestContractSet, verifyContractSetDirectory, withVerifiedContractSetSnapshot } from './customer-agent-contract-set.mjs';
import { generateDatabaseMigrations, buildDatabaseMigrationOutputs } from '../packages/database/scripts/generate-migrations.mjs';
import { buildGeneratedArtifacts } from '../packages/contracts/scripts/generate-contracts.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const prefix='business-docs/01-客服Agent项目/30-开发-进行中/content-intake-repair-successor-v1';
const approvalPath='business-docs/01-客服Agent项目/90-评审/2026-10-12_后继合同批准.json';
const hash=x=>createHash('sha256').update(x).digest('hex');
const json=x=>JSON.stringify(x,null,2)+'\n';
async function fixture(t) {
  const temporary=mkdtempSync(path.join(tmpdir(),'repair-intake-'));t.after(()=>rmSync(temporary,{recursive:true,force:true}));
  const product=path.join(temporary,'product'), source=path.join(temporary,'source'), bundle=path.join(temporary,'bundle');
  for(const d of [product,source,bundle])mkdirSync(d);
  writeFileSync(path.join(product,'package.json'),json({name:'customer-agent-demo'}));
  for(const rel of ['contracts/upstream/customer-agent','packages/database/migrations','packages/database/seeds','packages/database/overlays','packages/database/src/generated']) {
    mkdirSync(path.dirname(path.join(product,rel)),{recursive:true});cpSync(path.join(root,rel),path.join(product,rel),{recursive:true});
  }
  rmSync(path.join(product,'contracts/upstream/customer-agent/readiness-contract-set.lock.json'),{force:true});
  rmSync(path.join(product,'contracts/upstream/customer-agent/repair-contract-set.lock.json'),{force:true});
  await generateDatabaseMigrations({projectRoot:product});
  // All payload is invented; only the exact immutable predecessor comes from the repository.
  const versions={openapi:'1.24.0',schema:'1.28',migration:'0040',exportProfile:'content-intake-repair-successor-v1'};
  const prior=readFileSync(path.join(product,'packages/database/migrations/manifest.generated.json'));
  const files={openapi:json({openapi:'3.1.0',info:{title:'Synthetic successor',version:'1.24.0'},paths:{},components:{schemas:{SyntheticRepair:{type:'string'}}}}),
    database:'-- synthetic cumulative reference\n',upgrade:'SELECT 1;\n',
    installation:json({proposal:versions,predecessor:{migrationCount:39,newDatabaseBootstrap:false},owner:'intake_runtime_fn_owner'}),
    predecessor:json({manifestSha256:hash(prior),migrations:JSON.parse(prior).migrations.map(({position,id,file,sha256,bytes})=>({position,id,file,sha256,bytes}))})};
  const names={openapi:['openapi.candidate.json','openapi.v1.yaml','1.24.0'],database:['schema.candidate.sql','schema-v1.28.sql','schema.v1.28'],upgrade:['upgrade.candidate.sql','upgrade.v1.sql','1'],installation:['installation.candidate.json','installation.v1.json','1'],predecessor:['predecessor-lock.json','predecessor-lock.v1.json','1'],provenance:['manifest.json','provenance.v1.json','1']};
  files.provenance=json({proposedVersions:versions,artifacts:Object.fromEntries(['openapi','database','upgrade','installation'].map(k=>[names[k][0],{sha256:hash(files[k]),bytes:Buffer.byteLength(files[k])}]))});
  const approval={schema:'customer-agent-repair-successor-approval/v1',status:'APPROVED',versions,freezeApproved:true,exportApproved:true,intakeApproved:true,syntheticOnly:true,runtimeActivated:false,productionConsumerReady:false,
    artifacts:Object.fromEntries(Object.entries(names).map(([k,[n]])=>[n,hash(files[k])]))};
  files.approval=json(approval);names.approval=['approval','approval.v1.json','1'];
  const descriptors={};
  for(const [k,[,file,version]] of Object.entries(names)){
    const source_path=k==='approval'?approvalPath:`${prefix}/${file}`;
    mkdirSync(path.dirname(path.join(source,source_path)),{recursive:true});writeFileSync(path.join(source,source_path),files[k]);writeFileSync(path.join(bundle,file),files[k]);
    descriptors[k]={version,source_path,file,sha256:hash(files[k]),bytes:Buffer.byteLength(files[k])};
  }
  const git=args=>execFileSync('git',['-C',source,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git(['init','-q']);git(['add','--',prefix,approvalPath]);git(['-c','user.name=Contract Test','-c','user.email=test@example.invalid','commit','--no-verify','-qm','synthetic successor']);
  const sha=git(['rev-parse','HEAD']);const {openapi,database,...repair}=descriptors;
  const manifest={schema:'customer-agent-contract-set/v6',contract_set_id:`cs-ai-c11-openapi-1.24.0-schema-1.28-${sha.slice(0,12)}`,source_repository:'ai-赋能立项',source_git_sha:sha,architecture_version:'1.16',implementation_version:'1.22',openapi,database,repair};
  writeFileSync(path.join(bundle,'contract-set.json'),json(manifest));
  return {product,source,bundle,manifest,run:()=>ingestContractSet({projectRoot:product,sourceDirectory:bundle,sourceRepositoryRoot:source})};
}
test('v6 intake preserves historical lock and 39 migrations, generates 0040 and API 1.24, replays after generation',async t=>{
  const f=await fixture(t);const lock=readFileSync(path.join(f.product,'contracts/upstream/customer-agent/contract-set.lock.json'));
  assert.equal(f.run().status,'CREATED');assert.equal(f.run().status,'REUSED');
  const result=await generateDatabaseMigrations({projectRoot:f.product});assert.equal(result.migrations.length,40);
  assert.equal(f.run().status,'REUSED');await generateDatabaseMigrations({projectRoot:f.product,check:true});
  assert.deepEqual(readFileSync(path.join(f.product,'contracts/upstream/customer-agent/contract-set.lock.json')),lock);
  await withVerifiedContractSetSnapshot({projectRoot:f.product},s=>{assert.equal(s.repair.manifest.openapi.version,'1.24.0');assert.equal(s.repair.runtime_activated,false);});
  const generated=await buildGeneratedArtifacts({projectRoot:f.product});
  const provenance=JSON.parse(generated.files.get('packages/contracts/src/generated/codegen-manifest.generated.json'));
  assert.equal(generated.contract_set_id,f.manifest.contract_set_id);
  assert.equal(provenance.contract_set_id,f.manifest.contract_set_id);
  assert.equal(provenance.source_git_sha,f.manifest.source_git_sha);
  assert.equal(provenance.openapi_sha256,f.manifest.openapi.sha256);
  assert.equal(provenance.database_sha256,f.manifest.database.sha256);
});
test('predecessor byte changes fail before intake publishes a repair lock',async t=>{
  const f=await fixture(t);writeFileSync(path.join(f.product,'packages/database/migrations/0001_extensions.sql'),'SELECT 1;');assert.throws(f.run,/predecessor bytes drift/);
});
test('missing companion and self-consistent unapproved upgrade both fail closed',async t=>{
  const f=await fixture(t);const file=path.join(f.bundle,'upgrade.v1.sql');writeFileSync(file,'SELECT 2;\n');
  f.manifest.repair.upgrade.sha256=hash('SELECT 2;\n');writeFileSync(path.join(f.bundle,'contract-set.json'),json(f.manifest));
  assert.throws(()=>verifyContractSetDirectory(f.bundle),/approval hash mismatch/);
  rmSync(file);assert.throws(()=>verifyContractSetDirectory(f.bundle));
});
test('changed generator seed cannot rewrite prior migrations after approved intake',async t=>{
  const f=await fixture(t);f.run();const seed=path.join(f.product,'packages/database/seeds/menokin-sop-stage.sql');writeFileSync(seed,readFileSync(seed,'utf8')+'\nSELECT 1;\n');
  await assert.rejects(generateDatabaseMigrations({projectRoot:f.product}),/Generated repair predecessor drift/);
});

test('review regression: changed 0040 bytes cannot pass repair snapshot verification',async t=>{
  const f=await fixture(t);f.run();await generateDatabaseMigrations({projectRoot:f.product});
  const file=path.join(f.product,'packages/database/migrations/0040_intake_repair_successor_v1_28.sql');
  writeFileSync(file,readFileSync(file,'utf8')+'\nSELECT 2;\n');
  await assert.rejects(withVerifiedContractSetSnapshot({projectRoot:f.product},()=>true),/Repair migration/);
});
test('review regression: builder rejects a forged upgrade or repeated predecessor position',async t=>{
  const f=await fixture(t);f.run();
  await withVerifiedContractSetSnapshot({projectRoot:f.product},s=>{
    const forge=change=>({...s,repair:{...s.repair,repair_sources:{...s.repair.repair_sources,...change}}});
    assert.throws(()=>buildDatabaseMigrationOutputs(forge({upgrade:'SELECT 2;\n'}),{projectRoot:f.product}),/Repair upgrade/);
    const predecessor=JSON.parse(s.repair.repair_sources.predecessor);predecessor.migrations=Array(39).fill(predecessor.migrations[0]);
    assert.throws(()=>buildDatabaseMigrationOutputs(forge({predecessor:json(predecessor)}),{projectRoot:f.product}),/Repair predecessor positions/);
  });
});
