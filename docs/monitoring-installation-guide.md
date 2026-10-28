# 监控系统安装和使用指南

本指南记录迁移 0074/0075 监控系统的完整安装和使用流程。

---

## 一、快速开始

### 1.1 立即可用的命令

```bash
# 1. 查看监控指标（详细报告）
bash scripts/monitor-authorization-metrics.sh

# 2. 运行监控并发送告警（如果超阈值）
bash scripts/monitor-and-alert.sh

# 3. 检查主体事实状态
bash scripts/check-principal-facts.sh

# 4. 测试特定主体的授权
bash scripts/test-engineer-authorization.sh <principal_id>
```

所有脚本都可以立即运行，无需安装额外依赖。

---

## 二、完整安装步骤

### 步骤 1: 创建日志目录

```bash
# 方案 A: 使用系统日志目录（推荐，需要 sudo）
sudo mkdir -p /var/log/customer-agent
sudo chown $USER:staff /var/log/customer-agent

# 方案 B: 使用项目目录（无需 sudo）
# 监控脚本会自动使用 PROJECT_ROOT/logs

# 方案 C: 使用自定义目录
export CUSTOMER_AGENT_LOG_DIR=/path/to/logs
mkdir -p $CUSTOMER_AGENT_LOG_DIR
```

### 步骤 2: 配置飞书通知（可选）

```bash
# 1. 确认 lark-cli 已安装
which lark-cli

# 2. 登录飞书
lark-cli auth login

# 3. 测试群聊搜索
lark-cli im +chat-search --name "customer-agent-health" --type 2

# 4. 测试发送消息（找到群 ID 后）
echo "测试消息" | lark-cli im +messages-send --chat-id oc_xxx --text -
```

**如果飞书配置失败：** 监控脚本会降级到只发邮件，不影响正常运行。

### 步骤 3: 配置定时任务

```bash
# 1. 编辑 crontab
crontab -e

# 2. 添加以下内容（调整项目路径）
PROJECT_ROOT="/Users/hutou/Desktop/customer-agent-prototype"

# 监控脚本（带告警）- 每 6 小时
0 */6 * * * cd $PROJECT_ROOT && bash scripts/monitor-and-alert.sh >> $HOME/logs/monitor-cron.log 2>&1

# 详细监控报告 - 每天 08:00（工作日）
0 8 * * 1-5 cd $PROJECT_ROOT && bash scripts/monitor-authorization-metrics.sh > $HOME/logs/auth-metrics-$(date +\%Y\%m\%d)-detailed.log 2>&1

# 日志清理 - 每周日 02:00（清理 30 天前的日志）
0 2 * * 0 find $HOME/logs -name "auth-metrics-*.json" -mtime +30 -delete 2>/dev/null

# 3. 验证 crontab
crontab -l

# 4. 测试首次运行（不等待定时）
bash scripts/monitor-and-alert.sh
```

### 步骤 4: 发送团队通报

```bash
# 1. 邮件通报
cat docs/team-notification-2026-10-28.md | \
  mail -s "[数据库迁移] 0074/0075 部署完成及监控配置" \
  5DJgDkyjvPY1E@shinemage.cn

# 2. 飞书通报（如果配置成功）
# 先搜索群 ID
chat_id=$(lark-cli im +chat-search --name "customer-agent-health" --type 2 | jq -r '.data.items[0].chat_id')

# 发送文件
lark-cli drive +upload \
  --file docs/team-notification-2026-10-28.md \
  --folder "数据库迁移文档"

# 或发送消息摘要
cat docs/team-notification-2026-10-28.md | head -50 | \
  lark-cli im +messages-send --chat-id "$chat_id" --text -
```

---

## 三、日常使用

### 3.1 查看监控报告

```bash
# 最新监控指标（JSON）
cat logs/auth-metrics-$(date +%Y%m%d).json | jq .

# 详细监控报告（人类可读）
bash scripts/monitor-authorization-metrics.sh | less

# 历史趋势（对比前一天）
jq -s '{today: .[0].metrics, yesterday: .[1].metrics}' \
  logs/auth-metrics-$(date +%Y%m%d).json \
  logs/auth-metrics-$(date -v-1d +%Y%m%d).json 2>/dev/null
```

### 3.2 响应告警

**收到告警邮件或飞书消息后：**

1. **确认告警级别**
   - P0（严重）：5 分钟内响应
   - P1（重要）：30 分钟内响应
   - P2（警告）：工作时间内响应

