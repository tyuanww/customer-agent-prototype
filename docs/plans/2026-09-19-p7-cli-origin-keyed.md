# P7：检索 CLI 默认写带 origin 后缀的文件

> **状态：** 实现中（`feat/p7-cli-origin-keyed`）。  
> **不包含：** 改 OpenAPI、把索引打进包。

## 拍板

1. `pnpm retrieval:hydrate` / `retrieval:embeddings` / `retrieval:questions` 在设了 `CUSTOMER_AGENT_DESKTOP_API_ORIGIN` 时，默认写出 `retrieval-*.<id>.json`。
2. 显式 `--out` / `--index` 或已有 `CUSTOMER_AGENT_*_INDEX` 仍优先。
3. 未设 origin 时仍写未带后缀的本机文件（开发机旧习惯）。
