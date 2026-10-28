# 飞书新用户自动座席与权限授予流程调查报告

**调查日期：** 2026-10-28  
**范围：** 飞书用户登录后的主体创建、角色规则、授权记录自动生成流程  
**目的：** 完成迁移 0074/0075 的后续行动，评估其他角色是否需要类似修复

---

## 一、完整流程概览

### 1.1 入口：用户登录

```
飞书用户登录 
  ↓
product-auth-service.ts: afterLogin(openId)
  ↓
project-roster-login.ts: projectRosterLogin(client, openId, home)
  ↓
数据库函数: project_feishu_roster()
  ↓
数据库函数: issue_roster_query() (已废弃，改用 grant 自动签发)
```

### 1.2 核心数据库函数

#### A. `project_feishu_roster()` (迁移 0073)

**位置：** `packages/database/migrations/0073_feishu_query_grant.sql`

**职责：**
1. 验证用户身份和角色合法性
2. 创建或更新 `principals` 表记录（主体）
3. 创建 `principal_facts` 表记录（事实，24小时有效期）
4. **不再签发授权**（已由后续的 grant 自动签发取代）

**关键逻辑：**
```sql
-- 第 165-166 行：硬编码角色白名单（已包含 engineer）
IF p_role NOT IN ('agent','enabler','lead','supervisor','manager','director','engineer') THEN
  RAISE EXCEPTION USING ERRCODE='ZA001', MESSAGE='LOGIN_INVALID';
END IF;

-- 第 184-189 行：检查角色规则是否存在
IF NOT EXISTS (
  SELECT 1 FROM content_intake.role_rules
  WHERE tenant_id = p_tenant_id AND app_id = p_app_id
    AND department_id = ANY(p_department_ids)
    AND job_id = p_job_id AND role = p_role
) THEN
  RETURN 'policy-pending';  -- 角色规则不存在，等待管理员配置
END IF;

-- 第 234-264 行：创建主体和事实
INSERT INTO content_intake.principals ...
INSERT INTO content_intake.principal_facts (
  principal_id, facts_version, department_ids, job_id, enabled, checked_at, valid_until, facts_digest
) VALUES (
  p_principal_id, v_facts_version, p_department_ids, p_job_id, true,
  v_checked, v_checked + interval '24 hours', v_digest  -- 24小时有效期
);
```

#### B. 授权自动签发（同一迁移 0073）

**职责：** 新飞书用户首次登录时，自动签发 query 授权

**实现：**
```sql
-- 第 105-133 行：自动签发逻辑
INSERT INTO content_intake.grants(
  grant_id, kind, issuer_id, recipient_id, tenant_id, app_id, scope_id, source_id, action,
  starts_at, expires_at, reason, steward_id, parent_grant_id, policy_version, store_set_version, roster_job_id
)
SELECT DISTINCT ON (member.scope_id, member.source_id)
  left('grant_' || encode(sha256(...), 'hex'), 40),
  'business', v_issuer, v_principal, v_tenant, v_app,
  member.scope_id, member.source_id, 'query',  -- 只签发 query 动作
  v_checked,
  LEAST(parent.expires_at, v_checked + interval '1 year', member.content_valid_until),
  '飞书登录按来源签发。', v_issuer, parent.grant_id, v_policy, v_store, v_job
FROM content_intake.store_set_members member
JOIN content_intake.sources src
  ON src.source_id = member.source_id AND src.scope_id = member.scope_id
 AND src.mode = 'v2-preview'  -- 只为 v2-preview 来源签发
JOIN content_intake.grants parent
  ON parent.recipient_id = v_issuer  -- 从有 allocation/delegation 的签发者派生
 AND parent.action = 'query'
 AND parent.scope_id = member.scope_id
 AND (parent.source_id IS NULL OR parent.source_id = member.source_id)  -- 支持通配符
WHERE member.content_valid_until > v_checked;
```

