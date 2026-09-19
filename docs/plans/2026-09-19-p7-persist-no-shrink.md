# P7：hydrate 保大目录时不写小 BM25

> **状态：** 已实现（`feat/p7-persist-no-shrink`）。  
> **不包含：** 改 leftover `/v1/search`、登录等待 MiniMax、多公司 PG。

## 拍板

1. `persistHydrateFromEnv` 在 hydrate 为 `kept-larger` / `empty` / `invalid` 时直接返回，不写 BM25，不把结果改成 `wrote`。
2. hydrate `aligned` 且 BM25 新写入时，仍可升成 `wrote`，好让查询刷新。
3. hydrate 真正 `wrote` 时照旧补 BM25。
