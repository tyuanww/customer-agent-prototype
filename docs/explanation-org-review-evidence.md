# 为什么「组织已审」在库里只是一条声明

> 写给下一手。这不是设计辩护，是把边界说清楚：产品内那条质检证据挡不住谁，读它的角色字段能拿来做什么、不能拿来做什么。
>
> 代码真源：`packages/database/overlays/0016_office_owner_publish.sql` 的两个 definer 函数。

## 问题

一期产品流程是**一人发布**：有权限的人在飞书文档审完表，导出 Excel，导入工作台，同一人点发布。组织审核发生在产品之外。

但发布路径上有一道历史遗留的质检门：`packages/database/migrations/0012_owner_acceptance_v1_15.sql` 的 `publish_content_release` 要求库里存在 `conclusion = 'passed'` 的质检证据，否则抛 `QUALITY_GATE_NOT_PASSED`。

原来的实现靠**三个不同能力**的账号各打一张收据（话术师 / 管理员 / 质检）凑齐证据，也就是「双人复核」。生产路径里它接到 `dashboard-content-review.ts` 的 `completeSignedInReview`，用当前飞书 owner 一个人的会话去打三张票。owner 没有这三条能力，于是失败，界面停在「导入已进入双人复核」。

一人发布的业务现实和双人复核的代码门冲突。要么让 owner 去伪造三张票，要么换一条过门的合法路径。

## 选的路

不伪造三张 capability 收据。改成：worker 校验通过后，写**一条**组织已审证据，用这条证据过质检门。

两个 definer 函数：

| 函数 | 做什么 |
| --- | --- |
| `record_org_reviewed_quality_evidence(job, owner, lease, batch, plan, rows)` | 写 `content_quality_review_evidence`，`evidence_ref = 'org-reviewed:feishu-doc'`，`conclusion = 'passed'` |
| `finalize_org_reviewed_import_validation(job, owner, lease, batch, rows)` | 冻结计划 → staged，不 park 双人复核 |

两者都由 `app_backend_worker` 执行，调用点在同一次 worker 事务里（`apps/api/src/content-worker.ts`）。

审核人 ID 是**确定值**，不是真人账号：

```
sha256('org-reviewed:feishu-doc:lead:' || batch_id)
sha256('org-reviewed:feishu-doc:qa:'   || batch_id)
```

## 这条证据挡得住什么，挡不住什么

`REVIEW_EVIDENCE_TRUST_BOUNDARY` 检查存在，也确实有用，但它的作用域很窄：

```sql
-- 0016, finalize_org_reviewed_import_validation 内
IF EXISTS (
  SELECT 1 FROM pg_catalog.jsonb_array_elements(p_rows) AS item(value)
  WHERE item.value ?| ARRAY[
    'review_mode','primary_reviewer_id','primary_reviewer_role','primary_review_evd',
    'secondary_reviewer_id','secondary_reviewer_role','secondary_review_evd','quality_gate_passed'
  ]) THEN
  RAISE EXCEPTION ... DETAIL = 'REVIEW_EVIDENCE_TRUST_BOUNDARY';
```

它做的是：**拒绝 worker 在 payload 里夹带这 8 个审核 / 质量字段**。也就是不允许 worker 把「我认为这条过了」塞进输入。

注意位置：这道检查在 **finalize**，不在 record。同一个 finalize 还会确认 record 写下的那条证据确实存在（不存在即 `QUALITY_GATE_NOT_PASSED`）。

它**不**做的是：阻止这两个 definer 函数自己往 `content_quality_review_evidence` 落一行 `passed`。落库这件事本身，就是被授权的。

所以结论很直白：

> 库里记的是**一条声明**，不是一道独立控制。worker（API 进程）的信任级 = 审核的信任级。

## 拿去用之前要记住的三件事

1. **谁审的以飞书文档为准。** 库里的 `reviewer_id` / 角色字段只用于对账，**不能拿来举证**「某人审过」。
2. **别在 API 层加「校验」。** 在 API 层重算哈希、比对收据，都比直接读飞书真源弱，只是把同一个信任级换个地方声明。真要加强，得引入产品之外的独立真源。
3. **不要改 0016。** overlay 与生成的 migration 都已落库并带内容哈希。改了会让正式库的 `/ready` 对不上。要改链路，先读这两个函数，再走新 migration。

## 别的设计试过或否掉

| 方案 | 为什么没走 |
| --- | --- |
| owner 会话打三张 capability 票 | 用一个人的令牌伪造三张收据；且生产路径本来就失败 |
| 保留 43112 合成三连 | 那是合成栈的假审核，不是生产路径；删掉了 |
| 让发布跳过质检门 | 会连带放行其他未过门批次，破坏 0012 的门语义 |

`completeSignedInReview` 已从生产桌面删除；43112 合成三连停用。话术库**单条** `PATCH` / `DELETE` 仍进 `pending_review` 草稿，不受此路影响。

## 相关

- [内容导入与发布合同](reference-content-publish.md)
- [方案计划（含审核证据边界原话）](plans/2026-09-24-office-owner-publish.md)
- [产品文档生命周期](reference-document-lifecycle.md)
