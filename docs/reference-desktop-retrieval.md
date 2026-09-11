# 桌面语义检索

本页是当前桌面检索的事实描述。它不是发版说明，也不改冻结的 API `judgeSearch`。坐席只复制已发布原文，不生成话术。

相关：[检索为什么走桌面](explanation-desktop-retrieval.md) · [如何启动本机检索浮窗](how-to-run-macos-semantic-query.md) · [冻结点](plans/2026-09-10-macos-semantic-query-freeze.md) · [候选展示规则](plans/2026-09-07-natural-language-search.md)

## 做什么

查询胶囊把顾客问句交给 Electron main。main 在本地索引上做字段加权 BM25 + RRF，可选地用 MiniMax 规划检索式并重排已有 `scriptId`，再用仓外 hydrate 快照填回原文 Top 3。Renderer 不持有话术正文以外的检索实现，也不调用 MiniMax。

有 hydrate 快照时，不再把问句或命中标题转发给 leftover `/v1/search`。没有 hydrate 时，仍走 D1–D5 的合成 HTTP 搜索（测试与未接索引的 profile）。

## 管道

```
顾客问句
  → 可选 MiniMax 查询规划 JSON {intent, queries[1..3]}
  → 每条 query：BM25(title×3, question/questions[]×2.5) ∥ BM25(answer×1)
  → RRF k=60，池 24
  → 可选 MiniMax 重排 Top 8（只返回已有 scriptId；只发 id + 标题）
  → hydrate 原文，过滤平台 / 商品范围 / 有效期 / 冲突
  → 卡片 Top 3
```

开关 OFF、缺 key、超时或解析失败：跳过规划与重排，BM25+RRF 直出。禁止把话术正文发给 MiniMax。

## 公共表面

| 名称 | 位置 | 默认 / 约束 |
| --- | --- | --- |
| 智能检索开关 | 查询胶囊；IPC `product:retrieval-preference-get/set` | 默认 ON；无效 payload 不写入 |
| `CUSTOMER_AGENT_RETRIEVAL_INDEX` | main `loadRetrievalPipeline` | 仓外 JSON；`scripts[]` 含 `scriptId` / `title` / `questionText` / `answerText` / 可选 `questions[]` |
| `CUSTOMER_AGENT_HYDRATE_INDEX` | main `loadHydrateCatalog` | 仓外 JSON；`releaseId` 必须等于当前 `content_current`；行必须是 SearchCandidate 联合类型 |
| `CUSTOMER_AGENT_RETRIEVAL_PREFERENCE` | 偏好文件路径 | 默认 `~/.customer-agent-synthetic-stack/retrieval-preference.json` |
| `MINIMAX_API_KEY` | main `minimax-chat.ts` | 未设置则智能检索等同 OFF |
| `MINIMAX_BASE_URL` | 同上 | 默认 `https://api.minimaxi.com/v1` |
| `MINIMAX_MODEL` | 同上 | 默认 `MiniMax-M3` |
| 规划超时 | `minimax-plan.ts` | 1800ms |
| 重排超时 | `minimax-rerank.ts` | 2500ms；只看前 8 条 |

BM25 常量在 `apps/desktop/src/shared/hybrid-retrieve.ts`：`k1=1.2`，`b=0.75`，CJK 单字+二元组。查询分析槽在 `query-analyze.ts`，只扩展检索式，不映射某条标题。

## 失败

| 情况 | 坐席看到 |
| --- | --- |
| hydrate 的 `releaseId` 不在当前公告允许集合 | `STALE`：内容已变化，请重新查询 |
| 本地有排序但 hydrate 对不上 id，或过滤后为空 | `no_hit`，不打 leftover `/v1/search` |
| MiniMax 超时 / 非 2xx / JSON 非法 | 日志 fallback，卡片仍是 BM25 顺序 |
| 开关 SET 失败 | preload 回读磁盘，不假装已写入 |

## 例子

开发态在已有 `rel_6` 栈上查询「什么时候发货」，hydrate 命中后卡片标题来自发布快照，不经过 `judgeSearch`。关闭智能检索后，同一句只走 BM25，延迟应接近瞬时。

## Related

- 实现：`apps/desktop/src/main/retrieval-pipeline.ts`、`hydrate-catalog.ts`、`product-search.ts`
- 纯函数：`apps/desktop/src/shared/hybrid-retrieve.ts`、`query-analyze.ts`
- 冻结 HTTP 判定仍在 `apps/api/src/search-decision.ts`，本页不修改它
