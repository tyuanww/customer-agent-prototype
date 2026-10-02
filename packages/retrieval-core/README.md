# retrieval-core

可序列化的检索算法。调用方注入分词器、字段权重、BM25 的 `k1` / `b`、RRF 的 `k`，以及分数门槛。包内不读取环境变量，也不包含界面、进程、数据库或某套业务字段。

## 入口

| 函数 | 作用 |
| --- | --- |
| `characterUnigramBigramTerms` | 可选分词器：NFKC、小写、去掉非字母数字后，取单字和相邻二字 |
| `buildBm25Index` / `rankBm25` | 字段统计与 BM25 排序。权重在调用时按字段名传入 |
| `fuseReciprocalRanks` | `score = Σ 1 / (k + rank)`，`k` 由调用方传入 |
| `takeUniqueByKey` | 按调用方给出的去重键截断已排序结果 |
| `cosineSimilarity` / `rankByCosine` | 向量余弦与正分排序 |
| `countCoveringTerms` / `rowIsAdmitted` | 词覆盖计数和分数门槛。停用词与阈值由调用方传入 |

输入输出都是数组、字符串和数字，可以 `JSON.stringify`。分词器是构建索引时的参数，不写进索引。字段名、权重、RRF 的 `k`、去重键和弃权停用词都由调用方传入。

## 不在这个包里

- 问句槽位、品类、有效期和业务停用词
- 向量目录、正文哈希、模型名
- 宿主界面、进程、数据库和 IPC

## 检查

```bash
pnpm --filter @customer-agent/retrieval-core typecheck
pnpm --filter @customer-agent/retrieval-core test
pnpm --filter @customer-agent/retrieval-core build
```

`test` 先跑单元测试，再编译 `dist` 并用 Node 导入包入口做 smoke test。桌面打包解析 `source` 条件，直接打包 `src`，因此不依赖先产出 `dist`。
