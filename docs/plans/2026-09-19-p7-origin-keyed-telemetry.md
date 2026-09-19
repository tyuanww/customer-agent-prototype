# P7：检索 telemetry 按 API origin 隔离

> **状态：** 实现中（`feat/p7-origin-keyed-telemetry`）。  
> **不包含：** 多公司 PG 分库、把问句原文写入 telemetry。

## 拍板

1. 产品模式把 `CUSTOMER_AGENT_RETRIEVAL_TELEMETRY` 指到 `retrieval-telemetry.<id>.json`。
2. 不再默认写在 hydrate 同目录的共享 `retrieval-telemetry.json`（两个远端会混在一起）。
3. 未设 origin 且只有 hydrate env 时，仍可写在 hydrate 旁边（开发机旧习惯）。
4. 仍不记录问句原文。
