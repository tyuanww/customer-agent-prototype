import { RULE_DOCUMENTS } from './verification-policy.mjs';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const files = [...new Set(execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{encoding:'utf8'}).split('\0'))].filter((f) => f.endsWith('.md') && existsSync(f));
const failures = [];
for (const file of files) {
  const text = readFileSync(file,'utf8').replace(/^```[^\n]*\n[\s\S]*?^```/gmu,'');
  for (const match of text.matchAll(/!?\[[^\]\n]*\]\(<?([^\s)>]+)>?(?:\s+"[^"]*")?\)/gu)) {
    const link = match[1];
    if (/^(?:[a-z][a-z0-9+.-]*:|\/)/iu.test(link)) continue;
    const target = decodeURIComponent(link.split('#')[0]);
    const absolute = target ? path.resolve(path.dirname(file), target) : path.resolve(file);
    if (!absolute.startsWith(root + path.sep)) { failures.push(`${file}: link escapes repository`); continue; }
    if (!existsSync(absolute)) { failures.push(`${file}: missing ${target}`); continue; }
    const fragment = link.split('#')[1];
    if (fragment && absolute.endsWith('.md')) {
      const headings = readFileSync(absolute,'utf8').matchAll(/^#{1,6}\s+(.+)$/gmu);
      const anchors = [...headings].map((match) => match[1].toLowerCase().replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu,'').replace(/ /gu,'-'));
      if (!anchors.includes(decodeURIComponent(fragment))) failures.push(`${file}: missing anchor ${link}`);
    }
  }
}
// Validate documented executable entries, not exact prose or a copied policy matrix.
const scripts = JSON.parse(readFileSync('package.json','utf8')).scripts;
const native = new Set(['install','exec','run','rebuild','store','config']);
for (const file of RULE_DOCUMENTS) {
  if (!existsSync(file)) { failures.push(`missing rule document: ${file}`); continue; }
  for (const match of readFileSync(file,'utf8').matchAll(/\bpnpm ([a-z][a-z0-9:-]*\*?)/gu)) {
    const command = match[1];
    if (native.has(command)) continue;
    const found = command.endsWith('*')
      ? Object.keys(scripts).some((key) => key.startsWith(command.slice(0,-1)))
      : Object.hasOwn(scripts,command);
    if (!found) failures.push(`${file}: unknown package command ${command}`);
  }
}
if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
else console.log(`Documentation PASS: ${files.length} Markdown files, local links and workflow entry ownership.`);