**关键点：**
1. **只签发 query 动作**：import, publish, rollback 需要管理员显式授予
2. **source_id 可以为 NULL**：支持通配符授权（scope 的任意 source）
3. **有效期最长 1 年**：取 `parent.expires_at`, `1 year`, `content_valid_until` 三者最小值
4. **需要有签发者**：从有 allocation/delegation 授权的主体派生

---

## 二、角色规则的作用

### 2.1 `role_rules` 表

**作用：** 将 `(tenant_id, app_id, department_id, job_id)` 映射到 `role`

**生命周期：**
- **创建：** 管理员手动插入，或系统初始化时批量创建（如 `menokin-test-binding.ts`）
- **查询：** 登录时检查规则是否存在，`authorization_deadline` 函数中使用
- **删除：** 极少删除，除非组织架构重大变更

**示例：**
```sql
INSERT INTO content_intake.role_rules(
  tenant_id, app_id, department_id, job_id, policy_version, role
) VALUES (
  'tenant-menokin',
  'app-customer-agent',
  'dept-hangzhou',
  'job-ai-enablement-engineer',
  1,
  'engineer'
);
```

### 2.2 `role_ceiling` 表

**作用：** 定义每个角色允许的业务动作

**engineer 角色：**
```sql
-- 来自 packages/database/overlays/0030_intake_role_ceiling.sql
('engineer', ARRAY['query', 'content-manage', 'import', 'source-confirm', 'review', 'publish', 'candidate-cancel', 'rollback']::text[])
```

### 2.3 角色与授权的关系

1. **角色规则存在** → 用户可以登录，主体和事实被创建
2. **授权记录存在** → 用户可以执行具体动作（如 query）
3. **角色上限检查** → `authorization_deadline` 函数中动态检查（迁移 0074 修复）

**关键区别：**
- 角色规则：静态配置，管理员维护
- 授权记录：动态签发，系统自动生成或管理员显式授予

---

## 三、迁移 0074/0075 的影响评估

### 3.1 迁移 0074 的范围

**修复内容：** `authorization_deadline` 函数支持 engineer 角色

**影响：**
- **已包含角色：** agent, enabler, lead, supervisor, manager, director, engineer
- **未包含角色：** coach, owner, quality（这些角色不在 `role_ceiling` 的 business_actions 中）

**数据库状态：**
```sql
SELECT role, business_actions FROM content_intake.role_ceiling;

       role     |                                    business_actions                                    
---------------+-----------------------------------------------------------------------------------------
 agent         | {query}
 enabler       | {query,content-manage,import}
 lead          | {query,content-manage,import,source-confirm,review}
 supervisor    | {query,content-manage,import,source-confirm,review,publish,candidate-cancel}
 manager       | {query,content-manage,import,source-confirm,review,publish,candidate-cancel,rollback}
 director      | {query,content-manage,import,source-confirm,review,publish,candidate-cancel,rollback}
 engineer      | {query,content-manage,import,source-confirm,review,publish,candidate-cancel,rollback}
```

**结论：** 0074 已修复所有 7 个业务角色，无遗漏。

### 3.2 迁移 0075 的范围

**修复内容：** `authorization_deadline` 函数支持通配符 source 授权

**影响：**
- **所有角色：** 通配符授权语义对所有角色通用，不区分角色
- **授权签发：** 新用户登录时自动签发的授权已支持 `source_id IS NULL`（见 0073 迁移 L128）
- **授权判断：** 之前无法通过判断，现已修复

**数据：**
```sql
SELECT count(*) FROM content_intake.grants 
WHERE source_id IS NULL AND kind = 'business';
-- 结果：4 条（synthetic_owner 的通配符授权）
```

**结论：** 0075 修复了所有通配符授权，不限于特定角色。

---

## 四、其他角色是否需要类似修复

### 4.1 `project_feishu_roster()` 函数的角色白名单

**当前状态（0073 迁移）：**
```sql
IF p_role NOT IN ('agent','enabler','lead','supervisor','manager','director','engineer') THEN
  RAISE EXCEPTION USING ERRCODE='ZA001', MESSAGE='LOGIN_INVALID';
END IF;
```

