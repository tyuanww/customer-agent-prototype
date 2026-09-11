// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { rankScripts, type RetrievalScript } from '../../src/shared/hybrid-retrieve';

const indexPath = process.env.CUSTOMER_AGENT_RETRIEVAL_INDEX
  ?? join(homedir(), '.customer-agent-synthetic-stack', 'retrieval-index.json');
const enabled = existsSync(indexPath);

describe.skipIf(!enabled)('hybrid retrieve against local index', () => {
  it('maps spoken shipping / skin / address sentences onto related titles', () => {
    const scripts = JSON.parse(readFileSync(indexPath, 'utf8')).scripts as RetrievalScript[];
    expect(rankScripts('什么时候发货', scripts)[0]?.title).toMatch(/发货|时效|快递/);
    expect(rankScripts('这款面膜敏感肌能用吗', scripts)[0]?.title).toMatch(/面膜|适用|敏感/);
    expect(rankScripts('我地址填错了能改吗', scripts)[0]?.title).toMatch(/地址/);
  });
});