2. **执行快速诊断**
   ```bash
   # 运行诊断脚本
   bash scripts/check-principal-facts.sh

   # 查看最新指标
   cat logs/auth-metrics-$(date +%Y%m%d).json | jq .
   ```

3. **参考快速响应手册**
   - 详细故障排查：`docs/runbook/authorization-incident-response.md`
   - 常见故障和解决方案：第三节

4. **确认问题解决**
   ```bash
   # 再次运行监控
   bash scripts/monitor-and-alert.sh

   # 验证指标恢复正常
   ```

5. **在飞书群通报**
   ```
   已解决：<告警类型>
   原因：<根因>
   措施：<解决方案>
   恢复时间：<时间>
   ```

### 3.3 手动刷新主体事实

**仅在紧急情况下使用（用户长时间未登录导致授权失败）：**

```bash
# 1. 确认主体 ID
bash scripts/check-principal-facts.sh

# 2. 刷新特定主体的事实（延长 24 小时）
bash scripts/refresh-principal-facts.sh <principal_id>

# 3. 验证
bash scripts/test-engineer-authorization.sh <principal_id>
```

**注意：** 这只是临时措施，建议要求用户重新登录以自动刷新事实。

---

## 四、监控指标说明

### 4.1 关键指标

| 指标 | 说明 | 正常范围 | 告警阈值 |
|------|------|----------|----------|
| engineer_principals | Engineer 角色主体数 | 取决于实际用户 | N/A |
| total_principals | 总主体数 | 取决于实际用户 | N/A |
| active_grants | 有效授权数 | 取决于业务 | N/A |
| expired_facts | 过期事实数 | <总数的 5% | >5% 告警 |
| fact_expiry_rate_percent | 事实过期率 | <5% | >5% 告警 |
| auth_success_rate_percent | 授权成功率 | >95% | <95% 告警 |
| avg_latency_ms | 平均授权判断延迟 | <50ms | >50ms 告警 |

### 4.2 指标解读

**授权成功率：**
- 计算公式：(有效授权数 / 总主体数) * 100
- 意义：有多少比例的主体拥有有效授权
- 正常：>95%（大部分用户有权限）
- 异常：<95%（可能是授权配置问题）

**事实过期率：**
- 计算公式：(过期事实数 / 总事实数) * 100
- 意义：有多少比例的主体事实已过期
- 正常：<5%（偶尔有用户长时间未登录）
- 异常：>5%（可能是登录流程问题）

**授权判断延迟：**
- 计算公式：AVG(authorization_deadline 执行时间)
- 意义：授权判断的性能
- 正常：<50ms（P99 性能目标）
- 异常：>50ms（可能需要优化索引）

---

## 五、自定义配置

### 5.1 调整告警阈值

编辑 `scripts/monitor-and-alert.sh`，修改以下变量：

```bash
# 告警阈值
THRESHOLD_AUTH_SUCCESS_RATE=95  # 授权成功率低于 95% 告警
THRESHOLD_P99_LATENCY_MS=50     # P99 延迟超过 50ms 告警
THRESHOLD_FACT_EXPIRY_RATE=5    # 事实过期率超过 5% 告警
```

### 5.2 调整监控频率

编辑 crontab，修改定时任务：

```bash
# 每 6 小时 → 每 2 小时
0 */2 * * * cd $PROJECT_ROOT && bash scripts/monitor-and-alert.sh

# 每天 08:00 → 每 12 小时
0 */12 * * * cd $PROJECT_ROOT && bash scripts/monitor-authorization-metrics.sh
```

### 5.3 自定义通知渠道

编辑 `scripts/monitor-and-alert.sh`，修改通知函数：

```bash
# 添加其他通知渠道（如钉钉、企业微信）
send_custom_alert() {
    local title="$1"
    local content="$2"

    # 自定义通知逻辑
    curl -X POST https://custom-webhook.com/alert \
      -H 'Content-Type: application/json' \
      -d "{\"title\":\"$title\",\"content\":\"$content\"}"
}

# 在告警触发时调用
if [ $alert_triggered -eq 1 ]; then
    send_email_alert "..." "..."
    send_feishu_alert "..." "..."
    send_custom_alert "..." "..."  # 新增
fi
```

---

## 六、故障排查

### 6.1 监控脚本不运行

**症状：** crontab 定时任务没有执行