**分析：**
- ✅ 已包含 engineer
- ✅ 与 `role_ceiling` 的 7 个业务角色完全一致
- ❌ **未包含 coach, owner, quality**

**为什么 coach/owner/quality 不在列表？**

查看 `role_ceiling` 表的完整定义：
```sql
-- packages/database/overlays/0030_intake_role_ceiling.sql
INSERT INTO content_intake.role_ceiling (role, business_actions) VALUES
  ('agent', ARRAY['query']::text[]),
  ('enabler', ARRAY['query','content-manage','import']::text[]),
  ('lead', ARRAY['query','content-manage','import','source-confirm','review']::text[]),
  ('supervisor', ARRAY['query','content-manage','import','source-confirm','review','publish','candidate-cancel']::text[]),
  ('manager', ARRAY['query','content-manage','import','source-confirm','review','publish','candidate-cancel','rollback']::text[]),
  ('director', ARRAY['query','content-manage','import','source-confirm','review','publish','candidate-cancel','rollback']::text[]),
  ('engineer', ARRAY['query','content-manage','import','source-confirm','review','publish','candidate-cancel','rollback']::text[]);
```

**结论：**
- **coach, owner, quality 不是业务角色**，它们是系统角色或管理角色
- 这些角色通过其他途径创建（如 `bindKnownPrincipal` 或 `create_seat`）
- 飞书登录流程只处理业务角色，不处理系统角色

### 4.2 `authorization_deadline()` 函数的动态检查

**当前状态（0074 + 0075 迁移）：**
```sql
JOIN content_intake.role_ceiling rc
  ON rc.role = r.role
  AND p_action = ANY(rc.business_actions)  -- 动态检查
```

**分析：**
- ✅ 不再硬编码角色列表
- ✅ 支持 `role_ceiling` 中的所有角色
- ✅ 自动覆盖未来新增的角色

**结论：** 无需为其他角色修改此函数。

### 4.3 其他可能遗漏的地方

#### A. `withdraw_roster_query()` 函数

**位置：** `packages/database/migrations/0049_roster_lifecycle.sql`

**作用：** 撤销用户的 query 授权

**检查结果：** 此函数不检查角色，只撤销授权记录，无需修改。

#### B. `issue_roster_query()` 函数（已废弃）

**状态：** 0073 迁移已将授权签发逻辑内联到 `admit_feishu_agent()` 函数，`issue_roster_query()` 不再使用。

#### C. `seat_post_mapping()` 函数

**位置：** `packages/database/migrations/0063_seat_creation.sql`

**作用：** 将座席岗位映射到 job_id 和 role

**检查结果：** 此函数处理座席（非飞书用户），与飞书登录流程无关。

---

## 五、监控指标设计

### 5.1 engineer 角色使用情况

**目标：** 追踪 engineer 角色的实际使用情况

**指标：**
```sql
-- 1. engineer 角色的主体数量
SELECT count(*) FROM content_intake.principals p
JOIN content_intake.principal_facts f
  ON f.principal_id = p.principal_id
  AND f.facts_version = p.current_facts_version
JOIN content_intake.role_rules r
  ON r.tenant_id = p.tenant_id
  AND r.app_id = p.app_id
  AND r.department_id = ANY(f.department_ids)
  AND r.job_id = f.job_id
WHERE r.role = 'engineer';

-- 2. engineer 角色的有效授权数量
SELECT count(*) FROM content_intake.grants g
JOIN content_intake.principals p ON p.principal_id = g.recipient_id
JOIN content_intake.principal_facts f
  ON f.principal_id = p.principal_id
  AND f.facts_version = p.current_facts_version
JOIN content_intake.role_rules r
  ON r.tenant_id = p.tenant_id
  AND r.app_id = p.app_id
  AND r.department_id = ANY(f.department_ids)
  AND r.job_id = f.job_id
WHERE r.role = 'engineer'
  AND g.revoked_at IS NULL
  AND now() BETWEEN g.starts_at AND g.expires_at;

-- 3. engineer 角色的授权判断通过率
-- （需要在应用层统计，数据库层无法直接获取）
```

### 5.2 通配符授权性能影响

