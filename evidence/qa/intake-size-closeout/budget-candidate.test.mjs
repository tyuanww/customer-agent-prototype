import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
const { checkWorkspaceBudget } = await import(pathToFileURL(
  path.resolve('.gstack/qa-reports/intake-size-closeout/budget-candidate.mjs'),
).href);
const MIB=1024*1024;
function withFixture(run){const root=fs.mkdtempSync(path.join(os.tmpdir(),'workspace-budget-candidate-'));try{fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({name:'customer-agent-demo'}));return run(root);}finally{fs.rmSync(root,{recursive:true,force:true});}}
function write(root,relative,size){const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,Buffer.alloc(size,'x'));}
for(const [name,file,size] of [['frozen-contracts','contracts/upstream/frozen/input.sql',15],['frozen-evidence','evidence/qa/frozen.log',10],['source-inputs','apps/example/src/code.js',20]])test(`rejects ${name} above cap despite total below 45 MiB`,()=>withFixture(root=>{write(root,file,size*MIB+4096);const r=checkWorkspaceBudget(root);assert.equal(r.pass,false);assert(r.remainderBytes<45*MIB);assert(r.violations.some(v=>v.key===name));}));
test('counts each hardlinked file once across contract and evidence groups',()=>withFixture(root=>{write(root,'contracts/upstream/frozen/input.sql',MIB);fs.mkdirSync(path.join(root,'evidence'));fs.linkSync(path.join(root,'contracts/upstream/frozen/input.sql'),path.join(root,'evidence/copy.sql'));const r=checkWorkspaceBudget(root);assert(r.remainderBytes<1.1*MIB);assert.equal(r.pass,true);}));
test('retains an explicitly tighter aggregate gate',()=>withFixture(root=>{write(root,'apps/example/src/code.js',2*MIB);const r=checkWorkspaceBudget(root,{remainderBudgetBytes:MIB});assert.equal(r.pass,false);assert(r.violations.some(v=>v.key==='workspace-remainder'));}));
test('current corrected repository fits candidate but remains distinct from the 32 MiB gate',()=>{const r=checkWorkspaceBudget(process.cwd());assert.equal(r.pass,true);assert(r.remainderBytes>32*MIB);console.log(JSON.stringify({candidateOnly:true,remainderBytes:r.remainderBytes,groups:r.sourceBudgetGroups}));});
