import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const consumedDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../contracts/upstream/customer-agent');

describe('consumed intake gates stay shut', () => {
  it('keeps the consumed 1.25 lock inactive', () => {
    const lock = JSON.parse(readFileSync(path.join(consumedDir, 'contract-set.lock.json'), 'utf8')) as {
      contract_set_id: string; intake_status: string; runtime_activated: boolean;
    };
    expect(lock.contract_set_id).toBe('cs-ai-c11-openapi-1.22.0-schema-1.25-db6ba13d4780');
    expect(lock.intake_status).toBe('VERIFIED_NOT_ACTIVATED');
    expect(lock.runtime_activated).toBe(false);
  });

  it('keeps the ingested 1.26 successor from opening production', () => {
    const successor = readdirSync(consumedDir).filter(name => /^cs-ai-c11-openapi-1\.23\.0-schema-1\.26-[0-9a-f]+$/.test(name));
    expect(successor).toEqual(['cs-ai-c11-openapi-1.23.0-schema-1.26-c08bfcadf94d']);
    const sop = readFileSync(path.join(consumedDir, successor[0]!, 'openapi.v1.yaml'), 'utf8');
    expect(sop).toContain('"productionConsumerReady":false');
    expect(sop).not.toContain('"externalCompleteReview":"PASS"');
  });
});
