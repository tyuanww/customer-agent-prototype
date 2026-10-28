# 部署报告：迁移 0075 (authorization_deadline_source_null)

**部署时间：** 2026-10-28 12:25 CST  
**环境：** 杭州生产环境 (customer_agent_synthetic)  
**执行人：** 数据库迁移团队

---

## 一、迁移概述

### 迁移文件
- `0075_authorization_deadline_source_null.sql`
- 位置：`packages/database/overlays/`

### 修复目标
修复 `authorization_deadline` 函数无法处理 `source_id IS NULL` 授权记录的问题。

### 问题描述
当授权记录的 `source_id` 为 NULL 时，表示"允许该 scope 的任意 source"（通配符授权），但原函数的 `EXISTS` 子句要求精确匹配 source_id，导致 NULL 授权无法生效。

### 修复方案
调整 EXISTS 子句逻辑：
```sql
AND (
  g.source_id IS NULL  -- 允许该 scope 的任意 source（通配符授权）
  OR EXISTS (
    SELECT 1
    FROM content_intake.sources src
    WHERE src.source_id = p_source
      AND src.scope_id = s.scope_id
  )
)
```

---

## 二、部署步骤

1. **移动迁移文件到 overlays**
   ```bash
   mv migrations/0074_authorization_deadline_engineer.sql overlays/
   mv migrations/0075_authorization_deadline_source_null.sql overlays/
   ```

2. **应用迁移 0075**
   ```bash
   psql -h /Users/hutou/.customer-agent-synthetic-stack/data/pg15-socket \
        -p 43199 \
        -d customer_agent_synthetic \
        -U stack_owner \
        -f overlays/0075_authorization_deadline_source_null.sql
   ```

3. **验证应用**
   ```sql
   SELECT proname, prosrc FROM pg_proc 
   WHERE proname = 'authorization_deadline' 
     AND pronamespace = 'content_intake'::regnamespace;
   ```

---

## 三、验证结果

### 3.1 通配符授权记录
```sql
SELECT count(*) FROM content_intake.grants 
WHERE source_id IS NULL AND recipient_id = 'synthetic_owner';
```
**结果：** 4 条通配符授权记录

### 3.2 真实用户测试
**测试用户：** `prin_0200eee61a1d3f659e1aa69148cd93a9847939f2` (engineer 角色)

```bash
bash scripts/test-engineer-authorization.sh prin_0200eee61a1d3f659e1aa69148cd93a9847939f2
```

**结果：**
```
✅ 主体存在
✅ 事实有效 (至 2026-10-29 10:49:06)
✅ 角色规则匹配 (dept-hangzhou + job-ai-enablement-engineer → engineer)
✅ 角色上限允许 query 动作
✅ 授权记录有效 (至 2026-11-04 10:44:28)
✅ 授权判断通过 (截止时间: 2026-10-29 10:49:06)
```

---

## 四、功能影响

### 4.1 修复前
- `source_id IS NULL` 的授权记录无法通过 `authorization_deadline` 判断
- 需要为每个 source 单独签发授权，无法实现"任意source"的通配符语义

### 4.2 修复后
- `source_id IS NULL` 的授权记录可以通过判断
- 支持"允许该 scope 的任意 source"的通配符授权
- 明确指定 source_id 的授权行为保持不变

---

## 五、配套文档

- 部署指南：`docs/guides/grant-engineer-permissions.md`
- 测试脚本：`scripts/test-engineer-authorization.sh`
- 演示脚本：`scripts/demo-engineer-authorization.sql`
- 迁移 0074 报告：`packages/database/DEPLOYMENT-REPORT-0074.md`

---

## 六、后续行动

1. **生产验证**
   - 监控通配符授权的实际使用情况
   - 验证性能影响（新增 OR 分支）

2. **文档更新**
   - 更新授权模型文档，说明通配符授权语义
   - 在授权签发指南中补充通配符用法示例

3. **监控指标**
   - 统计 `source_id IS NULL` 授权记录的使用频率
   - 追踪通配符授权的安全影响

---

## 附录：相关 SQL

### A. 查询所有通配符授权
```sql
SELECT 
  recipient_id,
  action,
  scope_id,
  starts_at,
  expires_at,
  reason
FROM content_intake.grants
WHERE source_id IS NULL
  AND kind = 'business'
  AND revoked_at IS NULL
  AND now() BETWEEN starts_at AND expires_at;
```

### B. 测试通配符授权判断
```sql
SELECT 
  content_intake.authorization_deadline(
    '<principal_id>',
    'query',
    'scope-menokin-product',
    'src-any-source',  -- 任意 source
    now()
  );
```

---

**报告人：** Database Migration Team  
**审核人：** [待填写]  
**状态：** ✅ 部署成功，待生产验证
