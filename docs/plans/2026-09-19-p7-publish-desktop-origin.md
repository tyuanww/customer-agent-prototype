# P7：产品模式把 API origin 写进 env

> **状态：** 实现中（`feat/p7-publish-desktop-origin`）。  
> **不包含：** 覆盖操作员已经 export 的 origin。

## 拍板

`applyPackagedRetrievalDefaults` 在传入 `apiOrigin` 且 `CUSTOMER_AGENT_DESKTOP_API_ORIGIN` 为空时写入该 env。管理台、telemetry、leftover 关闭、CLI 默认路径都读这个变量；只设 hydrate 路径不够，子逻辑还要 origin。
