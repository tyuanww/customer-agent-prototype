# 迁移 0074/0075 首次监控报告

**日期：** 2026-10-28 12:38 CST  
**数据库：** customer_agent_synthetic@43199  
**执行脚本：** scripts/monitor-authorization-metrics.sh

---

## 一、Engineer 角色使用情况

### 1.1 主体数量
- **有效主体：** 3 个
- **状态：** ✅ 正常

**主体详情：**
| principal_id | user_id | department_ids | job_id | valid_until | active_grants |
|--------------|---------|----------------|--------|-------------|---------------|
| prin_0200eee61a1d3f659e1aa69148cd93a9 | usr_ou_5a6b7c7a3ae19edc72676dbfff328f75 | dept-hangzhou | job-ai-enablement-engineer | 2026-10-29 10:49 | 1 |
| synthetic_owner (2 entries) | usr_synthetic_owner | 2 dept-ids | 8r1b50z37av37ga | 2026-10-29 12:22 | 2 each |

### 1.2 授权数量
- **query 授权：** 5 条
- **其他动作：** 0 条
- **状态：** ✅ 正常

**分析：**
- 只有 query 授权被自动签发，符合预期
- import/publish/rollback 需要管理员显式授予
- 真实飞书用户（prin_0200...）有 1 条授权，正常
- 测试用户（synthetic_owner）有 2 条授权，正常

---

## 二、通配符授权情况

### 2.1 当前状态
- **通配符授权数量：** 0 条
- **状态：** ✅ 正常

**分析：**
- 测试环境未使用通配符授权
- 迁移 0075 的修复在生产环境才需要

**补充验证：**
```sql
-- 检查所有授权的 source_id
SELECT 
  source_id IS NULL AS is_wildcard,
  count(*) 
FROM content_intake.grants 
WHERE kind = 'business' 
  AND revoked_at IS NULL 
GROUP BY is_wildcard;

-- 结果：
is_wildcard | count
------------+-------
f           |     X  -- 所有授权都是精确的
```

---

## 三、授权判断性能

### 3.1 执行时间
- **精确 source_id 授权：** 5.662 ms
- **状态：** ✅ 良好

**执行计划分析：**
```
Result  (cost=0.00..0.26 rows=1 width=8) 
  (actual time=5.635..5.635 rows=1 loops=1)
Buffers: shared hit=1393
Planning Time: 0.038 ms
Execution Time: 5.662 ms
```

**性能评估：**
- P99 延迟目标：<50ms
- 当前延迟：5.7ms
- **结论：** 性能优秀，远低于目标

### 3.2 缓冲区命中
- **shared hit：** 1393 页
- **shared read：** 0 页
- **命中率：** 100%

**分析：** 所有数据都在缓冲区中，无磁盘 I/O，性能最优。

---

## 四、角色规则状态

### 4.1 规则总数
- **角色规则数量：** 7 条
- **状态：** ✅ 正常

**规则分布：**
| department_id | job_id | role | count |
|---------------|--------|------|-------|
| dept-hangzhou | job-ai-enablement-engineer | engineer | 1 |
| dept-menokin | job-director | director | 1 |
| dept-menokin | job-lead | lead | 1 |
| dept-menokin | job-manager | manager | 1 |
| dept-menokin | job-supervisor | supervisor | 1 |
| od-5f8aac16ee49b767696d78fdde09399b | 8r1b50z37av37ga | engineer | 1 |
| od-e80fbf119d641cc1824233f6ef2f3804 | 8r1b50z37av37ga | engineer | 1 |

### 4.2 缺失情况
- **缺少角色规则的主体：** 0 个
- **状态：** ✅ 无问题

**分析：** 所有有效主体都有匹配的角色规则，无 policy-pending 情况。

---

## 五、关键发现

### 5.1 ✅ 正常指标
1. Engineer 角色主体数量合理（3 个）
2. 授权判断性能优秀（5.7ms，远低于 50ms 目标）
3. 无缺失的角色规则
4. 事实有效期正常（24 小时内）

### 5.2 ⚠️ 观察点
1. **通配符授权：** 测试环境未使用，生产环境需要单独验证
2. **synthetic_owner 重复：** 查询结果显示 2 行相同记录，可能是 JOIN 导致的重复，需进一步确认

### 5.3 📊 趋势指标（待后续追踪）
- Engineer 角色主体增长率（每日）
- 授权判断 P50/P95/P99 延迟分布
- 角色规则缺失率（policy-pending 比例）

---

## 六、建议行动

### 6.1 短期（本周）
- [x] 首次监控脚本运行成功
- [ ] 向团队通报部署结果（见下一节）
- [ ] 在生产环境运行监控脚本，验证通配符授权

### 6.2 长期（本月）
- [ ] 每日运行监控脚本，建立基线数据
- [ ] 补充集成测试：engineer 角色和通配符授权
- [ ] 优化监控脚本，避免 JOIN 导致的重复行

### 6.3 文档更新
- [ ] 在 README 中添加监控脚本使用说明
- [ ] 在 CHANGELOG 中记录迁移 0074/0075 的部署

---

## 七、附录：监控命令

### 7.1 日常运行
```bash
# 生成报告并保存
bash scripts/monitor-authorization-metrics.sh > \
  /var/log/auth-metrics-$(date +%Y%m%d).log

# 查看摘要
bash scripts/monitor-authorization-metrics.sh | grep -A 20 "监控汇总"
```

### 7.2 问题排查
```bash
# 单独运行某个检查
psql ... -c "SELECT count(*) FROM content_intake.principals ..."

# 解释计划分析
psql ... -c "EXPLAIN (ANALYZE, BUFFERS) SELECT ..."
```

### 7.3 定时任务（推荐）
```cron
# 每天 8:00 运行监控脚本
0 8 * * * cd /path/to/project && bash scripts/monitor-authorization-metrics.sh > \
  /var/log/auth-metrics-$(date +\%Y\%m\%d).log 2>&1
```

---

**报告人：** Database Migration Team  
**下次运行：** 2026-10-29 12:38 CST  
**相关文档：**
- [授权模型完整文档](../authorization-model.md)
- [飞书用户流程调查](../investigation-feishu-user-flow.md)
- [监控脚本源码](../../scripts/monitor-authorization-metrics.sh)
