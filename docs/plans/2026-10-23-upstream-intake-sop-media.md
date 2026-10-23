# 上游合同变更提报：SOP 图片到坐席

状态：提报草案。产品仓不能自行修改冻结快照，这一份是交给记录仓形成新 `contract_set_id` 的输入。

## 一、现状与阻塞

产品仓已有完整的图片链路，只差合同一层。

已实现（产品仓，读码可核）：

| 环节 | 位置 |
| --- | --- |
| 图片字节持久化 | `apps/api/src/content-intake/sop-media.ts`，reserve → 写字节 → complete |
| 发布期图片与行绑定 | `packages/database/migrations/0040_intake_repair_successor_v1_28.sql:1389` `project_sop_release_media` |
| 按凭证读发布图 | `0040:1439-1477` `read_sop_release_assets(p_actor, p_entitlement_hash, p_session_token_hash)` |
| HTTP 读图 | `apps/api/src/content-intake/usage-http.ts:21` `GET /v1/intake/preview?entitlementId=&objectId=` |
| 服务端适配 | `apps/api/src/content-intake/sop-preview.ts`，已发布副本走 SQL，同一 release 的暂存副本作进程内回退 |

阻塞在合同四处，全部是 `IntakeSnapshot`：

```yaml
# packages/contracts/openapi/bundle.generated.yaml:10224
media:
  type: array
  items:
    type: object
    additionalProperties: false
    required: [objectId, sha256]
    properties:
      objectId: { type: string, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' }
      sha256:   { type: string, pattern: '^[0-9a-f]{64}$' }
  minItems: 0
  maxItems: 0        # ← 空数组被强制
```

`IntakePublishedEntry`（`:8677-8697`）没有媒体字段，`additionalProperties: false`，所以即使放开 `media` 也无法把图片挂到某一条目上。`sopNodes` / `sopEdges` 同样是 `maxItems: 0`。

当前产品仓把三处都固定返回空数组（`apps/api/src/content-intake/usage.ts:412`），并在注释里写明图片走 `preview()`。`sop-preview.ts` 的两个分支都以 release id 为键，因此它服务已发布内容，不服务审阅中的候选。

## 二、请求的变更

分两项。第一项是打通图片的最小集，第二项可选。

### 变更 1（必需）：让 media 能挂到条目上，并放开数量上限

`IntakeSnapshot.media.items` 增加两个字段，`maxItems` 放开到一个有界值：

```yaml
media:
  type: array
  items:
    type: object
    additionalProperties: false
    required: [objectId, sha256, businessEntryId, mime, bytes]
    properties:
      objectId:
        type: string
        pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
      sha256:
        type: string
        pattern: '^[0-9a-f]{64}$'
      # 新增：图片所属条目。用 businessEntryId 而不是 rowId，因为 rowId 是
      # 工作簿物理位置，会随插入行变化；businessEntryId 是业务方填的编码，稳定。
      businessEntryId:
        type: string
        pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
      # 新增：客户端要据此决定能否内联渲染，不必先取字节再嗅探
      mime:
        type: string
        enum: [image/png, image/jpeg, image/gif]
      # 新增：客户端要据此预判体积，避免逐张读取才知道大小
      bytes:
        type: integer
        minimum: 1
        maximum: 8388608
  minItems: 0
  maxItems: 200     # 单条 SOP 条目最多 100 张；一页快照留一倍余量
```

为什么用 `businessEntryId` 而非新增 `entry.mediaObjectIds`：后者要改 `IntakePublishedEntry`，而它被 `public.release_items` 与检索投影共用，改动面更大。前者只动 `media` 一个 schema，且客户端 join 成本可忽略。

### 变更 2（可选）：`sopNodes` / `sopEdges` 是否需要

如果 SOP 只需要「文字 + 行内图片」，这两项可以继续 `maxItems: 0`。如果以后要做步骤树或跨条目跳转，再单独提报，不要和图片绑在一起。**本轮不建议改**，避免把两个独立需求压成一次合同变更。

## 三、产品仓需要同步的改动（合同到达后）

| 位置 | 改动 |
| --- | --- |
| `apps/api/src/content-intake/usage.ts:412` | `media` 由 `read_sop_release_assets` 的投影填充，不再返回空数组 |
| `apps/api/src/content-intake/sop-preview.ts` | 投影补 `businessEntryId`、`mime`、`bytes` |
| `apps/desktop/src/shared/content-intake-query.ts` | `IntakeQueryRow` 加媒体描述符 |
| `apps/desktop/src/main/content-intake-query.ts` | 快照投影把媒体按 `businessEntryId` 分组 |
| `apps/desktop/src/preload/content-intake-query.ts` | 新增 typed `preview(objectId)` 通道 |
| `apps/desktop/src/main/content-intake-usage.ts:197-208` | 已有 `preview()` 接到新通道（当前零调用） |
| `apps/desktop/src/renderer/features/search/IntakeFaqCard.tsx` | 渲染图片；复制文本保持只复制 `answerText` |

桌面侧新增通道必须四件套原子改：`shared/ipc-channels.ts`、`preload/*.ts`、`preload/global.d.ts`、对应 `main/*-ipc.ts`。

## 四、约束与风险

- 图片字节仍然不进快照。快照只带描述符，字节经 `GET /v1/intake/preview` 读取，该端点每次复核 session、lease、scope 与选择，且 `cache-control: no-store`。合同不要引入 base64 内联字段。
- 新增字段会让 `additionalProperties: false` 的旧校验器拒绝新快照。这是有意的：新旧必须靠 `contract_set_id` 区分，不能静默兼容。
- `maxItems: 200` 需要配一个真实上限校验。产品仓已限制单条目 100 张、单张 5 MiB、总对象 500 张每候选（`0040:1003`），200 与这些一致。
- 变更 1 落地后，`IntakeSnapshot` 的总体积会上升。当前 2 MiB 上限限制的是目录行 JSON（`apps/desktop/src/main/content-intake-catalog.ts:70`），不是快照本身；需要复核这条上限是否要按图片描述符调整。

## 五、验收

合同到达后，产品仓需要能证明：

1. 一条带图 SOP 发布后，第二个坐席的快照里 `media` 含该项目 `businessEntryId` 的描述符
2. 取字节返回的 `sha256` 与该描述符一致
3. 撤权后同一个 `objectId` 再取返回 `SCOPE_DENIED`
4. 复制话术只复制 `answerText`，不含图片也不含描述符

这四条目前都可以在合成夹具上写，不需要真实工作簿。

## 六、我不能自行完成的部分

`packages/contracts/openapi/bundle.generated.yaml` 是单向交接的不可变快照（`contracts/upstream/customer-agent/README.md`）。产品仓改它等于制造第二真源。必须先在记录仓形成新 commit 与新 `contract_set_id`，再以新增快照交接，然后用 `pnpm contracts:intake` 接收。

本文件是提报输入，不是变更本身。
