import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import dgram from 'node:dgram';
import dns from 'node:dns';
import { INTAKE_POLICY, failedParse, isParseResult, CSV_TEMPLATE_VERSION, CSV_POLICY_VERSION, SOP_TEMPLATE_VERSION, type IntakeParseContext } from './policy.js';

let networkAttempts = 0;
function denyNetwork(): never { networkAttempts++; throw new Error('NETWORK_DISABLED'); }
http.request = denyNetwork; http.get = denyNetwork;
https.request = denyNetwork; https.get = denyNetwork;
net.connect = denyNetwork; net.createConnection = denyNetwork; net.Socket.prototype.connect = denyNetwork;
tls.connect = denyNetwork; dgram.createSocket = denyNetwork;
Object.assign(dns, { lookup: denyNetwork, resolve: denyNetwork }); globalThis.fetch = denyNetwork;

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,128}$/u.test(value);

const chunks: Buffer[] = [];
let size = 0;
let policyVersion: typeof INTAKE_POLICY.version | typeof CSV_POLICY_VERSION = INTAKE_POLICY.version;
try {
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > INTAKE_POLICY.fileBytes) throw new Error('FILE_TOO_LARGE');
    chunks.push(chunk as Buffer);
  }
  const context: unknown = JSON.parse(process.argv[2] ?? 'null');
  const bytes = Buffer.concat(chunks);
  let result: unknown;
  if (object(context) && context.kind === 'sop') {
    if (!object(context.scope) || !identifier(context.scope.sourceId) || !identifier(context.scope.brandId)
      || (context.scope.shopId !== null && !identifier(context.scope.shopId)) || typeof context.decoderUrl !== 'string'
      || new URL(context.decoderUrl).protocol !== 'file:') throw new Error('INVALID_CONTEXT');
    const scope = { sourceId: context.scope.sourceId, brandId: context.scope.brandId, shopId: context.scope.shopId };
    const { tryParseSopAsFaq } = await import('./sop.js');
    const { encodeSopOutcome } = await import('./sop-process.js');
    let sop = await tryParseSopAsFaq(bytes, scope);
    if (sop?.parsed.ok && sop.previews.length) {
      const decoder: unknown = await import(context.decoderUrl);
      if (!object(decoder) || typeof decoder.checkSopMedia !== 'function') throw new Error('INVALID_DECODER');
      const issue: unknown = await decoder.checkSopMedia(sop.previews);
      if (issue !== null) {
        const parsed = { ...sop.parsed, ok: false, rows: [], questions: [], issues: [issue], mediaCount: 0 };
        if (!isParseResult(parsed, INTAKE_POLICY.version)) throw new Error('INVALID_DECODER_OUTPUT');
        sop = { contentVersion: sop.contentVersion, parsed, rowBindings: [], previews: [] };
      }
    }
    result = encodeSopOutcome(sop);
  } else {
    const input = context as IntakeParseContext;
    policyVersion = input?.templateVersion === CSV_TEMPLATE_VERSION ? CSV_POLICY_VERSION : INTAKE_POLICY.version;
    if (input?.templateVersion === SOP_TEMPLATE_VERSION) throw new Error('SOP_WORKBOOK_NOT_AN_FAQ_PARSE');
    result = input?.templateVersion === CSV_TEMPLATE_VERSION
      ? (await import('./csv.js')).parseCsv(bytes, input)
      : await (await import('./workbook.js')).parseWorkbook(bytes, input);
  }
  process.stdout.write(JSON.stringify({ result, maxRssKiB: process.resourceUsage().maxRSS, networkAttempts }));
} catch {
  process.stdout.write(JSON.stringify({ result: failedParse(size > INTAKE_POLICY.fileBytes ? 'FILE_TOO_LARGE' : 'PROCESS_FAILURE', policyVersion),
    maxRssKiB: process.resourceUsage().maxRSS, networkAttempts }));
}
