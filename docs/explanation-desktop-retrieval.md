# 为什么检索在桌面，而不是改冻结的 `/v1/search`

API leftover `judgeSearch` 只在标题和问句上做字面判定，答案不进召回。把顾客口语句硬改写成某条标题，再打 `/v1/search`，是翻译器，不是检索。改那个判定器会搅动已冻结的 T6 / G1A 证据，本轮明确禁止。

## The problem

客服要的是：丢进一句顾客原话，立刻拿到已发布的话术原文。关键词表会无限膨胀；让模型写新回答又破坏「只复制原文」。本机还出现过把标题当查询打 leftover HTTP、以及 `stack start` 把 `rel_6` 顶掉后整窗 `STALE`。

## The approach

桌面 main 持有仓外倒排索引和 hydrate 快照。BM25 在标题 / 问句 / 正文上分别打分，RRF 融合。MiniMax 只做查询规划和已有 id 的重排，timeout fail-open。hydrate 用 `releaseId` 对齐公告门，卡片正文来自快照而不是模型。有 hydrate 时不再调用 leftover `/v1/search`。

```
Query renderer ──IPC──► ProductSearch
                          ├─ retrieval-pipeline (BM25 + 可选 MiniMax)
                          ├─ hydrate-catalog（原文 + 发布门）
                          └─ 仅当没有 hydrate 时：D1–D5 合成 HTTP（测试 / 未接索引）
```

## Trade-offs

- 索引和原文快照在仓外，git 里没有 MENOKIN 正文；换发布必须重导 hydrate，没有自动刷新。
- 第二路仍是 BM25(正文)，还不是 embedding；`questions[]` 入库（Doc2Query）也还没做。
- 没有 hydrate 的 profile 仍会打 leftover HTTP，这是 D2 测试合同，不是演示主链。

## Alternatives considered

- 继续快捷改写 + `/v1/search`：演示能出三条，但召回面仍是标题，口语会漏。
- 在 API 里换判定器：和冻结证据冲突，本轮不做。
- 用 MiniMax 直接写话术：产品禁止；实现上重排 prompt 只含 id 和标题。
