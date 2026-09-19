# P7：查询运行时按 origin 读 hydrate / BM25

> **状态：** 实现中（`feat/p7-runtime-origin-reads`）。  
> **不包含：** 未设 origin 时去读操作员家目录里的未带后缀文件。

## 拍板

1. `loadHydrateCatalog` / `loadRetrievalPipeline` 在 env 未设但有 `CUSTOMER_AGENT_DESKTOP_API_ORIGIN` 时，读带后缀文件。
2. origin 也未设时返回空，单测不会加载 `~/.customer-agent-synthetic-stack/` 里的真目录。
3. 智能检索开关：有 origin 用带后缀文件，否则保持原来的未带后缀默认（开发机）。
