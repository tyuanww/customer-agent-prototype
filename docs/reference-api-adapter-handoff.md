# 原型基线 → 正式九端口：产品化迁移边界

本页是当前 v3 原型到正式产品的迁移参考，不是 DEV-M0 开工授权。它用于防止把合成类型直接升格为正式合同，同时给本仓后续产品化实施保留明确入口。

对照来源（**只读**，本仓不得修改）：

- 人读合同：`31-产品契约-v1.md` v1.6、`39-API合同与发布状态机-v1.md` v1.16
- 机器合同：`openapi.v1.yaml`、`33-schema-v1-草案.sql`（schema v1.14）
- 架构北极星：`37-架构SSOT-v1.md`

项目记录与正式合同来源仓：`ai-赋能立项/business-docs/01-客服Agent项目`。动态 G0 / Ddev 状态只由该仓 `00–06` 维护，本页不复制计数或充当状态真源。产品仓以 `schema.v1.12@1d62e2c` 生成前九个不可变 PostgreSQL 15 migration，`schema.v1.13@dcd50383b458` 追加 `0010_search_projection_v1_13.sql`；当前又从治理仓合并头 `1af001b8b0ce95aac0c42f42251a38feb85f3e26` 接收 `schema.v1.14`，只追加 `0011_search_no_hit_context_v1_14.sql`，旧十段保持逐字节不变。当前合同集为 `cs-ai-c11-openapi-1.11.0-schema-1.14-1af001b8b0ce`，锁文件仍是 `VERIFIED_NOT_ACTIVATED`、`ddev_authorized=false`、`runtime_activated=false`。DEV-M1 已实现 synthetic-only 的 search + query/impression/adoption/escalate 事务主链与 PG15 证明，并以同一正式检索链执行 50 条纯合成 runner；结果固定为 `NOT_SIGNED`，不计真实 G1a。查询原文不落库，无状态降级也不接受后续事件。桌面仍没有 API adapter，真实飞书鉴权和生产接入仍不存在。禁止实时跨仓读取、手改快照，或把 codegen、migration、mock auth、policy/search/events/runner 测试解释为 runtime 激活。

相关文档：[第一次运行](tutorial-first-run.md) · [如何验证](how-to-verify-desktop.md) · [项目架构](reference-project-architecture.md) · [API 启动配置](reference-api-runtime-config.md) · [桌面合同](reference-desktop-contracts.md) · [README](../README.md)

---

## 0. 结论（先看这个）

| 问题 | 答案 |
| --- | --- |
| 正式机器合同是否已进入产品仓？ | **已接收 schema v1.14、按双哈希验证，并生成类型/组件校验器与十一段 migration，但未激活。** 当前输入见 `contracts/upstream/customer-agent/contract-set.lock.json`；旧 v1.12/v1.13 十段 migration 不变，v1.14 只追加 `0011`。本机 PG15 测试不是业务 runtime 或生产证据。 |
| Demo 现在有没有 API adapter？ | **没有。** Query 同步调用本地 `searchScripts()`；Dashboard 只读编译期 `DASHBOARD_MANIFEST`。并行 `apps/api` 已实现 `/health`、`/ready`、mock auth / policy 与 synthetic-only Search + Events，能够在批准的测试链路读取合成内容；桌面不连接它，正式真实内容运行接入未放行。 |
| 能否把 fixture / manifest **直接 INSERT** 进正式表？ | **不能。** 缺必填治理字段，枚举/日期/版本/租户形状非法，且正式写路径禁止绕过 DEFINER 函数。 |
| 能否在 renderer 里“换一个 search URL”就接到后端？ | **不能。** 生产 CSP 为 `connect-src 'self'`；Dashboard **无 preload**；正式检索只能走 `POST /v1/search` → `search_recommendable_scripts`，禁止客户端直扫 `scripts`。 |
| 视觉主链能否在正式客户端复用？ | **交互节奏可以参考**（狐狸头 → Top 3 → 人工点选 → 剪贴板）。**类型、鉴权、事件、发布、租约必须重做**，不能把本仓 `ScriptFixture` / `LedgerRow` 当 OpenAPI 类型。 |
| 本仓下一步该不该实现 adapter？ | **尚未进入该阶段。** DEV-M1 与 G1A-E0 T1～T3 已合并；T4 历史准备已留证，但 Attempt06/07 未产生有效报告。四域业务版本已批准、负责人承接已确认，先完成现行机器合同转换与版本化新包，再按运行授权重验、评测和签收；具体进度见 [G1a 计划](plans/2026-09-04-g1a-search-admission.md)。DEV-M2、真实飞书 auth 与 Windows Main adapter 仍需后续独立授权，不能把 runtime/admin pool 或 mock 会话直接暴露给 renderer。桌面继续使用合成 profile。 |

