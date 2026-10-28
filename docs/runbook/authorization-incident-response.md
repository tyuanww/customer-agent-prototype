# 授权系统故障快速响应手册

**目标读者：** 运维、开发团队  
**用途：** 授权监控告警触发时的快速诊断和响应

---

## 一、告警分类和紧急度

### 🔴 P0 - 严重故障（立即响应）
- **授权判断大面积失败**（成功率 <50%）
- **数据库连接失败**
- **所有主体无法登录**

**响应时间：** 5 分钟内  
**升级：** 立即通知 on-call 团队

### 🟡 P1 - 重要告警（30 分钟内响应）
- **授权成功率低于 95%**
- **授权判断延迟超过 50ms**
- **事实过期率超过 5%**

**响应时间：** 30 分钟内  
**升级：** 1 小时内未解决，通知技术负责人

### 🟢 P2 - 警告（工作时间内响应）
- **Engineer 角色主体数异常增长**
- **角色规则缺失**
- **通配符授权数量异常**

---

## 二、快速诊断流程

### 步骤 1: 确认告警真实性（1 分钟）

```bash
# 1. 检查数据库连接
psql -h $DB_HOST -p $DB_PORT -d $DB_NAME -U $DB_USER -c "SELECT 1"

# 2. 检查监控脚本是否正常
bash scripts/monitor-authorization-metrics.sh | head -50

# 3. 查看最新指标
cat /var/log/customer-agent/auth-metrics-$(date +%Y%m%d).json
```

**预期结果：**
- 数据库连接成功
- 监控脚本正常输出
- 指标文件存在且格式正确

**如果失败：** 可能是监控系统本身的问题，跳到"监控系统故障"章节

### 步骤 2: 定位故障范围（2 分钟）

```bash
# 1. 检查有效主体数量
psql ... -c "
SELECT count(*) AS total,
       count(*) FILTER (WHERE now() < f.valid_until) AS valid,
       count(*) FILTER (WHERE now() >= f.valid_until) AS expired
FROM content_intake.principals p
JOIN content_intake.principal_facts f
  ON f.principal_id = p.principal_id
  AND f.facts_version = p.current_facts_version;
"

# 2. 检查有效授权数量
psql ... -c "
SELECT action, count(*) FROM content_intake.grants
WHERE kind = 'business'
  AND revoked_at IS NULL
  AND now() BETWEEN starts_at AND expires_at
GROUP BY action;
"

# 3. 检查角色规则
psql ... -c "
SELECT role, count(*) FROM content_intake.role_rules
GROUP BY role;
"
```

**判断标准：**
- **主体问题：** 有效主体数为 0 或大量过期
- **授权问题：** 授权数量为 0 或大量撤销
- **角色问题：** 角色规则缺失或不匹配

### 步骤 3: 确认影响范围（1 分钟）

```bash
# 1. 抽样测试授权判断
bash scripts/test-engineer-authorization.sh <principal_id>

# 2. 检查应用日志
tail -100 /var/log/api.log | grep -i "authorization\|principal\|grant"

# 3. 检查最近的部署或变更
git log --oneline --since="1 day ago" packages/database/
```

**关键问题：**
- 影响所有用户还是特定角色？
- 影响所有动作还是特定动作（query, import, publish）？
- 是否有最近的迁移或配置变更？

---

## 三、常见故障和解决方案

### 故障 1: 授权判断大面积失败

**症状：**
- 授权成功率 <50%
- 用户无法访问任何资源
- `authorization_deadline` 返回 NULL

**可能原因：**
1. 主体事实大量过期（超过 24 小时未登录）
2. 授权记录被误撤销
3. 角色规则缺失或配置错误
4. `authorization_deadline` 函数被错误修改

**诊断：**
```bash
# 1. 检查事实有效期
psql ... -c "
SELECT
  count(*) FILTER (WHERE now() < f.valid_until) AS valid,
  count(*) FILTER (WHERE now() >= f.valid_until) AS expired
FROM content_intake.principals p
JOIN content_intake.principal_facts f USING (principal_id);
"

# 2. 检查授权记录
psql ... -c "
SELECT
  count(*) FILTER (WHERE revoked_at IS NULL) AS active,
  count(*) FILTER (WHERE revoked_at IS NOT NULL) AS revoked
FROM content_intake.grants
WHERE kind = 'business';
"

# 3. 检查 authorization_deadline 函数
psql ... -c "
SELECT prosrc FROM pg_proc
WHERE proname = 'authorization_deadline'
  AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'content_intake');
" | grep -E "role_ceiling|source_id IS NULL"
```

**解决方案：**

