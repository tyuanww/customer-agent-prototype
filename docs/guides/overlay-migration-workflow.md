# Overlay 迁移发布流程

本文档规范 `packages/database/overlays/` 目录下手动编写的迁移文件的发布流程。

---

## 一、Overlay 迁移 vs. 自动生成迁移

### 1.1 定义

| 类型 | 位置 | 来源 | 用途 |
|------|------|------|------|
| **自动生成迁移** | `migrations/` | 合约集自动生成 | 核心业务模型的结构化变更 |
| **Overlay 迁移** | `overlays/` | 手动编写 | 产品功能的辅助函数、索引、约束优化 |

### 1.2 何时使用 Overlay

**适用场景：**
- 修复或优化现有函数的业务逻辑
- 添加索引以提升查询性能
- 调整约束条件（如有效期限制）
- 添加辅助查询函数（如 `authorization_deadline`）

**不适用场景：**
- 修改核心表结构（字段、主键、外键）
- 修改合约定义的 API 签名
- 修改冻结的历史迁移

**判断标准：**
- 如果变更来自合约集更新 → `migrations/`
- 如果变更是产品特定优化 → `overlays/`

---

## 二、Overlay 迁移的生命周期

### 2.1 创建

1. **命名规范**
   ```
   overlays/NNNN_descriptive_name.sql
   
   NNNN: 四位数字，从 migrations/ 的最大编号开始递增
   descriptive_name: 短横线分隔的描述性名称
   ```

   **示例：**
   ```
   overlays/0074_authorization_deadline_engineer.sql
   overlays/0075_authorization_deadline_source_null.sql
   ```

2. **文件模板**
   ```sql
   -- OVERLAY MIGRATION: Brief description
   -- Purpose: What problem this solves
   -- Related: Link to issue/PR if applicable
   
   SET LOCAL search_path = public, pg_catalog, pg_temp;
   
   -- Migration content here
   
   -- Permissions (if creating functions)
   REVOKE ALL ON FUNCTION schema.function_name(...) FROM PUBLIC;
   GRANT EXECUTE ON FUNCTION schema.function_name(...) TO role_name;
   ```

3. **文档要求**
   - 在文件顶部注释中说明修复目标
   - 引用相关的 migrations/ 文件（如果有）
   - 说明向后兼容性影响

### 2.2 测试

1. **本地测试**
   ```bash
   # 在本地测试数据库应用
   psql -h <host> -p <port> -d <database> -U <user> \
     -f overlays/NNNN_name.sql
   
   # 验证功能
   bash scripts/test-<feature>.sh
   ```

2. **集成测试**
   ```bash
   # 运行相关的集成测试
   pnpm test:integration --filter=<related-tests>
   ```

3. **性能测试**
   ```bash
   # 如果是性能优化，测量前后性能
   psql -c "EXPLAIN ANALYZE <query>"
   ```

### 2.3 审核

**审核检查清单：**
- [ ] 文件命名符合规范
- [ ] 顶部注释完整
- [ ] SQL 语法正确
- [ ] 权限设置正确
- [ ] 本地测试通过
- [ ] 集成测试通过
- [ ] 有相应的验证脚本（如 `test-*.sh`）
- [ ] 有部署报告模板（如 `DEPLOYMENT-REPORT-*.md`）

### 2.4 部署

1. **生产环境部署**
   ```bash
   # 使用部署脚本
   bash deploy-<NNNN>-to-<env>.sh
   
   # 或手动应用
   psql -h <prod-host> -p <prod-port> -d <prod-db> -U <prod-user> \
     -f overlays/NNNN_name.sql
   ```

2. **验证**
   ```bash
   # 运行验证脚本
   bash scripts/test-<feature>.sh <principal-id>
   
   # 检查日志
   grep "migration NNNN" /var/log/api.log
   ```

3. **回滚计划**
   - 记录当前函数/约束的定义
   - 准备回滚 SQL（如果可行）
   - 对于不可回滚的变更（如删除字段），在生产部署前充分测试

### 2.5 归档

**部署后：**
1. 保留在 `overlays/` 目录
2. 创建部署报告 `packages/database/DEPLOYMENT-REPORT-NNNN.md`
3. 在 README 或 CHANGELOG 中记录
4. Git 提交时标注 `feat(database)` 或 `fix(database)`

