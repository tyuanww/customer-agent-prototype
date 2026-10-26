# 服务端检索方案

本文对应任务卡 E4。只写取舍，不改检索代码，不改 SQL，不改依赖。

## 现在有两条检索

坐席电脑上的排序在 `apps/desktop/src/shared/hybrid-retrieve.ts`。它做 BM25 加 RRF。字段权重是 title 3、question 2.5、answer 1。BM25 的 `k1` 是 1.2，`b` 是 0.75。RRF 的 `k` 是 60。池子是 24，只取前 3。弃答门在 `apps/desktop/src/shared/retrieval-quality.ts`。

[2026-10-24 检索基线](../reports/2026-10-24-retrieval-baseline.md) 只测了这条回落路径。held-out 200 条里，正例 170 条，Top-3 命中率 67.6%，MRR 0.608。负例 30 条，无命中正确率 33.3%。向量和重排没有跑。没有 MiniMax 凭据时，第二路回到答案文本的 BM25。

服务端候选来自 `search_recommendable_scripts`。迁移 `0007_search_bigram.sql` 和 `0010_search_projection_v1_13.sql` 都在 `FROM` 之后用 `WHERE public.content_scope_matches(...)` 丢掉范围不符的行，再把剩下的行返回。返回列里带着 `release_id` 和 `source_binding_hash`。范围过滤发生在结果交出去之前。

## 全文和中文

发布行上的检索文档用 `to_tsvector('simple', ...)` 拼出来。见 `packages/database/migrations/0006_definer_functions_and_triggers.sql`。`simple` 不做中文词典分词。服务端现用路径是字符二元组，不是另一套中文解析器。

本仓库的迁移没有 `CREATE EXTENSION` 安装 `pgvector`。在 `sql` 和 `ts` 里搜这个名字，只出现在计划文档。给独立的 PG15 集群编译这个扩展，是以后的工作，不是已经完成的步骤。

## 两套还没测的对照

WeKnora 没有用同一份 held-out 题跑过。结论写在 [WeKnora 检索评估](../reviews/2026-10-26-weknora-retrieval.md)。仓库里的快照核查看的是导入和租户角色，不是检索流水线。本文不把它放进生产检索。

E3 的小模型替换没有实测。没有命中率、延迟或显存可以写进来。

所以本文不能在「PG 全文加向量加 RRF 加重排」和「借用 WeKnora」之间给出谁更好的数字。两边都还没有这套题的结果。

## 提议

生产检索先保持现在两条路径。桌面继续 BM25 回落。服务端继续二元组，并且继续在返回行之前做 `content_scope_matches`。

以后若加向量索引，仍先按范围丢掉行，再在剩下的行上排序。先排序再按权限删，会让无权限的正文进入排序池。当前 SQL 没有这样做。这条顺序是提议，依据是现有函数的 `WHERE`。

索引跟当前 release 走。检索文档写在发布行上，候选带着 `release_id`。不要另建一份可以和 `release_id` 分开更新的索引。回退就是继续用现在的桌面 BM25 和服务端二元组，不删这两条。

在 WeKnora 和 E3 都用同一份 held-out 题、同一套指标跑完之前，不把生产检索换成其中任何一条。