---

## 1. 当前 Demo 数据面（无 adapter）

```text
Fox / Query renderer
  └─ searchScripts(query, SYNTHETIC_SCRIPTS, new Date())
       ├─ 本地 n-gram + fixture 锚点 / 意图
       ├─ YYYY-MM-DD 闭区间有效期（本地时区日界）
       └─ 返回 RankedScript（含 score，UI 不展示）

复制
  └─ preload copyText(answerText) → Main clipboard
       └─ 成功文案「已复制」后约 900ms 收起
       └─ 不写 query_id / impression / adoption

Dashboard renderer（无 customerAgent）
  └─ 深冻结 DASHBOARD_MANIFEST
       └─ 不读 Float 输入，不写盘，不调 /v1/*
```

正式一期拓扑是另一条链：

```text
Windows Electron 壳
  → HTTPS JSON /v1  （生产 Bearer 飞书会话；开发使用 mock-login Bearer 或成对 mock headers）
  → Node Application API
  → PostgreSQL SoR（唯一真相）
  → announce 短租约 + 只读 snapshot
```

正式 37 写明：多租户、聊天正文、写回、自动发送属于 **C 类破坏性变更**，不得从 Demo 形状“长”出来。

---

## 2. 按表面：哪些能对上端口，哪些对不上

| Demo 表面 | 看起来像 | 正式端口 | 现在实际 | 接到正式系统前必须补的 adapter 职责 |
| --- | --- | --- | --- | --- |
| 狐狸头 / 快捷键 | 一线唤起 | 无独立端口 | 纯桌面壳 | 保持；正式一期客户端边界是 **Windows**，macOS 后续 |
| Query 输入 | `POST /v1/search` | search | 本地 fixture | 生成 UUID `query_id`；确认 `platform`；成对 `product_context_*`；`collection_mode`；幂等 HMAC；处理 503 `CONTENT_NOT_READY` |
| Top 3 卡片 | search `candidates[]` | search | `RankedScript` | 映射 `release_id/script_id/script_version/content_hash`；**丢掉 score**；展示 title/category 而非中文 `domain` + 自由文本 `platform` |
| 「复制话术」 | `POST /v1/events/adoption` | events | 只写剪贴板 | 先确认 clipboard 成功，再带 `Idempotency-Key` 上报 `outcome=adopted` + `push_method=clipboard`；占位符缺值禁止复制 |
| 空态 | escalate | events | 文案“转人工话术师”，**无按钮、无事件** | `open_feishu` / `copy_contact` 是辅助动作，不是 terminal |
| 收起 / 切后台 | `dismissed` / `timeout` | events | 无上报 | 明确放弃才 `dismissed`；idle 达 `CLIENT_ACTION_TIMEOUT_MS` 才 `timeout` |
| Dashboard 九模块 | metrics / workorders / content / announce | 对应端口 | 静态合成 | 只读 GET；coach/owner RBAC；agent 无管理权；Publish 仍仅 owner |
| 架构图九端口 | 目标拓扑 | 九端口 | API 已实现 development/test 的 auth/policy/search/events 子集；桌面和真实运行均未接入 | 状态标签不是生产可用性声明 |