**不移动到 migrations/**
- `overlays/` 的文件永久保留
- 生成器检查时跳过 `overlays/`
- 避免与自动生成的迁移冲突

---

## 三、与迁移生成器的交互

### 3.1 生成器行为

**当前状态（迁移 0074/0075）：**
```bash
$ pnpm db:migrations:generate

# 生成器检查 migrations/ 中的最大编号
# 跳过 overlays/ 目录
# 从 migrations/ 的最大编号 + 1 开始生成新迁移
```

**预期：**
- `migrations/` 最大编号：0073
- `overlays/` 最大编号：0075
- 下次自动生成：`migrations/0074_....sql`（不冲突）

### 3.2 编号冲突处理

**场景：** Overlay 迁移 0074 已存在，自动生成也想用 0074

**解决方案：**
1. 自动生成器跳过 `overlays/` 目录
2. 按 `migrations/` 的最大编号递增
3. 如果 `overlays/` 编号更大，无需调整

**验证：**
```bash
# 检查是否有编号冲突
ls migrations/007*.sql overlays/007*.sql 2>/dev/null | sort

# 如果有重复编号，重命名 overlay 文件
# （通常不需要，因为 overlay 总是手动创建）
```

### 3.3 依赖关系

**规则：**
- Overlay 可以依赖 `migrations/` 中的任何已部署迁移
- Overlay 不能相互依赖（除非显式说明）
- 自动生成的迁移不依赖 `overlays/`

**示例：**
```sql
-- overlays/0074_authorization_deadline_engineer.sql
-- 依赖: migrations/0030_intake_role_ceiling.sql (role_ceiling 表)
-- 依赖: migrations/0046_project_feishu_roster.sql (authorization_deadline 函数)
```

---

## 四、最佳实践

### 4.1 小而专注

**好的 Overlay：**
- 修复一个明确的问题
- 文件小于 200 行
- 可以独立回滚（如果需要）

**避免：**
- 一个文件修改多个不相关的函数
- 混合业务逻辑和性能优化
- 依赖其他 overlay 的未部署变更

### 4.2 向后兼容

**兼容性检查：**
- [ ] 现有授权记录是否仍然有效？
- [ ] 现有主体和事实是否仍然可查询？
- [ ] API 签名是否保持不变？
- [ ] 错误码和消息是否保持不变？

**破坏性变更处理：**
1. 提前通知用户
2. 提供迁移脚本（数据迁移）
3. 保留旧版本兼容性（如果可能）
4. 记录在 CHANGELOG 中

### 4.3 充分测试

**测试层次：**
1. **单元测试：** SQL 函数的输入输出
2. **集成测试：** 完整的登录和授权流程
3. **性能测试：** 查询执行计划和延迟
4. **回归测试：** 确保未破坏现有功能

**测试覆盖：**
- 正常路径（授权通过）
- 边界条件（事实过期、授权撤销）
- 错误路径（角色不存在、授权拒绝）

### 4.4 文档齐全

**必需文档：**
1. **迁移文件顶部注释**
   - 修复目标
   - 相关问题/PR
   - 依赖的其他迁移

2. **部署报告**
   - 部署步骤
   - 验证结果
   - 影响范围
   - 回滚计划

3. **用户指南**
   - 新功能的使用方法
   - 行为变更的说明
   - 常见问题解答

---

## 五、示例：迁移 0074/0075

### 5.1 目录结构

```
packages/database/
├── migrations/
│   ├── 0001_initial.sql
│   ├── ...
│   └── 0073_feishu_query_grant.sql
├── overlays/
│   ├── 0074_authorization_deadline_engineer.sql  ← Overlay
│   └── 0075_authorization_deadline_source_null.sql  ← Overlay
├── DEPLOYMENT-REPORT-0074.md
├── DEPLOYMENT-REPORT-0075.md
└── DEPLOYMENT-SUMMARY-0074-0075.md
```

### 5.2 部署流程

1. **移动迁移文件**
   ```bash
   mv migrations/0074_*.sql overlays/
   mv migrations/0075_*.sql overlays/
   ```

2. **应用到生产**
   ```bash
   psql ... -f overlays/0074_authorization_deadline_engineer.sql
   psql ... -f overlays/0075_authorization_deadline_source_null.sql
   ```

3. **验证**
   ```bash
   bash scripts/test-engineer-authorization.sh prin_0200...
   ```

4. **提交**
   ```bash
   git add overlays/ DEPLOYMENT-*.md
   git commit -m "feat(database): add migration 0074-0075 - fix authorization_deadline"
   ```

### 5.3 后续维护

- **监控：** 每日运行 `monitor-authorization-metrics.sh`
- **文档：** 补充到 `docs/guides/grant-engineer-permissions.md`
- **测试：** 添加到 CI 流程

---

## 六、常见问题

### Q1: Overlay 迁移和自动生成迁移的编号冲突怎么办？

**A:** 不会冲突。生成器只看 `migrations/` 的最大编号，`overlays/` 的编号可以更大。

### Q2: 如何回滚 Overlay 迁移？

**A:** 
1. 如果是函数修改，重新应用旧版本的 SQL
2. 如果是表结构变更，准备回滚脚本
3. 记录在部署报告的"回滚计划"部分

### Q3: Overlay 迁移可以修改历史迁移吗？

**A:** 不可以。历史迁移已冻结。创建新的 Overlay 替换旧版本。

### Q4: 什么时候应该把 Overlay 合并到 migrations？

**A:** 永远不合并。`overlays/` 和 `migrations/` 是两个独立的命名空间。

### Q5: 如何处理 Overlay 之间的依赖？

**A:** 
1. 尽量避免依赖
2. 如果必须依赖，在文件顶部注释中明确说明
3. 部署时按依赖顺序应用

---

## 七、工具和脚本

### 7.1 创建 Overlay

```bash
# 自动生成下一个编号的 Overlay 文件
./scripts/create-overlay.sh "authorization deadline fix"
```

### 7.2 验证 Overlay

```bash
# 检查 SQL 语法
./scripts/lint-overlay.sh overlays/0074_*.sql

# 检查编号冲突
./scripts/check-migration-numbers.sh
```

### 7.3 部署 Overlay

```bash
# 生成部署脚本
./scripts/generate-deploy-script.sh 0074 hangzhou

# 执行部署
bash deploy-0074-to-hangzhou.sh
```

---

**版本：** 1.0  
**最后更新：** 2026-10-28  
**维护人：** Database Migration Team
