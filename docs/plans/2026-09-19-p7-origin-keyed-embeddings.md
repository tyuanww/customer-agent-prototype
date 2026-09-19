# P7：正文向量按 API origin 隔离

> **状态：** 实现中（`feat/p7-origin-keyed-embeddings`，叠在 hydrate/BM25 origin 隔离之上）。  
> **不包含：** 多公司 PG 分库、登录等待 MiniMax、把向量打进包。

## 拍板

1. `retrieval-embeddings.json` 与 hydrate / BM25 用同一 `sha256(apiOrigin)` 后缀。
2. 未带后缀的旧向量文件仍可回退。
3. `CUSTOMER_AGENT_EMBEDDING_INDEX` 在产品模式随 `applyPackagedRetrievalDefaults` 挂上。
4. 失败仍退回 BM25 正文车道。
