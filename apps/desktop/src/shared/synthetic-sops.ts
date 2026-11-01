import scriptImageData from '../../assets/sop-synthetic/parcel-details.png?inline';
import knowledgeImageData from '../../assets/sop-synthetic/split-parcels.png?inline';
import taskImageData from '../../assets/sop-synthetic/quantity.png?inline';
import { deepFreeze } from './deep-freeze';
import { ALLERGY_SOP_SCENE_ID, MISSING_ITEM_SOP_SCENE_ID } from './sop-entry';
import { validateSopTree, type SopEdge, type SopScript, type SopTree } from './sop-model';
import type { SopImage } from './sop-window';


// Synthetic drawings are bundled as data, and the enclosing task owns each image.
const SAMPLE_TASK_IMAGE = { alt: '合成示例：订单三件，实收两件', dataUrl: taskImageData } satisfies SopImage;
const SAMPLE_KNOWLEDGE_IMAGE = { alt: '合成示例：订单分为已送达和在途两个包裹', dataUrl: knowledgeImageData } satisfies SopImage;
const SAMPLE_SCRIPT_IMAGE = { alt: '合成示例：包裹外观与包裹信息', dataUrl: scriptImageData } satisfies SopImage;
const ALLERGY_FOLLOWUP_SCRIPT = { id: 'syn-sop-allergy-mild', title: '告知后续处理', condition: '需要记录不适并安排跟进', answerText: '请暂停使用，并告知不适出现的时间和部位。若症状持续或加重，请及时就医。' } satisfies SopScript;
const ALLERGY_RESULT_EDGES = [
  { id: 'mild', label: '客户描述轻微', criterion: '仅记录客户的原话，不作为医学判断', targetId: 'mild-copyable', unableToDetermine: false, matchTerms: [] },
  { id: 'severe', label: '客户描述明显不适', criterion: '客户描述明显不适，需要记录并跟进', targetId: 'record-discomfort', unableToDetermine: false, matchTerms: [] },
] satisfies readonly SopEdge[];

function defineTree(tree: SopTree): SopTree { validateSopTree(tree); return deepFreeze(tree); }