正式检索 **唯一 SQL 边界** 是 `search_recommendable_scripts(...)`。Adapter 若在客户端自拼 WHERE、直扫 `scripts`、或把 Demo fixture 当 SoR，即违反 INV-EFF / INV-ACL。

---

## 3. 不能“直接插入”的字段

下面“不能直插”指：把 Demo 对象原样写入正式表 / 当作 OpenAPI body，会被 CHECK / FK / mapper / 审核门拒绝，或写出语义谎言。

### 3.1 话术资产：`ScriptFixture` ↛ `scripts` / `release_items`

| Demo 字段 | 正式字段 | 为何不能直插 |
| --- | --- | --- |
| `scriptId`（如 `syn-prod-001`） | `script_id` | 形状可当演示 ID，但不是已发布 snapshot 键。正式主键是 `(release_id, script_id)`，还必须带 `script_version` + `content_hash`。 |
| （无） | `script_version` INTEGER ≥ 1 | Demo 无整数版本。Dashboard 的 `version: "q-14"` / `"demo-v3.1"` **不是** `script_version`。 |
| （无） | `content_hash` `^[0-9a-f]{64}$` | Dashboard `sha256:7c1a…b29e` 带前缀、省略号、非 64 hex，**会直接 CHECK 失败**。正式 hash 是治理快照 JCS，不是只对 `answer_text` 裸 SHA。 |
| （无） | `release_id` + `source_binding_hash` | 检索/复制事件必须绑当前 release。无 current release → 503 `CONTENT_NOT_READY`，禁止扫 `scripts` 伪造可用。 |
| `domain`: `产品/活动/售前/售后` | `category`: `product/campaign/presale/aftersale` | **人读中文 ≠ wire 枚举**。Dashboard 话术库已用英文域，Float fixture 仍用中文，本仓内部也不统一。 |
| `questionVariants: string[]` | `script_questions` + snapshot `questions[]` | 正式 Question 必须有上游稳定随机 `question_id`、`question_version`、脱敏后重算的 `question_hash`、HMAC `origin_fingerprint` + key version、`semantic_family_id`、`source`/`source_asset_id`。**禁止按数组下标或行序生成 ID。** 变体字符串不能当 Question 行插入。 |
| `search.intents` / `anchors` | 无对应列 | 这是 Demo 本地召回词典。写入 `intent_id` 或 `questions_json` 会污染正式 taxonomy。正式 `intent_taxonomy_version` + `intent_id` 必须已登记。 |
| `answerText` 全文 | `answer_text` 模板原字节 | 正文本身可作合成 seed 的候选，但：① 必须先走 import/publish，禁止 `INSERT INTO scripts`；② 正式只允许占位符 `{订单号}`/`{日期}` ↔ `order_id`/`date`；③ API 返回模板，客户端内存渲染，**渲染结果零落库**。 |
| `platform`: `私域企微` / `天猫咨询` / `售前咨询` / `商城结算页` / `会员中心` / `售后工单` / `抖音私信` | `platform_scope TEXT[]` 仅 `qianniu`/`douyin` | **非法平台值。** `NULL/[]` 也不能表示“全平台”。`天猫`/`企微` 不是一期 wire 值。 |
| `scopeLabel` 自由文本 | `product_scope_type` + `product_scope_refs` | `日常清洁 · 合成演示` 不能映射为 `storewide|category|sku`。`storewide` 的 refs 必须 `[]`；`category/sku` 必须非空。 |
| `riskLevel` | `risk_level` + `risk_categories` + `has_conflict` + 双审 | Demo 只有三档标签。正式 `high` 必须非空且只含七类受控枚举；`low/medium` 必须 `[]`。审核主体/EVD **不得**从文件或 fixture 自报。 |
| `effectiveFrom`/`effectiveTo` `YYYY-MM-DD` | `effective_from` TIMESTAMPTZ 必填；`effective_to` 可空 | 见 §5。日期字符串插入 timestamptz 会带隐式时区；Demo 还把缺省上界写成 `2099-12-31`，正式空上界是 `NULL`（+∞）。 |
| （无） | `owner_role` / `review_due_at` | upsert 必填。`review_due_at` 不是失效时间。 |
| （无） | `source_ref` / `source_version_id` | **文件行与 fixture 禁止自报。** 由服务端受信 import 上下文绑定。表头出现这些列整批失败。 |
| （无） | `search_document` / `search_fallback_text` | import worker 生成；缺任一字段不得发布。 |
| （无） | 四域 `release_source_bindings` | 每个 release 必须恰好绑定 presale/campaign/aftersale/product 各一个 `use_class=canonical` 版本。售前/售后正式源在 Demo 里已标 `NOT_CREATED`，**不能**用合成 `structure-pre-demo` 冒充 `srcv_*`。 |

