import { describe, expect, it } from 'vitest';
import { parseSopCsv } from '../src/ops-loop-csv.js';

describe('parseSopCsv', () => {
  it('parses a headered tree and rejects extra columns', () => {
    const nodes = parseSopCsv('node_id,parent_node_id,title,body,sort_key\nn1,,停手,先停手,0\nn2,n1,核对,再核对,1\n');
    expect(nodes).toEqual([
      { node_id: 'n1', parent_node_id: null, title: '停手', body: '先停手', sort_key: 0 },
      { node_id: 'n2', parent_node_id: 'n1', title: '核对', body: '再核对', sort_key: 1 },
    ]);
    expect(parseSopCsv('node_id,title\nn1,停手\n')).toBeNull();
    expect(parseSopCsv('node_id,parent_node_id,title,body,sort_key\n')).toBeNull();
  });

  it('parses quoted commas and rejects duplicates, empty body, and oversized trees', () => {
    expect(parseSopCsv(
      '\uFEFFnode_id,parent_node_id,title,body,sort_key\n"n1","","停手,立刻","先说""停手""",0\n',
    )).toEqual([
      { node_id: 'n1', parent_node_id: null, title: '停手,立刻', body: '先说"停手"', sort_key: 0 },
    ]);
    expect(parseSopCsv('node_id,parent_node_id,title,body,sort_key\nn1,,停手,先停,0\nn1,,重复,重复,1\n')).toBeNull();
    expect(parseSopCsv('node_id,parent_node_id,title,body,sort_key\nn1,,停手,,0\n')).toBeNull();
    expect(parseSopCsv('node_id,parent_node_id,title,body,sort_key\nn1,,停手,先停,1.5\n')).toBeNull();
    const rows = Array.from({ length: 501 }, (_, index) => `n${index},,标题,正文,${index}`);
    expect(parseSopCsv(['node_id,parent_node_id,title,body,sort_key', ...rows].join('\n'))).toBeNull();
  });

  it('rejects a 1MiB cap, unclosed quotes, and overlong parent or title', () => {
    const header = 'node_id,parent_node_id,title,body,sort_key';
    expect(parseSopCsv('x'.repeat(1_000_001))).toBeNull();
    expect(parseSopCsv(`${header}\nn1,,停手,"先停手,0\n`)).toBeNull();
    expect(parseSopCsv(`${header}\nn1,${'p'.repeat(129)},停手,先停,0\n`)).toBeNull();
    expect(parseSopCsv(`${header}\nn1,,${'标'.repeat(257)},先停,0\n`)).toBeNull();
    expect(parseSopCsv(`${header}\nn1,${'p'.repeat(128)},${'标'.repeat(256)},先停,0\n`)).toEqual([
      {
        node_id: 'n1',
        parent_node_id: 'p'.repeat(128),
        title: '标'.repeat(256),
        body: '先停',
        sort_key: 0,
      },
    ]);
  });

  it('rejects blank input, overlong ids/bodies, short data rows, and still parses CRLF trees', () => {
    const header = 'node_id,parent_node_id,title,body,sort_key';
    expect(parseSopCsv('   ')).toBeNull();
    expect(parseSopCsv(`${header}\n,,停手,先停,0\n`)).toBeNull();
    expect(parseSopCsv(`${header}\n${'n'.repeat(129)},,停手,先停,0\n`)).toBeNull();
    expect(parseSopCsv(`${header}\nn1,,停手,${'正'.repeat(20_001)},0\n`)).toBeNull();
    expect(parseSopCsv(`${header}\nn1,,停手,先停\n`)).toBeNull();
    expect(parseSopCsv(`${header}\nn1,,停手,先停,\n`)).toBeNull();
    expect(parseSopCsv(`${header}\nn1,,停手,先停,1e3\n`)).toBeNull();
    expect(parseSopCsv(`${header}\nn1,,停手,先停,0x10\n`)).toBeNull();
    expect(parseSopCsv(`${header}\r\nn1,,停手,先停手,0\r\n`)).toEqual([
      { node_id: 'n1', parent_node_id: null, title: '停手', body: '先停手', sort_key: 0 },
    ]);
  });

  it('rejects allergy steps that lack 停手 and 确认 copy', () => {
    const header = 'node_id,parent_node_id,title,body,sort_key';
    expect(parseSopCsv(`${header}\nn1,,过敏处理,继续使用即可,0\n`)).toBeNull();
    expect(parseSopCsv(`${header}\nn1,,核对,面膜过敏了先观察,0\n`)).toBeNull();
    expect(parseSopCsv(`${header}\nn1,,过敏处理,先停手、再确认是否就医,0\n`)).toEqual([
      {
        node_id: 'n1',
        parent_node_id: null,
        title: '过敏处理',
        body: '先停手、再确认是否就医',
        sort_key: 0,
      },
    ]);
  });
});
