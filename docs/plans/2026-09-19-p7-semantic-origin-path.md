# P7：BM25 fallback 按 origin 读 keyed 索引

> **状态：** 已实现（`feat/p7-semantic-origin-path`）。  
> **不包含：** 删 leftover 文件、改 leftover `/v1/search`、多公司 PG。

## 拍板

1. `loadSemanticRetriever()` 默认走 `productStackReadPath`，与查询 pipeline 同一套 origin 规则。
2. 显式传入路径仍优先（单测 / 注入）。
3. origin 已设且 keyed 文件不存在时，不读未带后缀 leftover。
