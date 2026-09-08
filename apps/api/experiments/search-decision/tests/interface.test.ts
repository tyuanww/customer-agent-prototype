import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { runInterfaceExperiment } from '../evaluate.js';

describe('interface decision-table acceptance', () => {
  it('fails non-zero listing ids when decide diverges or v3 diffs are unexpected', async () => {
    const result = await runInterfaceExperiment();
    const report = JSON.parse(await readFile(result.reportPath, 'utf8')) as {
      unexpectedV3Diffs: string[];
      allowedV3Diffs: string[];
    };
    const jsonl = (await readFile(result.casesPath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { id: string; match: boolean });
    expect(jsonl).toHaveLength(result.interfaceTotal);
    expect(jsonl.map((row) => row.id)).toEqual(
      (JSON.parse(await readFile(result.reportPath, 'utf8')) as { interfaceRows: Array<{ id: string }> }).interfaceRows.map((row) => row.id),
    );
    const problems: string[] = [];
    if (result.failedIds.length > 0) {
      problems.push(`interface ${result.failedIds.length}/${result.interfaceTotal}: ${result.failedIds.join(', ')}`);
    }
    if (result.unexpectedV3Diffs.length > 0) {
      problems.push(`unexpected v3 diffs: ${result.unexpectedV3Diffs.join(', ')}`);
    }
    if (problems.length > 0) throw new Error(problems.join(' | '));
    expect(report.unexpectedV3Diffs).toEqual([]);
    expect(result.interfacePass).toBe(result.interfaceTotal);
    expect([...result.allowedV3Diffs].sort()).toEqual(['Q01', 'Q02', 'Q03']);
  });
});
