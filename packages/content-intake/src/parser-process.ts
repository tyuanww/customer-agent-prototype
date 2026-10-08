import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import dgram from 'node:dgram';
import dns from 'node:dns';
import { INTAKE_POLICY, failedParse, CSV_TEMPLATE_VERSION, CSV_POLICY_VERSION, type IntakeParseContext } from './policy.js';

// Instrument supported Node network entry points BEFORE loading the parsing dependency.
// This proves observed library behaviour, not an OS sandbox or native-code isolation.
let networkAttempts = 0;
function denyNetwork(): never { networkAttempts++; throw new Error('NETWORK_DISABLED'); }
http.request = denyNetwork; http.get = denyNetwork;
https.request = denyNetwork; https.get = denyNetwork;
net.connect = denyNetwork; net.createConnection = denyNetwork; net.Socket.prototype.connect = denyNetwork;
tls.connect = denyNetwork; dgram.createSocket = denyNetwork;
Object.assign(dns, { lookup: denyNetwork, resolve: denyNetwork }); globalThis.fetch = denyNetwork;

const chunks: Buffer[] = [];
let size = 0;
let policyVersion: typeof INTAKE_POLICY.version | typeof CSV_POLICY_VERSION = INTAKE_POLICY.version;
try {
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > INTAKE_POLICY.fileBytes) throw new Error('FILE_TOO_LARGE');
    chunks.push(chunk as Buffer);
  }
  const context = JSON.parse(process.argv[2] ?? 'null') as IntakeParseContext;
  policyVersion = context?.templateVersion === CSV_TEMPLATE_VERSION ? CSV_POLICY_VERSION : INTAKE_POLICY.version;
  const bytes = Buffer.concat(chunks);
  const result = context?.templateVersion === CSV_TEMPLATE_VERSION
    ? (await import('./csv.js')).parseCsv(bytes, context)
    : await (await import('./workbook.js')).parseWorkbook(bytes, context);
  process.stdout.write(JSON.stringify({ result, maxRssKiB: process.resourceUsage().maxRSS, networkAttempts }));
} catch {
  process.stdout.write(JSON.stringify({ result: failedParse(size > INTAKE_POLICY.fileBytes ? 'FILE_TOO_LARGE' : 'PROCESS_FAILURE', policyVersion), maxRssKiB: process.resourceUsage().maxRSS, networkAttempts }));
}
