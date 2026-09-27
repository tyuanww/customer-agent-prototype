# 内容导入与发布合同

> 本文是**当前实现**的参考。它描述桌面工作台「内容管理」到 API 的导入 / 取消 / 发布链路，字段、状态、限额与失败码均可从源码核对。
>
> 组织审核在**飞书文档**完成，产品不读飞书。库里的审核证据是 worker 自己写的一条声明，不是独立控制——见[组织已审证据的边界](explanation-org-review-evidence.md)。

## 1. 链路概览

```
工作台 内容管理：选 CSV / xlsx
    │  本地解析第一张表，中文表头映射场景 / 标准话术
    ▼
POST /v1/content/import        →  202 ImportAcceptedResponse（validating）
    │  worker 校验：冻结质检计划 + 写组织已审证据 + finalize
    ▼
状态变成 staged（校验失败 → failed）
    │
    ▼
POST /v1/content/publish       →  200 PublishResponse（release_id / release_seq）
    │
    ▼
content_current 切换 → 坐席 announce / hydrate 读到新目录
```

一期发布**仅 owner**。导入可由 owner 或 coach 发起；坐席不能发布。

## 2. 桌面 IPC 通道

工作台用独立 `dashboard.ts` preload，不挂 overlay 的 search / login / copy。

| 通道 | 作用 | 参数要点 |
| --- | --- | --- |
| `dashboard:content-session` | 读当前产品会话（是否 enabled / signedIn / role / displayName） | 无 |
| `dashboard:content-parse` | 解析本地字节，只在本页预览 | `sourceName` + `bytes`；**只读 xlsx 第一张表** |
| `dashboard:content-import` | 提交导入，进入 `validating` | `sourceName` / `csvText` / `sourceBindings` |
| `dashboard:content-publish` | 发布已 staged 的批次 | 另有 `rows` / `title` / `summary` |
| `dashboard:content-cancel-in-flight` | 取消本 actor 全部进行中导入 | 无（内部发哨兵批号，见 §5） |

来源：`apps/desktop/src/shared/ipc-channels.ts`、`apps/desktop/src/shared/dashboard-content.ts`。

## 3. HTTP 接口

这些是**产品侧**端点（不在冻结的上游 OpenAPI 1.14.0 文件里）。全部要求产品会话、`Cache-Control: no-store`。

| 方法 | 路径 | 成功码 | 角色 |
| --- | --- | --- | --- |
| POST | `/v1/content/import` | 202 | owner / coach |
| GET | `/v1/content/import/:import_batch_id` | 200 | 批次 owner |
| POST | `/v1/content/import/:import_batch_id/cancel` | 200 | owner / coach |
| POST | `/v1/content/publish` | 200 | **owner** |
| POST | `/v1/content/rollback` | 200 | owner |

导入与发布都要 `Idempotency-Key` 头（1–128 字符）；缺头即 400。

### 请求 / 响应体

```ts
// PublishRequest
{ import_batch_id: string; title: string; summary: string | null }

// PublishResponse
{ release_id: string; release_seq: number; announcement_id: string; source_binding_hash: string }

// CancelImportRequest
{ reason: string | null }        // 桌面固定送 'in-flight-self'
```

`publish` 由 `content-release-service.ts` 在进库前再挡一次：`actor.role !== 'owner'` 直接 `FORBIDDEN`。

### 每进程速率窗（60 秒）

| 操作 | 上限 |
| --- | --- |
| publish | 5 |
| rollback | 5 |
| cancel | 40 |
| status | 120 |

窗口是**每进程**计数，不是每 actor。多实例部署时每个进程各算一份。

## 4. 限额与输入约束

| 项 | 值 | 来源 |
| --- | --- | --- |
| 上传上限 | 10 MiB | `CONTENT_UPLOAD_MAX_BYTES` |
| 行数上限 | 5 000 | `CONTENT_IMPORT_MAX_ROWS` |
| 导入超时 | 30 000 ms | `CONTENT_IMPORT_TIMEOUT_MS` |
| xlsx 读取范围 | 仅第一张表 | `parseXlsxFirstSheet` |
| 来源绑定数 | ≤ 4（每域一条，不可重复域） | `isDashboardContentImportRequest` |
| `sourceName` | 1–255 字符 | 同上 |
| `scene` / `script` | 各 1–2000 字符 | `isDashboardContentRow` |
| `title` | 1–200 字符 | `isDashboardContentPublishRequest` |
| `summary` | `null` 或 ≤ 500 字符 | 同上 |
| 批号格式 | `/^imp_[A-Za-z0-9_-]{16,128}$/` | `CONTENT_IMPORT_BATCH_ID_PATTERN` |
| 来源版本号 | `/^srcv_[A-Za-z0-9][A-Za-z0-9._-]{0,126}$/` | `CONTENT_SOURCE_VERSION_ID` |