export const ALLERGY_SOP_TREE: SopTree = defineTree({
  sceneId: ALLERGY_SOP_SCENE_ID, sceneTitle: '过敏流程', stageLabel: '售后核实', version: 'synthetic-3', startNodeId: 'voucher-ask',
  nodes: [
    { id: 'voucher-ask', kind: 'decision', title: '核实凭证', stageLabel: '核实情况', instruction: '请先确认停用，并核实客户是否提供照片。',
      scripts: [{ id: 'syn-sop-allergy-voucher', title: '索取凭证', condition: '客户尚未提供凭证', answerText: '请先暂停使用。方便提供不适部位的照片和包装上的批次信息吗？我们会进一步核实情况。' }],
      requirements: [], knowledge: [{ id: 'allergy-boundary', title: '处理边界', body: '坐席记录客户描述并按当前流程判断，不根据照片自行诊断。' }],
      edges: [{ id: 'no-photo', label: '未给照片', criterion: '尚未收到核实所需照片', targetId: 'insist-voucher', unableToDetermine: false, matchTerms: [] }, { id: 'has-photo', label: '已给照片', criterion: '已收到客户提供的照片', targetId: 'severity', unableToDetermine: false, matchTerms: [] }, { id: 'photo-unknown', label: '暂无法确认', criterion: '不能确定照片是否已提供', targetId: 'insist-voucher', unableToDetermine: true, matchTerms: [] }] },
    { id: 'severity', kind: 'decision', title: '核实不适情况', stageLabel: '确认处理路径', instruction: '根据客户描述选择处理路径，信息不足时先补充核实。',
      scripts: [], requirements: [], knowledge: [], edges: [
        ...ALLERGY_RESULT_EDGES,
        { id: 'unknown', label: '信息不足', criterion: '现有信息不足以选择处理路径', targetId: 'supplement-situation', unableToDetermine: true, matchTerms: [] }] },
    { id: 'insist-voucher', kind: 'action', title: '等待补充凭证', stageLabel: '后续处理', instruction: '记录缺少的信息，收到照片后继续核实。',
      scripts: [{ id: 'syn-sop-allergy-insist', title: '补充凭证', condition: '缺少核实信息', answerText: '方便补充不适部位的照片和包装上的批次信息吗？收到后我们会进一步核实。' }],
      requirements: [{ id: 'photo-received', label: '已收到客户照片' }], knowledge: [], nextId: 'severity' },
    { id: 'mild-copyable', kind: 'terminal', title: '记录不适', stageLabel: '后续处理', instruction: '记录不适时间与部位，确认后续跟进安排。',
      scripts: [ALLERGY_FOLLOWUP_SCRIPT], requirements: [], knowledge: [] },
    { id: 'record-discomfort', kind: 'action', title: '记录明显不适', stageLabel: '记录情况', instruction: '记录客户描述的不适时间与部位，并确认后续跟进安排。',
      scripts: [ALLERGY_FOLLOWUP_SCRIPT], requirements: [], knowledge: [], nextId: 'confirm-followup' },
    { id: 'confirm-followup', kind: 'action', title: '确认后续跟进', stageLabel: '后续处理', instruction: '确认客户的后续跟进安排。',
      scripts: [], requirements: [{ id: 'followup-confirmed', label: '已确认后续跟进安排' }], knowledge: [], nextId: 'followup-recorded' },
    { id: 'followup-recorded', kind: 'terminal', title: '记录后续跟进', stageLabel: '后续处理', instruction: '按已确认的安排继续跟进，及时记录客户反馈。', scripts: [], requirements: [], knowledge: [] },
    { id: 'supplement-situation', kind: 'action', title: '补充不适信息', stageLabel: '补充信息', instruction: '补充客户描述及需要核实的信息；未收到补充时可等待客户。',
      scripts: [{ id: 'syn-sop-allergy-supplement', title: '请求补充情况', condition: '客户描述尚不完整', answerText: '方便补充说明不适出现的时间和部位吗？收到后我会继续核实。' }],
      requirements: [{ id: 'details-confirmed', label: '已补充必要信息' }], knowledge: [], nextId: 'reassess-situation' },
    { id: 'reassess-situation', kind: 'decision', title: '再次核实不适情况', stageLabel: '确认处理路径', instruction: '根据补充后的客户描述选择处理路径，仍无法判断时可等待或返回补充。',
      scripts: [], requirements: [], knowledge: [], edges: [
        ...ALLERGY_RESULT_EDGES,
        { id: 'unknown', label: '信息仍不足', criterion: '补充后仍无法选择处理路径', targetId: 'pending-details', unableToDetermine: true, matchTerms: [] }] },
    { id: 'pending-details', kind: 'action', title: '等待补充信息', stageLabel: '后续跟进', instruction: '可等待客户补充信息，或从已走步骤返回重新判断。',
      scripts: [], requirements: [{ id: 'followup-planned', label: '已确认后续跟进安排' }], knowledge: [], nextId: 'pending-followup' },
    { id: 'pending-followup', kind: 'terminal', title: '跟进事项', stageLabel: '后续跟进', instruction: '按已确认的安排继续跟进，必要时再次核实。', scripts: [], requirements: [], knowledge: [] },
  ],
});

