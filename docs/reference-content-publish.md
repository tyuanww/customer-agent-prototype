# 内容导入与发布合同

> 本文是**当前实现**的参考。它描述桌面工作台「内容管理」到 API 的导入 / 取消 / 发布链路，字段、状态、限额与失败码均可从源码核对。
>
> 组织审核在**飞书文档**完成，产品不读飞书。库里的审核证据是 worker 自己写的一条声明，不是独立控制——见[组织已审证据的边界](explanation-org-review-evidence.md)。操作步骤见 [How to 用一张表替换四库之一](how-to-replace-one-library.md)。

## 1. 链路概览

工作台「内容管理」的顶栏是**产品会话徽章 + 一对动作**：徽章只说会话接没接上（`未接入` / `正在确认会话` / `已接入`），右侧同一行是「取消未完成导入」（左）和「发布」（右），原因与发布反馈写在动作行下方。发布成功后主句 `已发布 rel_N · 姓名`；服务端回显了 `summary` 才画第二行四库 delta，失败不画 delta。回执下有「去系统同步」「去话术库」。成功后「发布」保持禁用，直到清除预览或重选文件。发布进行中「取消未完成导入」仍可用。标题下方常驻「将替换」下拉，发布前必须手选四库之一。表里识别到的域和将替换不一致时，点发布先确认。「内容导入」默认折起，**先展开再选文件**；读文件进入 reading / ready / error 后会保持展开。