**A. 如果事实过期：**
```bash
# 方案 1: 要求用户重新登录（推荐）
# 用户登录后会自动刷新事实（24 小时有效期）

# 方案 2: 手动刷新特定主体的事实（紧急情况）
psql ... -f scripts/refresh-principal-facts.sql <principal_id>
```

**B. 如果授权被误撤销：**
```bash
# 检查最近的撤销操作
psql ... -c "
SELECT grant_id, action, revoked_at, reason
FROM content_intake.grants
WHERE revoked_at > now() - interval '1 day'
ORDER BY revoked_at DESC
LIMIT 10;
"

# 如果确认误操作，联系数据库管理员手动恢复
# 注意：这需要数据库管理员权限，不要自己尝试
```

**C. 如果角色规则缺失：**
```bash
# 检查缺失的角色规则
psql ... -c "
SELECT DISTINCT f.department_ids, f.job_id
FROM content_intake.principals p
JOIN content_intake.principal_facts f USING (principal_id)
WHERE NOT EXISTS (
  SELECT 1 FROM content_intake.role_rules r
  WHERE r.department_id = ANY(f.department_ids)
    AND r.job_id = f.job_id
);
"

# 联系管理员补充角色规则
# 参考: docs/guides/grant-engineer-permissions.md
```

**D. 如果函数被错误修改：**
```bash
# 回滚到正确的版本
cd packages/database
git log --oneline overlays/007*.sql
git show <commit>:overlays/0074_authorization_deadline_engineer.sql > /tmp/0074.sql
git show <commit>:overlays/0075_authorization_deadline_source_null.sql > /tmp/0075.sql

# 重新应用迁移
psql ... -f /tmp/0074.sql
psql ... -f /tmp/0075.sql

# 验证
bash scripts/test-engineer-authorization.sh <principal_id>
```

### 故障 2: 授权判断延迟过高

**症状：**
- P99 延迟 >50ms
- 用户体验卡顿
- 数据库 CPU 使用率高

**可能原因：**
1. 授权记录数量激增
2. 缺少必要的索引
3. 通配符授权数量过多
4. 数据库资源不足

**诊断：**
```bash
# 1. 执行计划分析
psql ... -c "
EXPLAIN (ANALYZE, BUFFERS)
SELECT content_intake.authorization_deadline(
  '<principal_id>', 'query', '<scope_id>', '<source_id>', now()
);
"

# 2. 检查授权记录数量
psql ... -c "
SELECT
  source_id IS NULL AS is_wildcard,
  count(*)
FROM content_intake.grants
WHERE kind = 'business' AND revoked_at IS NULL
GROUP BY is_wildcard;
"

# 3. 检查索引健康度
psql ... -c "
SELECT schemaname, tablename, indexname, idx_scan, idx_tup_read, idx_tup_fetch
FROM pg_stat_user_indexes
WHERE schemaname = 'content_intake'
  AND tablename IN ('grants', 'principals', 'principal_facts', 'role_rules')
ORDER BY idx_scan DESC;
"
```

**解决方案：**

**A. 如果授权记录激增：**
```bash
# 清理过期授权（需要管理员权限）
psql ... -c "
DELETE FROM content_intake.grants
WHERE expires_at < now() - interval '30 days';
"

# 或者标记为已撤销
psql ... -c "
UPDATE content_intake.grants
SET revoked_at = now()
WHERE expires_at < now() - interval '30 days'
  AND revoked_at IS NULL;
"
```

**B. 如果缺少索引：**
```bash
# 检查建议的索引
psql ... -c "
SELECT *
FROM pg_stat_statements
WHERE query LIKE '%authorization_deadline%'
ORDER BY total_exec_time DESC
LIMIT 5;
"

# 如果需要添加索引，联系数据库管理员
# 参考: packages/database/migrations/0026_intake_source_grant_index.sql
```

**C. 如果通配符授权过多：**
```bash
# 将通配符授权改为精确授权
# 这需要业务评估和管理员操作，不要自己尝试
```

### 故障 3: 数据库连接失败

**症状：**
- 监控脚本无法连接数据库
- 应用日志显示连接超时
- `psql` 命令失败

**可能原因：**
1. 数据库进程未运行
2. 连接池耗尽
3. 网络问题
4. 权限问题

**诊断：**
```bash
# 1. 检查数据库进程
ps aux | grep postgres

# 2. 检查端口监听
lsof -i :$DB_PORT

# 3. 检查连接数
psql ... -c "
SELECT count(*), state
FROM pg_stat_activity
GROUP BY state;
"

# 4. 检查日志
tail -100 /var/log/postgresql/postgresql-15-main.log
```

