# Database Roles and Connection Reference

**单一真相源 (SSOT)：数据库连接、角色、schema 与表结构查询。**

## 连接参数（杭州生产环境）

```bash
# Socket 连接（推荐）
PGHOST=/srv/customer-agent/stack/data/pg15-socket
PGPORT=43199
PGUSER=stack_owner
PGDATABASE=customer_agent_formal
```

端口 `43199` 只是 Unix socket 文件名后缀，不是 TCP 端口。各 stack 的 PostgreSQL 只在对应 stack root 的 socket 目录内使用，不开放 TCP 监听。

## 如何查询（禁止猜测）

在修改任何配置或执行 SQL 前，先查询实际状态：

```bash
# 列出所有角色
psql -h "$PGHOST" -p "$PGPORT" -U stack_owner -d customer_agent_formal \
  -c "SELECT rolname FROM pg_roles WHERE rolname NOT LIKE 'pg_%' ORDER BY rolname;"

# 列出所有 schema
psql -h "$PGHOST" -p "$PGPORT" -U stack_owner -d customer_agent_formal \
  -c "SELECT schema_name FROM information_schema.schemata 
      WHERE schema_name NOT LIKE 'pg_%' 
      AND schema_name != 'information_schema' 
      ORDER BY schema_name;"

# 查看迁移表结构
psql -h "$PGHOST" -p "$PGPORT" -U stack_owner -d customer_agent_formal \
  -c "\d customer_agent_meta.schema_migrations"

# 查询函数签名
psql -h "$PGHOST" -p "$PGPORT" -U stack_owner -d customer_agent_formal \
  -c "SELECT pg_get_function_arguments(oid) 
      FROM pg_proc 
      WHERE proname = 'authorization_deadline' 
        AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'content_intake');"
```

## 已知角色（截至 2026-10-28）

- `stack_owner` - 超级用户，用于迁移和 DDL
- `stack_backend_worker` - 应用后端角色
- `stack_intake_business` - 内容导入业务逻辑角色

**⚠️ 禁止假设角色名**：`stack_migrator`、`stack_backend_application`、`postgres` 等角色不存在。使用前必须先查询确认。

## 已知 Schema

- `customer_agent_meta` - 迁移元数据和系统表
- `content_intake` - 业务逻辑和领域表

**迁移表位置**：`customer_agent_meta.schema_migrations`  
**迁移 ID 列名**：`migration_id`（不是 `id`）

## 函数签名：authorization_deadline

```sql
-- 实际签名（按位置传参）
authorization_deadline(
  p_principal text,
  p_action text,
  p_scope text,
  p_source text,
  p_at timestamp with time zone
)
```

**⚠️ 只支持位置参数，不支持命名参数。**

```sql
-- ✅ 正确
SELECT authorization_deadline('prin_xxx', 'query', 'shop:123', 'feishu_binding', now());

-- ❌ 错误（会失败）
SELECT authorization_deadline(
  p_principal => 'prin_xxx',
  p_action => 'query',
  p_scope => 'shop:123'
);
```

## 紧急手工修复模板

当需要手工更新生产数据库元数据时：

```bash
# 1. 先记录原值
echo "=== Manual fix $(date -u +%Y-%m-%dT%H:%M:%SZ) ===" | tee -a /var/log/db-manual-fixes.log
psql -h "$PGHOST" -p "$PGPORT" -U stack_owner -d customer_agent_formal -x \
  -c "SELECT * FROM customer_agent_meta.schema_migrations WHERE position = XX;" \
  | tee -a /var/log/db-manual-fixes.log

# 2. 记录 UPDATE 命令
echo "UPDATE customer_agent_meta.schema_migrations SET ..." | tee -a /var/log/db-manual-fixes.log

# 3. 执行
psql -h "$PGHOST" -p "$PGPORT" -U stack_owner -d customer_agent_formal \
  -c "UPDATE customer_agent_meta.schema_migrations SET ..."

# 4. 验证
psql -h "$PGHOST" -p "$PGPORT" -U stack_owner -d customer_agent_formal -x \
  -c "SELECT * FROM customer_agent_meta.schema_migrations WHERE position = XX;"
```

**或更好的做法**：把修复写成可重放的脚本，而不是直接在 psql 里操作。