```
工作台 内容管理：手选将替换 → 展开内容导入，选 CSV / xlsx
    │  本地解析第一张表，中文表头映射场景 / 标准话术；只进本页预览，不打 import
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

一期发布**仅 owner**。导入可由 owner 或 coach 发起；坐席不能发布。选文件只在本页预览，不触发 import——import 由发布动作带起。

## 2. 桌面 IPC 通道

工作台用独立 `dashboard.ts` preload，不挂 overlay 的 search / login / copy。

| 通道 | 作用 | 参数要点 |
| --- | --- | --- |
| `dashboard:content-session` | 读当前产品会话（是否 enabled / signedIn / role / displayName） | 无；preload 另有 `onSessionChanged` 听 `product:session-changed` |
| `dashboard:content-parse` | 解析本地字节，只在本页预览 | `sourceName` + `bytes`；**只读 xlsx 第一张表** |
| `dashboard:content-publish` | 一次动作：内部 POST import → 等到 staged → POST publish | `sourceName` / `csvText` / `rows` / `title` / `summary` / `sourceBindings` |
| `dashboard:content-cancel-in-flight` | 取消本 actor 全部进行中导入 | 无（内部发哨兵批号，见 §5） |

来源：`apps/desktop/src/shared/ipc-channels.ts`、`apps/desktop/src/shared/dashboard-content.ts`。

## 3. HTTP 接口

端点属于冻结合同集 `cs-ai-c11-openapi-1.14.0-schema-1.18-260ef224c534`。全部要求产品会话、`Cache-Control: no-store`。

| 方法 | 路径 | 合同角色 | 成功码 | 合同声明的错误码 |
| --- | --- | --- | --- | --- |
| POST | `/v1/content/import` | coach, owner | 202 | 400, 401, 403, 409, 429, 500, 503 |
| GET | `/v1/content/import/:import_batch_id` | coach, owner | 200 | 401, 403, 404, 429, 500, 503 |
| POST | `/v1/content/import/:import_batch_id/cancel` | coach, owner | 200 | 400, 401, 403, **404**, 409, 429, 500, 503 |
| POST | `/v1/content/publish` | **owner** | 200 | 400, 401, 403, 404, 409, 429, 500, 503 |
| POST | `/v1/content/rollback` | **owner** | 200 | 400, 401, 403, 404, 409, 429, 500, 503 |

取消路径**没有 410**：合同只声明 404。§5 的空扫就是靠这个 404 表达的。

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

`publish` 由 `content-release-service.ts` 在进库前再挡一次：`actor.role !== 'owner'` 直接 `FORBIDDEN`。合同角色与实现一致，都是 owner-only。

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
| `SOURCE_BASE_RELEASE_STALE` / `IMPORT_IN_FLIGHT` | 你自己的上一份草稿还在队列里（还没发布）。请等它发布，或点「取消未完成导入」后再导下一份。 |
| `QUESTION_IDENTITY_CONFLICT` | 表里有内容和线上已有版本冲突（同一问法被改成了不同话术）。请挑出这些行：要么改用线上版本的说法，要么把改动并进原条目后重新导入。 |
| `QUALITY_GATE_NOT_PASSED` | 质检证明没写上，不能发布。请联系管理员，不要重复点发布。 |
| `NO_IN_FLIGHT`（桌面本地码） | 当前没有未完成的导入。登录还在，不必重新登录。 |
| 非 owner 发 `FORBIDDEN` | 一期发布仅管理员。话术师可导入产品或活动草稿，发布需管理员操作。 |
| 坐席 | 坐席不能发布内容。 |
| 无会话 | 当前没有产品会话，无法发布。 |
| 本地文件读不出来 | 无法读取该文件。请确认文件未打开且仍是 CSV/xlsx 后重试。 |

映射在 `apps/desktop/src/main/dashboard-content.ts` 的 `asFailure`，文案表在 `apps/desktop/src/shared/dashboard-content.ts`。

**只有哨兵闸门才算「在途」。** `assert_no_in_flight_content_import` 抛 `DETAIL='CONFLICT'`，桌面把 `reason === 'CONFLICT'` 的 CONFLICT 显示成「你的上一份草稿还在队列里」。没有 reason 的 CONFLICT 走通用文案，不再冒充在途导入——否则操作员会去点「取消未完成导入」而这个动作永远清不掉一个内容冲突。

**内容身份是永久的。** 桌面导入时按 `域 + 场景 + 正文` 规范化后取 16 位十六进制摘要生成 `script_id`（`upl<16hex>`），worker 再派生 `question_id = 'q_' + script_id`、版本恒为 1。同一份内容永远同一身份，所以重复导入同一张表是幂等的、不会撞车；而把同一个 `script_id` 的正文改成另一段话，会被 `0012` 的守卫挡下并报 `QUESTION_IDENTITY_CONFLICT`——这类必须改表，重试或取消都没用。（`content-frozen-import.ts` 曾按行号生成 `upl00001`，任何第二张表都与第一张表第 1 行同名同版本，那正是这个错误的原因。）

## 7. 发布前后的桌面闸门

`contentPublishGate` 按序判：无产品会话 → `UNAVAILABLE`；未登录 → `UNAUTHORIZED`；坐席 → `FORBIDDEN`；无行 → `请先导入并通过校验后再发布`；owner 无来源绑定 → `缺少来源绑定，无法导入`；coach → 一期仅管理员文案（`ownerPublish`，不是 HTTP 403）。

顶栏徽章**不是** `gate.allowed`。徽章读产品会话：无会话或未登录写「未接入」，`enabled === false` 也写「未接入」，首次 `session()` 未返回写「正在确认会话」，已登录（含 coach / agent）写「已接入」。所以话术师看到的是「已接入 + 发布禁用」，禁用原因走 `CONTENT_PUBLISH_COPY.ownerPublish`，不冒充连接失败。

`rowRequiresOwner` / `rowCoachPublishable` 决定内容级限制：`aftersale` 域或场景/话术含「过敏」「赔付」的行需 owner；coach 只能发 `product` / `campaign`。

**将替换（手选域）决定这次替换哪一区。** 发布时当前发布里「被这次绑定的域」的所有行先归档，再用你上传的整张表填回去；没被这次碰到的域照旧继承。所以将替换不只是标签：把一张产品表选成活动，你换掉的是活动区，而真正的产品区没动。桌面在折叠外必选手选四库之一；「表里识别到」只展示文件原域（文件名 `售前` / `活动` / `售后` / `faq` 或 `产品`，以及表内 `域` / `分类` 列），不跟下拉。表域和将替换不一致时，点发布先确认再 POST。

## 8. 系统同步：合成 rel vs 本版是否更新该域

合成发布仍是**唯一** `current_release_id`。检索与 hydrate 只认这一个租约；系统同步不拆四条平行主干，也不做部分快照。

工作台「系统同步 · 话术版本更新」第一屏是**四张卡**，固定顺序 产品 → 活动 → 售前 → 售后。点卡会切到话术库对应域。有未读时卡上另有品牌紫点（`announce-unread-dot`）。

```
[产品 沿用 N条] [活动 沿用 N条]
[售前 已更新 + 发布标题一次] [售后 沿用 N条]
脚注：当前发布 rel_N
```

- **卡状态唯一源** = 发布成功时写入 `Announcement.summary` 的那一句四库 delta，所有机器从 `GET /v1/announce/current` 的 `announcement.summary` 解析。写的是「本版已更新 / 本版沿用」，不写「已替换 / 未替换」，也不写 `rel_N`。
- **禁止**用 hydrate 哈希、本机 `sourceBindings`、或「相对上一份快照的域差」填卡。`summary` 为空或解析失败：四卡显示「无法标出本版更新了哪一库」，仍保留库名 + 条数 + 脚注。
- 条数与域哈希一律取**当次 snapshot 内存**，不信 `kept-larger` 磁盘 hydrate（磁盘可能留着比当前发布更大的旧目录）。list 失败时条数降级为「—」，不拆第一屏。
- 「本版已更新」只来自本次发布绑定的域（`source_bindings`）。继承域的文案是「本版沿用 · 内容仍是当前可用」，`StatusBadge` 用 `neutral`，**禁止** warn/danger——沿用不是故障。

对外用词锁死「本版已更新 / 本版沿用」；计划文件里 CEO 块的「已替换 / 未替换」是历史记录，UI 与测试以本节为准。

## 9. ACK ≠ 已读

`POST /v1/announce/ack` 写的 `client_sync_state` 只是**内容游标**（这台机器同步到了哪个 release），不是「人已读」。

坐席的未读是另一件事：

- 未读 = 该 session `userId` 相对本地 `last_seen` 的**域内容哈希差**（category + 排序后的 `scriptId+content_hash`，**不含** `releaseId`）。某域内容没动，换 `rel_N` 也不点亮该域。
- `last_seen` 存在 **main** 进程 origin-keyed userData，文件名 `product-last-seen.<id>.json`（`<id>` 算法对齐 `product-session.${id}.enc`），键 `{userId, domain}`，文件 `0o600`。读写 IPC **不得**带 userId，只用 `ProductSession.view().userId`；未登录 no-op。发布者的 userId 不清坐席的未读。
- 无基线时**不点亮、不写时间**；第一次四域 snapshot 完整成功后才建基线。
- ACK 与 `client_sync_state` **禁止**写 `last_seen`。已读只有两条路径：Query 窗可见（非 `FOX_IDLE`、非收起、非 `document.hidden`）且横幅停留 ≥1s 或点「知道了」关掉；或者工作台「话术版本更新」tab 实际可见（非 `document.hidden`）时。

## 10. 软更新 ≠ 版本失效

内容发布是一个**软信号**，不是失效：

- `ProductAnnounce.refresh` 发现 `releaseId` 变了，向 fox + query **和 dashboard** 扇出独立的 `content-updated` 事件（`{releaseId, summary, domainHashes, unreadDomains}`）。**禁止**走 `PRODUCT_ANNOUNCE_INVALIDATED`。dashboard preload 暴露 `dashboardAnnounce.onCatalogUpdated`（听 `product:announce-content-updated`）。话术库 / 概览订阅后立刻 `list()`。系统同步四卡仍靠窗口聚焦/可见 + 10s poll 重取 `dashboard:announce-current`。
- Query 收到软更新：换租约、出 `--muted` 墨色横幅（「售前话术已更新」，多域固定顺序 产品→活动→售前→售后，带「知道了」可关），**禁止** `setResults([])` / `cancelPendingSearch`——坐席正在接待，Top 3 必须留在屏幕上。横幅高度计入窗口 hug。窗口不可见时到达的横幅会被记住，等 Query 重新可见后才开始 1s 已读计时（不会卡住或永不清）。
- 真正的 `expired` / `source_gate` / `unavailable` 才走 `onInvalidated`，语义保持：抽空结果 + `is-invalid`。

## 11. 坐席未读最多约 10s

一期**没有**跨机 push、没有 websocket。运输层是已登录 Query 现有的 `sessionStatus`（约 10s）触发 `refreshAnnounce`，以及发布者 `afterPublish` 的 refresh。所以坐席从发布到看到紫点，最多约 10s。Fox 只读未读投影，不发 `PRODUCT_ANNOUNCE_REFRESH`、不 mark-read。

## 12. 相关

- [组织已审证据的边界](explanation-org-review-evidence.md) — 库里那条审核声明到底是什么
- [How to 用一张表替换四库之一](how-to-replace-one-library.md) — 手选将替换与 mismatch 确认
- [How to 下架一条已发布话术](how-to-retire-a-script.md) — 两步确认，下次发布才离开目录
- [本机目录与当前发布](explanation-catalog-lease.md) — `matchesLease` 与 kept-larger
- [How to：办公机产品主链](how-to-office-machine-product-remote.md) — 在办公机上勾选取消与发布
- [Tutorial：管理员导入 MENOKIN FAQ 并发布](tutorial-menokin-content-publish.md) — 端到端走一遍
- [打包与签名](reference-packaging-and-signing.md) — 包怎么出、签不签
