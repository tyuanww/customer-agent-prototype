# SOP 行身份（已修复：方案 A）

状态：**已实现并验证**。迁移 `0061_sop_entry_code_identity`。

## 原问题

SOP 工作簿的一行曾由两个**位置**键标识：

```2:4:packages/content-intake/src/sop.ts
  const shaped = sop.rows.map((row, index) => {
    const id = `sop${index + 1}`;
    ...
      rowId: `sop:${row.sheet}:${row.row}`,
```

`businessEntryId = sop<序号>` 来自解析结果下标，`rowId = sop:<表名>:<行号>` 来自物理行号。插入一行时两者**一起平移**。

实测（合成工作簿，v2 在过敏表第 2 行前插入一行）：

| 文本 | v1 | v2 |
| --- | --- | --- |
| 过敏答案A | sop2 @ row2 | **sop3 @ row3** |
| 过敏答案B | sop3 @ row3 | **sop4 @ row4** |

反过来看 sop3：正文从「过敏答案B」变成「过敏答案A」，**两个键都没动**。静默改写。

`0040:1038-1046` 的行身份守卫比较「同一 businessEntryId 的 row_id 是否变」。位置平移时同向移动，`b.row_id = current.row_id` 恒成立，检查不触发。

## 现在的模型

**编码是身份，行号是位置。**

```ts
export const SOP_ENTRY_CODE_HEADER = '条目编码';
export const isEntryCode = (value: string): boolean => ENTRY_CODE.test(value);
```

- 每张表第 1 行是表头，必须含「条目编码」列；缺失即 `MISSING_ENTRY_CODE_HEADER`
- 第 2 行起是数据，编码写入 `businessEntryId`
- 空编码 → `MISSING_ENTRY_CODE`（不回退到位置）
- 编码格式 `^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$`，非法 → `ENTRY_CODE_INVALID`。必须是 ASCII，因为契约把 `businessEntryId` 定义成 `^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`。所以编码是料号（`GM-001`），不是中文标签。
- 整册唯一，重复 → `ENTRY_CODE_DUPLICATE`
- 编码列的值不进入正文；第 1 行不再产生条目（原先表头「答案」会变成一条正式条目）

实测同一工作簿插入一行后：

| 编码 | v1 | v2 | 正文 |
| --- | --- | --- | --- |
| A-1 | row2 | **row3** | 不变 |
| A-2 | row3 | **row4** | 不变 |

## SQL 侧

`packages/database/overlays/0061_sop_entry_code_identity.sql` 只改 `stage_sop_candidate_assets` 里的一处守卫：

```sql
AND l.business_entry_id ~ '^sop[0-9]+$'
AND NOT EXISTS (SELECT 1 FROM content_intake.sop_candidate_rows b ... b.row_id=current.row_id)
```

位置式 ID（`sop7`）仍走原检查，行为完全不变。显式编码是**新增**的数据形态，在方案 A 之前不存在，所以没有放宽任何既有校验。

函数其余部分与 0040 逐字相同，用 `CREATE OR REPLACE` 原地替换，属主与 ACL 不变。

## TS 侧

`apps/api/src/content-intake/sop-freeze.ts`：

- 编码式下位置移动合法，正文修改是普通的 material 差异，所以 `materialFromParse` 会把它记成 `modify`，不需要额外守卫。
- 守卫改成 `assertNoRowIdCollision`：编码命名行之后，护栏不再是「文字不许动」，而是「两个条目不能占同一物理行」。后者会撞 `sop_candidate_rows` 的 `(candidate_id, candidate_version, row_id)` 主键，抛原始 23505，所以必须在 TS 侧先拒绝。
- 继承行按**编码**过滤：`assets.rows` 是「该来源全部已发布行」，不是「本次缺失的行」。之前按 rowId 过滤会在位置移动时误判。
- 已知缺口：SOP 没有「停用/删除条目」的表达，`tryParseSopAsFaq` 产出的行恒为 `启用`。要删一个已发布条目，只能靠 `0040:1271` 之外的手段，目前没有路径。omit 之后该条目会被继承保留，这也正是撞行检查存在的原因。

## 验证

| 项 | 结果 |
| --- | --- |
| `sop-entry-code.test.ts` | 4/4：插入行后编码与正文稳定、空编码拒绝、重复编码拒绝、表头不入目录 |
| `sop-row-identity.test.ts` | 5/5：位置式 ID 的文字改写仍被拒绝 |
| `content-intake.integration.test.ts` 新用例「publishes a SOP workbook again after a row is inserted above published entries」 | 两次发布均 202；发布后 `A-1` 的 `row_id` 为 `sop:过敏流程SOP:3`、正文为「过敏答案A」 |
| `content-intake.integration.test.ts` 全量 | 178/178 |
| `pnpm test:db:integration` | 77/77（两次实跑） |
| `pnpm --filter @customer-agent/database test` | 全绿 |
| `pnpm db:migrations:check` | 通过 |

## 台账改动（实测抄录，非推导）

| 文件 | 改动 |
| --- | --- |
| `scripts/generate-migrations.mjs` | productOverlays 增加 `[61, '0061_sop_entry_code_identity']` |
| `packages/database/src/verifier.ts` | `READINESS_SUFFIX` 加 61；`READINESS_INVENTORY_BY_LENGTH[61]` 函数摘要 `1c28c57e…`；ACL 与 60 相同（641 / `fa54a9fb…`） |
| `packages/database/src/planner.ts` | `CATALOGUE_SUCCESSOR_STEPS` 加 index 60 |
| `scripts/customer-agent-contract-set.mjs` | 两处迁移长度白名单各加 61 |
| `packages/database/tests/{postgres,verifier-runtime,planner}.integration/test.ts` | `migrationCount`/`pending` 60→61；两处 ID 数组加 0061；`priorUpgrade` 51→52 |

函数摘要取自 `test:db:integration` 的实际报错值，不是推出来的。表、对象、触发器数量不变，因为只替换函数体。

## 未验证

- 真实 Menokin 工作簿不在仓库里（`faq/minokin话术库/` 不存在），模板 `话术模板-20261022/SOP-模板.xlsx` 的第 1 行是「【示例·导入前请删除】第…」，说明真实表结构没有表头约定。业务方必须按新模板在第 1 行写「条目编码」列。
- 没有在 266 行 / 47 图的真实工作簿上验证，只用合成布局。
- 编码由业务方维护；如果两人给不同行填了同一编码，目前只会被 `ENTRY_CODE_DUPLICATE` 拒绝，没有跨表冲突的界面提示。
