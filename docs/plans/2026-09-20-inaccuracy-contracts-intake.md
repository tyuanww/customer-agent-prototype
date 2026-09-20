# 「话术不准」contracts:intake 预备

> **状态：** PREP。本页冻结未来 `POST /v1/inaccuracy-reports` 的形状与开单口径。本切片不实现 HTTP、不改 OpenAPI YAML、不新增 `AuthMode`、不自动改写 Answer、不自动关单。

## 拍板

1. 客服点「话术不准」之后，持久化必须走上游合同快照 → `pnpm contracts:intake`。禁止手改 `packages/contracts`、禁止在本仓补 YAML、禁止把旧快照改成第二真源。
2. 同一查询会话 + 同一 `script_id` 只记一次。桌面 PREP 键为 `sessionKey + '\0' + scriptId`；上线后 `sessionKey` 对应请求体里的 `query_id`。
3. 开单阈值：同一 `script_id` 在 24 小时内 ≥ 3，或 7 天内 ≥ 10，才**可以**打开已有域的 `iteration_task`。本切片只计算 counts / 是否应当打开；不自动改写、不自动 close。
4. 禁止发明 `/tickets`。列表 / 开始 / 关闭继续用现有 `/v1/metrics/iteration-tasks` 与 `/v1/events/iteration-tasks/{task_id}/start|close`。
5. `AuthMode` 仍是 `mock | feishu`。本能力不增加登录模式，也不增加密码登录端点。

## 当前事实（本切片不改）

- Query 卡片「话术不准」只在本次浮窗会话按 `scriptId` 本地记下，文案「已记录，待话术师核实」。收起查询后丢弃。不走 IPC / API / Dashboard / `copyAdopt`。
- Dashboard「话术优化待办」是合成演练队列，形状对齐冻结 `IterationTask`。本页不展示实时「话术不准」计数。
- 冻结 OpenAPI 已有 iteration_task 域，且合同说明禁止 `/tickets` 与跨域原始明细。

## 未来 POST `/v1/inaccuracy-reports`

尚未存在于任何合同快照。落地前必须在治理仓形成新 `contract_set_id`，再 `pnpm contracts:intake`。

| 项 | 口径 |
| --- | --- |
| method / path | `POST /v1/inaccuracy-reports` |
| operationId（建议） | `recordInaccuracyReport` |
| auth | 现有产品会话 Bearer；开发/测试 mock 仍用成对 `X-Mock-User` + `X-Mock-Role` |
| AuthMode | 不新增；继续 `mock \| feishu` |
| roles | `agent`、`coach`、`owner`（客服点按钮；与 search / adoption 同级，不是 coach-only 写） |
| 幂等头 | 必填 `Idempotency-Key`（同其他 events：同 scope/key/body 重放首次终态，TTL ≥ 24h） |
| 业务去重 | 唯一键 `(query_id, script_id)`；同一对只产生一条计数 |

### 请求体

closed object，禁止 extra properties：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `query_id` | 是 | uuid，必须属于当前 token 用户，且该 query 的候选里含 `script_id`。这就是查询会话键。 |
| `script_id` | 是 | 被点「话术不准」的候选。不得用未展示脚本灌水。 |
| `script_version` | 否 | 当时候选版本，只作证据，不进入去重键。 |
| `rank` | 否 | 1–3，当时展示位，只作证据。 |
| `content_hash` | 否 | 当时候选哈希，只作证据。 |

禁止字段：`ticket_id`、`answer_text`、改写稿、`adopted` / 已发送语义、客户端自报 `role`、任何新 `auth_mode`。

点击只证明产品内按钮已执行，不证明话术师已核实、不证明问题已解决、不结束 query（terminal 仍是 adoption）。

### 响应

| 状态 | 何时 |
| --- | --- |
| `200` | 首次写入，或同一 `(query_id, script_id)` 同体重放。重放不得把计数 +1。 |
| `400` | 校验失败（缺字段、非法 uuid、空 `script_id`）。 |
| `401` | 无产品会话。 |
| `403` | 角色不足或 policy denied。 |
| `404` | query 不存在，或不属于当前用户，或 `script_id` 不是该 query 的候选。 |
| `409` | 同 `Idempotency-Key` 异体；或同一 `(query_id, script_id)` 但证据字段冲突。沿用现有 `ConflictErrorEnvelope`（如 `IDEMPOTENCY_BODY_MISMATCH`）。 |
| `429` / `500` / `503` | 与其他 events 相同。 |

建议 200 体：`{ ok: true, query_id, script_id }`。不要返回「已处理 / 已上报 / 已建单」。

## 计数与开单（本切片可计算，不可执行）

桌面纯函数（`apps/desktop/src/shared/inaccuracy-report.ts`）是本 PREP 的可执行口径：

- `shouldAcceptInaccuracyReport({ sessionKey, scriptId, seenKeys })`
- `aggregateInaccuracyCounts(reports) → { scriptId, count }[]`（先按 session+script 去重再按 script 计数）
- `shouldOpenIterationTask({ count24h, count7d })` → `count24h ≥ 3 || count7d ≥ 10`

后续任务（不在本切片）：

1. 客户端在本地 accept 后才 POST。
2. 服务端按 `(query_id, script_id)` 去重后，按 `script_id` 滚 24h / 7d 窗口。
3. 达到阈值则**打开**一条 `iteration_task`（`status=open`，`suspected_cause` 仍用现有枚举，建议 `mixed` 或后续合同明确的内容不准原因）。不得新造 ticket 资源。
4. 打开 ≠ start。`start` / `close` 仍是 coach / owner 走现有 events，且 `expected_version` 冲突 409。
5. 系统不得因计数或关单自动改写 Answer；关闭待办不等于已发布。

## 明确不做

- 本切片零 HTTP 路由、零 Fastify handler、零 OpenAPI runtime、零 Dashboard IPC。
- 不把 YAML 写入 `packages/contracts` 或 `contracts/upstream`。
- 不 bump `VERSION`，不合并 embeddings-delivery。
- Query 现有本地「已记录」文案保持待核实，不改成已上报。