`app_runtime` 对 `scripts` / `release_items` / `content_current` **无直接写、无直接 SELECT**。合法路径只有 import worker finalizer → `publish_content_release` / `rollback_content_release`。

### 3.2 检索请求：Query 输入 ↛ `POST /v1/search`

| Demo | 正式请求 | 缺口 |
| --- | --- | --- |
| 无 `query_id` | UUID，兼幂等键 | 不生成则无法写事件、无法 adoption |
| 无 `parent_query_id` / `interaction_reason` | `original` 必须 parent=null；重搜是新 query | Demo 改口再查会覆盖本地结果，不建 lineage |
| `query` 最长 **2000** 字 | `query_text` **1–500** Unicode code point；整包 32 KiB | 超 500 在正式侧是 400，本 Demo 仍会本地检索 |
| 无 `collection_mode` | `synthetic` / `approved_redacted` / `pilot_recorded` | `pilot_recorded` 还要先接受 privacy notice |
| 无平台确认 | `platform` + `platform_source` + 可选 `detected_platform` | 未知平台不得靠空 scope 放宽；禁止读窗口标题/剪贴板历史 |
| 无商品上下文 | `product_context_type/ref` 成对或同为 null | 空上下文只命中 `storewide` |
| 无 `Idempotency-Key` / HMAC | search 用 HMAC-SHA256(JCS(body)) | 客户端不得对原文做无密钥 SHA，也不得落原始 body |
| 本地打分阈值 | 服务端 bigram + `search_recommendable_scripts` | Demo 的 `score` / `matchKind` / `matchLabel` **不是** wire 字段；卡片禁止展示分数（这一点 Demo 已遵守） |

### 3.3 自动事实：复制 / 流水 ↛ `query_events` / `candidate_impressions` / `adoption_events`

| Demo | 正式 | 缺口 |
| --- | --- | --- |
| 不写事件 | `query_events` 必有 `user_id`（只来自 token）、脱敏正文或 `suppressed`、HMAC、`release_id`、过期时间 | 原始问法、渲染后正文、占位符值都 **零落库零日志** |
| 结果卡只有 `scriptId`+rank | impression 四元组 FK：`release_id, script_id, script_version, content_hash` | Dashboard `LedgerTop3Binding.version = "q-14"` 不能当 `script_version` |
| `copyText(answerText)` | `POST /v1/events/adoption`：`outcome=adopted` ⇒ `push_method ∈ {clipboard,autofill}` 且 rank/script 与 impression 一致 | **先成功复制，再记账。** 失败不得写 adopted |
| 收起无事件 | `dismissed` / `no_hit_exit` / `timeout` 三选一 terminal | 每个 query **只能一条** terminal |
| Dashboard `terminal: copied` | wire `outcome: adopted` | 人读可写「已复制」；机器字段必须是 `adopted`。禁止把 copied 解释成已发送 |
| `abandoned` | 不是正式 enum | 看过未选 ≈ `dismissed`（明确放弃）或 `timeout`（idle/切后台）。不可发明第四个 terminal |
| `risk_escalated` 当作终态 | `escalate_actions` 是 **辅助动作**，不终结 query | 升级后仍可再 adopted。Demo 流水把升级写成 terminal，**口径不能进 metrics** |
| `operationId: op-20260813-001` | `query_id` UUID | 不能当 PK 插入 |
| `askedAt: 2026-08-13 10:12:04` | `created_at` TIMESTAMPTZ UTC | 无时区墙钟不能当权威时间 |
| Dashboard 数字写死 | `GET /v1/metrics/tool` 半开窗 ≤7 天 | `collection_disabled` 必须从全部分子分母排除；本 Demo 指标与 Float **零联动** |