/** Fully invented teaching example, shared by the manual and in-query execution. */
export const MISSING_ITEM_SOP_TREE: SopTree = defineTree({
  sceneId: MISSING_ITEM_SOP_SCENE_ID, sceneTitle: '少件处理', stageLabel: '售后核实', version: 'synthetic-2', startNodeId: 'collect',
  nodes: [
    { id: 'collect', kind: 'action', title: '核对订单与实收数量', stageLabel: '收集信息', instruction: '核对订单应收数量、客户实收数量和包裹信息。', images: [SAMPLE_TASK_IMAGE],
      requirements: [{ id: 'ordered', label: '已核对订单应收数量' }, { id: 'received', label: '已核对实收数量和包裹信息' }],
      scripts: [
        { id: 'syn-missing-ask', title: '索取数量与包裹信息', condition: '客户尚未提供完整信息', answerText: '方便告诉我这笔订单应收到和实际收到的数量，并提供包裹信息吗？我先帮您核对。', images: [SAMPLE_SCRIPT_IMAGE] },
        { id: 'syn-missing-ack', title: '确认收到材料', condition: '客户已提供所需信息', answerText: '收到您提供的信息了，我会先核对订单和包裹情况，再与您确认后续处理。' },
      ],
      knowledge: [{ id: 'missing-vs-split', title: '少件与分包发货', body: '实收数量较少不一定代表漏发。应先核对是否分包发货、其他包裹是否仍在运输，以及客户描述是否与同一订单对应。', images: [SAMPLE_KNOWLEDGE_IMAGE] }], nextId: 'classify' },
    { id: 'classify', kind: 'decision', title: '确认数量差异原因', stageLabel: '判断情况', instruction: '根据已核实的信息选择路径。资料不足时不要判断为已漏发。', scripts: [], requirements: [],
      knowledge: [{ id: 'missing-unknown', title: '无法判断怎么办', body: '如果无法确定包裹是否拆分或订单明细是否完整，继续补充核实。不要直接承诺补发、退款或赔付。' }],
      edges: [
        { id: 'split', label: '还有包裹在途', criterion: '已确认订单分包且剩余包裹尚未送达', targetId: 'in-transit', unableToDetermine: false, matchTerms: [] },
        { id: 'missing', label: '已核实数量不足', criterion: '包裹均已到达，实收数量仍少于应收数量', targetId: 'escalate', unableToDetermine: false, matchTerms: [] },
        { id: 'unknown', label: '信息不足', criterion: '未能核实包裹状态或数量', targetId: 'supplement', unableToDetermine: true, matchTerms: [] },
      ] },
    { id: 'in-transit', kind: 'terminal', title: '告知分包情况', stageLabel: '确认后续', instruction: '告知已核实的包裹情况，并记录后续跟进安排。', requirements: [], knowledge: [],
      scripts: [{ id: 'syn-missing-transit', title: '说明分包发货', condition: '已核实剩余包裹仍在途', answerText: '核对后，这笔订单还有包裹在运输中。我会协助您关注后续配送情况。' }] },
    { id: 'escalate', kind: 'action', title: '提交少件复核', stageLabel: '人工协助', instruction: '整理数量差异和包裹材料，提交主管确认处理方案。', requirements: [{ id: 'submitted', label: '已提交材料并确认跟进人' }], knowledge: [],
      scripts: [{ id: 'syn-missing-escalate', title: '告知正在复核', condition: '数量差异已核实，处理方案待确认', answerText: '已记录您反馈的数量差异，我会提交进一步核实，处理方案确认后再与您沟通。' }],
      managerNote: '处理方案需按当前有效规则确认，不能根据此合成样例承诺补发或赔付。', nextId: 'done' },
    { id: 'supplement', kind: 'action', title: '补充核实信息', stageLabel: '补充材料', instruction: '补充订单数量或包裹状态。可先等待客户或内部同事回复，再继续。',
      requirements: [{ id: 'supplemented', label: '已补充核实所缺信息' }], knowledge: [], scripts: [{ id: 'syn-missing-supplement', title: '请求补充信息', condition: '信息尚不足以判断', answerText: '目前还需要补充核对订单和包裹情况，方便提供缺少的信息吗？收到后我会继续核实。' }], nextId: 'recheck' },
    { id: 'recheck', kind: 'decision', title: '重新核实数量差异', stageLabel: '判断情况', instruction: '根据补充信息选择路径，仍不确定时提交人工协助。', requirements: [], knowledge: [], scripts: [], edges: [
      { id: 'split', label: '还有包裹在途', criterion: '补充资料确认剩余包裹在途', targetId: 'in-transit', unableToDetermine: false, matchTerms: [] },
      { id: 'review', label: '提交人工复核', criterion: '确认少件或仍无法确定原因', targetId: 'escalate', unableToDetermine: true, matchTerms: [] },
    ] },
    { id: 'done', kind: 'terminal', title: '完成本次引导', stageLabel: '确认后续', instruction: '本次核实和材料提交已完成，按已确认安排继续跟进。', requirements: [], knowledge: [], scripts: [] },
  ],
});
export const SYNTHETIC_SOP_TREES: readonly SopTree[] = Object.freeze([ALLERGY_SOP_TREE, MISSING_ITEM_SOP_TREE]);
export function findSyntheticSopTree(sceneId: string): SopTree | null { return SYNTHETIC_SOP_TREES.find(tree => tree.sceneId === sceneId) ?? null; }
