# P7：登录快照同时写 BM25 索引

> **状态：** 实现中（`feat/p7-login-bm25-index`，叠在 origin 隔离线上）。  
> **不包含：** 多公司 PG 分库、把索引打进包。

## 拍板

1. 胶囊登录分页 `/v1/announce/snapshot` 之后：写 hydrate，并按同一快照写 `CUSTOMER_AGENT_RETRIEVAL_INDEX`（origin 带后缀路径）。
2. 空快照不擦盘。更小的种子不覆盖更大的本地索引。已有 Doc2Query `questions[]` 按 scriptId 保留。
3. 索引写入失败不挡 hydrate。
