import { describe, expect, it } from 'vitest';
import {
  MENOKIN_SOP_EXECUTION_KEYS,
  MENOKIN_SOP_SEVERITY_ORDER,
  MENOKIN_SOP_TABLE_NAMES,
  createMenokinSopDecisionSummary,
  projectMenokinSopSourceRows,
  serializeMenokinSopDecisionSummary,
  validateMenokinSopCandidate,
  validateMenokinSopGraph,
  validateMenokinSourceRows,
  type MenokinSourceRow,
} from '@customer-agent/content-intake';

const sha = (digit: string): string => digit.repeat(64);

function row(overrides: Partial<MenokinSourceRow> = {}): MenokinSourceRow {
  return {
    sourceSha256: sha('a'),
    sheetName: '少错破SOP',
    sopGroup: '少错破SOP',
    rowNumber: 2,
    rowHash: sha('b'),
    sourceEntryCode: 'SYN-ROW-1',
    nodes: [{
      nodeKey: 'D1',
      nodeType: 'execution',
      stepNumber: 3,
      title: '合成步骤',
      body: '核对合成条件后继续',
    }],
    fields: [{ key: 'condition', value: '合成字段值', targetNodeKey: 'D1' }],
    paths: [],
    scripts: [{ targetNodeKey: 'D1', text: '合成对客说明', riskLevel: 'routine' }],
    quickPhrases: [{ targetNodeKey: 'D1', text: '合成快捷语' }],
    images: [{
      referenceKind: 'embedded',
      columnNumber: 4,
      contentSha256: sha('c'),
      referenceHash: null,
      mime: 'image/png',
      bytes: 68,
      targetNodeKey: 'D1',
    }],
    knowledge: [{ kind: 'knowledge', key: 'note', text: '合成知识说明', targetNodeKey: 'D1' }],
    ...overrides,
  };
}

function assertReady(input: unknown) {
  const result = projectMenokinSopSourceRows(input);
  expect(result.inputIssues).toEqual([]);
  expect(result.candidate).not.toBeNull();
  expect(result.validation?.ready).toBe(true);
  return result;
}