**排查：**
```bash
# 1. 检查 crontab 是否正确
crontab -l

# 2. 检查 cron 日志
tail -100 /var/log/cron.log  # macOS
tail -100 /var/log/syslog | grep CRON  # Linux

# 3. 检查脚本权限
ls -l scripts/monitor-and-alert.sh
# 应该有执行权限（-rwxr-xr-x）

# 4. 手动运行验证
bash scripts/monitor-and-alert.sh
```

**解决方案：**
- 确保 crontab 路径正确（绝对路径）
- 确保脚本有执行权限（`chmod +x`）
- 确保环境变量正确（cron 环境不同于 shell）

### 6.2 邮件发送失败

**症状：** 监控日志显示"邮件发送失败"

**排查：**
```bash
# 1. 检查 mail 命令是否可用
which mail

# 2. 手动测试邮件发送
echo "测试邮件" | mail -s "测试" 5DJgDkyjvPY1E@shinemage.cn

# 3. 检查邮件配置
cat /etc/mail.rc  # macOS
cat /etc/postfix/main.cf  # Linux
```

**解决方案：**
- 安装 mailutils 或 postfix
- 配置 SMTP 服务器
- 或者使用 sendmail/msmtp 等替代工具

### 6.3 飞书发送失败

**症状：** 监控日志显示"飞书消息发送失败"

**排查：**
```bash
# 1. 检查 lark-cli 登录状态
lark-cli auth status

# 2. 重新登录
lark-cli auth login

# 3. 搜索群聊
lark-cli im +chat-search --name "customer-agent-health" --type 2

# 4. 手动测试发送
echo "测试消息" | lark-cli im +messages-send --chat-id <chat_id> --text -
```

**解决方案：**
- 确保 lark-cli 已登录
- 确认群名正确（区分大小写）
- 确认有权限向群发送消息
- 如果无法解决，监控脚本会降级到只发邮件

### 6.4 数据库连接失败

**症状：** 监控脚本无法连接数据库

**排查：**
```bash
# 1. 检查数据库连接参数
echo $CUSTOMER_AGENT_DB_HOST
echo $CUSTOMER_AGENT_DB_PORT
echo $CUSTOMER_AGENT_DB_NAME
echo $CUSTOMER_AGENT_DB_USER

# 2. 手动测试连接
psql -h $DB_HOST -p $DB_PORT -d $DB_NAME -U $DB_USER -c "SELECT 1"

# 3. 检查数据库进程
ps aux | grep postgres

# 4. 检查端口监听
lsof -i :$DB_PORT
```

**解决方案：**
- 确保数据库正在运行
- 确保连接参数正确
- 确保网络通畅
- 参考快速响应手册的"数据库连接失败"章节

---

## 七、最佳实践

### 7.1 监控数据分析

**每周复核：**
```bash
# 1. 生成周报
ls -1 logs/auth-metrics-*.json | tail -7 | \
  xargs jq -s '{
    avg_latency: [.[].metrics.avg_latency_ms] | add / length,
    max_latency: [.[].metrics.avg_latency_ms] | max,
    avg_expiry_rate: [.[].metrics.fact_expiry_rate_percent] | add / length
  }'

# 2. 查看趋势
for f in logs/auth-metrics-202610*.json; do
    echo -n "$(basename $f .json | cut -d- -f3): "
    jq -r '.metrics.avg_latency_ms' $f
done
```

### 7.2 定期维护

**每周任务：**
- 查看监控趋势，是否有异常变化
- 检查告警历史，是否有重复告警
- 复核告警阈值，是否需要调整

**每月任务：**
- 清理过期日志（保留 30 天）
- 更新监控基线值
- 复核快速响应手册

### 7.3 文档更新

**遇到新故障时：**
1. 记录故障现象和根因
2. 补充到快速响应手册
3. 更新告警规则（如果需要）
4. 在团队内分享经验

---

## 八、相关文档

- 快速响应手册：`docs/runbook/authorization-incident-response.md`
- 告警规则配置：`docs/monitoring-alert-rules.md`
- 授权模型文档：`docs/authorization-model.md`
- 部署总结：`packages/database/DEPLOYMENT-SUMMARY-0074-0075.md`
- 部署清单：`docs/deployment-checklist-0074-0075.md`

---

**版本：** 1.0  
**最后更新：** 2026-10-28  
**维护人：** DevOps Team  
**支持：** 5DJgDkyjvPY1E@shinemage.cn
