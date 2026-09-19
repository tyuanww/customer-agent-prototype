# P7：仅在 hydrate 写入或对齐后补向量

> **状态：** 已实现（`feat/p7-embed-after-persist`）。  
> **不包含：** 登录等待 MiniMax、把向量打进包、改 leftover `/v1/search`。

## 拍板

1. 登录分页后仍**不等待** MiniMax。
2. 只在 persist 结果为 `wrote` 或 `aligned` 时调度补向量。
3. `kept-larger` / `empty` / `invalid` / persist 失败（`null`）不拿小快照去覆盖本地更大目录的向量。
