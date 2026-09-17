import { deepFreeze } from './deep-freeze';
import { ALLERGY_SOP_SCENE_ID } from './sop-entry';
import { validateSopTree, type SopTree } from './sop-model';

function defineAllergyTree(tree: SopTree): SopTree {
  validateSopTree(tree);
  return deepFreeze(tree);
}

export const ALLERGY_SOP_TREE: SopTree = defineAllergyTree({
  sceneId: ALLERGY_SOP_SCENE_ID,
  sceneTitle: '过敏流程',
  stageLabel: '环节',
  startNodeId: 'voucher-ask',
  nodes: [
    {
      id: 'voucher-ask',
      kind: 'copyable',
      voucher: true,
      scriptId: 'syn-sop-allergy-voucher',
      scopeLabel: '过敏凭证 · 合成演示',
      riskLevel: 'high',
      answerText:
        '请先请客户提供不适部位照片和包装批次信息（合成演示，不会上传、不建单）。确认已停用后再继续，这一步只给话术。',
      edges: [
        { id: 'no-photo', label: '未给照片', targetId: 'insist-voucher' },
        { id: 'has-photo', label: '已给照片', targetId: 'severity' },
      ],
    },
    {
      id: 'severity',
      kind: 'decision',
      edges: [
        { id: 'mild', label: '轻微', targetId: 'mild-copyable' },
        { id: 'severe', label: '严重', targetId: 'severe-internal' },
      ],
    },
    {
      id: 'insist-voucher',
      kind: 'copyable',
      scriptId: 'syn-sop-allergy-insist',
      scopeLabel: '继续要凭证 · 合成演示',
      riskLevel: 'high',
      answerText:
        '还没有照片或批次信息时，先不要判断责任或补偿；请继续请客户补凭证后再升级。本条只用于合成演示。',
      edges: [],
    },
    {
      id: 'mild-copyable',
      kind: 'copyable',
      scriptId: 'syn-sop-allergy-mild',
      scopeLabel: '轻微不适 · 合成演示',
      riskLevel: 'medium',
      answerText:
        '轻微不适可先停用观察，并记录出现时间和部位；不要承诺补偿路径。若持续加重，再按严重路径升级人工复核。',
      edges: [],
    },
    {
      id: 'severe-internal',
      kind: 'internal',
      internalNote: '按升级路径交给话术师复核，不要把内部口径发给客户。',
      internalTask: '通知话术师复核（合成待办，不建单）',
      nextId: 'severe-done',
      edges: [],
    },
    {
      id: 'severe-done',
      kind: 'internal',
      internalNote: '升级说明已走完，坐席可结束本流程。',
      edges: [],
    },
  ],
});

export function allergySopTree(): SopTree {
  return ALLERGY_SOP_TREE;
}