域只有四个：`presale` / `campaign` / `aftersale` / `product`。角色只有三个：`agent` / `coach` / `owner`。

## 5. 一次只有一个进行中的导入

同一 actor 在 `validating` 或 `staged` 期间不能再入队第二份。服务端由 SQL 拒绝，界面给中文原因。

- 入口闸：`public.assert_no_in_flight_content_import(actor)`，在 `enqueue` 路径调用。
- 它先取事务级咨询锁 `pg_advisory_xact_lock(724019, 19)`，再查有没有在途批次。

### 取消未完成导入（哨兵批号）

界面上的「取消未完成导入」不点具体批次，桌面改为发送一个哨兵批号：

```ts
ACTOR_IN_FLIGHT_IMPORT_ID = 'imp_actor_in_flight_01'
```

API 侧分支：批号等于哨兵时，走 `public.cancel_actor_in_flight_imports(actor, role)` **扫掉本 actor 全部** `validating` / `staged` 批次，逐条按 reason `in-flight-self` 取消。

两条必须同时成立，否则「取消全部」会静默失效：

1. **哨兵值在两端一致。** 桌面与 API 各存一份，改名任一侧都让「取消全部」变成对一个不存在批号的 404。`apps/desktop/tests/unit/contracts.test.ts` 钉住声明值与 API 的比较点。
2. **扫描与入队共用同一把锁。** 哨兵分支同样取 `pg_advisory_xact_lock(724019, 19)`。少了它，一次并发入队能在「扫完」到「提交」之间落下新批次，于是界面报「没有未完成导入」，而队列其实已被新批次占住。

### 扫空返回 404，不返回成功

哨兵批号不代表任何单一批次，所以「扫到 0 条」是**资源不存在**，不是取消成功。

API 返回 `NOT_FOUND`（HTTP 404），桌面把 404 映射成 `GONE`，文案取 `CONTENT_IMPORT_FAILURE_COPY.NO_IN_FLIGHT`：

> 当前没有未完成的导入。登录还在，不必重新登录。

若这里报成功，操作员会以为队列已清空，而实际上还有一份 staged 批次堵着下一次导入。计数一律收敛后判定：空行、`NaN`、非数字形状都不得读成「取消了什么」。

## 6. 失败码与屏幕文案

工作台显示中文「问题 + 原因 + 下一步」，合同码只进日志。

| reason / code | 屏幕 |
| --- | --- |
| `SOURCE_SNAPSHOT_MISMATCH` | 文件和当前登记的来源对不上。请确认这是要发的那份表后重新导入。 |
| `CONTENT_CONTRACT_INVALID` | 表格式或花括号不合法。请按模板改表后重新导入。 |
| `SOURCE_BASE_RELEASE_STALE` / `IMPORT_IN_FLIGHT` | 上一份还在处理。请等它发布或点取消后再导下一份。 |
| `QUALITY_GATE_NOT_PASSED` | 质检证明没写上，不能发布。请联系管理员，不要重复点发布。 |
| `NO_IN_FLIGHT`（桌面本地码） | 当前没有未完成的导入。登录还在，不必重新登录。 |
| 非 owner 发 `FORBIDDEN` | 一期发布仅管理员。话术师可导入产品或活动草稿，发布需管理员操作。 |
| 坐席 | 坐席不能发布内容。 |
| 无会话 | 请先登录后再发布。 |

映射在 `apps/desktop/src/main/dashboard-content.ts` 的 `asFailure`，文案表在 `apps/desktop/src/shared/dashboard-content.ts`。

## 7. 发布前后的桌面闸门

`contentPublishGate` 按序判：无产品会话 → `UNAVAILABLE`；未登录 → `UNAUTHORIZED`；坐席 → `FORBIDDEN`；无行 → `请先导入并通过校验后再发布`；owner 无来源绑定 → `缺少来源绑定，无法导入`；coach → 403 文案。

`rowRequiresOwner` / `rowCoachPublishable` 决定内容级限制：`aftersale` 域或场景/话术含「过敏」「赔付」的行需 owner；coach 只能发 `product` / `campaign`。

## 8. 相关

- [组织已审证据的边界](explanation-org-review-evidence.md) — 库里那条审核声明到底是什么
- [How to：办公机产品主链](how-to-office-machine-product-remote.md) — 在办公机上勾选取消与发布
- [Tutorial：管理员导入 MENOKIN FAQ 并发布](tutorial-menokin-content-publish.md) — 端到端走一遍
- [打包与签名](reference-packaging-and-signing.md) — 包怎么出、签不签