### 3.4 Dashboard 其它域

| Demo 对象 | 正式对象 | 不能直插的原因 |
| --- | --- | --- |
| VOC `uniqueOrders` / 产品名 / 问题原文聚合 | `work_order_records` 白名单 + `product_ref_hash` | 原始订单号、客户、工单长编号、任意 raw JSON **禁入表、禁入公开错误、禁入导出** |
| VOC 年/月/日切片 | `/v1/work-orders/analysis` 窗默认/最大 **31 天** | 年切片超过合同窗，不得静默截断后假装同一口径 |
| `IterationTask.taskId` 无 `expected_version` | start/close 必须 CAS | 无版本并发会 409；关闭 ≠ 已 Publish |
| 内容页 `sourceId: structure-pre-demo` | `srcv_*` + `SRC-*` | 形状非法；且售前/售后正式源未创建 |
| 公告演练成功 | `POST /v1/announce/ack` | 演练明确不改 published / announced / ACK / lease。真 ACK 不续租、不表示用户已读 |
| Publish 按钮 disabled | `POST /v1/content/publish` 仅 owner | 保持禁用是正确的；**不要**为了演示改成可点 |

---

## 4. 认证与权限

| 项 | Demo | 正式合同 |
| --- | --- | --- |
| 身份 | 无用户、无 token、无 `/auth/me` | 生产 `Authorization: Bearer <feishu_session>`；开发可使用 `POST /v1/auth/mock-login` 返回的进程内 opaque Bearer，或成对 `X-Mock-User` + `X-Mock-Role`；两种方式冲突或 header 单边出现均拒绝 |
| `AUTH_MODE` | 徽标 `MOCK AUTH` | 生产必须 `feishu`；生产若 mock / 缺验签 / 仍注册 mock-login → **监听前退出** |
| 角色 | 谁都能开 Dashboard | `agent` 浮窗；`coach`/`owner` Dashboard；agent 访问 `/v1/work-orders/*` 或 iteration-tasks → 403 |
| 角色来源 | 无 | **只取验签后 claims**，禁止取请求体 |
| 隐私告知 | 无 | `pilot_recorded` 前必须 `notices/current` accepted；浏览/安装不得推定同意 |
| Dashboard 打开 | Query IPC 或原生菜单，无角色门 | 正式还要服务端 RBAC；本 Demo 的 query-only IPC 只防 Fox 乱开窗，**不是**业务授权 |
| 审核 capability | 无 | `ROLE-CONTENT-LEAD` / `ROLE-CS-MANAGER` 是附加能力，不替换 agent/coach/owner |

没有会话的 adapter 不得调用除 `/health` 以外的业务端口。把 Demo 当“已登录 owner”会在试点门被拒。

---

## 5. 版本、生效期、租户

### 5.1 三种“版本”不要混

