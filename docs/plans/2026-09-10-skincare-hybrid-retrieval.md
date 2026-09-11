# 护肤品客服话术检索：并行落地计划

> 状态：本轮已冻结，见 `docs/plans/2026-09-10-macos-semantic-query-freeze.md`。不改冻结 `judgeSearch`，不把客户原文提交进 Git。水合走仓外 hydrate 快照，不再用 `/v1/search` 换标题。
> 产品形状：坐席看到**原文候选**并复制，不生成话术。

## 为什么大改而不是补丁

当前桌面「口语句 → 猜快捷短语 → `/v1/search`」是绕开冻结判定器的翻译器，不是检索。源头错位是：

1. 入库检索面是快捷短语，不是顾客问法。
2. 冻结搜索不把答案当召回，leftover 字二元组把相关口语丢掉。
3. 意图关键词表会无限膨胀。

冻结 `/v1/search` 只负责**水合**：用命中标题换回带 `release_id` / `content_hash` 的候选，复制合同不变。

## 目标架构

```
顾客原句
  → 查询分析（域 / 实体槽）
  → 过滤器：平台 · 商品范围 · 有效期（发布门仍在 API）
  → 并行召回：BM25(标题+问句)  ∥  BM25(正文)   〔后续把第二路换成 embedding〕
  → RRF(k=60) 融合
  → 仓外 hydrate 快照填原文 Top 3（有快照时不打 leftover `/v1/search`）
  → 现有卡片 + 复制
```

依据（交叉验证）：

| 结论 | 来源 A | 来源 B |
|---|---|---|
| 生产默认 hybrid：词法 + 向量，RRF 融合 | [Azure Hybrid Search](https://learn.microsoft.com/en-us/azure/search/hybrid-search-overview) | [Elastic RRF retriever](https://www.elastic.co/docs/reference/elasticsearch/rest-apis/retrievers/rrf-retriever) |
| RRF 几乎不调参、融合多路排序 | 同上 Azure ranking | SIGIR 2009 Cormack et al. |
| 电商先做查询分析（同义/NER/类目）再检索 | [OpenSearch 电商查询分析](https://www.alibabacloud.com/help/en/open-search/industry-algorithm-edition/query-analysis-in-e-commerce-scenarios) | [OpenSearch 查询分析](https://www.alibabacloud.com/help/en/open-search/industry-algorithm-edition/query-analysis-rule-management/) |
| 客服知识库同一流水线 | [ai-cookbook hybrid-retrieval](https://github.com/daveebbelaar/ai-cookbook/tree/main/knowledge/hybrid-retrieval) | [hybrid-rag](https://github.com/tim-ponomarev/hybrid-rag) |
| 字段加权对电商检索有额外增益 | WANDS：RRF+field boost | Azure：filter/facet 与倒排、向量分结构 |

## 并行分工（互不改同一文件）

| 流 | 负责人 | 文件 | 完成标准 |
|---|---|---|---|
| **A 召回** | Grok（本轮） | `apps/desktop/src/shared/hybrid-retrieve.ts` 及单测 | 合成语料：口语句 Top1 正确；不引用客户原文 |
| **B 查询分析** | Grok（本轮） | `apps/desktop/src/shared/query-analyze.ts` | 槽输出域+实体，只作为 BM25 查询扩展/过滤，不映射具体标题 |
| **C 接线** | Grok（本轮） | `semantic-retrieve.ts` 改为调用 A+B；`product-search.ts` 保持水合 | 无索引时行为与旧测试一致 |
| **D 入库问句面** | Codex / 下一轮 | 仓外索引 schema 增加 `questions[]`；发布时写入 | 不提交飞书正文；快捷短语降为别名 |
| **E 稠密向量** | 下一轮 | 第二路 BM25(正文) 换成 embedding | 模型版本绑 `content_hash`；失败显式降级到 A |
| **F 真实商品槽** | 下一轮 | 目录换成 MENOKIN 品名/系列，仓外 | 不改冻结 HTTP |

禁止：改 `apps/api/src/search-decision.ts`、扩 FUNCTION_WORDS、把「什么时候」写死映射到某个 script_id。

## 本轮（小时级）验收

合成语料（不是客户表）：

- 「什么时候发货」→ 发货/时效类标题，不优先改地址
- 「敏感肌能用吗」→ 适用人群类标题
- 「地址填错了」→ 改地址类标题

本机索引（仓外）抽查口语句仍能水合成 `/v1/search` hit。卡片仍展示原文。

## 明确不做

- 大模型生成客服回复
- 合并治理 PR、Windows、打包
- 把 MENOKIN 正文推进 Git
- 宣称 M5 完成或去掉 Demo 身份壳
