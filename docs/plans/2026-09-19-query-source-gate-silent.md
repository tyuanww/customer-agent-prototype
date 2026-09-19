# 查询完成后空白

> **状态：** 已实现（`feat/query-source-gate-silent`）。

## 拍板

1. 登录后第一次查询会 `refreshAnnounce`。lease 未就绪会 `drop('source_gate')`。
2. `onInvalidated` 不得把进行中的查询清成空白 SEARCH_INPUT 且不报错。
3. `source_gate` / `unavailable` 在查询中或已有结果时显示「内容暂不可用」/「服务暂不可用」，不得显示「当前版本已失效」。