**解决方案：**

**A. 如果数据库未运行：**
```bash
# 启动数据库
sudo systemctl start postgresql@15-main

# 或者使用 pg_ctl
pg_ctl -D /var/lib/postgresql/15/main start
```

**B. 如果连接池耗尽：**
```bash
# 检查当前连接
psql ... -c "
SELECT pid, usename, application_name, state, query_start
FROM pg_stat_activity
WHERE datname = '$DB_NAME'
ORDER BY query_start;
"

# 杀死空闲连接（谨慎操作）
psql ... -c "
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = '$DB_NAME'
  AND state = 'idle'
  AND query_start < now() - interval '1 hour';
"
```

**C. 如果网络问题：**
```bash
# 检查网络连通性
ping <DB_HOST>
telnet <DB_HOST> <DB_PORT>

# 检查防火墙规则
sudo iptables -L -n | grep $DB_PORT
```

### 故障 4: Engineer 角色主体数异常

**症状：**
- Engineer 角色主体数突然激增或归零
- 监控告警显示主体数异常

**可能原因：**
1. 批量导入或删除用户
2. 角色规则被错误修改
3. 事实批量过期
4. 数据损坏

**诊断：**
```bash
# 1. 检查主体和事实
psql ... -c "
SELECT
  count(*) AS total,
  count(*) FILTER (WHERE r.role = 'engineer') AS engineer,
  count(*) FILTER (WHERE now() < f.valid_until) AS valid
FROM content_intake.principals p
JOIN content_intake.principal_facts f USING (principal_id)
LEFT JOIN content_intake.role_rules r
  ON r.department_id = ANY(f.department_ids)
  AND r.job_id = f.job_id;
"

# 2. 检查最近的变更
psql ... -c "
SELECT tablename, pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'content_intake'
  AND tablename IN ('principals', 'principal_facts', 'role_rules')
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
"

# 3. 检查审计日志（如果有）
tail -100 /var/log/postgresql/postgresql-15-main.log | grep -E "INSERT|UPDATE|DELETE"
```

**解决方案：**

**A. 如果是预期的批量操作：**
- 确认操作合法性
- 更新监控基线值
- 通知团队成员

**B. 如果是意外变更：**
- 立即停止可能的批量操作
- 从备份恢复（联系数据库管理员）
- 调查变更原因，防止再次发生

---

## 四、预防措施

### 4.1 日常监控检查清单

**每日（自动）：**
- [x] 运行监控脚本
- [x] 检查告警阈值
- [x] 发送每日摘要（工作日 09:00）

**每周（手动）：**
- [ ] 查看监控趋势图
- [ ] 检查事实过期率
- [ ] 检查授权记录增长
- [ ] 复核角色规则

**每月（手动）：**
- [ ] 清理过期授权记录
- [ ] 优化数据库索引
- [ ] 更新监控基线
- [ ] 复核告警规则

### 4.2 关键指标基线

**当前基线（杭州测试环境，2026-10-28）：**
- Engineer 角色主体数：3 个
- 总主体数：~10 个
- 有效授权数：~20 条
- 事实过期率：<1%
- 授权成功率：>99%
- 平均授权判断延迟：5-10ms

**生产环境预期（待更新）：**
- Engineer 角色主体数：待观察
- 总主体数：待观察
- 有效授权数：待观察
- 事实过期率：<5%
- 授权成功率：>95%
- P99 授权判断延迟：<50ms

### 4.3 定期维护

**数据库维护：**
```bash
# 每周运行一次（非高峰期）
psql ... -c "VACUUM ANALYZE content_intake.grants;"
psql ... -c "VACUUM ANALYZE content_intake.principals;"
psql ... -c "VACUUM ANALYZE content_intake.principal_facts;"
```

**日志清理：**
```bash
# 每月清理一次（保留 30 天）
find /var/log/customer-agent -name "auth-metrics-*.json" -mtime +30 -delete
```

**备份验证：**
```bash
# 每周验证一次
# 确认数据库备份可用，恢复测试正常
```

---

## 五、联系信息

**邮件告警：** 5DJgDkyjvPY1E@shinemage.cn  
**飞书群：** customer-agent-health  
**文档：** docs/authorization-model.md  
**监控脚本：** scripts/monitor-and-alert.sh  
**故障排查：** scripts/test-engineer-authorization.sh

**升级路径：**
1. 运维团队 → 开发团队
2. 开发团队 → 技术负责人
3. 技术负责人 → CTO/VP Engineering

---

**版本：** 1.0  
**最后更新：** 2026-10-28  
**维护人：** DevOps Team & Database Team
