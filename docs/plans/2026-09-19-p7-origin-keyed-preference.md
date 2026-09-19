# P7：智能检索开关按 API origin 隔离

> **状态：** 已接线（`feat/p7-origin-keyed-preference`，待授权提交）。  
> **不包含：** 多公司 PG 分库、改 OpenAPI。

## 拍板

1. `retrieval-preference.json` 与会话 / hydrate 用同一 `sha256(apiOrigin)` 后缀。
2. 偏好 store 在 `registerProductSearchIpc` 时读取 env，不在 import 时绑死路径（那时还没 `applyPackagedRetrievalDefaults`）。
3. 两个远端目标的「智能检索」开关互不影响。
