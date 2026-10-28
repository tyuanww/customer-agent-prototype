# 迁移 0074/0075 团队通报

**收件人：** 开发团队、产品团队、运维团队  
**日期：** 2026-10-28  
**主题：** 数据库迁移 0074/0075 部署完成及后续监控

---

## 一、执行摘要

数据库迁移 0074 和 0075 已在杭州生产环境成功部署并验证。这两个迁移修复了 `authorization_deadline` 函数对 engineer 角色和通配符授权的支持。

**关键成果：**
- ✅ Engineer 角色（AI 赋能工程师）现在可以正常使用系统
- ✅ 通配符授权（source_id IS NULL）按预期工作
- ✅ 真实用户验证通过，授权判断性能优秀（5.7ms）
- ✅ 完整的文档、监控脚本和部署报告已提交

---

## 二、部署详情

### 2.1 迁移内容

**迁移 0074：支持 engineer 角色**
- **文件：** `packages/database/overlays/0074_authorization_deadline_engineer.sql`
- **修复：** 将 `authorization_deadline` 函数中硬编码的角色列表改为动态检查 `role_ceiling` 表
- **影响：** 所有 7 个业务角色（agent, enabler, lead, supervisor, manager, director, engineer）现在都能通过授权判断

**迁移 0075：支持通配符授权**
- **文件：** `packages/database/overlays/0075_authorization_deadline_source_null.sql`
- **修复：** 修复 `authorization_deadline` 函数对 `source_id IS NULL` 的处理逻辑
- **影响：** 通配符授权（允许访问 scope 的任意 source）按预期工作

### 2.2 部署时间
- **迁移 0074：** 2026-10-28 10:30 CST
- **迁移 0075：** 2026-10-28 10:31 CST
- **验证完成：** 2026-10-28 10:50 CST

### 2.3 验证结果
- **真实用户：** prin_0200eee61a1d3f659e1aa69148cd93a9
- **岗位：** AI 赋能工程师（job-ai-enablement-engineer）
- **授权状态：** ✅ 通过，截止时间 2026-10-29 10:49 CST
- **授权判断延迟：** 5.7ms（远低于 50ms 目标）

---

## 三、监控现状

### 3.1 首次监控报告（2026-10-28 12:38）

**Engineer 角色使用情况：**
- 有效主体：3 个
- 有效授权：5 条（全部为 query 动作）

**性能指标：**
- 授权判断延迟：5.7ms
- 缓冲区命中率：100%
- 状态：✅ 性能优秀

**角色规则：**
- 总数：7 条
- 缺失：0 个
- 状态：✅ 无问题

**详细报告：** [docs/monitoring-report-2026-10-28.md](docs/monitoring-report-2026-10-28.md)

### 3.2 监控脚本
- **位置：** `scripts/monitor-authorization-metrics.sh`
- **频率：** 建议每日运行
- **输出：** 控制台或日志文件

**运行方式：**
```bash
bash scripts/monitor-authorization-metrics.sh > \
  /var/log/auth-metrics-$(date +%Y%m%d).log
```

---

## 四、文档资源

### 4.1 新增文档

1. **授权模型完整文档**
   - 位置：`docs/authorization-model.md`
   - 内容：主体、事实、角色规则、授权记录的关系和判断流程
   - 读者：开发、测试、运维团队

2. **飞书用户流程调查报告**
   - 位置：`docs/investigation-feishu-user-flow.md`
   - 内容：飞书用户登录和授权的完整流程分析
   - 读者：产品、开发团队

3. **Overlay 迁移发布流程**
   - 位置：`docs/guides/overlay-migration-workflow.md`
   - 内容：手动迁移的创建、测试、审核、部署规范
   - 读者：数据库管理员、开发团队

4. **授予 Engineer 角色权限指南**
   - 位置：`docs/guides/grant-engineer-permissions.md`
   - 内容：为 AI 赋能工程师授权的完整步骤
   - 读者：产品、运维团队

### 4.2 部署报告
- `packages/database/DEPLOYMENT-REPORT-0074.md`
- `packages/database/DEPLOYMENT-REPORT-0075.md`
- `../packages/database/DEPLOYMENT-SUMMARY-0074-0075.md`

---

## 五、后续行动

### 5.1 短期行动（本周内）

**开发团队：**
- [ ] 补充 engineer 角色的集成测试
- [ ] 补充通配符授权的集成测试

**运维团队：**
- [ ] 设置监控脚本定时任务（每日 8:00）
- [ ] 在生产环境运行首次监控
- [ ] 建立基线数据和告警规则

**产品团队：**
- [ ] 向 AI 赋能工程师用户通知系统已可用
- [ ] 确认是否需要授予其他动作（import, publish, rollback）

### 5.2 长期行动（本月内）

**文档完善：**
- [ ] 更新 README 或 CHANGELOG
- [ ] 在团队 wiki 中链接授权模型文档

**监控优化：**
- [ ] 根据首周数据优化监控脚本
- [ ] 设置 P99 延迟告警（>50ms）
- [ ] 追踪 engineer 角色主体增长趋势

**自动化测试：**
- [ ] 将监控脚本集成到 CI/CD 流程
- [ ] 添加回归测试，防止类似问题

---

## 六、常见问题

### Q1: 为什么 engineer 角色之前无法使用系统？

**A:** `authorization_deadline` 函数硬编码了 6 个角色的白名单，未包含 engineer。迁移 0074 将其改为动态检查 `role_ceiling` 表，现在所有业务角色都支持。

### Q2: 通配符授权是什么？什么时候使用？

**A:** `source_id IS NULL` 表示"允许访问该 scope 的任意 source"。通常用于测试环境或管理员账号。生产环境的普通用户应使用精确授权。

### Q3: 如何为 engineer 角色授予其他动作（import, publish）？

**A:** 
1. 参考文档：`docs/guides/grant-engineer-permissions.md`
2. 使用管理 API 或 SQL 手动签发授权
3. 注意：import/publish/rollback 不会自动签发，需要显式授予

### Q4: 监控脚本多久运行一次？

**A:** 建议每日运行一次。可以设置 cron 定时任务：
```cron
0 8 * * * bash /path/to/scripts/monitor-authorization-metrics.sh > \
  /var/log/auth-metrics-$(date +\%Y\%m\%d).log 2>&1
```

### Q5: 如果授权判断失败怎么排查？

**A:** 
1. 运行监控脚本查看当前状态
2. 参考文档：`authorization-model.md` 第七节"故障排查"
3. 使用 `scripts/test-engineer-authorization.sh` 验证具体主体

---

## 七、联系方式

**技术支持：**
- 文档问题：查看 `docs/` 目录下的相关文档
- 部署问题：联系数据库管理员或 DevOps 团队
- 监控告警：查看 `/var/log/auth-metrics-*.log`

**紧急情况：**
- 如果生产环境授权判断大面积失败，请立即联系 on-call 团队
- 回滚迁移：参考 `../packages/database/DEPLOYMENT-SUMMARY-0074-0075.md` 的回滚部分

---

## 八、总结

迁移 0074/0075 成功修复了 engineer 角色和通配符授权的问题，真实用户验证通过，性能优秀。完整的文档、监控脚本和部署报告已提交，后续请按计划执行监控和测试。

如有疑问或需要支持，请参考相关文档或联系技术团队。

---

**发送人：** Database Migration Team  
**时间：** 2026-10-28 13:00 CST  
**附件：**
- [首次监控报告](monitoring-report-2026-10-28.md)
- [授权模型文档](authorization-model.md)
- [部署总结](../packages/database/DEPLOYMENT-SUMMARY-0074-0075.md)
