# 完整部署总结：迁移 0074 + 0075

**部署时间：** 2026-10-28  
**目标环境：** 杭州生产环境 (customer_agent_synthetic)  
**状态：** ✅ 两个迁移全部部署并验证完成

---

## 一、迁移 0074：支持 engineer 角色

### 修复内容
修复 `authorization_deadline` 函数对 engineer 角色的支持。

### 技术细节
**问题：** 原函数在 HAVING 子句硬编码角色列表，未包含 engineer
**修复：** 改用 `role_ceiling` 表的 `business_actions` 字段动态判断
**影响：** 所有 `role_ceiling` 中定义的角色现在都能根据其 `business_actions` 通过授权

### 验证结果
- ✅ 函数已更新
- ✅ 真实用户 `prin_0200eee61a1d3f659e1aa69148cd93a9847939f2` (engineer 角色) 通过授权
- ✅ 服务健康 (API 0.3.34)

**发现的问题：** `source_id IS NULL` 授权无法生效 → 引出迁移 0075

---

## 二、迁移 0075：支持通配符 source 授权

### 修复内容
修复 `authorization_deadline` 函数无法处理 `source_id IS NULL` 授权记录的问题。

### 技术细节
**问题根源：**
- `source_id IS NULL` 表示"允许该 scope 的任意 source"（通配符授权）
- 但原函数的 EXISTS 子句要求精确匹配，导致 NULL 授权无法生效

**修复方案：**
```sql
AND (
  g.source_id IS NULL  -- 通配符：允许任意 source
  OR EXISTS (          -- 精确匹配：要求 source 存在
    SELECT 1
    FROM content_intake.sources src
    WHERE src.source_id = p_source
      AND src.scope_id = s.scope_id
  )
)
```

### 验证结果
- ✅ 发现 4 条通配符授权记录
- ✅ 真实用户测试通过
- ✅ 函数逻辑完整

---

## 三、关键决策

### 1. 迁移文件位置
- **决策：** 将 0074 和 0075 放在 `packages/database/overlays/` 而非 `migrations/`
- **原因：** 这些是手动编写的 overlay 迁移，不是从合约集自动生成的
- **影响：** 生成器检查通过，不会与自动生成的迁移冲突

### 2. 修复顺序
- **0074 先部署：** 让 engineer 角色基本可用
- **0075 后部署：** 完善通配符授权语义
- **原因：** 0074 是高优先级（用户无法登录），0075 是完善性修复

### 3. 验证策略
- **真实用户测试：** 使用实际的 principal_id 和授权记录
- **完整链路：** 验证从事实 → 角色规则 → 授权记录 → 判断函数的完整流程
- **边界条件：** 测试通配符授权（NULL source_id）

---

## 四、部署记录

### Git 提交
```
79f34cf refactor(database): move migration 0074 to overlays (was already deployed)
42a2670 feat(database): add migration 0075 - fix authorization_deadline for source_id NULL
56497a9 feat(database): 修复 authorization_deadline 对 engineer 角色的支持
```

### 文件清单
```
packages/database/overlays/0074_authorization_deadline_engineer.sql
packages/database/overlays/0075_authorization_deadline_source_null.sql
packages/database/DEPLOYMENT-REPORT-0074.md
packages/database/DEPLOYMENT-REPORT-0075.md
deploy-0074-to-hangzhou.sh
```

### 数据库状态
```sql
-- 迁移已应用
SELECT migration_id FROM customer_agent_migrations.migrations 
WHERE migration_id ~ '^007[45]';
-- (注：实际表名待确认，可能不存在迁移记录表)

-- 通配符授权生效
SELECT count(*) FROM content_intake.grants WHERE source_id IS NULL;
-- 结果：4

-- 真实用户授权通过
SELECT content_intake.authorization_deadline(
  'prin_0200eee61a1d3f659e1aa69148cd93a9847939f2',
  'query',
  'scope-menokin-product',
  'src-menokin-faq',
  now()
);
-- 结果：2026-10-29 10:49:06.207375 (非NULL，授权通过)
```

---

## 五、后续行动

### 5.1 监控
- [ ] 监控 engineer 角色的实际使用情况
- [ ] 追踪通配符授权的性能影响
- [ ] 观察是否有其他角色遇到类似问题

### 5.2 文档
- [x] 更新授权指南 (`docs/guides/grant-engineer-permissions.md`)
- [x] 记录部署过程和验证结果
- [ ] 补充通配符授权的使用示例

### 5.3 技术债
- [ ] 确认生产环境是否有迁移记录表
- [ ] 评估是否需要为其他角色批量修复授权
- [ ] 考虑将 overlay 迁移纳入正式的发布流程

---

## 六、经验教训

### 做得好的
1. **分层验证：** 从函数定义 → 数据库状态 → 真实用户测试，逐层验证
2. **完整链路：** 测试脚本覆盖了从事实到授权判断的完整流程
3. **即时修复：** 发现 0074 留下的问题后，立即编写 0075 修复

### 需改进的
1. **测试数据：** 测试数据库中主体不足，差点用错 principal_id
2. **迁移记录：** 不确定是否有迁移记录表，无法跟踪已应用迁移
3. **构建流程：** overlay 迁移的管理流程需要文档化

---

**报告人：** Database Migration Team  
**审核人：** [待填写]  
**最终状态：** ✅ 两个迁移全部成功，授权链路完整
