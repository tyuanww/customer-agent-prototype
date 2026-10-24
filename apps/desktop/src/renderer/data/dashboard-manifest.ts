import { deepFreeze } from '@shared/deep-freeze';
import {
  DASHBOARD_ENV_BADGES,
  DASHBOARD_METRIC_SCOPE,
  DASHBOARD_REFRESH_LABEL,
  DASHBOARD_REFRESHED_AT,
  DASHBOARD_STRUCTURE_DISCLAIMER,
} from '@shared/dashboard-window';

export const DASHBOARD_MODULE_IDS = [
  'overview',
  'wording',
  'sop',
  'content',
  'announce',
] as const;

export type DashboardModuleId = (typeof DASHBOARD_MODULE_IDS)[number];

export type LedgerTerminal = 'copied' | 'no_hit' | 'abandoned' | 'risk_escalated';
export type IterationStatus = 'open' | 'in_progress' | 'resolved' | 'wont_fix';
export type IterationKind = 'no_hit' | 'top1_skipped';
// 与 OpenAPI `IterationTaskCause` 一一对应；风险升级属于 escalate，不属于本域。
export type IterationCause = 'content_gap' | 'ranking' | 'stale' | 'mixed';
export type DomainId = 'presale' | 'campaign' | 'aftersale' | 'product';
export type SyncFacet = 'published' | 'announced' | 'client_ack' | 'offline_lease';
export type DashboardNavItem = {
  id: DashboardModuleId;
  label: string;
  blurb: string;
  group: '经营总览' | '服务洞察' | '话术运营' | '治理与架构';
};

export type WordingLifecycle = 'demo_effective' | 'demo_expiring' | 'structure_sample' | 'published';
export type SourceReadiness = 'structure_confirmed' | 'upstream_authoring' | 'local_catalog';

export type WordingEntry = {
  scriptId: string;
  domain: DomainId;
  title: string;
  scene: string;
  answerPreview: string;
  platform: string;
  version: string;
  effectiveWindow: string;
  risk: 'low' | 'medium' | 'high';
  lifecycle: WordingLifecycle;
  lifecycleLabel: string;
  ownerRole: string;
  dataClass: 'synthetic' | 'local-catalog' | 'current-release';
};

export type LedgerTop3Binding = {
  rank: 1 | 2 | 3;
  releaseId: string;
  scriptId: string;
  version: string;
  contentHash: string;
};

export type LedgerRow = {
  operationId: string;
  rootQuestionId: string;
  askedAt: string;
  scene: string;
  rootQuestion: string;
  operationNote: string;
  top3: readonly LedgerTop3Binding[];
  chosenRank: 1 | 2 | 3 | null;
  terminal: LedgerTerminal;
  terminalLabel: string;
};

export type WorkorderStage = 'precheck' | 'map' | 'aggregate' | 'drill' | 'redacted_export';

export type WorkorderBatch = {
  batchId: string;
  title: string;
  currentStage: WorkorderStage;
  ticketCount: number;
  uniqueOrders: number;
  rejectedFields: readonly string[];
  distribution: readonly { label: string; count: number; pct: number }[];
};

export type IterationTask = {
  taskId: string;
  /** 与 OpenAPI `signal_id` 同形；本刀不进 HTTP，只作展示。 */
  signalId: string;
  clusterKey: string;
  kind: IterationKind;
  status: IterationStatus;
  priority: 'P0' | 'P1' | 'P2';
  cause: IterationCause;
  suggestedScriptIds: readonly string[];
  sampleQueryIds: readonly string[];
  /** CAS 期望版本；演练的 start / close 用它判定并发冲突。 */
  version: number;
  resolution: 'resolved' | 'wont_fix' | null;
  resolutionNote: string | null;
  owner: string;
  evidenceCount: number;
  title: string;
  detail: string;
  nextStep: string;
  createdAt?: string;
};

export type ContentRelease = {
  releaseId: string;
  title: string;
  bindings: readonly { domain: DomainId; label: string; sourceId: string; bound: boolean }[];
  review: string;
  quality: string;
  validity: string;
  risk: string;
  blocked: boolean;
  blockReason?: string;
};

export type ContentCoachUpload = {
  title: string;
  roleNote: string;
  draftOnlyCopy: string;
  boundaryCopy: string;
  aftersaleNote: string;
  accept: string;
  demoFileName: string;
  demoCsv: string;
};