| 名字 | Demo 用法 | 正式用法 |
| --- | --- | --- |
| `script_version` | 不存在 | 整数，治理快照任一字段变化即 +1 |
| Question 版本 | 不存在（只有 `questionVariants[]`） | `(question_id, question_version)` 不可变 |
| `release_seq` / `release_id` | Dashboard 合成 `rel-demo-2026-08-a` | 发布事务内单调；rollback **复制为新 seq**，禁止把 current 指针拨回旧行 |
| 客户端 N / N-1 | `apps/desktop/package.json` `0.2.0`，`appId=local.demo.customer-agent` | 首个签名 Pilot 才建立 N；破坏性变更走 `/v2` |
| Dashboard `version: "q-14"` | 流水装饰 | **不能**写入 `script_version` 或 `question_version` |

### 5.2 生效期：闭区间本地日 ≠ 半开 UTC

Demo `validity.ts`：

- 只接受 `YYYY-MM-DD`
- 起算本地 `00:00:00.000`，截止本地 `23:59:59.999`
- `now >= start && now <= end`（**闭区间**）
- `effectiveTo` 必填；缺省用 `2099-12-31` 假装“长期有效”

正式合同：

- `effective_from` **必填** TIMESTAMPTZ（ISO-8601 UTC）
- `effective_to` **可空 = +∞**
- 引擎与客户端本地召回都是半开区间 `[effective_from, effective_to)`
- **`now == effective_to` 必须排除**
- snapshot 返回完整不可变 release，**每次**本地检索都要再滤有效窗
- 离线短租约到期立即停搜，无旧快照宽限

因此：把 Demo 的 `2026-08-31` 当成“当天仍有效”插入正式库后，UTC 当天 16:00（若东八区）起就会被排除；反之，把正式 `NULL` 上界当成非法，Demo 会整条丢弃。**有效期过滤本身必须保留**（G3），但日历形状必须换。

37 有一句“from 缺省 −∞”；33 / 31 / OpenAPI 已把 `effective_from` 收成必填。实现以 **33 + OpenAPI** 为准，不要从 Demo 或过时摘要发明空 from。

### 5.3 租户 / 范围

| 正式位置 | 字段 | Demo |
| --- | --- | --- |
| `authoritative_source_versions` | `tenant_id` 默认 `'default'` | 无 |
| `work_order_import_batches` / records / export audits | `tenant_scope` | VOC 页无租户；`uniqueOrders` 甚至不是可入库字段 |
| 幂等 | `scope = "{METHOD} {path}:{user_id}"` | 无 user |
| 限流 | `user:{user_id}:{route}` | 无 |
| 离线租约 | 绑定 `client_id + user_id + release_id + source_binding_hash` | 无 client_id |
| 37 扩展治理 | **多租户 = C 类破坏性** | 不得在 `/v1` 用 Demo 形状偷偷加租户列 |

一期不是“没有租户”，而是 **单租户默认值 + 工单分析独立 `tenant_scope`**。Adapter 必须显式传服务端已授权范围，禁止从 UI 文本猜租户。

---

## 6. 复制语义（最容易说错的一句）

正式冻结句：

> `adopted` 只表示候选已成功复制/推送到客户端输入载体，不表示已发送、正确或客户已接受。

本 Demo 已做对的部分：

- 主 CTA 文案是「已复制」，`FORBIDDEN_COPY_PHRASES` 含「已发送 / 已采纳 / 已解决」
- Dashboard 多处写明 adopted = 复制成功
- 离线复核把修改 / 发送 / 适用分账，不从复制倒推

本 Demo **还缺**、接到正式 API 时不能省略的部分：

1. **没有 adoption 请求。** 剪贴板成功 ≠ 已记账。正式指标分子来自 `adoption_events`，不是 UI phase `COPIED`。
2. **没有 impression 四元组。** 上报 adopted 时 `chosen_rank/script_id` 必须已存在于该 `query_id` 的候选行。
3. **没有占位符门。** 正式缺 `{订单号}`/`{日期}` 值时禁止复制并二次确认；值与渲染正文不得回传。
4. **没有 terminal 互斥。** 复制成功后自动收起，正式仍应能写 adopted；但若先 timeout 再复制会被拒。
5. **升级不是复制失败，也不是终态。** 空态只提示“转人工”，没有 `escalate`。
6. **autofill 不是主 CTA。** 正式保留兼容值，但必须真实 push 成功；本 Demo 未实现自动填，也不应在 adapter 里用 `pending` 冒充 adopted。

