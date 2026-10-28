# 迁移 0074/0075 部署和监控完整清单

本清单记录迁移 0074/0075 部署后的所有配置和后续行动。

---

## ✅ 已完成项

### 1. 数据库迁移
- [x] 迁移 0074 应用（2026-10-28 10:30）
- [x] 迁移 0075 应用（2026-10-28 10:31）
- [x] 真实用户验证通过
- [x] 部署报告编写完成

### 2. 监控配置
- [x] 创建监控脚本 `scripts/monitor-authorization-metrics.sh`
- [x] 创建告警脚本 `scripts/monitor-and-alert.sh`
- [x] 创建辅助脚本 `scripts/check-principal-facts.sh`
- [x] 创建辅助脚本 `scripts/refresh-principal-facts.sh`
- [x] 首次监控运行成功（5.7ms 延迟）

### 3. 文档
- [x] 授权文档 `packages/database/README.md`
- [x] Overlay 迁移流程规范 `docs/guides/overlay-migration-workflow.md`
- [x] 快速响应手册 `docs/runbook/authorization-incident-response.md`
- [x] 告警规则配置 `docs/monitoring-alert-rules.md`
- [x] 首次监控报告 `docs/monitoring-report-2026-10-28.md`
- [x] 团队通报草稿 `docs/team-notification-2026-10-28.md`

### 4. 测试
- [x] Engineer 角色集成测试 `apps/api/tests/engineer-authorization.integration.test.ts`
- [x] 通配符授权集成测试 `apps/api/tests/wildcard-source-authorization.integration.test.ts`

---

## 🔄 待执行项

### 短期（本周）

#### A. 配置监控定时任务
```bash
# 1. 创建日志目录（需要 sudo）
sudo mkdir -p /var/log/customer-agent
sudo chown hutou:staff /var/log/customer-agent

# 2. 安装 crontab
crontab -e
# 复制 scripts/crontab.txt 的内容

# 3. 验证 crontab
crontab -l

# 4. 测试首次运行
bash scripts/monitor-and-alert.sh
```

**预计完成时间：** 2026-10-28 下午

#### B. 发送团队通报
```bash
# 1. 邮件通报
cat docs/team-notification-2026-10-28.md | \
  mail -s "[数据库迁移] 0074/0075 部署完成及监控配置" \
  5DJgDkyjvPY1E@shinemage.cn

# 2. 飞书通报
lark-cli im +send-message \
  --chat customer-agent-health \
  --type text \
  --text "$(cat docs/team-notification-2026-10-28.md | head -100)"

# 或者使用 lark-cli 上传文档
lark-cli drive +upload \
  --file docs/team-notification-2026-10-28.md \
  --folder "数据库迁移文档"
```

**预计完成时间：** 2026-10-28 下午

#### C. 软件重新打包和部署
```bash
# 1. 更新版本号
cd packages/database
# 编辑 package.json，版本号递增

# 2. 构建
pnpm build

# 3. 发布（如果需要）
pnpm publish

# 4. API 重新打包
cd ../../apps/api
pnpm build

# 5. 部署到生产环境
# 参考: docs/how-to-run-backend-on-hangzhou.md
bash scripts/deploy-to-hangzhou.sh
```

**预计完成时间：** 2026-10-28 晚上或 2026-10-29 上午

#### D. 生产环境首次监控
```bash
# 在杭州生产环境运行
ssh hangzhou-prod
cd /path/to/customer-agent-prototype
bash scripts/monitor-and-alert.sh

# 保存报告
cp /var/log/customer-agent/auth-metrics-$(date +%Y%m%d).json \
   docs/monitoring-report-prod-$(date +%Y%m%d).json
```

**预计完成时间：** 部署后立即执行

---

### 长期（本月）

#### E. 监控数据收集和分析
- [ ] 每日查看监控报告（自动化）
- [ ] 每周分析趋势数据
- [ ] 建立指标基线值
- [ ] 优化告警阈值

