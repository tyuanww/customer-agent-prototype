# 客服 Agent 运维手册

**版本**：1.0  
**最后更新**：2026-10-28  
**维护团队**：DevOps & Backend  
**文档位置**：`/docs/runbook/customer-agent-operations-manual.md`

---

## 目录

1. [系统架构概览](#1-系统架构概览)
2. [日常运维](#2-日常运维)
3. [监控和告警](#3-监控和告警)
4. [常见故障处理](#4-常见故障处理)
5. [数据库维护](#5-数据库维护)
6. [备份和恢复](#6-备份和恢复)
7. [性能优化](#7-性能优化)
8. [安全和权限](#8-安全和权限)
9. [发布和部署](#9-发布和部署)
10. [应急响应流程](#10-应急响应流程)

---

## 1. 系统架构概览

### 1.1 核心组件

```
┌─────────────────┐
│  飞书用户/Web    │
└────────┬────────┘
         │
         ↓
┌─────────────────┐
│   API Gateway   │ (apps/api)
│   - 身份验证     │
│   - 路由        │
│   - 限流        │
└────────┬────────┘
         │
         ↓
┌─────────────────┐       ┌─────────────────┐
│  Authorization  │←─────→│   PostgreSQL    │
│  - 授权判断     │       │   - 主体事实     │
│  - 角色管理     │       │   - 授权记录     │
│  - 权限控制     │       │   - 角色规则     │
└────────┬────────┘       └─────────────────┘
         │
         ↓
┌─────────────────┐       ┌─────────────────┐
│  Content Intake │←─────→│  External APIs  │
│  - 内容管理     │       │  - 飞书 API     │
│  - 来源控制     │       │  - 第三方服务   │
│  - 审核流程     │       └─────────────────┘
└─────────────────┘
```

### 1.2 关键数据流

**用户登录和授权流程：**
1. 用户通过飞书 OAuth 登录 → `apps/api/src/middleware/afterLogin.ts`
2. 创建或更新主体记录 → `content_intake.principals`
3. 刷新主体事实（部门、岗位、24 小时有效期）→ `content_intake.principal_facts`
4. 匹配角色规则 → `content_intake.role_rules` + `content_intake.role_ceiling`
5. 签发授权 → `content_intake.grants`
6. 授权判断 → `content_intake.authorization_deadline(principal_id, action, scope, source, now())`

**关键表关系：**
- `principals` (1) ←→ (N) `principal_facts`：一个主体有多个历史事实版本
- `principal_facts.current_facts_version`：指向当前有效的事实版本
- `role_rules` (部门 + 岗位) → `role`：映射到角色
- `role_ceiling.business_actions`：角色允许的动作列表
- `grants`：授权记录（kind, action, scope, source, starts_at, expires_at）

### 1.3 部署环境

| 环境 | 数据库 | API 地址 | 用途 |
|------|--------|----------|------|
| 本地开发 | `customer_agent_dev` | `localhost:3000` | 开发和调试 |
| 测试环境 | `customer_agent_synthetic` | `test-api.example.com` | 集成测试 |
| 杭州生产 | `customer_agent_hangzhou_prod` | `hz-api.example.com` | 杭州区域生产 |
| 北京生产 | `customer_agent_beijing_prod` | `bj-api.example.com` | 北京区域生产（未来） |

---

## 2. 日常运维

### 2.1 每日检查清单

**上午 09:00（工作日）**
```bash
# 1. 查看昨日监控报告
cat logs/auth-metrics-$(date -v-1d +%Y%m%d).json | jq .

# 2. 检查告警记录
tail -50 logs/monitor-cron.log

# 3. 检查数据库连接
psql -h $DB_HOST -p $DB_PORT -d $DB_NAME -U $DB_USER -c "SELECT version();"

# 4. 检查 API 健康
curl -f https://hz-api.example.com/health || echo "API 不健康"

# 5. 检查磁盘空间
df -h | grep -E "Filesystem|/var/log|$HOME/logs"
```

**关键指标基线（杭州生产）：**
- 授权判断延迟：<10ms（P99 <50ms）
- 授权成功率：>95%
- 事实过期率：<5%
- API 响应时间：<200ms（P99 <1s）
- 数据库 CPU：<60%
- 数据库内存：<70%

### 2.2 每周任务

**每周一 10:00**
```bash
# 1. 生成周报
bash scripts/generate-weekly-report.sh

# 2. 复核监控趋势
ls -1 logs/auth-metrics-*.json | tail -7 | \
  xargs jq -s '[.[] | {date: .timestamp[0:10], latency: .metrics.avg_latency_ms}]'

# 3. 检查事实过期趋势
for f in logs/auth-metrics-202610*.json; do
    echo -n "$(basename $f .json | cut -d- -f3): "
    jq -r '.metrics.fact_expiry_rate_percent' $f
done

# 4. 清理临时文件
find /tmp -name "lark-*.json" -mtime +7 -delete

# 5. 数据库统计信息更新
psql -h $DB_HOST -p $DB_PORT -d $DB_NAME -U $DB_USER -c "ANALYZE;"
```

### 2.3 每月任务

**每月 1 号**
```bash
# 1. 备份数据库（见第 6 节）
bash scripts/backup-database.sh

# 2. 日志归档
tar -czf logs-$(date -v-1m +%Y%m).tar.gz logs/auth-metrics-$(date -v-1m +%Y%m)*.json
mv logs-*.tar.gz /backup/logs/

# 3. 更新依赖
cd apps/api && pnpm outdated
cd packages/database && pnpm outdated

# 4. 安全补丁检查
pnpm audit
npm audit fix --force  # 谨慎使用

# 5. 复核监控阈值
vi scripts/monitor-and-alert.sh  # 调整告警阈值
```

---

## 3. 监控和告警

### 3.1 监控系统架构

```
┌─────────────────┐
│  PostgreSQL     │
│  - 授权指标     │
│  - 性能指标     │
└────────┬────────┘
         │
         ↓
┌─────────────────┐
│  monitor-and-   │
│  alert.sh       │
│  - 采样指标     │
│  - 计算告警     │
│  - 发送通知     │
└────────┬────────┘
         │
         ├────────→ 邮件：5DJgDkyjvPY1E@shinemage.cn
         │
         └────────→ 飞书群：customer-agent-health
```

### 3.2 监控指标详解

**授权成功率（Auth Success Rate）**
```sql
-- 计算公式
SELECT 
  (COUNT(*) FILTER (WHERE authorization_deadline(...) IS NOT NULL)::float / COUNT(*)) * 100
FROM content_intake.principals;
```
- **正常范围**：>95%
- **告警阈值**：<95%
- **告警级别**：P1（30 分钟响应）
- **常见原因**：
  - 事实过期（用户长时间未登录）
  - 角色规则缺失
  - 授权记录未签发或已撤销

**授权判断延迟（Authorization Latency）**
```sql
-- 采样 100 次授权判断
EXPLAIN ANALYZE 
SELECT content_intake.authorization_deadline(
  'prin_xxx', 'query', 'scope-xxx', 'src-xxx', now()
);
```
- **正常范围**：<10ms（平均），<50ms（P99）
- **告警阈值**：>50ms（平均）
- **告警级别**：P1（30 分钟响应）
- **常见原因**：
  - 数据库索引失效
  - 主体事实或授权记录膨胀
  - 数据库负载过高

**事实过期率（Fact Expiry Rate）**
```sql
-- 计算公式
SELECT 
  (COUNT(*) FILTER (WHERE valid_until < now())::float / COUNT(*)) * 100
FROM content_intake.principal_facts f
JOIN content_intake.principals p ON p.principal_id = f.principal_id
WHERE f.facts_version = p.current_facts_version;
```
- **正常范围**：<5%
- **告警阈值**：>5%
- **告警级别**：P1（30 分钟响应）
- **常见原因**：
  - 用户长时间未登录
  - 登录流程故障
  - afterLogin 中间件未触发

### 3.3 告警响应流程

**收到告警后：**

1. **确认告警级别和内容**
   - P0（严重）：数据库连接失败、API 完全不可用
   - P1（重要）：授权成功率 <95%、延迟 >50ms、事实过期率 >5%
   - P2（警告）：磁盘使用率 >80%、内存使用率 >80%

2. **快速诊断**
   ```bash
   # 运行诊断脚本
   bash scripts/check-principal-facts.sh
   
   # 查看最新指标
   cat logs/auth-metrics-$(date +%Y%m%d).json | jq .
   
   # 检查数据库连接
   psql -h $DB_HOST -p $DB_PORT -d $DB_NAME -U $DB_USER -c "SELECT COUNT(*) FROM content_intake.principals;"
   ```

3. **参考快速响应手册**
   - **授权成功率低**：见第 4.1 节
   - **授权延迟高**：见第 4.2 节
   - **事实过期**：见第 4.3 节
   - **数据库连接失败**：见第 4.4 节

4. **执行修复措施**（见第 4 节详细步骤）

5. **验证恢复**
   ```bash
   # 再次运行监控
   bash scripts/monitor-and-alert.sh
   
   # 确认指标恢复正常
   cat logs/auth-metrics-$(date +%Y%m%d).json | jq '.metrics'
   ```

6. **通报团队**
   - 在飞书群 `customer-agent-health` 通报
   - 格式：`已解决：<告警类型> | 原因：<根因> | 措施：<解决方案> | 恢复时间：<时间>`

### 3.4 自定义监控

**添加新指标：**

编辑 `scripts/monitor-authorization-metrics.sh`，在 `collect_metrics()` 函数中添加：

```bash
# 新指标：平均授权有效期
avg_grant_duration=$(psql ... -t -A -c "
SELECT AVG(EXTRACT(EPOCH FROM (expires_at - starts_at)) / 86400)::int
FROM content_intake.grants
WHERE revoked_at IS NULL AND expires_at > now();
")

# 添加到 JSON 输出
jq -n \
  --argjson ... \
  --argjson avg_grant_duration "$avg_grant_duration" \
  '{...}'
```

**添加新告警规则：**

编辑 `scripts/monitor-and-alert.sh`，在检查逻辑中添加：

```bash
# 新告警：平均授权有效期 <7 天
AVG_GRANT_DURATION=$(echo "$METRICS_JSON" | jq -r '.metrics.avg_grant_duration')
if [ "$AVG_GRANT_DURATION" -lt 7 ]; then
    alert_triggered=1
    alert_messages+=("告警: 平均授权有效期过短: ${AVG_GRANT_DURATION}天 < 7天")
fi
```

---

## 4. 常见故障处理

### 4.1 授权成功率低（<95%）

**症状：**
- 监控显示 `auth_success_rate_percent < 95`
- 用户反馈"没有权限"或"无法查询"

**诊断步骤：**

1. **检查事实过期情况**
   ```bash
   bash scripts/check-principal-facts.sh
   ```

2. **检查角色规则覆盖**
   ```sql
   -- 查找没有匹配角色规则的主体
   SELECT 
     p.principal_id,
     p.user_id,
     f.department_ids,
     f.job_id,
     (SELECT COUNT(*) 
      FROM content_intake.role_rules r
      WHERE r.tenant_id = p.tenant_id
        AND r.app_id = p.app_id
        AND r.department_id = ANY(f.department_ids)
        AND r.job_id = f.job_id) AS matching_rules
   FROM content_intake.principals p
   JOIN content_intake.principal_facts f
     ON f.principal_id = p.principal_id
     AND f.facts_version = p.current_facts_version
   WHERE f.enabled
     AND now() < f.valid_until
   HAVING matching_rules = 0;
   ```

3. **检查授权记录**
   ```sql
   -- 查找没有有效授权的主体
   SELECT 
     p.principal_id,
     p.user_id,
     (SELECT COUNT(*)
      FROM content_intake.grants g
      WHERE g.recipient_id = p.principal_id
        AND g.revoked_at IS NULL
        AND g.starts_at <= now()
        AND now() < g.expires_at) AS active_grants
   FROM content_intake.principals p
   HAVING active_grants = 0;
   ```

**解决方案：**

**方案 A：事实过期（最常见）**
```bash
# 通知用户重新登录
# 或手动刷新事实（紧急情况）
bash scripts/refresh-principal-facts.sh <principal_id>
```

**方案 B：角色规则缺失**
```sql
-- 添加缺失的角色规则
INSERT INTO content_intake.role_rules (
  tenant_id, app_id, department_id, job_id, policy_version, role
) VALUES (
  'tenant-menokin',
  'app-customer-agent',
  '<缺失的部门 ID>',
  '<缺失的岗位 ID>',
  1,
  '<对应的角色>'
);
```

**方案 C：授权未签发**
```sql
-- 检查签发逻辑
-- 通常由 backend_identity.create_seat 自动签发
-- 或手动签发授权
INSERT INTO content_intake.grants (
  grant_id, kind, issuer_id, recipient_id,
  tenant_id, app_id, scope_id, source_id, action,
  starts_at, expires_at, reason, steward_id, policy_version
) VALUES (
  'grant_manual_' || encode(sha256(convert_to(now()::text, 'UTF8')), 'hex'),
  'business',
  'synthetic_owner',
  '<主体 ID>',
  'tenant-menokin',
  'app-customer-agent',
  '<范围 ID>',
  '<来源 ID>',
  'query',
  now(),
  now() + interval '30 days',
  '手动签发授权',
  'synthetic_owner',
  1
);
```

### 4.2 授权判断延迟高（>50ms）

**症状：**
- 监控显示 `avg_latency_ms > 50`
- API 响应缓慢
- 用户反馈页面加载慢

**诊断步骤：**

1. **分析慢查询**
   ```sql
   -- 开启查询日志
   ALTER SYSTEM SET log_min_duration_statement = 100;  -- 记录 >100ms 的查询
   SELECT pg_reload_conf();
   
   -- 查看慢查询
   \! tail -100 /var/log/postgresql/postgresql-*.log | grep "duration:"
   ```

2. **检查索引使用**
   ```sql
   EXPLAIN ANALYZE
   SELECT content_intake.authorization_deadline(
     'prin_xxx',
     'query',
     'scope-menokin-product',
     'src-menokin-faq',
     now()
   );
   ```

3. **检查数据库统计**
   ```sql
   -- 检查表膨胀
   SELECT 
     schemaname, tablename,
     pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size,
     n_live_tup, n_dead_tup,
     ROUND(100 * n_dead_tup / NULLIF(n_live_tup + n_dead_tup, 0), 2) AS dead_ratio
   FROM pg_stat_user_tables
   WHERE schemaname = 'content_intake'
   ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
   ```

**解决方案：**

**方案 A：索引缺失或失效**
```sql
-- 重建索引
REINDEX TABLE content_intake.principal_facts;
REINDEX TABLE content_intake.grants;
REINDEX TABLE content_intake.role_rules;

-- 添加缺失的索引（如果需要）
CREATE INDEX CONCURRENTLY idx_grants_recipient_action_scope
  ON content_intake.grants (recipient_id, action, scope_id)
  WHERE revoked_at IS NULL;
```

**方案 B：数据膨胀**
```sql
-- 手动 VACUUM
VACUUM FULL ANALYZE content_intake.principal_facts;
VACUUM FULL ANALYZE content_intake.grants;

-- 或启用自动 VACUUM（推荐）
ALTER TABLE content_intake.principal_facts
  SET (autovacuum_vacuum_scale_factor = 0.1);
```

**方案 C：查询计划缓存失效**
```sql
-- 清理查询计划缓存
DISCARD PLANS;

-- 重新分析统计信息
ANALYZE content_intake.principals;
ANALYZE content_intake.principal_facts;
ANALYZE content_intake.grants;
ANALYZE content_intake.role_rules;
ANALYZE content_intake.role_ceiling;
```

### 4.3 事实过期率高（>5%）

**症状：**
- 监控显示 `fact_expiry_rate_percent > 5`
- 多个用户反馈"没有权限"
- 授权成功率同时下降

**诊断步骤：**

1. **查看过期事实分布**
   ```sql
   SELECT 
     COUNT(*) AS expired_count,
     MIN(valid_until) AS earliest_expiry,
     MAX(valid_until) AS latest_expiry,
     AVG(EXTRACT(EPOCH FROM (now() - valid_until)) / 3600)::int AS avg_hours_expired
   FROM content_intake.principal_facts f
   JOIN content_intake.principals p ON p.principal_id = f.principal_id
   WHERE f.facts_version = p.current_facts_version
     AND f.valid_until < now();
   ```

2. **检查登录频率**
   ```sql
   -- 查看最近登录时间
   SELECT 
     p.principal_id,
     p.user_id,
     f.checked_at AS last_login,
     f.valid_until,
     EXTRACT(EPOCH FROM (now() - f.checked_at)) / 3600 AS hours_since_login
   FROM content_intake.principals p
   JOIN content_intake.principal_facts f
     ON f.principal_id = p.principal_id
     AND f.facts_version = p.current_facts_version
   WHERE f.valid_until < now()
   ORDER BY f.checked_at DESC
   LIMIT 20;
   ```

3. **检查 afterLogin 中间件**
   ```bash
   # 查看 API 日志
   tail -100 /var/log/customer-agent-api/api.log | grep "afterLogin"
   
   # 检查中间件是否正常触发
   curl -f https://hz-api.example.com/auth/callback
   ```

**解决方案：**

**方案 A：用户长时间未登录（正常）**
```bash
# 通知用户重新登录
# 或批量刷新事实（谨慎使用）
for principal_id in $(psql ... -t -A -c "SELECT principal_id FROM ..."); do
    bash scripts/refresh-principal-facts.sh "$principal_id"
done
```

**方案 B：登录流程故障**
```bash
# 1. 检查 afterLogin 中间件配置
cat apps/api/src/middleware/afterLogin.ts

# 2. 检查飞书 API 连接
curl -f https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal

# 3. 重启 API 服务
pm2 restart customer-agent-api
```

**方案 C：数据库写入失败**
```sql
-- 检查数据库权限
SELECT has_table_privilege('stack_owner', 'content_intake.principal_facts', 'INSERT');

-- 检查约束违反
SELECT * FROM pg_constraint WHERE conrelid = 'content_intake.principal_facts'::regclass;

-- 检查最近的错误
SELECT * FROM pg_stat_database_conflicts WHERE datname = current_database();
```

### 4.4 数据库连接失败

**症状：**
- 监控脚本报错"数据库连接失败"
- API 返回 500 错误
- 应用日志显示 `ECONNREFUSED` 或 `ETIMEDOUT`

**诊断步骤：**

1. **检查数据库进程**
   ```bash
   # 检查 PostgreSQL 进程
   ps aux | grep postgres
   
   # 检查端口监听
   lsof -i :$DB_PORT
   netstat -an | grep $DB_PORT
   ```

2. **检查数据库日志**
   ```bash
   # macOS
   tail -100 /usr/local/var/log/postgresql@15/*.log
   
   # Linux
   tail -100 /var/log/postgresql/postgresql-15-main.log
   ```

3. **手动测试连接**
   ```bash
   psql -h $DB_HOST -p $DB_PORT -d $DB_NAME -U $DB_USER -c "SELECT 1;"
   ```

**解决方案：**

**方案 A：数据库进程挂掉**
```bash
# macOS
brew services restart postgresql@15

# Linux
sudo systemctl restart postgresql

# 或手动启动
pg_ctl -D /usr/local/var/postgresql@15 start
```

**方案 B：连接数耗尽**
```sql
-- 查看当前连接数
SELECT COUNT(*) FROM pg_stat_activity WHERE datname = current_database();

-- 查看最大连接数
SHOW max_connections;

-- 终止空闲连接
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = current_database()
  AND state = 'idle'
  AND state_change < now() - interval '1 hour';

-- 或增加最大连接数（需要重启）
ALTER SYSTEM SET max_connections = 200;
SELECT pg_reload_conf();
```

**方案 C：网络问题**
```bash
# 检查防火墙
sudo iptables -L -n | grep $DB_PORT

# 检查 pg_hba.conf
cat /usr/local/var/postgresql@15/pg_hba.conf | grep -v "^#"

# 添加允许规则
echo "host all all 0.0.0.0/0 md5" | sudo tee -a /usr/local/var/postgresql@15/pg_hba.conf
sudo systemctl reload postgresql
```

---

## 5. 数据库维护

### 5.1 日常维护

**每日自动任务（通过 crontab）：**
```bash
# 自动 VACUUM（PostgreSQL 默认开启）
# 检查配置
psql -h $DB_HOST -p $DB_PORT -d $DB_NAME -U $DB_USER -c "SHOW autovacuum;"

# 手动触发（如果需要）
VACUUM ANALYZE content_intake.principal_facts;
VACUUM ANALYZE content_intake.grants;
```

**每周手动任务：**
```bash
# 1. 检查表膨胀
psql ... -c "
SELECT schemaname, tablename,
  pg_size_pretty(pg_total_relation_size(...)) AS size,
  n_dead_tup
FROM pg_stat_user_tables
WHERE schemaname = 'content_intake'
ORDER BY n_dead_tup DESC;
"

# 2. 重建索引（如果需要）
psql ... -c "REINDEX TABLE CONCURRENTLY content_intake.principal_facts;"

# 3. 更新统计信息
psql ... -c "ANALYZE;"
```

### 5.2 迁移管理

**查看当前迁移状态：**
```bash
# 查看已应用的迁移
psql ... -c "
SELECT migration_id, applied_at 
FROM database_migrations.migration_log 
ORDER BY applied_at DESC 
LIMIT 10;
"

# 查看最新迁移文件
ls -lt packages/database/migrations/*.sql | head -5
```

**应用新迁移：**
```bash
# 1. 生成迁移（如果需要）
cd packages/database
pnpm run generate-migration

# 2. 检查迁移内容
cat migrations/0076_new_feature.sql

# 3. 在测试环境验证
psql -h test-db -p 5432 -d customer_agent_synthetic -U stack_owner -f migrations/0076_new_feature.sql

# 4. 应用到生产
psql -h $DB_HOST -p $DB_PORT -d $DB_NAME -U $DB_USER -f migrations/0076_new_feature.sql
```

**回滚迁移（紧急情况）：**
```bash
# 1. 查看迁移内容，确认可回滚
cat migrations/0076_new_feature.sql

# 2. 手动反转更改
psql ... -c "DROP FUNCTION content_intake.new_function();"

# 3. 记录回滚
psql ... -c "
INSERT INTO database_migrations.migration_rollback_log (
  migration_id, rolled_back_at, reason
) VALUES ('0076', now(), '紧急回滚：发现关键 bug');
"
```

### 5.3 性能调优

**慢查询分析：**
```sql
-- 开启慢查询日志
ALTER SYSTEM SET log_min_duration_statement = 500;  -- 记录 >500ms 的查询
SELECT pg_reload_conf();

-- 查看最慢的查询
SELECT 
  query,
  calls,
  total_exec_time,
  mean_exec_time,
  max_exec_time
FROM pg_stat_statements
WHERE query LIKE '%authorization_deadline%'
ORDER BY mean_exec_time DESC
LIMIT 10;
```

**索引优化：**
```sql
-- 查找缺失的索引
SELECT 
  schemaname,
  tablename,
  attname,
  null_frac,
  n_distinct
FROM pg_stats
WHERE schemaname = 'content_intake'
  AND tablename IN ('principal_facts', 'grants', 'role_rules')
  AND n_distinct > 100  -- 高基数列
  AND null_frac < 0.5;  -- 非空值较多

-- 检查索引使用情况
SELECT 
  schemaname,
  tablename,
  indexname,
  idx_scan,
  idx_tup_read,
  idx_tup_fetch
FROM pg_stat_user_indexes
WHERE schemaname = 'content_intake'
ORDER BY idx_scan ASC;  -- 低扫描次数 = 可能不需要

-- 删除未使用的索引
DROP INDEX IF EXISTS content_intake.idx_unused_index;
```

---

## 6. 备份和恢复

### 6.1 备份策略

**每日增量备份（推荐）：**
```bash
#!/bin/bash
# scripts/backup-database.sh

BACKUP_DIR="/backup/customer-agent"
DATE=$(date +%Y%m%d-%H%M%S)
DB_NAME="customer_agent_hangzhou_prod"

# 1. 全量备份
pg_dump -h $DB_HOST -p $DB_PORT -U $DB_USER -Fc \
  -f "$BACKUP_DIR/full-$DATE.dump" $DB_NAME

# 2. 只备份关键表（更快）
pg_dump -h $DB_HOST -p $DB_PORT -U $DB_USER -Fc \
  -t content_intake.principals \
  -t content_intake.principal_facts \
  -t content_intake.grants \
  -t content_intake.role_rules \
  -f "$BACKUP_DIR/critical-$DATE.dump" $DB_NAME

# 3. 压缩并上传到 S3（可选）
gzip "$BACKUP_DIR/full-$DATE.dump"
aws s3 cp "$BACKUP_DIR/full-$DATE.dump.gz" \
  s3://customer-agent-backups/hangzhou/

# 4. 清理 30 天前的备份
find "$BACKUP_DIR" -name "*.dump*" -mtime +30 -delete
```

**定时任务（每天 02:00）：**
```bash
# 添加到 crontab
0 2 * * * bash /path/to/scripts/backup-database.sh >> /var/log/backup.log 2>&1
```

### 6.2 恢复流程

**场景 A：数据误删除（部分表恢复）**
```bash
# 1. 停止应用（防止数据继续变化）
pm2 stop customer-agent-api

# 2. 恢复指定表
pg_restore -h $DB_HOST -p $DB_PORT -U $DB_USER \
  -d $DB_NAME \
  -t content_intake.grants \
  --clean \
  /backup/customer-agent/critical-20261028-020000.dump

# 3. 验证数据
psql ... -c "SELECT COUNT(*) FROM content_intake.grants;"

# 4. 重启应用
pm2 start customer-agent-api
```

**场景 B：整库损坏（全量恢复）**
```bash
# 1. 创建新数据库
createdb -h $DB_HOST -p $DB_PORT -U postgres customer_agent_hangzhou_prod_restore

# 2. 恢复数据
pg_restore -h $DB_HOST -p $DB_PORT -U $DB_USER \
  -d customer_agent_hangzhou_prod_restore \
  /backup/customer-agent/full-20261028-020000.dump

# 3. 验证数据完整性
psql ... -c "SELECT COUNT(*) FROM content_intake.principals;"
psql ... -c "SELECT MAX(applied_at) FROM database_migrations.migration_log;"

# 4. 切换数据库（在配置中修改数据库名）
vi apps/api/.env
# CUSTOMER_AGENT_DB_NAME=customer_agent_hangzhou_prod_restore

# 5. 重启应用
pm2 restart customer-agent-api

# 6. 验证业务功能
curl -f https://hz-api.example.com/health
```

**场景 C：时间点恢复（PITR）**
```bash
# 需要启用 WAL 归档
# postgresql.conf:
# wal_level = replica
# archive_mode = on
# archive_command = 'cp %p /backup/wal_archive/%f'

# 1. 基础备份
pg_basebackup -h $DB_HOST -p $DB_PORT -U $DB_USER \
  -D /backup/base -Ft -z -P

# 2. 恢复到指定时间点
# recovery.conf:
# restore_command = 'cp /backup/wal_archive/%f %p'
# recovery_target_time = '2026-10-28 14:30:00+08'

# 3. 启动数据库
pg_ctl -D /backup/base start
```

### 6.3 灾难恢复演练

**每季度执行一次：**
```bash
# 1. 在隔离环境恢复备份
bash scripts/disaster-recovery-drill.sh

# 2. 验证关键功能
bash scripts/verify-restored-database.sh

# 3. 记录演练结果
echo "演练时间: $(date)" >> docs/disaster-recovery-log.md
echo "恢复耗时: XX 分钟" >> docs/disaster-recovery-log.md
echo "数据完整性: 通过/失败" >> docs/disaster-recovery-log.md
```

---

## 7. 性能优化

### 7.1 数据库优化

**连接池配置（apps/api/src/db/pool.ts）：**
```typescript
const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: 20,                    // 最大连接数
  idleTimeoutMillis: 30000,   // 空闲超时 30 秒
  connectionTimeoutMillis: 5000, // 连接超时 5 秒
  statement_timeout: 10000    // 查询超时 10 秒
});
```

**查询优化：**
```sql
-- 使用准备语句（减少解析开销）
PREPARE auth_check (text, text, text, text) AS
  SELECT content_intake.authorization_deadline($1, $2, $3, $4, now());

EXECUTE auth_check('prin_xxx', 'query', 'scope-xxx', 'src-xxx');

-- 批量查询（减少往返次数）
SELECT 
  principal_id,
  content_intake.authorization_deadline(principal_id, 'query', 'scope-xxx', 'src-xxx', now())
FROM content_intake.principals
WHERE principal_id = ANY($1);  -- 一次查询多个主体
```

**缓存策略：**
```typescript
// apps/api/src/cache/authorization-cache.ts
import Redis from 'ioredis';

const redis = new Redis({
  host: process.env.REDIS_HOST,
  port: parseInt(process.env.REDIS_PORT || '6379'),
});

// 缓存授权结果（5 分钟）
async function getAuthorizationDeadline(
  principalId: string,
  action: string,
  scope: string,
  source: string
): Promise<Date | null> {
  const cacheKey = `auth:${principalId}:${action}:${scope}:${source}`;
  
  // 1. 尝试从缓存读取
  const cached = await redis.get(cacheKey);
  if (cached) {
    return new Date(cached);
  }
  
  // 2. 从数据库查询
  const result = await pool.query(
    'SELECT content_intake.authorization_deadline($1, $2, $3, $4, now())',
    [principalId, action, scope, source]
  );
  
  const deadline = result.rows[0]?.authorization_deadline;
  
  // 3. 写入缓存（5 分钟）
  if (deadline) {
    await redis.setex(cacheKey, 300, deadline.toISOString());
  }
  
  return deadline;
}
```

### 7.2 API 优化

**请求批处理：**
```typescript
// apps/api/src/routes/batch-authorization.ts
router.post('/api/batch/authorization', async (req, res) => {
  const { principals, action, scope, source } = req.body;
  
  // 一次查询检查多个主体
  const results = await pool.query(
    `SELECT 
       principal_id,
       content_intake.authorization_deadline(principal_id, $1, $2, $3, now()) AS deadline
     FROM content_intake.principals
     WHERE principal_id = ANY($4)`,
    [action, scope, source, principals]
  );
  
  res.json(results.rows);
});
```

**响应压缩：**
```typescript
// apps/api/src/app.ts
import compression from 'compression';

app.use(compression({
  level: 6,  // 压缩级别
  threshold: 1024,  // 只压缩 >1KB 的响应
}));
```

### 7.3 监控性能指标

**应用性能指标：**
```bash
# 使用 pm2 监控
pm2 monit

# 或导出指标到 Prometheus
pm2 install pm2-prometheus-exporter
```

**数据库性能指标：**
```sql
-- 每秒事务数（TPS）
SELECT 
  xact_commit + xact_rollback AS tps
FROM pg_stat_database
WHERE datname = current_database();

-- 缓冲区命中率
SELECT 
  ROUND(100.0 * blks_hit / NULLIF(blks_hit + blks_read, 0), 2) AS buffer_hit_ratio
FROM pg_stat_database
WHERE datname = current_database();

-- 活跃连接数
SELECT state, COUNT(*) 
FROM pg_stat_activity
GROUP BY state;
```

---

## 8. 安全和权限

### 8.1 数据库安全

**最小权限原则：**
```sql
-- 应用用户只需要 CRUD 权限
CREATE ROLE customer_agent_app LOGIN PASSWORD 'strong_password';

-- 授予必要的权限
GRANT CONNECT ON DATABASE customer_agent_hangzhou_prod TO customer_agent_app;
GRANT USAGE ON SCHEMA content_intake TO customer_agent_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA content_intake TO customer_agent_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA content_intake TO customer_agent_app;

-- 禁止 DDL 操作
REVOKE CREATE ON SCHEMA content_intake FROM customer_agent_app;
```

**审计日志：**
```sql
-- 开启审计日志
ALTER SYSTEM SET log_statement = 'ddl';  -- 记录所有 DDL
ALTER SYSTEM SET log_min_duration_statement = 1000;  -- 记录 >1s 的查询
SELECT pg_reload_conf();

-- 查看最近的 DDL 操作
\! tail -100 /var/log/postgresql/*.log | grep "CREATE\|ALTER\|DROP"
```

**敏感数据保护：**
```sql
-- 加密敏感字段（如果需要）
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 示例：加密用户邮箱
ALTER TABLE content_intake.principals 
ADD COLUMN email_encrypted bytea;

UPDATE content_intake.principals
SET email_encrypted = pgp_sym_encrypt(email, 'encryption_key');
```

### 8.2 应用安全

**环境变量管理：**
```bash
# 使用 .env 文件（不要提交到 Git）
# apps/api/.env
CUSTOMER_AGENT_DB_HOST=localhost
CUSTOMER_AGENT_DB_PORT=5432
CUSTOMER_AGENT_DB_NAME=customer_agent_hangzhou_prod
CUSTOMER_AGENT_DB_USER=customer_agent_app
CUSTOMER_AGENT_DB_PASSWORD=strong_password

# 生产环境使用密钥管理服务
# AWS Secrets Manager、HashiCorp Vault 等
```

**API 认证和授权：**
```typescript
// apps/api/src/middleware/auth.ts
import jwt from 'jsonwebtoken';

export function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}
```

**限流和防护：**
```typescript
// apps/api/src/middleware/rate-limit.ts
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 分钟
  max: 100,  // 限制 100 次请求
  message: 'Too many requests, please try again later',
});

app.use('/api/', limiter);
```

---

## 9. 发布和部署

### 9.1 部署流程

**标准发布流程：**
```bash
# 1. 代码构建
cd apps/api
pnpm install
pnpm run build

# 2. 运行测试
pnpm run test
pnpm run test:integration

# 3. 构建 Docker 镜像（如果使用 Docker）
docker build -t customer-agent-api:1.0.0 .

# 4. 推送到镜像仓库
docker push customer-agent-api:1.0.0

# 5. 部署到服务器
ssh deploy@hz-prod-01
cd /opt/customer-agent-api
git pull origin main
pnpm install
pm2 reload customer-agent-api

# 6. 健康检查
curl -f https://hz-api.example.com/health
bash scripts/monitor-authorization-metrics.sh
```

### 9.2 数据库迁移部署

**迁移部署检查清单：**
```bash
# 1. 备份数据库
bash scripts/backup-database.sh

# 2. 在测试环境验证
psql -h test-db -d customer_agent_synthetic -U stack_owner \
  -f packages/database/migrations/0076_new_feature.sql

# 3. 检查迁移内容
cat packages/database/migrations/0076_new_feature.sql
# - 是否向后兼容？
# - 是否有破坏性更改？
# - 是否需要停机？

# 4. 通知团队（如果需要停机）
cat > /tmp/maintenance-notice.txt << EOF
【系统维护通知】
时间：$(date '+%Y-%m-%d %H:%M')
内容：数据库迁移 0076
预计时长：10 分钟
影响：API 短暂不可用
EOF
mail -s "[维护通知] 数据库迁移" 5DJgDkyjvPY1E@shinemage.cn < /tmp/maintenance-notice.txt

# 5. 停止应用（如果需要）
pm2 stop customer-agent-api

# 6. 应用迁移
psql -h $DB_HOST -p $DB_PORT -d $DB_NAME -U $DB_USER \
  -f packages/database/migrations/0076_new_feature.sql

# 7. 验证迁移
psql ... -c "SELECT * FROM database_migrations.migration_log WHERE migration_id = '0076';"

# 8. 重启应用
pm2 start customer-agent-api

# 9. 健康检查
curl -f https://hz-api.example.com/health
bash scripts/monitor-authorization-metrics.sh

# 10. 通知团队完成
echo "迁移完成，服务已恢复" | \
  mail -s "[维护完成] 数据库迁移" 5DJgDkyjvPY1E@shinemage.cn
```

### 9.3 回滚预案

**代码回滚：**
```bash
# 1. 回滚到上一个版本
pm2 stop customer-agent-api
git reset --hard HEAD~1
pnpm install
pm2 start customer-agent-api

# 2. 或使用 Git 标签回滚
git checkout v1.0.0
pnpm install
pm2 restart customer-agent-api
```

**数据库回滚：**
```bash
# 1. 停止应用
pm2 stop customer-agent-api

# 2. 反转迁移（手动编写反向 SQL）
psql ... -c "DROP FUNCTION content_intake.new_function();"

# 3. 或从备份恢复
pg_restore -h $DB_HOST -p $DB_PORT -U $DB_USER \
  -d $DB_NAME \
  --clean \
  /backup/customer-agent/full-$(date -v-1d +%Y%m%d)-020000.dump

# 4. 重启应用
pm2 start customer-agent-api
```

---

## 10. 应急响应流程

### 10.1 严重故障（P0）

**定义：**
- 数据库完全不可用
- API 完全不可用
- 数据丢失或损坏
- 安全漏洞被利用

**响应时间：** 5 分钟

**处理流程：**
```bash
# 1. 立即通知团队（飞书群 + 电话）
echo "P0 告警: 数据库不可用" | \
  lark-cli im +messages-send --chat-id $CHAT_ID --text -

# 2. 启动应急预案
bash scripts/emergency-response-p0.sh

# 3. 快速诊断
bash scripts/quick-diagnosis.sh

# 4. 根据诊断结果执行修复
# 选项 A: 重启服务
# 选项 B: 切换到备用数据库
# 选项 C: 从备份恢复

# 5. 持续监控直到恢复
while true; do
    bash scripts/monitor-and-alert.sh
    sleep 60
done

# 6. 事后总结
bash scripts/generate-incident-report.sh
```

### 10.2 重要故障（P1）

**定义：**
- 授权成功率 <95%
- 授权延迟 >50ms
- 事实过期率 >5%
- API 部分功能不可用

**响应时间：** 30 分钟

**处理流程：**
1. 查看第 4 节对应的故障处理步骤
2. 执行诊断和修复
3. 验证恢复
4. 在飞书群通报

### 10.3 警告（P2）

**定义：**
- 磁盘使用率 >80%
- 内存使用率 >80%
- 慢查询增多
- 监控指标异常但未超阈值

**响应时间：** 工作时间内处理

**处理流程：**
1. 记录问题
2. 计划维护窗口
3. 执行优化措施
4. 更新文档

---

## 11. 联系方式

**团队：**
- DevOps：5DJgDkyjvPY1E@shinemage.cn
- 飞书群：customer-agent-health

**紧急联系：**
- P0 故障：立即电话 + 飞书群通知
- P1 故障：飞书群通知
- P2 警告：邮件通知

**文档位置：**
- 本手册：`docs/runbook/customer-agent-operations-manual.md`
- 快速响应手册：`docs/runbook/authorization-incident-response.md`
- 监控安装指南：`docs/monitoring-installation-guide.md`
- 部署清单：`docs/deployment-checklist-0074-0075.md`

**飞书文件夹：**
- https://shinemage.feishu.cn/drive/folder/SQf1fvnGPlUEeGdZSeacNUOfnoh

---

**版本历史：**
- 1.0 (2026-10-28)：初始版本，覆盖迁移 0074/0075 部署后的运维需求
