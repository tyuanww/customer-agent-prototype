import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import dgram from 'node:dgram';
import dns from 'node:dns';
import { INTAKE_POLICY, failedParse, type ParseContext } from './policy.js';

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
try {
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > INTAKE_POLICY.fileBytes) throw new Error('FILE_TOO_LARGE');
    chunks.push(chunk as Buffer);
  }
  const context = JSON.parse(process.argv[2] ?? 'null') as ParseContext;
  const { parseWorkbook } = await import('./workbook.js');
  const result = await parseWorkbook(Buffer.concat(chunks), context);
  process.stdout.write(JSON.stringify({ result, maxRssKiB: process.resourceUsage().maxRSS, networkAttempts }));
} catch {
  process.stdout.write(JSON.stringify({ result: failedParse(size > INTAKE_POLICY.fileBytes ? 'FILE_TOO_LARGE' : 'PROCESS_FAILURE'), maxRssKiB: process.resourceUsage().maxRSS, networkAttempts }));
}
