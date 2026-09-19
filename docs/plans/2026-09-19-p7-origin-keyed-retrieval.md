# P7：检索目录按 API origin 隔离

> **状态：** 实现中（`feat/p7-origin-keyed-retrieval`）。  
> **不包含：** 多公司 PG 分库、改 OpenAPI、把索引打进包。

## 拍板

1. 会话文件已经按 `sha256(apiOrigin)` 分文件。hydrate / BM25 用同一把钥匙：`retrieval-hydrate.<id>.json`。
2. 已有未带后缀的仓外文件仍可用（本机开发目录）。一旦出现带后缀的文件，优先用它。
3. 有 `apiOrigin` 且 env 未设时，即使文件还不存在也指向带后缀的路径，避免登录把公司 A 的目录写进公司 B。
4. 地理客户不是租户；租户边界是 API origin / `content_current`。本刀不新增 schema。

## 明确不做

- 不按省/市拆搜索
- 不删本机现有 `retrieval-hydrate.json`
