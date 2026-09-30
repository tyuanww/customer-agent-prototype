# 试点采集的告知与同意（pilot_recorded）

真实坐席的提问正文含顾客姓名、地址。归档这类内容之前，系统必须能证明**当事人已看过并同意当前那一版告知**。
冻结合同对此写得很硬：`collection_mode = pilot_recorded` 时，服务端**必须**确认当前用户已接受当前 notice 版本，
**未接受或校验不可用时 fail-closed**（不许降级、不许"先记再说"）。

本文说明这套机制**已经建好什么**、**还差什么**。

## 已经建好的（本轮）

| 部分 | 位置 |
| --- | --- |
| `GET /v1/notices/current` | `apps/api/src/notice-routes.ts` |
| `POST /v1/notices/{version}/decision` | 同上 |
| 读取/写入逻辑 | `apps/api/src/notice-service.ts` |
| 采集门禁 | `apps/api/src/search-routes.ts`（写 `query_events` 之前） |

三处行为，都有测试钉住：

1. **未同意 → 403，且检索操作根本不执行。**
2. **同意后 → 放行。**
3. **校验本身报错 → 仍然 403**（fail-closed，这是合同明文要求的那一条）。

决定记录是**只追加**的：同一用户同一版本，重复提交相同决定返回首次终态；提交**不同**决定返回 **409**，不允许覆盖审计证据。

**不需要新的数据库对象**：`app_runtime` 在 0008 里已经有 `privacy_notices` 的 SELECT 与 `notice_decisions` 的 SELECT+INSERT。
`notice_decisions` 的主键 `(notice_version, user_id)` 本身就是幂等键，所以没有另建幂等表。

## 还差什么 —— **需要你提供**

### 1. 告知正文（我不能代写）

`privacy_notices` 需要一条 `status='current'` 的行。**正文是对真实顾客的承诺，属于法律/产品文本，我编不了**。
`content_hash` 必须是正文的 64 位十六进制 sha256。

```sql
-- 在杭州库上执行（把 <正文> 换成你确认过的文本）
INSERT INTO public.privacy_notices(notice_version, notice_text, content_hash, status, published_at)
VALUES (
  'pilot-notice-v1',
  '<正文>',
  encode(public.digest('<正文>', 'sha256'), 'hex'),
  'current',
  now()
);
```

> 当前库里**没有任何 notice 行**（`status='current'` 为空），所以 `GET /v1/notices/current` 现在返回 **404**。
> 这是**正确的静默状态**，不是故障 —— 没人发布过告知，采集门禁因此保持关闭。

### 2. 客户端同意弹窗（桌面端）

合同要求：`decision` 为 `null` 时，客户端**必须**展示一次明确告知，
**不得把页面浏览等同于接受**。桌面端目前没有这个弹窗，所以：

- 现在的桌面端**不会**发送 `pilot_recorded`（仍发 `synthetic`），门禁不会挡它
- 要做真实采集，得先有弹窗：首启时拉 `/v1/notices/current`，`decision === null` 就展示正文并让坐席点同意/拒绝

### 3. 让客户端开始发 `pilot_recorded`

桌面端 `product-search.ts` 现在硬编码 `collection_mode: 'synthetic'`（`:250`）。
改成 `pilot_recorded` 之前，1 和 2 必须先就位。

## 顺序

```
① 你写告知正文并入库
② 桌面端加首启弹窗（拉 current / 写 decision）
③ 桌面端把 collection_mode 改成 pilot_recorded
④ 9 个坐席各点一次同意（一次性）
```

在 ①②③ 完成之前，`pilot_recorded` 请求一律 403 —— 这是设计，不是缺陷。
