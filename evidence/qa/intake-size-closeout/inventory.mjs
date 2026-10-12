import fs from 'node:fs';
import path from 'node:path';
import { workspaceInventory } from '../../../scripts/workspace-hygiene.mjs';
const root=process.argv[2] ?? process.cwd();
const inventory=workspaceInventory(root);
const excluded=inventory.categories.filter(c=>c.key!=='workspace-remainder').map(c=>c.path);
const seen=new Set();const rows=[];
function walk(rel){
 if(excluded.some(e=>rel===e||rel.startsWith(e+'/'))) return;
 const p=path.join(root,rel);const s=fs.lstatSync(p);const k=s.ino?`${s.dev}:${s.ino}`:p;if(seen.has(k))return;seen.add(k);
 const allocated=s.blocks>0?s.blocks*512:s.size;
 rows.push({path:rel,type:s.isDirectory()?'directory':s.isSymbolicLink()?'symlink':'file',logical:s.isFile()?s.size:0,allocated});
 if(s.isDirectory()&&!s.isSymbolicLink())for(const f of fs.readdirSync(p))walk(`${rel}/${f}`);
}
for(const n of fs.readdirSync(root))walk(n);
const groups={};for(const r of rows){const p=r.path.split('/');const key=p[0]==='contracts'?p.slice(0,2).join('/'):['apps','packages'].includes(p[0])?p.slice(0,3).join('/'):p[0];const g=groups[key]??={logical:0,allocated:0,files:0};g.logical+=r.logical;g.allocated+=r.allocated;g.files+=r.type==='file'?1:0;}
console.log(JSON.stringify({root,total:inventory.categories.find(c=>c.key==='workspace-remainder').bytes,computedTotal:rows.reduce((s,r)=>s+r.allocated,0),groups:Object.entries(groups).map(([path,values])=>({path,...values})).sort((a,b)=>b.allocated-a.allocated),largest:rows.filter(r=>r.type==='file').sort((a,b)=>b.allocated-a.allocated).slice(0,25)},null,2));