---

## 7. 其它隐性缺口（漏了会在试点门爆炸）

1. **传输与 CSP。** 生产 renderer `connect-src 'self'`。即使未来要连 API，HTTPS 客户端应放在 **main**，经白名单 IPC 暴露，而不是给 Dashboard 开 Node 或给 overlay 开通用 `fetch`。
2. **Dashboard 无 preload。** 正式 coach/owner 工作台若仍走独立窗，需要单独设计受信 API 面；不得把 `customerAgent` 扩成通用 IPC。
3. **内容未就绪。** 无 `content_current` 时 search / announce/current 均为 503 `OVERLOADED` + `CONTENT_NOT_READY`。Demo 的“永远有合成稿”不能当首发行为。
4. **离线租约。** ACK 不续租；到期停本地 FTS。Demo 没有本地 FTS 缓存，但也没有租约状态机。
5. **脱敏 / DLP。** 正式在 redaction 失败时 fail-closed；手机号/身份证最小规则。Demo 把用户输入直接送进本地打分。
6. **限流与幂等。** 30/min/user search、写接口 `Idempotency-Key`、同键异体 409。Demo 无重试合同。
7. **平台适配器。** `native_integration` 未注册时提交必须 403 且零写入。禁止为了“自动识别千牛”去读窗口标题。
8. **工单只读。** 无班牛凭据、无写回适配器。VOC 页的“下钻 / 导出”是合成交互，不是 `/v1/work-orders/analysis/export`。
9. **训练 / 教师。** 一期 OpenAPI 不得出现 training 路由。深度思考入口保持 OFF，不得变成“已接模型”。
10. **正式客户端 OS。** DEC-031：一期 Windows；本 Demo 主验证面是 macOS。桌面壳可以参考，不能声称已满足一期交付边界。

---

## 8. Ddev 之后在本仓实现 adapter 的最小形状

这是本仓后续产品化任务，不是当前 v3 原型映射任务。以下边界防止把 Demo 类型“升格”成合同：

```text
[Query UI]
   │  仍只认识展示用 DTO（无 score）
   ▼
[Main SearchAdapter]          ← 唯一允许出站 HTTPS 的地方
   │  POST /v1/search
   │  map OfficialCandidate → ViewModel
   │  丢弃未知 JSON 字段；缺四元组 fail-closed
   ▼
[Main EventAdapter]
   │  clipboard 成功后再 POST /v1/events/adoption
   │  dismiss / timeout / escalate 分方法
   ▼
[Dashboard 只读 Adapter]      ← 新窗也要独立受信面
   │  GET /v1/metrics/* 、/work-orders/* 、/announce/*
   │  角色 403 原样展示；禁止用合成数字填空
```

**禁止：**

- 把 `SYNTHETIC_SCRIPTS` upsert 进 `scripts`
- 把 `DASHBOARD_MANIFEST.ledger.rows` insert 进 `query_events`
- 在 renderer 存 token / 问法原文 / 占位符值
- 用 Demo 的 `copied` / `abandoned` / `risk_escalated` 当 OpenAPI enum
- 宣称产品仓代码可以替治理仓签发 G0/G1a、桌面已接通 PostgreSQL，或已具备生产数据库

---

## 9. 历史原型收尾记录

以下只记录当时原型收尾改动，不再定义本仓未来产品范围：

- 本文：缺口清单
- `README.md` / `docs/tutorial-first-run.md` / `docs/how-to-verify-desktop.md` / `docs/reference-desktop-contracts.md`：入口链接
- `启动客服Agent.command`：启动时打印“无正式 API adapter”