**负责人：** 运维团队  
**检查点：** 每周一

#### F. 补充自动化测试
- [ ] 将集成测试集成到 CI 流程
- [ ] 添加性能基准测试
- [ ] 添加回归测试（防止迁移被误改）

**负责人：** 开发团队  
**预计完成：** 2026-11-15

#### G. 文档完善
- [ ] 更新 README 或 CHANGELOG
- [ ] 在团队 wiki 中添加授权模型文档链接
- [ ] 补充故障案例和解决方案

**负责人：** 技术写作团队  
**预计完成：** 2026-11-30

---

## 📊 监控配置详情

### 定时任务
```cron
# 监控脚本（带告警）- 每 6 小时
0 */6 * * * cd /Users/hutou/Desktop/customer-agent-prototype && bash scripts/monitor-and-alert.sh >> /var/log/customer-agent/monitor-cron.log 2>&1

# 详细监控报告 - 每天 08:00（工作日）
0 8 * * 1-5 cd /Users/hutou/Desktop/customer-agent-prototype && bash scripts/monitor-authorization-metrics.sh > /var/log/customer-agent/auth-metrics-$(date +\%Y\%m\%d)-detailed.log 2>&1

# 日志清理 - 每周日 02:00
0 2 * * 0 find /var/log/customer-agent -name "*.log" -mtime +30 -delete 2>/dev/null
```

### 告警通知
- **邮件：** 5DJgDkyjvPY1E@shinemage.cn
- **飞书群：** customer-agent-health
- **告警级别：** P0 (5分钟) / P1 (30分钟) / P2 (工作时间)

### 告警阈值
- 授权成功率：<95%
- 授权判断延迟：>50ms
- 事实过期率：>5%
- 数据库连接失败：立即

---

## 🔍 快速验证清单

### 验证监控脚本
```bash
# 1. 监控脚本可执行
bash scripts/monitor-authorization-metrics.sh | head -50

# 2. 告警脚本可执行
bash scripts/monitor-and-alert.sh

# 3. 辅助脚本可执行
bash scripts/check-principal-facts.sh
```

### 验证告警通知
```bash
# 1. 邮件通知（测试）
echo "授权监控测试" | mail -s "[测试] 授权监控" 5DJgDkyjvPY1E@shinemage.cn

# 2. 飞书通知（测试）
lark-cli im +send-message \
  --chat customer-agent-health \
  --type text \
  --text "【测试】授权监控系统测试消息"
```

### 验证数据库迁移
```bash
# 1. 检查函数定义
psql ... -c "
SELECT prosrc FROM pg_proc
WHERE proname = 'authorization_deadline'
  AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'content_intake')
" | grep -E "role_ceiling|source_id IS NULL"

# 2. 测试 engineer 角色
bash scripts/test-engineer-authorization.sh <principal_id>

# 3. 测试授权判断性能
psql ... -c "EXPLAIN (ANALYZE, BUFFERS) SELECT content_intake.authorization_deadline(...)"
```

---

## 📞 联系信息

**监控告警：**
- 邮件：5DJgDkyjvPY1E@shinemage.cn
- 飞书群：customer-agent-health

**技术支持：**
- 运维团队：[联系方式]
- 开发团队：[联系方式]
- 数据库管理员：[联系方式]

**紧急联系：**
- On-call：[联系方式]
- 技术负责人：[联系方式]

---

## 📚 相关文档

- 授权模型：`packages/database/README.md`
- 快速响应手册：`docs/runbook/authorization-incident-response.md`
- 告警规则：`docs/monitoring-alert-rules.md`
- 部署总结：`packages/database/DEPLOYMENT-SUMMARY-0074-0075.md`

---

**版本：** 1.0  
**最后更新：** 2026-10-28  
**维护人：** DevOps & Database Team  
**下次复核：** 2026-11-04（一周后）