**目标：** 评估 0075 修复引入的 OR 分支对性能的影响

**方法：**
1. 执行计划分析
```sql
EXPLAIN (ANALYZE, BUFFERS) SELECT content_intake.authorization_deadline(
  'prin_0200eee61a1d3f659e1aa69148cd93a9847939f2',
  'query',
  'scope-menokin-product',
  'src-menokin-faq',
  now()
);
```

2. 慢查询日志监控
```
log_min_duration_statement = 100  -- 记录超过 100ms 的查询
```

3. 授权判断延迟分布
```sql
-- 应用层统计：P50, P95, P99
```

**预期影响：**
- OR 分支增加查询计划复杂度
- 但通配符授权数量很少（当前 4 条），实际影响微小
- 如果通配符授权大量增加，可能需要优化索引

### 5.3 角色规则缺失率

**目标：** 追踪返回 'policy-pending' 的登录次数

**指标：**
```sql
-- 应用层日志统计
grep "roster projection policy-pending" /var/log/api.log | wc -l
```

**建议：**
- 每日报告 policy-pending 的 (department_id, job_id) 组合
- 提醒管理员补充缺失的角色规则

---

## 六、后续行动检查清单

### 6.1 短期（已完成 ✅）
- [x] 部署迁移 0074 和 0075 到生产环境
- [x] 真实用户验证通过
- [x] 完整部署文档和脚本提交

### 6.2 短期（本周 🔄）
- [ ] 设置 engineer 角色使用情况监控
- [ ] 设置授权判断性能监控
- [ ] 向团队通报部署结果和监控指标

### 6.3 长期 📋
- [ ] 评估其他角色是否需要类似修复
  - **结论：无需修复**，0074 已覆盖所有业务角色，0075 对所有角色通用
- [ ] 完善 overlay 迁移的发布流程
  - 编写文档：何时使用 overlays 而非 migrations
  - 自动化检查：生成器跳过 overlays，避免冲突
- [ ] 补充授权模型的完整文档
  - 主体、事实、角色规则、授权记录的关系图
  - 通配符授权的使用场景和限制
  - 授权判断函数的完整逻辑流程

---

## 七、经验教训

### 7.1 做得好的
1. **分层验证：** 从函数定义 → 角色规则 → 授权记录 → 真实用户，逐层验证完整
2. **动态检查优于硬编码：** 0074 改用 `role_ceiling` 动态检查，避免未来遗漏
3. **通配符语义明确：** 0075 用 `OR` 分支清晰表达 NULL 的语义

### 7.2 需改进的
1. **文档不足：** 授权模型分散在多个迁移中，缺少统一文档
2. **监控缺失：** 无法主动发现类似问题，依赖用户报告
3. **测试覆盖：** 缺少针对 engineer 角色和通配符授权的集成测试

---

## 八、总结

### 8.1 飞书用户登录流程（完整）

```
1. 用户在飞书点击授权
2. 飞书回调 API，API 创建 access_token
3. 客户端用 token 换取 session，触发 afterLogin(openId)
4. projectRosterLogin() 调用 project_feishu_roster()
5. project_feishu_roster() 创建/更新 principals + principal_facts
6. 自动签发逻辑（0073 迁移）为新用户签发 query 授权
7. 用户后续请求通过 authorization_deadline() 判断权限
```

### 8.2 迁移 0074/0075 的完整性

- ✅ **0074：** 已支持所有 7 个业务角色，无遗漏
- ✅ **0075：** 已支持所有角色的通配符授权，无遗漏
- ✅ **其他角色：** coach/owner/quality 是系统角色，不走飞书登录流程，无需修复

### 8.3 下一步

1. **监控上线：** 部署本报告第五节的监控指标
2. **文档完善：** 编写授权模型的统一文档（见 6.3 长期行动）
3. **自动化测试：** 补充 engineer 角色和通配符授权的集成测试

---

**报告人：** Database Migration Team  
**完成时间：** 2026-10-28 13:00 CST  
**状态：** ✅ 调查完成，所有后续行动已规划
