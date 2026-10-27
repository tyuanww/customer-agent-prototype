# 本地小模型检索对照（2026-10-27）

E3 的离线对照。同一套合成评测集上，把答案路从 BM25 换成 `Qwen/Qwen3-Embedding-0.6B`，再对融合后的前 8 条用 `Qwen/Qwen3-Reranker-0.6B` 重排。没有调用 MiniMax，没有改 `retrieval-pipeline.ts`，没有写仓外生产索引。

对照的 BM25 数字来自 [2026-10-24 检索基线](2026-10-24-retrieval-baseline.md)。那份报告量的是没有向量时的答案路回落。

## 机器

主机是 `macOS-26.5.2-arm64-arm-64bit`，Apple M5，设备是 MPS。这不是 4060 8G。4060 上的延迟和显存没有测。

进程峰值 `ru_maxrss` 是 745046016 字节。MPS 当前分配峰值是 2401895424 字节，约 2.24 GiB。

答案向量按条均摊 9.761 ms。查询向量按条均摊 6.855 ms。每条查询的 8 段重排平均 256.767 ms，360 条合计 92.44 秒。这三项都是 MPS 上的批处理时间，不是单条冷启动。

同一批 62 条答案在 CPU 上再编了一次。`sentence-transformers` 把模型载成 `torch.bfloat16`，并提示这可能比 `float32` 慢。62 条合计 16.435 秒，按条均摊 265.086 ms。这次没有在 CPU 上重跑重排，也没有重跑命中率。

## 怎么复现

在仓库根目录生成向量文件。脚本拒绝模型名里带 `minimax` 或 `embo` 的参数。

```
uv run --python 3.12 --with sentence-transformers --with torch scripts/embed-eval-corpus.py
```

默认写到 `/tmp/ca-dense-eval.json`。然后在 `apps/desktop` 打分。

```
CUSTOMER_AGENT_DENSE_EVAL=1 CUSTOMER_AGENT_DENSE_EVAL_FILE=/tmp/ca-dense-eval.json pnpm exec vitest run tests/unit/retrieval-dense-eval.test.ts
```

日常 `pnpm test` 不读这个文件，只跑融合和解析的守卫。

文档向量使用空 prompt。查询向量使用模型自带的 `query` prompt。重排走 `CrossEncoder`。这次运行里，重排库打印了默认 prompt 名为 `query`。重排数字仍然改变了排序，但不能把它当成模型卡上的完整重排模板。

## 结果

held-out 170 条正例、30 条负例。dev 140 条正例、20 条负例。划分与 2026-10-24 基线相同。弃答门仍是 `admitRetrieval`，所以无命中正确率没有因为换了向量而变化。

| 分组 | Top-3 | MRR | 无命中正确率 |
| --- | --- | --- | --- |
| held-out BM25 回落 | 67.6% | 0.608 | 33.3% |
| held-out Qwen 向量 | 70.0% | 0.648 | 33.3% |
| held-out Qwen 向量加重排 | 68.2% | 0.641 | 33.3% |
| dev BM25 回落 | 55.0% | 0.487 | 25.0% |
| dev Qwen 向量 | 57.9% | 0.529 | 25.0% |
| dev Qwen 向量加重排 | 57.1% | 0.519 | 25.0% |

## 结论

在这套合成题上，Qwen 向量路的 held-out Top-3 和 MRR 高于 BM25 回落。重排没有再高于向量路。无命中正确率与 BM25 回落相同。

没有 MiniMax `embo-01` 的同题数字，所以不能判断 Qwen 是否优于 MiniMax。线上检索仍走原来的链路。BM25 仍是向量缺失时的回落。
