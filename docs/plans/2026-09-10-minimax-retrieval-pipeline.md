# MiniMax 检索管道（源头替换，不是重排补丁）

> 状态：本轮已冻结，见 `docs/plans/2026-09-10-macos-semantic-query-freeze.md`。不改冻结 `judgeSearch`。不生成话术正文。坐席只复制原文。
> 开关：查询胶囊「智能检索」，**默认 ON**，可关；失败 fail-open 到本地 BM25。

## 为什么现方案不是源头

当前 MiniMax 只接在 BM25 Top 结果之后做 L2 重排，且召回池实际只有 3 条。
重排不能找回从未进入候选集的话术。口语句和快捷短语的词表鸿沟仍在入库侧。

## 目标管道

```
顾客原句
  → [开关 ON] MiniMax 查询规划：JSON {intent, queries[1..3]}
  → L1 并行：每条 query 做字段加权 BM25（title / questions[] / answer），池子 24
  → RRF(k=60) 融合
  → [开关 ON] MiniMax 重排 Top 8（只返回已有 scriptId）
  → hydrate 原文 Top 3
  → 卡片 / 复制

开关 OFF 或 MiniMax 失败：跳过规划与重排，BM25+RRF 直出。
```

后续（不阻塞本轮）：入库 Doc2Query 把 `questions[]` 写成顾客问法；第二路 BM25(正文) 换成 embedding。

禁止：改 `search-decision.ts`、生成回复、把口语写死映射到 script_id。
