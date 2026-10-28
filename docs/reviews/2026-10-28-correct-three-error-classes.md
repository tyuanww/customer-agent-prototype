# 三类重复错误的修复方案（2026-10-28）

针对用户提出的三类错误，按架构层、类型层、测试层、文档层四层分别给出修复方案。

## Class 1：迁移种下的行不满足合同枚举

### 错误实例

1. **0038 第 99-108 行**：`scope-menokin-sop` 的 `domain` 设为 `sop`，`template_version` 设为 `sop-v1`，而合同 `IntakeSourceScope.domain` 只允许 `presale|campaign|aftersale|product`，`templateVersion` 只允许 `faq-p1.1|faq-csv-v1`。
2. **0048 第 141 行**：按 `src.mode = 'v2-preview'` 筛来源，而 0037 和 0038 种下的 6 个来源全是 `legacy`，没有任何迁移插入过 `v2-preview`。

### 根因

迁移用 SQL 直接写值，TypeScript 合同在另一处声明约束，两处没有自动对齐机制。

### 修复层级

**测试层（推荐）**：在 `packages/database/tests/postgres.integration.test.ts` 加一条测试，跑完全部迁移后把 `sources`、`source_mappings`、`scopes` 的每一行过一遍 `parseContractSchema`。

- 优点：不改生成器，不改合同结构，只在测试阶段拦截。
- 实施成本：约 50 行测试代码。
- 何时失败：下次提交包含不合规迁移时 CI 红。

**架构层（成本高）**：让 `generate-migrations.mjs` 直接读合同枚举，生成时就拦截。

- 优点：错误前移到生成期。
- 缺点：生成器要解析 TypeScript 合同，或合同要导出 JSON schema。
- 实施成本：重写生成器的数据部分。

### 推荐

测试层。架构层收益不足以抵消成本。

## Class 2：NOT VALID 约束留在生产上没人再验

### 错误实例

12 条 `convalidated = f` 约束，全部来自 0065：

- `commit_tickets_actor_id_action_operation_id_fkey`
- `entitlement_contexts_entitlement_id_fkey`
- `entitlement_scopes_entitlement_id_fkey`
- `grant_history_grant_id_fkey`
- `publications_release_id_fkey`
- `quality_approvals_check_id_fkey`
- `quality_disapprovals_check_id_fkey`
- `release_lineage_candidate_id_fkey`
- `release_lineage_release_id_fkey`
- `bindings_observation_id_fkey` (intake_organization)
- `current_bindings_observation_id_fkey` (intake_organization)
- `observations_binding_id_fkey` (intake_organization)

### 根因

0065 把这些约束改成 `NOT VALID` 止血，但没有后续验证机制，导致它们永久留在生产上。

### 修复层级

**测试层（推荐）**：在 verifier 加一条检查，`NOT VALID` 计数不为 0 就失败。

```typescript
// packages/database/src/verifier.ts 新增函数
export async function verifyNoNotValidConstraints(client: DatabaseQueryClient): Promise<void> {
  const result = await client.query(`
    SELECT conname, conrelid::regclass AS table_name
    FROM pg_constraint
    WHERE convalidated = false
    ORDER BY conrelid::regclass::text, conname
  `);
  
  if (result.rows.length > 0) {
    const list = result.rows.map(r => `${r.table_name}.${r.conname}`).join('\n  ');
    throw new Error(`NOT VALID constraints detected:\n  ${list}\n\nThese must be validated or removed.`);
  }
}
```

在 `postgres.integration.test.ts` 的迁移后检查中调用。

- 优点：任何新增 NOT VALID 约束会立即被拦截。
- 实施成本：约 20 行代码。
- 何时失败：下次提交引入 NOT VALID 约束时 CI 红。

**架构层（更高层）**：禁止迁移使用 `NOT VALID`，强制所有约束必须立即验证。

- 缺点：失去止血工具。0065 那次如果没有 NOT VALID，备份无法还原。
- 不推荐：止血能力有价值。

### 推荐

测试层。保留 NOT VALID 作为紧急止血手段，但通过 verifier 确保它不会永久留存。

## Class 3：文档里写死的数字跟着迁移漂移

### 错误实例

`docs/how-to-restore-a-feishu-shop-list.md` 三处写"5 分钟"，0073 之后实际是 24 小时。

### 修复层级

**文档层（已完成）**：把三处数字换成指向 0073 迁移的链接。

**类型层（不推荐）**：把窗口时长抽成导出常量再用脚本生成文档。

- 缺点：成本远大于收益。文档错误不会导致 CI 失败。
- 不推荐。

### 推荐

文档层。已完成。

## 未覆盖的一条

**手工 INSERT 违反规则**：`docs/how-to-restore-a-feishu-shop-list.md:52` 写着"不要为了让店铺出现而手写"，但没有任何东西强制它。

按 `/correct` 的定义这是 repeat。最高层修复是让迁移账本成为唯一写入口，但这需要：

1. 把手工 INSERT 的那一行 `src-menokin-sop-v2` 变成可重放的迁移（0074）。
2. 建立机制确保所有生产数据变更必须通过迁移。

这一条超出本次三类错误范围，需要你单独决定是否推进。

## 实施顺序

1. **立即**：文档层修正（已完成）。
2. **本周内**：测试层 Class 1 检查（约 1 小时）。
3. **本周内**：测试层 Class 2 检查（约 30 分钟）。
4. **需决策**：0074 迁移（不可逆写入，需明确授权）。
5. **需决策**：未覆盖的手工写入规则强制机制（架构层，成本高）。

## 成本估算

| 项目 | 层级 | 工时 | 风险 |
|---|---|---|---|
| Class 1 测试 | 测试层 | 1h | 低 |
| Class 2 测试 | 测试层 | 0.5h | 低 |
| Class 3 文档 | 文档层 | 0.5h | 无（已完成）|
| 0074 迁移 | 数据层 | 2h | 中（不可逆）|
| 强制迁移唯一 | 架构层 | 未估算 | 高 |

## 推荐给甲方的说辞

"我们发现三类系统性问题，已经修复了文档漂移（Class 3），并准备加两条自动检查（Class 1 和 2），在提交时拦截这些错误，成本约 1.5 小时。

另有一项数据修复（0074 迁移）需要您的明确授权，因为它会写入生产数据库。这项修复会让新建库也能正常显示店铺列表，避免重复手工操作。

最后一项是架构层改造，让所有生产数据变更必须通过迁移，成本较高，建议暂缓，等积累更多案例再评估。"