export type AnnounceRow = {
  itemId: string;
  title: string;
  published: boolean;
  announced: boolean;
  clientAck: boolean;
  offlineLease: boolean;
};

export const DASHBOARD_NAV: readonly DashboardNavItem[] = deepFreeze([
  { id: 'overview', label: '管理概览', blurb: '风险、责任与处理进度', group: '经营总览' },
  { id: 'wording', label: '话术库', blurb: '四域资产浏览与来源就绪度', group: '话术运营' },
  { id: 'sop', label: 'SOP', blurb: '当前产品会话 SOP 树', group: '话术运营' },
  { id: 'content', label: '内容管理', blurb: '导入 · 发布', group: '治理与架构' },
  { id: 'announce', label: '系统同步', blurb: '话术版本 / 软件版本更新', group: '治理与架构' },
]);

export const DASHBOARD_MANIFEST = deepFreeze({
  banners: {
    env: DASHBOARD_ENV_BADGES,
    disclaimer: DASHBOARD_STRUCTURE_DISCLAIMER,
    refreshedAt: DASHBOARD_REFRESHED_AT,
    refreshLabel: DASHBOARD_REFRESH_LABEL,
    metricScope: DASHBOARD_METRIC_SCOPE,
    syntheticMark: 'DEMO · 合成数据',
  },
  // The intake overview reads live usage and inaccuracy rows.
  // Fixed sample rates stay out of this manifest so a failed read cannot fall back to them.
  ledger: {
    title: '检索流水',
    kicker: 'root question 与 search operation 双账',
    emptyHint: '本 Demo 不采集真实检索。下表为预置合成流水。',
    rows: [
      {
        operationId: 'op-20260813-001',
        rootQuestionId: 'rq-cleanser-usage',
        askedAt: '2026-08-13 10:12:04',
        scene: '私域企微 · 产品用法',
        rootQuestion: '澄芽氨基酸洁面泡沫很少，是不是少了活剂？',
        operationNote: '同根问题第 2 次检索，坐席改写了口语。',
        top3: [
          {
            rank: 1,
            releaseId: 'rel-demo-2026-08-a',
            scriptId: 'syn-prod-001',
            version: 'q-14',
            contentHash: 'sha256:7c1a…b29e',
          },
          {
            rank: 2,
            releaseId: 'rel-demo-2026-08-a',
            scriptId: 'syn-prod-001-care',
            version: 'q-09',
            contentHash: 'sha256:11d4…90aa',
          },
          {
            rank: 3,
            releaseId: 'rel-demo-2026-08-a',
            scriptId: 'syn-prod-001-quick',
            version: 'q-06',
            contentHash: 'sha256:88e0…c4f1',
          },
        ],
        chosenRank: 2,
        terminal: 'copied',
        terminalLabel: '已复制 · 未发生发送',
      },
      {
        operationId: 'op-20260813-014',
        rootQuestionId: 'rq-serum-acid',
        askedAt: '2026-08-13 11:03:41',
        scene: '天猫咨询 · 成分叠加',
        rootQuestion: '雾屿精华今晚能和刷酸一起用吗？',
        operationNote: '根问题首次检索。',
        top3: [
          {
            rank: 1,
            releaseId: 'rel-demo-2026-08-a',
            scriptId: 'syn-prod-002',
            version: 'q-11',
            contentHash: 'sha256:4ab2…d017',
          },
          {
            rank: 2,
            releaseId: 'rel-demo-2026-08-a',
            scriptId: 'syn-after-004',
            version: 'q-03',
            contentHash: 'sha256:90c8…ee12',
          },
          {
            rank: 3,
            releaseId: 'rel-demo-2026-08-a',
            scriptId: 'syn-pre-007',
            version: 'q-02',
            contentHash: 'sha256:c31f…77ab',
          },
        ],
        chosenRank: 1,
        terminal: 'copied',
        terminalLabel: '已复制 · 未发生发送',
      },
      {
        operationId: 'op-20260813-028',
        rootQuestionId: 'rq-points-expire',
        askedAt: '2026-08-13 13:22:18',
        scene: '售后工单 · 会员积分',
        rootQuestion: '青禾会员日积分昨天到期了，还能补发吗？',
        operationNote: '命中过期活动域，检索按有效期过滤后无可用稿。',
        top3: [],
        chosenRank: null,
        terminal: 'no_hit',
        terminalLabel: '无命中',
      },
      {
        operationId: 'op-20260813-041',
        rootQuestionId: 'rq-sunscreen-acne',
        askedAt: '2026-08-13 14:08:55',
        scene: '抖音私信 · 使用反馈',
        rootQuestion: '月白防晒涂完出油还闷痘，要停用吗？',
        operationNote: '坐席展开 Top3 后未选择，会话被下一条消息打断。',
        top3: [
          {
            rank: 1,
            releaseId: 'rel-demo-2026-08-a',
            scriptId: 'syn-prod-003',
            version: 'q-08',
            contentHash: 'sha256:2e44…a91c',
          },
          {
            rank: 2,
            releaseId: 'rel-demo-2026-08-a',
            scriptId: 'syn-after-009',
            version: 'q-05',
            contentHash: 'sha256:bb70…14d6',
          },
          {
            rank: 3,
            releaseId: 'rel-demo-2026-08-a',
            scriptId: 'syn-pre-012',
            version: 'q-04',
            contentHash: 'sha256:0d9a…6cf3',
          },
        ],
        chosenRank: null,
        terminal: 'abandoned',
        terminalLabel: '已展开未选择',
      },
      {
        operationId: 'op-20260813-057',
        rootQuestionId: 'rq-refund-report',
        askedAt: '2026-08-13 16:41:09',
        scene: '售后升级 · 退货检测',
        rootQuestion: '退货一定要第三方检测报告吗？没有报告能退吗？',
        operationNote: '风险策略命中售后承诺边界，建议升级人工复核。',
        top3: [
          {
            rank: 1,
            releaseId: 'rel-demo-2026-08-a',
            scriptId: 'syn-after-021',
            version: 'q-07',
            contentHash: 'sha256:65f1…cc08',
          },
        ],
        chosenRank: null,
        terminal: 'risk_escalated',
        terminalLabel: '风险升级 · 未复制',
      },
    ] satisfies LedgerRow[],
  },
  wording: {
    title: '话术库',
    kicker: '资产浏览与正式来源就绪度 · Dashboard 一期零写正文',
    disclaimer:
      '以下正文均为虚构合成结构样例，不是真实品牌或正式话术源。产品 / 活动只展示正式来源规模与治理状态，不导入真实正文；售前 / 售后正式源尚未创建。',
    domains: [
      {
        id: 'product',
        label: '产品话术',
        readiness: 'structure_confirmed',
        readinessLabel: '正式源结构已确认 · Demo 未导入',
        sourceSummary: '正式源结构已确认；Demo 仅展示 2 条合成结构样例，四域整体签发仍未完成。',
      },
      {
        id: 'campaign',
        label: '活动话术',
        readiness: 'structure_confirmed',
        readinessLabel: '正式源结构已确认 · Demo 未导入',
        sourceSummary: '正式源结构已确认；Demo 仅展示 1 条合成结构样例，活动有效期必须硬过滤。',
      },
      {
        id: 'presale',
        label: '售前流程',
        readiness: 'upstream_authoring',
        readinessLabel: 'NOT_CREATED · UPSTREAM_AUTHORING',
        sourceSummary: '上游文档尚未创建，不存在 canonical / current。',
      },
      {
        id: 'aftersale',
        label: '售后流程',
        readiness: 'upstream_authoring',
        readinessLabel: '合成过敏树样例 · DEMO',
        sourceSummary: '合成过敏树样例 · DEMO。切片 1 不提供树编辑；话术师 CSV 上传在「内容与发布」。',
      },
    ] as const,
    entries: [
      {
        scriptId: 'syn-prod-library-001',
        domain: 'product',
        title: '洁面产品使用方法 · 合成结构样例',
        scene: '产品用法 / 预期管理',
        answerPreview: '先确认产品版本，再说明用量、使用步骤和不可承诺边界；本条不对应任何真实商品。',
        platform: '千牛 / 抖音（演示）',
        version: 'demo-v3.1',
        effectiveWindow: '2026-01-01 → 2099-12-31（合成）',
        risk: 'low',
        lifecycle: 'demo_effective',
        lifecycleLabel: '合成有效',
        ownerRole: 'ROLE-CONTENT-LEAD（结构演示）',
        dataClass: 'synthetic',
      },
      {
        scriptId: 'syn-prod-library-002',
        domain: 'product',
        title: '产品搭配与风险升级 · 合成结构样例',
        scene: '搭配咨询 / 合规边界',
        answerPreview: '只回答库内已批准原文；持续不适时停止使用并升级人工，不生成医学判断。',
        platform: '千牛（演示）',
        version: 'demo-v3.2',
        effectiveWindow: '2026-01-01 → 2099-12-31（合成）',
        risk: 'high',
        lifecycle: 'demo_effective',
        lifecycleLabel: '合成有效',
        ownerRole: 'ROLE-CS-MANAGER + ROLE-CONTENT-LEAD',
        dataClass: 'synthetic',
      },
      {
        scriptId: 'syn-campaign-library-001',
        domain: 'campaign',
        title: '满赠规则与库存边界 · 合成结构样例',
        scene: '活动规则 / 有效期',
        answerPreview: '展示门槛、限制与结算条件；不核验订单、不承诺库存，过期后停止推荐。',
        platform: '抖音（演示）',
        version: 'demo-c3.1',
        effectiveWindow: '2026-08-01 → 2026-08-31（合成）',
        risk: 'medium',
        lifecycle: 'demo_expiring',
        lifecycleLabel: '合成临期',
        ownerRole: 'ROLE-CONTENT-LEAD（结构演示）',
        dataClass: 'synthetic',
      },
      {
        scriptId: 'syn-presale-structure-001',
        domain: 'presale',
        title: '售前适用性判断 · 结构样例',
        scene: '适用性 / 预期管理',
        answerPreview: '仅示意未来字段：问题识别、边界提醒、人工升级；正式正文由上游编写。',
        platform: '结构样例',
        version: 'structure-only',
        effectiveWindow: '未发布',
        risk: 'high',
        lifecycle: 'structure_sample',
        lifecycleLabel: '结构样例 · 未发布',
        ownerRole: '待上游指定',
        dataClass: 'synthetic',
      },
      {
        scriptId: 'syn-aftersale-structure-001',
        domain: 'aftersale',
        title: '异物 / 少液证据采集与升级 · 结构样例',
        scene: '售后质量升级',
        answerPreview: '仅示意未来流程：记录必要证据、禁止原因承诺、转品质人工复核。',
        platform: '结构样例',
        version: 'structure-only',
        effectiveWindow: '未发布',
        risk: 'high',
        lifecycle: 'structure_sample',
        lifecycleLabel: '结构样例 · 未发布',
        ownerRole: '待上游指定',
        dataClass: 'synthetic',
      },
    ] satisfies WordingEntry[],
  },
  iteration: {
    title: '话术优化待办',
    kicker: '需要跟进的话术',
    domainNote: '这里只看待处理的话术。',
    footnote: '标成优先的事项先处理。',
    tasks: [
      {
        taskId: 'it-2041',
        signalId: 'sig-no-hit-rq-points-expire',
        clusterKey: 'no_hit:rq-points-expire',
        kind: 'no_hit',
        status: 'open',
        cause: 'content_gap',
        suggestedScriptIds: ['syn-after-004'],
        sampleQueryIds: ['q-syn-2041-01', 'q-syn-2041-02', 'q-syn-2041-03'],
        version: 1,
        resolution: null,
        resolutionNote: null,
        priority: 'P0',
        owner: '售后流程 Owner',
        evidenceCount: 18,
        title: '会员积分过期补发缺少有效稿',
        detail: '根问题 rq-points-expire 连续无命中。需内容同学补「过期积分不补发」的售后边界稿。',
        nextStep: '确认规则唯一主源与有效期后，由内容 Owner 起草并进入受控复核。',
      },
      {
        taskId: 'it-2048',
        signalId: 'sig-top1-skipped-rq-cleanser-usage',
        clusterKey: 'top1_skipped:rq-cleanser-usage',
        kind: 'top1_skipped',
        status: 'in_progress',
        cause: 'ranking',
        suggestedScriptIds: ['syn-prod-001-quick', 'syn-prod-001-care'],
        sampleQueryIds: ['q-syn-2048-01', 'q-syn-2048-02'],
        version: 2,
        resolution: null,
        resolutionNote: null,
        priority: 'P1',
        owner: 'Search Owner + Coach',
        evidenceCount: 12,
        title: '洁面泡沫少的首条场景过宽',
        detail: '坐席两次选了 rank 2 温和提醒稿。首条偏说明书，待拆「疑似假货」与「用量」两条。',
        nextStep: '复核查询表达与候选绑定，先调召回/排序，不改写已发布 Answer。',
      },
      {
        taskId: 'it-2055',
        signalId: 'sig-no-hit-rq-refund-report',
        clusterKey: 'no_hit:rq-refund-report',
        kind: 'no_hit',
        status: 'open',
        cause: 'stale',
        suggestedScriptIds: ['syn-after-021'],
        sampleQueryIds: ['q-syn-2055-01', 'q-syn-2055-02', 'q-syn-2055-03', 'q-syn-2055-04'],
        version: 1,
        resolution: null,
        resolutionNote: null,
        priority: 'P0',
        owner: '售后口径 Owner',
        evidenceCount: 7,
        title: '退货检测旧稿已过有效期仍被召回',
        detail: '根问题 rq-refund-report 命中的售后稿有效窗口已过，仍出现在候选里。',
        nextStep: '核对有效期硬过滤与召回口径；过期内容不得进入结果。',
      },
      {
        taskId: 'it-2017',
        signalId: 'sig-no-hit-rq-sunscreen-acne',
        clusterKey: 'no_hit:rq-sunscreen-acne',
        kind: 'no_hit',
        status: 'resolved',
        cause: 'content_gap',
        suggestedScriptIds: ['syn-prod-003'],
        sampleQueryIds: ['q-syn-2017-01'],
        version: 3,
        resolution: 'resolved',
        resolutionNote: '上一发布已纳入 syn-prod-003，本条保留合成闭环记录。',
        priority: 'P2',
        owner: '产品话术 Owner',
        evidenceCount: 9,
        title: '月白防晒补涂话术已补',
        detail: '上一发布已纳入 syn-prod-003。本条只作历史闭环示例。',
        nextStep: '保留合成闭环记录，不自动学习，不影响正式内容。',
      },
      {
        taskId: 'it-1992',
        signalId: 'sig-top1-skipped-rq-live-streaming',
        clusterKey: 'top1_skipped:rq-live-streaming',
        kind: 'top1_skipped',
        status: 'wont_fix',
        cause: 'mixed',
        suggestedScriptIds: ['syn-pre-007'],
        sampleQueryIds: ['q-syn-1992-01'],
        version: 3,
        resolution: 'wont_fix',
        resolutionNote: '样本过少且与现有简洁稿重复，维持观察。',
        priority: 'P2',
        owner: 'Search Owner',
        evidenceCount: 3,
        title: '直播口语过短不单独立项',
        detail: '样本过少且与现有简洁稿重复。记录为 wont_fix，不改写现网稿。',
        nextStep: '维持观察，证据量达到合成阈值后重新评估。',
      },
    ] satisfies IterationTask[],
  },
  content: {
    title: '内容与发布',
    kicker: 'Import → Validate → Staged → Publish → Announce → ACK/Lease',
    pipeline: ['Import', 'Validate', 'Staged', 'Publish', 'Announce', 'ACK/Lease'],
    publishDisabledReason: '请先登录后再发布',
    upload: {
      title: '话术师上传',
      roleNote:
        '话术师（coach）可导入已标注的产品与活动草稿。一期发布仅管理员（owner）。冻结合同 POST /v1/content/publish。售后、过敏或赔付需管理员。坐席（agent）不能发布。没有第四角色。',
      draftOnlyCopy: '上传只进入待发布，点发布后坐席才能搜到。',
      boundaryCopy: '支持 CSV 与 xlsx。中文表头会映射到场景/标准话术；不连接飞书或 Wiki。',
      aftersaleNote: '售后流程仍为合成样例，本页不展开 SOP 树。',
      accept: '.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      demoFileName: 'synthetic-coach-draft.csv',
      demoCsv: [
        'scene,script',
        '洁面用量确认,先确认产品版本，再说明用量与不可承诺边界',
        '满赠规则说明,展示门槛与结算条件，不承诺库存',
        '售后质量升级,记录必要证据，禁止原因承诺',
      ].join('\n'),
    } satisfies ContentCoachUpload,
    domains: [
      { id: 'presale', label: '售前' },
      { id: 'campaign', label: '活动' },
      { id: 'aftersale', label: '售后' },
      { id: 'product', label: '产品' },
    ],
    releases: [
      {
        releaseId: 'rel-demo-2026-08-a',
        title: '合成发布结构演练 · 四域样例齐全（非正式现状）',
        bindings: [
          { domain: 'presale', label: '售前', sourceId: 'structure-pre-demo', bound: true },
          { domain: 'campaign', label: '活动', sourceId: 'src-camp-demo-08', bound: true },
          { domain: 'aftersale', label: '售后', sourceId: 'structure-after-demo', bound: true },
          { domain: 'product', label: '产品', sourceId: 'src-prod-demo-08', bound: true },
        ],
        review: '已复核',
        quality: '抽样通过',
        validity: '2026-08-01 → 2026-09-30',
        risk: '含 1 条 medium',
        blocked: false,
      },
      {
        releaseId: 'rel-demo-2026-08-blocked',
        title: '合成发布 B · 缺产品域',
        bindings: [
          { domain: 'presale', label: '售前', sourceId: 'src-pre-demo-08b', bound: true },
          { domain: 'campaign', label: '活动', sourceId: 'src-camp-demo-08b', bound: true },
          { domain: 'aftersale', label: '售后', sourceId: 'src-after-demo-08b', bound: true },
          { domain: 'product', label: '产品', sourceId: '—', bound: false },
        ],
        review: '未进入审核',
        quality: '未评估',
        validity: '未生效',
        risk: '未知',
        blocked: true,
        blockReason: '缺域即阻断：产品域来源未绑定，发布不可继续。',
      },
    ] satisfies ContentRelease[],
  },
  announce: {
    title: '公告与同步',
    kicker: 'published / announced / client ACK / offline lease 必须分面',
    story:
      '正式链路里“库里有稿”“已经公告”“客户端确认”“离线租约有效”是四件事。本 Demo 禁止把它们合成一个「已同步」。',
    simulation: {
      delayMs: 480,
      disclaimer: '仅在当前页面演练 loading / success / error，不联网、不发送、不保存，也不改变下方四分面。',
      loadingMessage: '正在本地生成合成推送回执；未连接任何公告服务。',
      successMessage: '本地演练完成（未发送）：已生成合成回执预览，四分面状态未改变。',
      errorMessage: '本地演练失败并已安全停止；没有联网、发送或保存，可调整演练结果后重试。',
      unpublishedMessage: '该对象尚未发布，本地演练按发布门禁禁用。',
    },
    facets: [
      { id: 'published', label: 'published', meaning: '发布记录已写入内容库' },
      { id: 'announced', label: 'announced', meaning: '公告通道已发出' },
      { id: 'client_ack', label: 'client ACK', meaning: '客户端确认收到该版本' },
      { id: 'offline_lease', label: 'offline lease', meaning: '离线租约仍在有效窗口' },
    ],
    rows: [
      {
        itemId: 'ann-rel-a',
        title: 'rel-demo-2026-08-a',
        published: true,
        announced: true,
        clientAck: true,
        offlineLease: true,
      },
      {
        itemId: 'ann-rel-a-nightly',
        title: '夜间增量公告（合成）',
        published: true,
        announced: true,
        clientAck: false,
        offlineLease: true,
      },
      {
        itemId: 'ann-rel-blocked',
        title: 'rel-demo-2026-08-blocked',
        published: false,
        announced: false,
        clientAck: false,
        offlineLease: false,
      },
      {
        itemId: 'ann-lease-expired',
        title: '旧租约示例（合成）',
        published: true,
        announced: true,
        clientAck: true,
        offlineLease: false,
      },
    ] satisfies AnnounceRow[],
  }
});

export function nextDashboardNavId(
  active: DashboardModuleId,
  delta: number,
  items: readonly DashboardNavItem[] = DASHBOARD_NAV,
): DashboardModuleId {
  const index = items.findIndex((item) => item.id === active);
  return items[(index + delta + items.length) % items.length].id;
}

export function findLedgerRow(operationId: string): LedgerRow | undefined {
  return DASHBOARD_MANIFEST.ledger.rows.find((row) => row.operationId === operationId);
}

export function listOpenP0IterationTasks(
  tasks: readonly IterationTask[],
): readonly IterationTask[] {
  return tasks.filter((task) => task.status === 'open' && task.priority === 'P0');
}
