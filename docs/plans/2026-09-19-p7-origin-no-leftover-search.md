# P7：有 API origin 时不走 leftover `/v1/search`

> **状态：** 实现中（`feat/p7-origin-no-leftover-search`）。  
> **不包含：** 改冻结 OpenAPI、把 leftover 当产品主链。

## 拍板

产品模式有 `CUSTOMER_AGENT_DESKTOP_API_ORIGIN` 时，查询缺 hydrate 文件应 `UNAVAILABLE`，不得打 leftover `/v1/search`。与「hydrate env 已设但文件读失败」同一条 fail-closed。未设 origin 的开发单测仍可走 leftover。