describe('Menokin six-table candidate projection', () => {
  it('accepts a resolved acyclic graph and reports isolated nodes separately', () => {
    const result = projectMenokinSopSourceRows([
      row({
        rowNumber: 2,
        rowHash: sha('b'),
        nodes: [{ nodeKey: 'D1', nodeType: 'execution', stepNumber: 3, title: '第一步', body: '第一步' }],
        paths: [{ fromNodeKey: 'D1', toNodeKey: 'D2', condition: '继续' }],
        fields: [], scripts: [], quickPhrases: [], images: [], knowledge: [],
      }),
      row({
        rowNumber: 3,
        rowHash: sha('c'),
        nodes: [{ nodeKey: 'D2', nodeType: 'execution', stepNumber: 3, title: '第二步', body: '第二步' }],
        fields: [], paths: [], scripts: [], quickPhrases: [], images: [], knowledge: [],
      }),
    ]);
    expect(result.validation?.ready).toBe(true);
    const graph = validateMenokinSopGraph(result.candidate!);
    expect(graph).toMatchObject({ ok: true, status: 'ready', nodeCount: 2, edgeCount: 1 });
    expect(graph.issues).toEqual([]);
    expect(graph.isolatedExecutionIds).toEqual([]);
  });

  it('blocks a missing graph target and a terminal outgoing edge', () => {
    const missing = projectMenokinSopSourceRows([row({
      paths: [{ fromNodeKey: 'D1', toNodeKey: 'D9', condition: '未知目标' }],
      fields: [], scripts: [], quickPhrases: [], images: [], knowledge: [],
    })]);
    const missingGraph = validateMenokinSopGraph(missing.candidate!);
    expect(missingGraph.issues).toContainEqual(expect.objectContaining({ code: 'GRAPH_BRANCH_TARGET_MISSING' }));

    const terminal = projectMenokinSopSourceRows([
      row({
        rowNumber: 2,
        rowHash: sha('d'),
        nodes: [{ nodeKey: 'E1', nodeType: 'terminal', stepNumber: null, title: '结束', body: '结束' }],
        paths: [
          { fromNodeKey: 'E1', toNodeKey: 'D1', condition: '错误出边' },
          { fromNodeKey: 'E1', toNodeKey: 'D9', condition: '错误未知出边' },
        ],
        fields: [], scripts: [], quickPhrases: [], images: [], knowledge: [],
      }),
      row({
        rowNumber: 3,
        rowHash: sha('e'),
        nodes: [{ nodeKey: 'D1', nodeType: 'execution', stepNumber: 3, title: '步骤', body: '步骤' }],
        fields: [], paths: [], scripts: [], quickPhrases: [], images: [], knowledge: [],
      }),
    ]);
    const terminalGraph = validateMenokinSopGraph(terminal.candidate!);
    expect(terminalGraph.issues).toContainEqual(expect.objectContaining({ code: 'GRAPH_TERMINAL_HAS_OUTGOING' }));
  });

  it('blocks branch references whose node keys or source groups disagree with their ids', () => {
    const result = projectMenokinSopSourceRows([
      row({
        rowNumber: 2,
        rowHash: sha('1'),
        paths: [{ fromNodeKey: 'D1', toNodeKey: 'D2', condition: '继续' }],
        fields: [], scripts: [], quickPhrases: [], images: [], knowledge: [],
      }),
      row({
        rowNumber: 3,
        rowHash: sha('2'),
        nodes: [{ nodeKey: 'D2', nodeType: 'execution', stepNumber: 3, title: '第二步', body: '第二步' }],
        fields: [], scripts: [], quickPhrases: [], images: [], knowledge: [],
      }),
    ]);
    const candidate = result.candidate!;
    const branch = candidate.tables.decisionBranches.rows[0]!;
    const mismatched: typeof candidate = {
      ...candidate,
      tables: {
        ...candidate.tables,
        decisionBranches: {
          ...candidate.tables.decisionBranches,
          rows: [{ ...branch, fromNodeKey: 'D7', sourceRefs: [{ ...branch.sourceRefs[0]!, sheetName: '税收相关规则' }] }],
        },
      },
    };
    expect(validateMenokinSopCandidate(mismatched).issues).toContainEqual(expect.objectContaining({ code: 'NODE_REFERENCE_MISMATCH' }));
    expect(validateMenokinSopGraph(mismatched).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'GRAPH_NODE_KEY_MISMATCH' }),
      expect.objectContaining({ code: 'GRAPH_SOURCE_GROUP_MISMATCH' }),
    ]));
  });

  it('blocks customer content whose target key disagrees with its target id', () => {
    const candidate = assertReady([row()]).candidate!;
    const script = candidate.tables.customerScripts.rows[0]!;
    const mismatched: typeof candidate = {
      ...candidate,
      tables: {
        ...candidate.tables,
        customerScripts: {
          ...candidate.tables.customerScripts,
          rows: [{ ...script, targetNodeKey: 'D2' }],
        },
      },
    };
    expect(validateMenokinSopCandidate(mismatched).issues).toContainEqual(expect.objectContaining({
      code: 'NODE_REFERENCE_MISMATCH', rowId: script.id, field: 'targetNodeKey',
    }));
  });

  it('reports a cycle for review instead of deciding whether the loop is valid', () => {
    const result = projectMenokinSopSourceRows([
      row({
        rowNumber: 2,
        rowHash: sha('f'),
        nodes: [{ nodeKey: 'D1', nodeType: 'execution', stepNumber: 3, title: '第一步', body: '第一步' }],
        paths: [{ fromNodeKey: 'D1', toNodeKey: 'D2', condition: '循环一' }],
        fields: [], scripts: [], quickPhrases: [], images: [], knowledge: [],
      }),
      row({
        rowNumber: 3,
        rowHash: sha('9'),
        nodes: [{ nodeKey: 'D2', nodeType: 'execution', stepNumber: 3, title: '第二步', body: '第二步' }],
        paths: [],
        fields: [], scripts: [], quickPhrases: [], images: [], knowledge: [],
      }),
    ]);
    const candidate = result.candidate!;
    const forward = candidate.tables.decisionBranches.rows[0]!;
    const d1 = candidate.tables.executionTasks.rows.find((item) => item.nodeKey === 'D1')!;
    const d2 = candidate.tables.executionTasks.rows.find((item) => item.nodeKey === 'D2')!;
    const reverse: typeof forward = {
      ...forward,
      id: `sop-branch-${'f'.repeat(24)}`,
      fromExecutionId: d2.id,
      targetExecutionId: d1.id,
      fromNodeKey: 'D2',
      targetNodeKey: 'D1',
      condition: '循环二',
    };
    const cyclicCandidate: typeof candidate = {
      ...candidate,
      tables: {
        ...candidate.tables,
        decisionBranches: {
          ...candidate.tables.decisionBranches,
          rows: [...candidate.tables.decisionBranches.rows, reverse],
        },
      },
    };
    const graph = validateMenokinSopGraph(cyclicCandidate);
    expect(graph.issues).toContainEqual(expect.objectContaining({ code: 'GRAPH_CYCLE_REQUIRES_REVIEW' }));
    expect(graph.status).toBe('blocked');
  });

  it('projects a synthetic ordinary row into all six maintained tables', () => {
    const result = assertReady([row()]);
    const candidate = result.candidate!;
    expect(MENOKIN_SOP_TABLE_NAMES).toEqual([
      '场景目录', '执行任务', '判断分支', '客户话术', '知识与案例', '资源与图片',
    ]);
    expect(Object.values(candidate.tables).map((table) => table.tableName)).toEqual(MENOKIN_SOP_TABLE_NAMES);
    expect(candidate.tables.executionTasks.rows[0]).toMatchObject({
      nodeKey: 'D1', nodeType: 'execution', stepNumber: 3, maintenanceStatus: 'candidate',
    });
    expect(candidate.tables.customerScripts.rows[0]?.text).toBe('合成对客说明');
    expect(candidate.tables.resourcesImages.rows[0]?.contentSha256).toBe(sha('c'));
    const ids = Object.values(candidate.tables).flatMap((table) => table.rows.map((item) => item.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^sop-[a-z]+-[0-9a-f]{24}$/u.test(id))).toBe(true);
  });

  it('sorts the present groups by the approved severity order', () => {
    const input = [...MENOKIN_SOP_SEVERITY_ORDER].reverse().map((group, index) => row({
      sheetName: group,
      sopGroup: group,
      rowNumber: index + 2,
      rowHash: sha(String(index + 1)),
      sourceEntryCode: `SYN-${index + 1}`,
    }));
    const candidate = assertReady(input).candidate!;
    expect(candidate.tables.scenarioDirectory.rows.map((item) => item.group)).toEqual(MENOKIN_SOP_SEVERITY_ORDER);
    expect(candidate.tables.scenarioDirectory.rows.map((item) => item.severityRank))
      .toEqual([0, 1, 2, 3, 4]);
  });

  it('places D1, D7 and DS under step 3 as execution candidates', () => {
    const input = MENOKIN_SOP_EXECUTION_KEYS.filter((key) => ['D1', 'D7', 'DS'].includes(key)).map((nodeKey, index) => row({
      rowNumber: index + 2,
      rowHash: sha(String(index + 2)),
      sourceEntryCode: `SYN-${nodeKey}`,
      nodes: [{
        nodeKey,
        nodeType: 'execution',
        stepNumber: 3,
        title: `合成${nodeKey}`,
        body: `执行合成${nodeKey}`,
      }],
      fields: [],
      scripts: [],
      quickPhrases: [],
      images: [],
      knowledge: [],
    }));
    const candidate = assertReady(input).candidate!;
    expect(candidate.tables.executionTasks.rows.map((item) => item.nodeKey)).toEqual(['D1', 'D7', 'DS']);
    expect(candidate.tables.executionTasks.rows.every((item) => item.nodeType === 'execution' && item.stepNumber === 3))
      .toBe(true);
  });

  it('keeps E1 and E2 as no-outgoing-edge terminal candidates', () => {
    const input = ['E1', 'E2'].map((nodeKey, index) => row({
      rowNumber: index + 2,
      rowHash: sha(String(index + 7)),
      sourceEntryCode: `SYN-${nodeKey}`,
      nodes: [{
        nodeKey,
        nodeType: 'terminal',
        stepNumber: null,
        title: `合成${nodeKey}结束`,
        body: '合成结束说明',
      }],
      fields: [],
      paths: [],
      scripts: [],
      quickPhrases: [],
      images: [],
      knowledge: [],
    }));
    const candidate = assertReady(input).candidate!;
    expect(candidate.tables.executionTasks.rows.map((item) => [item.nodeKey, item.nodeType]))
      .toEqual([['E1', 'terminal'], ['E2', 'terminal']]);
    expect(candidate.tables.decisionBranches.rows).toEqual([]);
  });

  it('retains an unknown branch target as a blocker instead of choosing a default', () => {
    const result = projectMenokinSopSourceRows([row({
      paths: [{ fromNodeKey: 'D1', toNodeKey: null, condition: '合成条件' }],
    })]);
    expect(result.ok).toBe(false);
    expect(result.validation?.ready).toBe(false);
    const branch = result.candidate?.tables.decisionBranches.rows[0];
    expect(branch).toMatchObject({ targetExecutionId: null, targetNodeKey: null, maintenanceStatus: 'blocked' });
    expect(branch?.blockers.map((item) => item.code)).toContain('BRANCH_TARGET_UNRESOLVED');
  });

  it('blocks unresolved node type, script risk and media binding', () => {
    const result = projectMenokinSopSourceRows([row({
      nodes: [{
        nodeKey: null,
        nodeType: 'unresolved',
        stepNumber: null,
        title: null,
        body: null,
      }],
      fields: [],
      scripts: [{ targetNodeKey: null, text: '合成不定风险话术', riskLevel: 'unresolved' }],
      quickPhrases: [],
      images: [{
        referenceKind: 'embedded',
        columnNumber: 5,
        contentSha256: sha('f'),
        referenceHash: null,
        mime: 'image/jpeg',
        bytes: 120,
        targetNodeKey: null,
      }],
      knowledge: [],
    })]);
    expect(result.validation?.ready).toBe(false);
    const codes = result.candidate?.blockers.map((item) => item.code) ?? [];
    expect(codes).toEqual(expect.arrayContaining([
      'NODE_KEY_UNRESOLVED',
      'NODE_TYPE_UNRESOLVED',
      'SCRIPT_RISK_UNRESOLVED',
      'SCRIPT_TARGET_UNRESOLVED',
      'MEDIA_TARGET_UNRESOLVED',
    ]));
  });

  it('blocks allergy text unless both required instructions are present', () => {
    const blockedExecution = projectMenokinSopSourceRows([row({
      nodes: [{
        nodeKey: 'D1',
        nodeType: 'execution',
        stepNumber: 3,
        title: '合成过敏提示',
        body: '合成正文继续处理',
      }],
    })]);
    expect(blockedExecution.validation?.ready).toBe(false);
    expect(blockedExecution.candidate?.tables.executionTasks.rows[0]?.blockers.map((item) => item.code))
      .toContain('ALLERGY_REQUIRED_CONTEXT');

    const blocked = projectMenokinSopSourceRows([row({
      scripts: [{ targetNodeKey: 'D1', text: '合成过敏说明', riskLevel: 'routine' }],
      knowledge: [],
    })]);
    expect(blocked.validation?.ready).toBe(false);
    expect(blocked.candidate?.tables.customerScripts.rows[0]?.blockers.map((item) => item.code))
      .toContain('ALLERGY_REQUIRED_CONTEXT');

    const accepted = assertReady([row({
      scripts: [{ targetNodeKey: 'D1', text: '合成过敏说明：请停手并确认', riskLevel: 'routine' }],
    })]);
    expect(accepted.candidate?.tables.customerScripts.rows[0]?.maintenanceStatus).toBe('candidate');

    assertReady([row({
      nodes: [{
        nodeKey: 'D1',
        nodeType: 'execution',
        stepNumber: 3,
        title: '合成过敏提示',
        body: '请停手并确认后再继续',
      }],
      scripts: [],
    })]);
  });

  it('keeps external image references as summaries and never emits their locator', () => {
    const result = projectMenokinSopSourceRows([row({
      images: [{
        referenceKind: 'external',
        columnNumber: 8,
        contentSha256: null,
        referenceHash: sha('d'),
        mime: null,
        bytes: null,
        targetNodeKey: 'D1',
      }],
    })]);
    expect(result.validation?.ready).toBe(false);
    const image = result.candidate?.tables.resourcesImages.rows[0];
    expect(image).toMatchObject({
      referenceKind: 'external',
      referenceHash: sha('d'),
      contentSha256: null,
      bytes: null,
      columnNumber: 8,
      maintenanceStatus: 'blocked',
    });
    expect(image?.blockers.map((item) => item.code)).toContain('MEDIA_EXTERNAL_REFERENCE');
    expect(JSON.stringify(result.candidate)).not.toContain('https://');
    expect(JSON.stringify(result.candidate)).not.toContain('/Downloads/');
    expect(validateMenokinSourceRows([row({
      images: [{
        referenceKind: 'external',
        columnNumber: 8,
        contentSha256: null,
        referenceHash: 'https://synthetic.example/image.png',
        mime: null,
        bytes: null,
        targetNodeKey: 'D1',
      }],
    })])).toContainEqual(expect.objectContaining({
      code: 'INVALID_SHA256',
      field: '$[0].images[0].referenceHash',
    }));
  });

  it('fails closed for missing fields and blocks duplicate field keys', () => {
    const missing = { ...row() } as Record<string, unknown>;
    delete missing.rowHash;
    expect(validateMenokinSourceRows([missing])).toContainEqual(expect.objectContaining({
      code: 'MISSING_FIELD',
      field: '$[0].rowHash',
    }));
    expect(projectMenokinSopSourceRows([missing])).toMatchObject({ ok: false, candidate: null });

    const duplicate = projectMenokinSopSourceRows([row({
      fields: [
        { key: 'condition', value: '合成值一', targetNodeKey: 'D1' },
        { key: 'condition', value: '合成值二', targetNodeKey: 'D1' },
      ],
    })]);
    expect(duplicate.validation?.ready).toBe(false);
    expect(duplicate.candidate?.tables.knowledgeCases.rows[1]?.blockers.map((item) => item.code))
      .toContain('DUPLICATE_FIELD_KEY');
  });

  it('produces the same logical candidate and summary for reordered input', () => {
    const first = row();
    const second = row({
      sheetName: '税收相关规则',
      sopGroup: '税收相关规则',
      rowNumber: 2,
      rowHash: sha('e'),
      sourceEntryCode: 'SYN-ROW-2',
    });
    const direct = projectMenokinSopSourceRows([first, second]).candidate!;
    const reordered = projectMenokinSopSourceRows([second, first]).candidate!;
    const repeated = projectMenokinSopSourceRows([first, second]).candidate!;
    expect(reordered).toEqual(direct);
    expect(repeated).toEqual(direct);
    expect(createMenokinSopDecisionSummary(reordered)).toEqual(createMenokinSopDecisionSummary(direct));
    expect(serializeMenokinSopDecisionSummary(reordered)).toBe(serializeMenokinSopDecisionSummary(direct));
    expect(validateMenokinSopCandidate(direct).ready).toBe(true);
  });
});
