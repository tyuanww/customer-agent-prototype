# 桌面与后端接入：下一阶段准备

> 状态：**APPROVED · SYNTHETIC DESKTOP DEVELOPMENT ONLY**。
> 本文件是下一阶段桌面接入方案的唯一计划真源。用户于 2026-09-09 明确确认批准 D1–D5 纯合成实施及逐切片 Git 交付。批准摘要由治理仓 `DEC-DESKTOP-SYNTHETIC-20260909` 拥有；批准不等于实现完成。
> 当前执行状态统一由[执行清单](2026-09-06-execution-goal.md#当前执行清单)拥有。授权 D1–D5 实施，每切片测试、OCR 审查、修复复审后依次 commit / push / PR / 合并。冻结合同、真实数据、真实飞书凭据、Windows 实机接入和部署不在范围。

核对日期：2026-09-09。候选基线：产品 `main@bb7a14b565553dc689823e54b0218d1d24c47095`（PR #59），治理 `main@0904a0aa11f2dc29ae7700871a943c41295cd329`（PR #75）。冻结合同：OpenAPI 1.13.0 / schema.v1.17，`cs-ai-c11-openapi-1.13.0-schema-1.17-0904a0aa11f2`。

## 0. 结论

后端 T0–T6 与收尾已合并，桌面仍走编译期合成 fixture，中间没有 adapter。本轮把接入边界、IPC 合同、D0–D5 验收切片和并行约束写成可批准方案。推荐 **方案 A：Electron main 唯一持有产品会话与 HTTP**；renderer 只拿视图数据，Dashboard 继续无 preload。客服主链（合成登录、查询复制、公告失效、人工求助、整链验收）可以在现有冻结合同上实施，本轮不改 OpenAPI / schema / 旧 migration。

阻碍接入的是桌面接线，不是再做一套后端。HTTP 上有两处适配缺口，都不授权本轮改冻结合同：搜索澄清在服务端折叠为 `no_hit`；求助通讯录没有独立端口。客户端必须在搜索前澄清，无匹配时走人工求助，打开入口不得显示转交成功。

## 1. 核对基线

| 项 | 实际事实 | 不得写成 |
| --- | --- | --- |
| 产品 HEAD | `bb7a14b565553dc689823e54b0218d1d24c47095`，PR #59 已合并 | 仍停在 `de0a92c` / PR #58 收尾未完成 |
| 产品 CI | 合并提交五项全部 SUCCESS：Verification scope、Linux canonical、PostgreSQL 15、Windows feasibility smoke、CI gate；run `34343036673` | 本机通过代替合并后 CI |
| 治理 HEAD / 合同来源 | `0904a0aa11f2dc29ae7700871a943c41295cd329` | 跨仓实时读取或手改快照 |
| 冻结合同 | lock `cs-ai-c11-openapi-1.13.0-schema-1.17-0904a0aa11f2`；OpenAPI SHA `c3c14659…c94c`；DDL SHA `419d84fb…f133`；`intake_status=VERIFIED_NOT_ACTIVATED`，`runtime_activated=false` | 合同已激活或可手改 |
| migration | `0001`–`0014` 共十四条；禁止改写旧迁移或上游快照 | 改 0001–0013 或重写 0014 |
| Git | 两仓独立历史；启动时均在干净 `main`，已切本地 `codex/desktop-integration-plan`；未 commit / push / PR | 夹带其他任务改动 |
| 许可证 | 产品仓已公开；本轮不选择或新增许可证 | 借文档任务改 LICENSE |
| BACKEND-CI-503 | OPEN。诊断缺口已在 PR #59 修复；原偶发 503 根因未确认 | 用再次 CI 绿关闭问题 |

旧文档里「后端尚未完成 / T4 BLOCKED / 桌面尚未进入该阶段」只保留历史语义。后端已完成；本文件是获批的纯合成桌面实施输入，不能授权真实运行。

## 2. 任务 A：事实与接口缺口

不凭文件名或历史注释猜状态。以下对照当前源码。

### 2.1 桌面仍使用合成 fixture 的位置

| 位置 | 当前行为 | 接入后 |
| --- | --- | --- |
| `apps/desktop/src/renderer/data/synthetic-scripts.ts` `SYNTHETIC_SCRIPTS` | Query 本地召回语料 | D2 后不再作为运行时检索 SoR；可留作未接线 profile 回归 |
| `apps/desktop/src/renderer/features/search/search-service.ts` `searchScripts()` | renderer 同步 n-gram；有效期为本地闭区间日 | D2 删除运行路径；正式检索只走 main adapter → `POST /v1/search` |
| `apps/desktop/src/renderer/QueryApp.tsx` | `setTimeout` 后直接 `searchScripts(trimmed)`；generation 只防本地过期结果 | 改为白名单 IPC；renderer 拥有输入 generation；main 校验并绑定当前会话，不自行递增它 |
| `apps/desktop/src/renderer/features/search/QueryResultsPane.tsx` | 空态只有文案「转人工话术师」，无按钮、无事件 | D4 增加求助入口；打开≠转交成功 |
| `apps/desktop/src/renderer/data/dashboard-manifest.ts` `DASHBOARD_MANIFEST` | 九模块编译期深冻结合成 BI | 本阶段不改成管理写入口；D5 不经 Dashboard 做导入审核发布 |
| `apps/desktop/src/shared/contracts.ts` | `MAX_QUERY_CHARS = 2000`；`copyText` 只写剪贴板 | API 上限 500；复制成功后才能报 `adopted` |
| `apps/desktop/src/preload/index.ts` | 仅 overlay / clipboard / dashboard:open | 增加产品会话与检索窄能力；仍无通用 IPC |
| Dashboard 窗口 | `DASHBOARD_WINDOW_SECURITY`，无 preload，不在 `trustedContents()` | 保持。禁止把只读 adapter 扩成通用管理写 |

桌面 `src/` 内无 `fetch` / HTTP 客户端。生产 CSP 为 `connect-src 'self'`。renderer 不能「换一个 search URL」接到后端。

### 2.2 后端已实现的合同（源码，不是目录名）

| 域 | 已实现入口 | 关键不变量 |
| --- | --- | --- |
| 身份 | `POST /v1/auth/login-requests`、`GET /v1/auth/callback`、`POST /v1/auth/login-requests/{id}/exchange`、`POST /v1/auth/logout`、`GET /v1/auth/me`；mock 仅 `kind==='mock'` 时注册 `POST /v1/auth/mock-login` | 产品会话 opaque Bearer，43 字符；合成提供方仅 127.0.0.1 loopback；客户端不选 DB 角色 |
| 查询 | `POST /v1/search` | 只放行 `collection_mode=synthetic`；平台仅 `qianniu`/`douyin`；`platform_source=native_integration` 拒绝；`unknown` 拒绝 |
| 事件 | `POST /v1/events/adoption`、`POST /v1/events/escalate` | adoption 含 `adopted` / `dismissed` / `no_hit_exit` / `timeout`；每个 query 一条 terminal；`adopted` 先复制成功再记账 |
| 公告 / 快照 / ACK | `GET /v1/announce/current`、`GET /v1/announce/snapshot`、`POST /v1/announce/ack` | 必须 `X-Client-Id`；短租约 600s；ACK 不续租；分页不混版本 |
| 审核 | `/v1/admin/content/reviews*` | 受限能力池；主体/质量门由数据库再验证 |
| 发布 | `POST /v1/content/publish`、`POST /v1/content/rollback` | owner + `app_content_admin`；回退复制为新 seq |
| 导入 / worker | `POST /v1/content/import` 及查询/取消；独立 worker | 202 只在持久化 + enqueue 成功后返回 |
| 策略 | `GET /v1/policy`、`POST /v1/policy/flags` | 管理写与 runtime 读分离 |

`SearchCandidate` 已含 `release_id/script_id/script_version/content_hash/title/category/answer_text/platform_scope/product_scope_* /effective_* /intent_* /risk_* /placeholder_keys`。内部判定 `show | reject | clarify_or_no_result` 在 HTTP 上折叠为 `hit_status: hit|no_hit`。

### 2.3 三类区分

| 分类 | 条目 |
| --- | --- |
| 后端已有 | 上表全部；合成身份、导入、worker、审核、发布/回退、search+events、announce/snapshot/ack |
| 桌面尚未接线 | 会话、HTTP、平台/商品确认、候选映射、复制后 adoption、terminal 事件、公告租约、求助入口、退出清理 |
| 确实需要新增合同 | **本轮客服主链不需要改冻结合同。** 新增的是产品仓内部 IPC adapter 合同（D0 定稿）。治理 OpenAPI 1.13.0 / schema.v1.17 保持冻结 |

### 2.4 适配缺口（记录，不改冻结合同）

1. **澄清与无匹配共用 `no_hit`。** 客户端必须在调用搜索前补齐平台；缺少具体商品或问题信息时先澄清。搜索返回空候选后走 D4，不把内部 `clarify_or_no_result` 当成新 HTTP 字段。
2. **无求助通讯录端口。** `escalate.action` 仅为 `open_feishu | copy_contact | other`，不表示已转交。D4 使用合成本地联系卡 + 该事件。
3. **无 refresh token。** `LoginSession` 只有 `access_token/token_type/expires_at`。过期或 401 后重新走 login-requests，不得静默续期。
4. **`/v1/notices/*`、`/v1/metrics/*`、`/v1/work-orders/*`、iteration-tasks 合同有、API 无。** 本阶段客服主链不依赖；`pilot_recorded` 本轮不放行。
5. **`CLIENT_ACTION_TIMEOUT_MS` 是部署配置，不是请求字段。** 由 main 持有 idle/切后台计时，到点报 `timeout`。
6. **查询长度。** 桌面基线 2000，API 1–500 Unicode code point。接线后 IPC 按 500 拒绝。
7. **`X-Client-Id`。** 公告必填；由 main 生成稳定设备 ID，不从 renderer 传入任意字符串。
8. **占位符。** `placeholder_keys` 仅 `order_id|date`。缺值禁止复制，禁止把渲染结果写日志或事件。

这些缺口用 adapter 行为消化。若实施中发现冻结合同无法表达必需要求，停在 D0 修订，不擅自改合同。

## 3. 任务 B：接入边界方案

### 3.1 谁持有产品会话和网络

| 方案 | 做法 | 收益 | 代价 | 结论 |
| --- | --- | --- | --- | --- |
| A. Main 持有 ProductSession + HttpAdapter | 唯一 Node 网络与 token 所有者；preload 只暴露类型化结果；renderer 无 token、无 DB、无通用 IPC | 与现有 overlay 安全模型一致；CSP 不必为 `/v1` 开口；取消/过期/日志可集中脱敏 | main 变厚，必须按能力拆模块，避免再变成第二个万能 controller | **推荐** |
| B. 独立 utility process 持有网络 | session/HTTP 放到 Electron utility；main 只做窗口与原生副作用 | 崩溃隔离更好 | 多一跳 IPC、合成开发过重、失败面翻倍；一期 Windows 合成接入不值得 | 不采用 |
| C. renderer 直连 HTTP | 放宽 CSP 或自定义协议，token 进 renderer | 看起来少一层 | 违反 AGENTS / DESIGN 信任边界；Dashboard 无 preload 会被误开成通用入口 | **禁止** |

方案 A 相对 B 更简单、信息泄漏更少、调用方只需知道「窄结果 + generation」。C 不是合理安全方案。

### 3.2 四层职责

```text
Query renderer  --typed IPC-->  preload  --whitelist-->  main
                                                     ├─ ProductSession (token, expiry, logout, device id)
                                                     ├─ HttpAdapter   (AbortController, idempotency key, /v1)
                                                     ├─ OverlayController (窗口/剪贴板/handoff，已有)
                                                     └─ 合成身份只作为 loopback 提供方，不进 renderer

Dashboard renderer  无 preload、无 customerAgent、不进 trustedContents()
shared              只放跨边界类型、validator、错误码、generation 谓词；无 I/O
```

| 层 | 负责 | 不负责 |
| --- | --- | --- |
| main | 会话存储与撤销、HTTP、请求取消、租约、剪贴板副作用、打开外部联系方式、设备 ID、日志脱敏 | React、业务话术编造、通用 `ipcMain.on` |
| preload | 把已授权能力适配成 `CustomerAgentApi` 方法；丢弃非法 payload | 持有 token、缓存候选原文以外的密钥、任意 channel |
| shared | IPC 通道名、请求/响应/失败形状、精确 key 校验、generation | DOM / Electron / 网络 |
| renderer (Fox/Query) | 交互、ViewModel、平台/商品确认 UI、候选展示、求助入口状态 | token、DSN、任意 fetch、文件系统 |
| renderer (Dashboard) | 继续读 `DASHBOARD_MANIFEST` | 任何产品 IPC、管理写、真实公告 ACK |

桌面 main 只生成随机幂等键并在同一次操作中保持稳定；后端 HMAC 密钥、摘要计算和数据库幂等账本仍由 API 拥有，绝不向客户端下发。

现有 overlay IPC（拖拽、handoff、layout、clipboard、dashboard:open）保持。产品能力另起 `product:*` 通道，不把检索塞进 `overlay:command`。

### 3.3 会话存储、退出、过期、撤销

推荐：**main 使用 Electron `safeStorage` 加密后写入 `app.getPath('userData')` 的专用文件**，只存 `access_token` 密文、`expires_at`、`user_id`、`role`、`auth_mode`。`device_id`（`X-Client-Id`）不是秘密，单独明文存放且安装期内稳定；不得从 renderer 传入。renderer 只收到 `{ signedIn, role, expiresAt, userId }`，没有 token。`safeStorage` 不可用时 fail-closed，禁止明文写 token。

| 事件 | 行为 |
| --- | --- |
| 登录成功 | 写入加密会话；通知 Query `session-changed` |
| 主动退出 | 立即清除本地会话、取消在途请求并阻断操作；保留仅本次撤销所需的进程内 token，限时尝试 `POST /v1/auth/logout`，无论成功失败均清除；删除文件失败须给出可见错误并保持阻断 |
| 应用退出 | 先尝试 logout + 删文件；失败也删本地密文，避免下一进程沿用 |
| 过期 / `/auth/me` 401 / `SESSION_INVALID` | 清本地；Query 回到未登录；进行中检索标 `STALE`/`UNAUTHORIZED`，不降级成未授权检索 |
| 权限变化 | 以服务端 `role` 为准；agent 不得因本地徽章获得管理写 |

内存-only 也可通过重启后明确要求重新登录满足安全边界；本方案选择加密持久化仅用于异常退出后的会话恢复，正常退出仍清除。启动时须通过 `/v1/auth/me` 重新核验后才能检索，本地 role 不是授权依据。把 token 放 renderer/localStorage 禁止（Dashboard 测试已禁止这些 API）。

合成登录主路径是产品会话：`login-requests` → 受控 loopback 授权窗（独立 sandboxed BrowserWindow，不是 Query/Fox/Dashboard）→ `exchange` 轮询（202 pending / 2s）→ 得到 Bearer。该登录窗只允许导航到配置中精确登记的合成提供方 origin/路径，以及 API origin 下的 `/v1/auth/callback`（两者端口可以不同，均须是 `127.0.0.1`）；每次重定向、子窗打开均校验此白名单；不得打开系统浏览器到任意 URL，也不得放宽现有 Fox/Query/Dashboard 的 `will-navigate` 拒绝。`mock-login` 与 `X-Mock-User` 不得作为 Query 主路径，也不得从 renderer 传 mock header。

### 3.4 取消、旧响应、重复、断线、重试

| 问题 | 所有者与规则 |
| --- | --- |
| 用户改口再查 | Query renderer 是 generation 唯一递增者；输入变更或取消即递增并清旧候选。main 按 sender + sessionEpoch 校验安全整数与单调性，取消低 generation 请求，响应只回显原值；不自行修改 renderer generation |
| IPC 乱序 | main 唯一拥有 sessionEpoch，登录身份变化、退出及过期时使旧 epoch 失效；renderer 只接收它。查询相关请求/结果携带 sessionEpoch + generation，任一与当前状态不符即忽略；main 在原生副作用前再验 epoch 与候选归属 |
| 重复复制 | UI 复制中禁用；main 对同一 `query_id` 串行；服务端 first-wins。第二次可见冲突，不得假装两次都 adopted |
| 断线 | 不静默用本地 fixture 顶上。可见 `UNAVAILABLE`/`OVERLOADED`，保留输入，提供重试 |
| 重试 | 仅对 current/me 等读取按有界策略重试。search 会写事件，不是幂等读；用户明确重试才创建新 query_id。不得因未知结果自动创建新 query_id 或重复复制；logout/adopt/ack 不自动重试 |
| 公告租约到期 | 立即停止使用旧候选与本地快照；重新 `current`，失败则停搜 |
| `collection_disabled` | 展示候选但禁止随后 adoption/escalate；文案说明未记入自动事实 |

新搜索/取消输入只接受高于该 sender 当前值的 generation；复制、事件和查询结果只接受与已保存候选相等的 generation。窗口重建重新建立 sender 会话，不复用旧窗口请求。renderer 收到响应还须与当前输入 generation 比较；main 的数值校验不替代服务端授权。

### 3.5 白名单 IPC：输入、输出、校验、失败形状

D0 定稿下列通道。未列入的能力默认不存在。会话状态返回 main 生成的 sessionEpoch；查询相关输入和输出必须附带该 epoch，表中省略重复列写。会话事件不改变 renderer 的 generation。

| Channel | 方向 | 发送者 | 输入 | 成功输出 | 失败 |
| --- | --- | --- | --- | --- | --- |
| `product:session-status` | invoke | fox/query | 无 | `{ signedIn, role, expiresAt, userId, authMode, sessionEpoch }` 无 token | 标准失败壳 |
| `product:login` | invoke | query | 无 body；PKCE 由 main 生成，不经过 renderer | `{ signedIn: true, role, expiresAt, userId }` | VALIDATION/GONE/CONFLICT/UNAVAILABLE/RATE_LIMITED |
| `product:logout` | invoke | query | 无 body | `{ signedIn: false }` | 仍须清本地；网络失败不保留 token |
| `product:search` | invoke | query | `{ generation, queryText, platform, platformSource='manual', productContextType, productContextRef, parentQueryId }` | 白名单候选 + `queryId/hitStatus/releaseId/telemetryStatus` | 见下表 |
| `product:cancel-search` | invoke | query | `{ generation }` | `{ cancelled: true }` | STALE 若 generation 不匹配 |
| `product:copy-adopt` | invoke | query | `{ generation, queryId, rank, scriptId, scriptVersion, contentHash, placeholderValues? }` | `{ copied: true, eventStatus: recorded|unrecorded|disabled }`；main 只从自身保存的候选渲染正文，不接受 renderer 任意正文。占位符仅允许合同声明的键；先复制再记账，记账失败不抹掉已复制事实 | 缺占位符/剪贴板失败不得 adopted |
| `product:record-terminal` | invoke | query | `{ generation, queryId, outcome: dismissed\|no_hit_exit\|timeout }` | `{ ok: true }` | 已有 terminal 则 CONFLICT，UI 不重报 |
| `product:escalate` | invoke | query | `{ generation, queryId, action: open_feishu\|copy_contact }` | `{ escalateId, action, opened: boolean }`；`opened` 只表示入口动作 |
| `product:announce-refresh` | invoke | query | `{ generation }` | `{ releaseId, releaseSeq, leaseExpiresAt, announcement }` 无 lease token | 无 current / 来源门 / 过期 |
| `product:session-changed` / `product:announce-invalidated` | main→query | n/a | 枚举 + sessionEpoch | renderer 只更新视图 | 非法 payload preload 丢弃 |

公共失败形状（shared validator，精确 key）：

```text
{ ok: true, sessionEpoch: number, ...通道白名单字段 }
{ ok: false, sessionEpoch: number, code: ProductIpcErrorCode, message: string }
查询相关结果额外包含 generation；会话操作不虚构 generation。
```

`ProductIpcErrorCode`：`UNAUTHORIZED | VALIDATION | FORBIDDEN | GONE | CONFLICT | SOURCE_GATE_NOT_READY | OVERLOADED | UNAVAILABLE | RATE_LIMITED | CANCELLED | STALE | CLIPBOARD_FAILED`。`message` 为可展示短句，不含 token、query 原文、answer 原文、SQL、DSN、内部路径。

校验：精确 key、安全整数、UUID、枚举、`platform ∈ {qianniu,douyin}`、商品上下成对或同为 null、queryText 1–500。main 再验 sender / role / 必要时 main-frame。Fox 不得调用 search/copy/login。Dashboard 无这些通道。

### 3.6 日志

| 禁止 | 允许 |
| --- | --- |
| access_token、authorize 中的 code、PKCE verifier | `query_id`、generation、HTTP status、稳定 error code |
| 客户 query 原文、渲染后话术、占位符值 | `script_id`、rank、`release_id`、latency_ms |
| DSN、SQL、source_ref 内部定位符、文件绝对路径 | `SOURCE_GATE_NOT_READY` 等合同原因；SQLSTATE 仅 API 诊断，不进桌面日志 |
| 把 Dashboard 演练日志写成真实 ACK | `collection_mode=synthetic` 过程标记；auth_mode 保留冻结枚举，不编造 synthetic 值 |

现有 `console.error('[dashboard] ...', error)` 不得扩展到打印未知 error 对象。产品 adapter 使用固定字段记录器。

## 4. 任务 D：业务规则（全切片强制）

1. 有平台且问法具体时，结合前文检索；缺少具体商品或问题信息时先澄清，不调用搜索编造命中。
2. 未匹配有效话术，不自行编造业务回答，不显示「AI 正在思考」。
3. 无匹配时客服先让客户稍等，再联系话术师或运营核实；必要时升级客服经理。
4. 过期、暂停、来源无效、租约到期的话术不得继续推荐或复制。
5. 「已复制」只表示剪贴板成功。不得写已发送、已采纳、回答正确、已解决。机器字段 `adopted` 对人读仍译为「已复制」。
6. 打开求助入口或 `escalate` 成功，只表示入口动作已发生。没有话术师/运营/经理的实际承接结果，不得显示转交成功。
7. 本轮不实现自动外发、autofill、外部模型、真实飞书凭据、真实客户数据。

## 5. 任务 C：D0–D5 验收切片

按完整用户行为拆分，不按文件数量拆分。未获本方案批准前不实施 D1–D5。

### D0 范围、设备、会话及 adapter 合同定稿

1. **用户可观察的结果：** 仍是当前合成 Demo。交付物是获批后可执行的合同：设备/系统、会话存储、IPC 表、错误码、合成测试数据规格、Windows 与本机验证分账。
2. **前置依赖：** 本文件被用户批准；冻结合同保持 1.13.0 / v1.17。
3. **模块所有者与文件范围：** 文档 owner 为本文件 + 随后同步的 `docs/reference-desktop-contracts.md`、`docs/reference-api-adapter-handoff.md`。不改运行代码。
4. **接口：** 第 3.5 节 IPC；HTTP 复用现有 OpenAPI。不需要合同变更。
5. **成功 / 失败：** 成功=责任、失败路径、公开字段明确，且不向客户端提供 DB 角色/凭据。失败=仍有「直连 renderer」或 Dashboard 写入口含糊。
6. **测试与实机：** 文档链接/锚点/命令名检查；人工审阅 IPC 表。无实机。
7. **完成标准：** 用户批准本文件；D1 不再需要发明通道名或错误码。
8. **交付与回退：** 只文档。回退=保持 DRAFT，不进入 D1。

### D1 桌面合成登录、退出、会话失效与权限变化

1. **用户可观察：** 未登录不能检索。合成登录成功后 Query 显示角色/过期可见状态（无 token）。退出、重启后过期、服务端撤销、网络错误均有可见结果，且不降级成未授权检索。
2. **前置：** D0 批准；本机可启动 `formal-dev` + 合成身份 loopback + PG15。
3. **所有者：** 新模块 `apps/desktop/src/main/product-session.ts`、`product-http.ts`；独立 sandboxed 登录窗（不是 Query/Dashboard）；preload/shared 合同；Query 登录/阻断 UI。不改 Dashboard preload。不改 API 身份实现。
4. **接口：** `product:login/logout/session-status` + `/v1/auth/*`。不需要冻结合同变更。
5. **成功：** 登录、me、logout、过期、撤销、重复 logout。**失败：** 提供方 5s 超时、callback 缺 code、exchange 202 超时、加密存储不可用则 fail-closed 不写明文。
6. **自动化：** main 单测（存储、过期、脱敏日志、sender 门禁）；IPC 合同单测；Query 组件（未登录阻断、失效横幅）；API 已有身份集成不重写。**人工：** 本机 macOS 合成登录一次；**不**算 Windows 验收。
7. **完成标准：** 上述路径可见且无 token 泄漏测试；Fox/Dashboard 不能登录。
8. **回退：** 未合并前删除本切片即可回到当前 Demo。已合入后，未登录或会话失效必须阻断检索，**禁止**把 API 失败静默降级为 `searchScripts()`。与后端断开的旧 Demo 只作为显式开发 profile，不能当运行时 fallback。

### D2 后端查询、候选展示、平台和具体商品隔离、人工复制

1. **用户可观察：** 确认平台（千牛/抖音）后查询后端候选 Top 3。卡片展示 title/category/原文，不展示 score。平台或 SKU 隔离：问 A 商品不出现 B。无商品语境只命中 storewide。复制仅「已复制」，事件四元组与当前候选一致。缺占位符不能复制。
2. **前置：** D1；后端已有 current 合成发布（D5 全链之前可用测试夹具发布，但不得 seed 绕过 DEFINER）。
3. **所有者：** `product-http` 增加 search/copy-adopt；Query 检索 UI 替换 `searchScripts` 运行路径；`ScriptCard` 映射 `SearchCandidate`。`search-service.ts` 退出运行时。
4. **接口：** `POST /v1/search`、`POST /v1/events/adoption`。`platform_source` 固定 `manual`。不需要冻结合同变更。
5. **成功：** 命中 Top 3、改口取消旧检索、复制 adopted。**失败：** 超 500 字、未知平台、商品字段不成对、`CONTENT_NOT_READY`/`SOURCE_GATE_NOT_READY`、`collection_disabled` 可看不可报 adopted。
6. **自动化：** adapter 映射单测（丢掉 score/domain 中文、有效期半开区间）；IPC 校验；Query 组件隔离、旧 epoch/旧 generation 拒绝、复制成功但事件失败、collection_disabled 仍可人工复制且不报事件；API 搜索集成复用。**人工：** 本机合成查询+复制；Windows 实机不在本切片。
7. **完成标准：** 本地 fixture 不再被 Query 运行时调用；复制失败不写 adopted。
8. **回退：** 显式回退软件版本或停用接入 profile；运行中的后端故障绝不切回 fixture。已上报事件不删。

### D3 公告、固定版本快照、租约、ACK、来源暂停、过期与回退更新

1. **用户可观察：** 登录后 Query 跟随 current 公告/版本。暂停来源、回退、过期后，旧候选不可继续复制；需重新核验。断线恢复后按合同重拉，不混分页版本。ACK 不延长租约，也不表示「已读」。
2. **前置：** D1；与 D2 在接口稳定后可并行开发，但必须在同一集成版本联验。
3. **所有者：** main `product-announce.ts`；Query 只读横幅；不把 Dashboard「公告演练」接到真 ACK。
4. **接口：** announce current/snapshot/ack。不需要冻结合同变更。
5. **成功：** 新 release 出现、租约内可检索、到期停搜、ACK 后租约不变。**失败：** 无 current、来源门、lease 不匹配、304 条件不满足时必须 200 新租约。
6. **自动化：** 租约过期停搜单测；ACK 不续租；分页 cursor 同 release。**人工：** 本机用 API 发布/回退观察 Query，不经 Dashboard 点发布。
7. **完成标准：** 失效后旧 `content_hash` 不能 adopted。
8. **回退：** 停止 announce 轮询即回到「无版本则拒搜」。

### D4 无匹配话术时的人工求助路径

1. **用户可观察：** 无匹配时明确「没找到可用话术」，提示先让客户稍等，再提供联系话术师/运营、必要时升级经理的入口。可复制合成联系方式或打开合成飞书入口。状态为「已打开入口 / 已复制联系方式 / 待核实」，禁止「已转交成功」。
2. **前置：** D2 的无匹配结果模型；求助文案需同步 DESIGN 空态（实施时改，本轮只定稿）。
3. **所有者：** Query 空态模块；main 只做 `copy_contact`（复用 clipboard）与受控打开 loopback/合成联系目标，禁止任意 URL。
4. **接口：** `POST /v1/events/escalate`；terminal `no_hit_exit` 仅在用户明确离开时。不需要冻结合同变更。
5. **成功：** 展示入口、复制联系方式、记录 escalate。**失败：** 打开失败可见；网络失败不伪报转交；无匹配不得生成话术。
6. **自动化：** 空态组件；escalate 与 terminal 互不冒充；禁止成功文案断言。**人工：** 走一遍无匹配+复制联系方式。
7. **完成标准：** 无按钮的「转人工」文案被真实入口取代，且成功文案不含转交完成。
8. **回退：** 去掉入口，保留无匹配文案，不得恢复编造回答。

### D5 桌面、API、worker 的完整合成验收

1. **用户可观察：** 同一合成版本上：导入→worker 校验→审核→发布→桌面登录查询复制→暂停或回退→桌面停止旧候选并看到更新。故障与退出清理可见。
2. **前置：** D1–D4 合入同一候选 SHA，不能用各分支分别绿代替。
3. **所有者：** 组合验收脚本/测试在 `apps/api/tests` 与 `apps/desktop/tests` 分层；不新增跨仓 runner。导入审核发布继续走 API/worker，不经 Dashboard。
4. **接口：** 复用已有 HTTP + 本计划 IPC。不需要冻结合同变更。
5. **成功：** 整链一次合成数据。**失败：** worker 失败、审核拒绝、发布来源门、桌面停搜、退出后无残留 token。
6. **自动化：** API 已有导入/审核/发布/公告集成 + 桌面 IPC/组件 + 一层受控 loopback 串联（仍是合成）。**人工：** 本机合成整链；**Windows 实机、安装包、部署另批。**
7. **完成标准：** 单一 SHA 上自动化分层通过，人工记录本机观察；明确未测 Windows/真实飞书/真实数据。
8. **回退：** 回退该 SHA；不回写旧 migration；不关闭 BACKEND-CI-503。

## 6. 任务 E：平台与并行

正式一期客户端目标是 **Windows**。本机 macOS 合成验证只证明工程行为，不能替代 Windows 实机、安装、签名或合成器证据。Windows hosted-runner smoke 仍只是可行性，不是本阶段验收。

### 6.1 可并行 vs 必须串行

```text
D0 批准
  └─ D1 会话（串行，产品 IPC 骨架唯一写入）
        ├─ D2 查询复制    ─┐
        ├─ D3 公告失效    ─┴─ 接口已冻、文件所有者不重叠时可并行
        └─ D4 求助（串行依赖 D2 空态模型）
              └─ D5 同一 SHA 整链（串行，在 D1–D4 之后）
```

D0 期间可并行：验收用例草稿、合成数据规格、内容管理界面**草案**（仍不实施、不给 Dashboard preload）。

D2 与 D3 若都改 `QueryApp.tsx` 则改为串行，或 D1 先把检索结果区/公告横幅抽成独立模块。默认串行；只有模块本身需要独立边界时才抽取，不为并行而预先重构。

### 6.2 唯一写入者

| 产物 | 唯一写入者 |
| --- | --- |
| 冻结合同 / `contracts/upstream` / 0001–0014 | 无人（本阶段禁止） |
| `apps/desktop/src/shared/ipc-channels.ts` 与产品失败形状 | D1 一次加入；其后切片只追加已在 D0 登记的通道 |
| `product-session.ts` | D1 |
| `product-http.ts` | D1 骨架；D2/D3/D4 按方法分段，同一文件同时只一个写入者 |
| Query 检索运行路径 | D2 |
| Query 公告横幅 | D3 |
| Query 空态求助 | D4 |
| Dashboard | 本阶段不写产品接线 |
| `pnpm-lock.yaml` / CI / 根组合脚本 | 需要时单一切片；默认不新增依赖 |
| 整链验收入口 | D5 |

合并后的整体测试必须在集成 SHA 上重跑。D2 分支绿 + D3 分支绿 ≠ D5。

## 7. BACKEND-CI-503

跟踪入口仍是[后端计划](2026-09-08-backend-runtime-plan.md#2026-09-09-交付核验与可靠性跟踪)。

- 公告请求及拒绝审计的诊断缺口已由产品 PR #59 修复。
- 原偶发 503（PR #58 CI `34336646663` attempt 1，无效离线租约预期 403、实际 503/OVERLOADED）根因未确认。
- 本地、PR、合并后 CI 通过不代表原故障已修复。
- 本阶段不猜测性修复，不靠放宽超时或断言关闭。
- 桌面接入若再次观察到 503，记录：SHA、run/job、请求码、安全诊断字段（无凭据/SQL/原文）、是否与租约/审计连接失败同类。无新证据则保持 OPEN。

## 8. 明确不在范围

- 修改冻结合同、旧 migration、上游快照
- 真实飞书凭据、真实客户数据、旧真实评测包重跑
- Windows 实机接入、安装发布、部署、备份恢复、灰度
- 自动发送、autofill、外部模型、付费、许可证变更
- Dashboard 管理写、工单分析、指标工作台、四项桌面 P3 补测、Dependabot
- 删除资料、强推、夹带无关改动
- 把本机合成验证写成 Windows 或生产验收

## 9. 已有能力（复用，不重做）

- overlay 安全窗、preload 白名单、sender/main-frame 门禁
- 复制语义「已复制」、generation 取消本地检索的交互节奏
- API 产品会话、SearchBackend、Events、announce、导入审核发布
- 合同 runtime validator、脱敏错误壳
- PG15 集成与五项 CI

不要在 renderer 重写检索算法，不要把 fixture INSERT 进正式表。

## 10. 评审

### 10.1 工程方案评审（批准前历史记录）

按[工程工作流程](../reference-engineering-workflow.md) 阶段 1/4：中等以上跨边界设计，比较方案后定稿。方案准备时不做 D1–D5 实施，因此当时未走 `/ship`；当前批准后的交付与实施按第 11 节执行。

Step 0：最小变化是 main adapter + 窄 IPC，不新建桌面框架、不放宽 Dashboard、不改冻结合同。8+ 文件是实施阶段的纵向切片，不是本轮文档膨胀。

折叠进方案的评审意见：

| ID | 问题 | 处理 |
| --- | --- | --- |
| R1 | renderer 直连或 API 失败时回退 fixture 会破坏 CSP 与「未授权不得检索」 | 禁止方案 C；禁止运行时 fallback 到 `searchScripts()` |
| R2 | QueryApp 同时承接 D2/D3/D4 会无法并行 | 默认串行；不为并行预先拆分内聚状态机 |
| R3 | 澄清字段不在 HTTP | 搜索前客户端澄清；不改合同 |
| R4 | Dashboard 演练易被当成真 ACK | D3 明确不接线 |
| R5 | 复制与 adopted 时序 | 先 clipboard 成功再事件 |
| R6 | 日志易泄漏原文 | 第 3.6 节强制字段表 |
| R7 | 各分支绿代替整链 | D5 唯一集成 SHA |
| R8 | 治理执行中心仍写「准备后端身份计划」会覆盖已合并后端 | 更新 02 当前下一动作并同步生成视图；历史 T6 记录不改写 |

复审补充（本轮修订）：HMAC 留在后端；renderer generation 与 main sessionEpoch 分别唯一所有者；产品事件不混用 overlay channel；search 不作幂等读；复制成功与事件失败分别显示；禁止 D2 fixture fallback；纠正合并后 CI run 和 auth_mode 表述。会话存储读取须重验身份，退出立即失效，不能等待网络完成后才阻断。

测试意图：每个切片覆盖成功、校验失败、未登录、过期、取消/STALE、断线；D2 另覆盖平台/SKU 隔离与占位符；D3 覆盖租约到期；D4 覆盖「未转交」文案；D5 覆盖发布后桌面可见、回退后旧候选不可用。

### 10.2 OCR

本轮产品仓 `ocr delegate preview --format json`（CLI v1.11.6，workspace 模式）：`total_files=6`，`reviewable_count=0`，6 个 `.md` 全部 `unsupported_ext`。**产品仓 OCR 不适用**，不是通过。不得把「0 个可审代码文件」写成方案审查通过。计划正文由人工审查（R1–R8 与全文一致性）。

治理仓最终 preview：`total_files=15`，`reviewable_count=10`（生成 HTML/JSON 与状态断言测试），`excluded_count=5`（Markdown）。10 个可审文件已按规则审完：仅为下一动作字符串、台账版本断言与源哈希同步，未发现阻断问题。实施阶段出现桌面代码 diff 后再跑 OCR，并在修复后复审。

### 10.3 文档验证

产品仓运行文档差异、链接、锚点与引用检查（`pnpm docs:check`），不安装依赖、不启动桌面应用。治理仓因生成视图与状态断言发生变化，追加完整 `npm --prefix sites run test:release`；初次发现旧台账版本和旧下一动作断言，已同步并重跑。最终结果与内容哈希保存在仓外复审记录。

## 11. 批准与执行

2026-09-09 用户明确确认本方案 APPROVED，授权 D1–D5 纯合成开发；每切片测试 → OCR 审查 → 修复复审 → commit → push → PR → 合并。真实数据、真实飞书凭据、Windows 实机接入和部署排除。治理批准摘要：`DEC-DESKTOP-SYNTHETIC-20260909` / `EVD-DESKTOP-SYNTHETIC-AUTH-20260909`。

D0：方案修订及批准记录交付中。D1–D5 按依赖串行推进；真实人工观察尚未完成时保留未确认，不以自动化代替。BACKEND-CI-503 保持 OPEN。

以下评审表为批准前准备过程的历史记录，不覆盖本节授权。

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | skipped | 用户已冻结范围：先后端、再桌面方案；不扩大真实运行 |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | deferred | 本轮无代码 diff；实施切片再跑 |
| Eng Review | `/plan-eng-review` | Architecture & tests | 1 | folded into plan | 7 项已写入正文 R1–R7，非交互阻塞 |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | later | D4 空态文案在实施时改 DESIGN |
| DX Review | `/plan-devex-review` | Developer experience | 0 | skipped | 无新开发者平台 |
| OCR delegate | 用户指定 | 文件过滤 + 规则 | 2 | product N/A; gov 10/10 reviewed | 产品仓 0 reviewable（`.md` 排除）不得视为通过；治理仓 10 个生成物/测试无阻断 |

- **VERDICT:** 方案可提交用户批准；eng 意见已折入 DRAFT。实施未授权。OCR 不作为本轮 Markdown 方案的通过证明。
- **UNRESOLVED DECISIONS:**
  - 用户尚未批准本 DRAFT
  - 实施切片范围（D1–D5 或仅 D1）未授权
  - 实施阶段 Git 动作未授权
