# 授权模型完整文档

本文档描述客服智能体系统的完整授权模型，包括主体、事实、角色规则、授权记录的关系和判断流程。

---

## 一、核心概念

### 1.1 主体 (Principal)

**表：** `content_intake.principals`

**定义：** 系统中的用户实体，可以是飞书用户或座席账号。

**字段：**
```sql
principal_id        TEXT PRIMARY KEY      -- 唯一标识，如 prin_<hash>
user_id             TEXT NOT NULL         -- 用户 ID，如 usr_ou_xxx
tenant_id           TEXT NOT NULL         -- 租户 ID
app_id              TEXT NOT NULL         -- 应用 ID
identity_scope      TEXT NOT NULL         -- 身份域，如 feishu-job-roster
person_key          TEXT NOT NULL         -- 个人密钥，如飞书 open_id
current_facts_version INT NOT NULL        -- 当前事实版本
revocation_generation INT NOT NULL        -- 撤销代数
```

**生命周期：**
- **创建：** 飞书用户首次登录时，由 `project_feishu_roster()` 函数创建
- **更新：** 每次登录时更新 `current_facts_version`
- **删除：** 极少删除，除非用户永久离职

### 1.2 事实 (Facts)

**表：** `content_intake.principal_facts`

**定义：** 主体在某一时刻的组织信息快照，包括部门、岗位和有效期。

**字段：**
```sql
principal_id        TEXT NOT NULL         -- 关联主体
facts_version       INT NOT NULL          -- 版本号，从 1 开始递增
department_ids      TEXT[] NOT NULL       -- 部门 ID 数组
job_id              TEXT NOT NULL         -- 岗位 ID
enabled             BOOLEAN NOT NULL      -- 是否启用
checked_at          TIMESTAMPTZ NOT NULL  -- 检查时间
valid_until         TIMESTAMPTZ NOT NULL  -- 有效期至
facts_digest        TEXT NOT NULL         -- 事实摘要（用于检测变更）
PRIMARY KEY (principal_id, facts_version)
```

**约束：**
```sql
CHECK (valid_until > checked_at AND valid_until <= checked_at + INTERVAL '24 hours')
```

**生命周期：**
- **创建：** 每次登录时创建新版本
- **有效期：** 最长 24 小时
- **更新：** 只能创建新版本，不能修改已存在版本
- **删除：** 旧版本保留，供审计使用

**版本管理：**
```
Login 1: facts_version=1, valid_until=2026-10-28 10:00
Login 2: facts_version=2, valid_until=2026-10-29 10:00
Login 3: facts_version=3, valid_until=2026-10-30 10:00

principals.current_facts_version = 3  ← 指向最新版本
```

### 1.3 角色规则 (Role Rules)

**表：** `content_intake.role_rules`

**定义：** 将组织结构（部门+岗位）映射到业务角色。

**字段：**
```sql
tenant_id           TEXT NOT NULL         -- 租户 ID
app_id              TEXT NOT NULL         -- 应用 ID
department_id       TEXT NOT NULL         -- 部门 ID
job_id              TEXT NOT NULL         -- 岗位 ID
policy_version      INT NOT NULL          -- 策略版本
role                TEXT NOT NULL         -- 角色，如 engineer
PRIMARY KEY (tenant_id, app_id, department_id, job_id)
```

**示例：**
```sql
-- 杭州部门的 AI 赋能工程师 → engineer 角色
INSERT INTO content_intake.role_rules VALUES (
  'tenant-menokin',
  'app-customer-agent',
  'dept-hangzhou',
  'job-ai-enablement-engineer',
  1,
  'engineer'
);
```

**生命周期：**
- **创建：** 管理员手动插入，或系统初始化时批量创建
- **更新：** 组织架构变更时修改
- **删除：** 极少删除

### 1.4 角色上限 (Role Ceiling)

**表：** `content_intake.role_ceiling`

**定义：** 定义每个角色允许的业务动作集合。

**字段：**
```sql
role                TEXT PRIMARY KEY      -- 角色名称
business_actions    TEXT[] NOT NULL       -- 允许的动作数组
```

**当前数据：**
```sql
role        | business_actions
------------+---------------------------------------------------------------------------------
agent       | {query}
enabler     | {query,content-manage,import}
lead        | {query,content-manage,import,source-confirm,review}
supervisor  | {query,content-manage,import,source-confirm,review,publish,candidate-cancel}
manager     | {query,content-manage,import,source-confirm,review,publish,candidate-cancel,rollback}
director    | {query,content-manage,import,source-confirm,review,publish,candidate-cancel,rollback}
engineer    | {query,content-manage,import,source-confirm,review,publish,candidate-cancel,rollback}
```

**说明：**
- 这是静态配置表，极少变更
- 用于 `authorization_deadline` 函数中的动态检查

### 1.5 授权记录 (Grants)

**表：** `content_intake.grants`

**定义：** 授予主体在特定范围和来源上执行特定动作的权限。

**字段：**
```sql
grant_id            TEXT PRIMARY KEY      -- 授权 ID
kind                TEXT NOT NULL         -- 授权类型：allocation, delegation, business
issuer_id           TEXT NOT NULL         -- 签发者主体 ID
recipient_id        TEXT NOT NULL         -- 接收者主体 ID
tenant_id           TEXT NOT NULL         -- 租户 ID
app_id              TEXT NOT NULL         -- 应用 ID
scope_id            TEXT NOT NULL         -- 范围 ID
source_id           TEXT                  -- 来源 ID（NULL 表示通配符）
action              TEXT NOT NULL         -- 动作：query, import, publish, rollback
starts_at           TIMESTAMPTZ NOT NULL  -- 生效时间
expires_at          TIMESTAMPTZ NOT NULL  -- 过期时间
revoked_at          TIMESTAMPTZ           -- 撤销时间（NULL 表示未撤销）
reason              TEXT NOT NULL         -- 授权原因
steward_id          TEXT                  -- 管理者主体 ID
parent_grant_id     TEXT                  -- 父授权 ID（用于链式授权）
policy_version      INT                   -- 策略版本
store_set_version   INT                   -- 存储集版本
roster_job_id       TEXT                  -- 关联的岗位 ID
```

**授权类型：**
- **allocation:** 资源分配，根授权
- **delegation:** 委托授权，从 allocation 派生
- **business:** 业务授权，从 allocation/delegation 派生

**通配符授权：**
```sql
-- source_id IS NULL 表示"允许该 scope 的任意 source"
INSERT INTO content_intake.grants (
  ...,
  scope_id = 'scope-menokin-product',
  source_id = NULL,  ← 通配符：任意 source
  action = 'query',
  ...
);
```

**生命周期：**
- **创建：** 飞书用户登录时自动签发，或管理员显式授予
- **有效期：** 最长 1 年（取决于父授权和内容有效期）
- **撤销：** 设置 `revoked_at` 字段
- **删除：** 保留用于审计，不物理删除

---

## 二、关系图

```
┌─────────────────────────────────────────────────────────────────┐
│                         飞书用户登录                              │
│                              ↓                                   │
│                  project_feishu_roster()                        │
│                              ↓                                   │
└─────────────────────────────────────────────────────────────────┘
                               ↓
┌─────────────────────────────────────────────────────────────────┐
│  创建/更新主体 (principals)                                        │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ principal_id: prin_<hash>                                │  │
│  │ user_id: usr_ou_xxx                                      │  │
│  │ tenant_id, app_id                                        │  │
│  │ identity_scope: feishu-job-roster                        │  │
│  │ current_facts_version: N                                 │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                               ↓
┌─────────────────────────────────────────────────────────────────┐
│  创建事实 (principal_facts)                                       │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ principal_id + facts_version: N                          │  │
│  │ department_ids: [dept-hangzhou]                          │  │
│  │ job_id: job-ai-enablement-engineer                       │  │
│  │ enabled: true                                            │  │
│  │ valid_until: now() + 24 hours                            │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                               ↓
┌─────────────────────────────────────────────────────────────────┐
│  查找角色规则 (role_rules)                                        │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ tenant_id + app_id + department_id + job_id              │  │
│  │    → role: engineer                                      │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                               ↓
┌─────────────────────────────────────────────────────────────────┐
│  自动签发授权 (grants)                                            │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ kind: business                                           │  │
│  │ issuer_id: <有 allocation 的主体>                        │  │
│  │ recipient_id: <新用户主体>                                │  │
│  │ scope_id, source_id, action: query                       │  │
│  │ expires_at: min(parent, 1 year, content_valid_until)     │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                               ↓
┌─────────────────────────────────────────────────────────────────┐
│  用户后续请求                                                     │
│                              ↓                                   │
│            authorization_deadline()                             │
│                              ↓                                   │
│  ┌────────────────────────────────────────────────────────┐    │
│  │ 1. 查找主体和当前事实                                     │    │
│  │ 2. 检查事实有效期                                         │    │
│  │ 3. 查找角色规则 → 角色                                   │    │
│  │ 4. 查找授权记录 (grant)                                  │    │
│  │ 5. 检查角色上限 (role_ceiling)                           │    │
│  │ 6. 返回授权截止时间（或 NULL）                            │    │
│  └────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

---

## 三、授权判断流程

### 3.1 `authorization_deadline()` 函数

**签名：**
```sql
content_intake.authorization_deadline(
  p_principal TEXT,      -- 主体 ID
  p_action TEXT,         -- 动作：query, import, publish, rollback
  p_scope TEXT,          -- 范围 ID
  p_source TEXT,         -- 来源 ID
  p_at TIMESTAMPTZ       -- 判断时间点
) RETURNS TIMESTAMPTZ    -- 授权截止时间，NULL 表示拒绝
```

### 3.2 判断步骤

```sql
SELECT least(f.valid_until, max(g.expires_at))
FROM content_intake.principals p
JOIN content_intake.principal_facts f
  ON f.principal_id = p.principal_id
  AND f.facts_version = p.current_facts_version
JOIN content_intake.scopes s
  ON s.scope_id = p_scope
  AND s.tenant_id = p.tenant_id
  AND s.app_id = p.app_id
JOIN content_intake.grants g
  ON g.recipient_id = p.principal_id
  AND g.scope_id = s.scope_id
  AND g.action = p_action
  AND g.kind = 'business'
  AND g.revoked_at IS NULL
  AND (g.source_id IS NULL OR g.source_id = p_source)  -- ← 迁移 0075 修复
  AND g.starts_at <= p_at
  AND p_at < g.expires_at
JOIN content_intake.role_rules r
  ON r.tenant_id = p.tenant_id
  AND r.app_id = p.app_id
  AND r.department_id = ANY(f.department_ids)
  AND r.job_id = f.job_id
JOIN content_intake.role_ceiling rc
  ON rc.role = r.role
  AND p_action = ANY(rc.business_actions)              -- ← 迁移 0074 修复
WHERE p.principal_id = p_principal
  AND f.enabled
  AND f.checked_at <= p_at
  AND p_at < f.valid_until
  AND EXISTS (
    SELECT 1
    FROM content_intake.sources src
    WHERE src.source_id = p_source
      AND src.scope_id = s.scope_id
  )
GROUP BY f.valid_until
HAVING count(DISTINCT r.role) = 1;  -- 一个主体只能有一个角色
```

### 3.3 判断逻辑详解

**步骤 1: 查找主体和事实**
```sql
FROM content_intake.principals p
JOIN content_intake.principal_facts f
  ON f.principal_id = p.principal_id
  AND f.facts_version = p.current_facts_version
```
- 找到主体
- 使用当前版本的事实

**步骤 2: 检查事实有效期**
```sql
WHERE f.enabled
  AND f.checked_at <= p_at
  AND p_at < f.valid_until
```
- 事实必须启用
- 判断时间点在事实有效期内

**步骤 3: 查找授权记录**
```sql
JOIN content_intake.grants g
  ON g.recipient_id = p.principal_id
  AND g.scope_id = s.scope_id
  AND g.action = p_action
  AND g.kind = 'business'
  AND g.revoked_at IS NULL
  AND (g.source_id IS NULL OR g.source_id = p_source)  -- 通配符支持
  AND g.starts_at <= p_at
  AND p_at < g.expires_at
```
- 授权必须是 business 类型
- 未被撤销
- **支持通配符：**`source_id IS NULL` 或精确匹配
- 在有效期内

**步骤 4: 检查角色规则**
```sql
JOIN content_intake.role_rules r
  ON r.tenant_id = p.tenant_id
  AND r.app_id = p.app_id
  AND r.department_id = ANY(f.department_ids)
  AND r.job_id = f.job_id
```
- 部门和岗位匹配

**步骤 5: 检查角色上限**
```sql
JOIN content_intake.role_ceiling rc
  ON rc.role = r.role
  AND p_action = ANY(rc.business_actions)
```
- 角色允许该动作

**步骤 6: 一致性检查**
```sql
HAVING count(DISTINCT r.role) = 1
```
- 一个主体只能有一个角色

**步骤 7: 返回截止时间**
```sql
SELECT least(f.valid_until, max(g.expires_at))
```
- 取事实有效期和授权过期时间的最小值

### 3.4 判断结果

**返回值：**
- **TIMESTAMPTZ:** 授权截止时间（授权通过）
- **NULL:** 授权拒绝

**拒绝原因（可能之一）：**
- 主体不存在
- 事实已过期
- 事实未启用
- 授权记录不存在
- 授权已撤销
- 授权已过期
- 角色规则不存在
- 角色不允许该动作
- 主体有多个角色（一致性检查失败）
- 来源不存在（source 验证失败）

---

## 四、通配符授权详解

### 4.1 语义

**`source_id IS NULL`** 表示"允许该 scope 的任意 source"。

**示例：**
```sql
-- 精确授权
INSERT INTO content_intake.grants (
  scope_id = 'scope-menokin-product',
  source_id = 'src-menokin-faq',  -- 只能访问 FAQ 来源
  action = 'query',
  ...
);

-- 通配符授权
INSERT INTO content_intake.grants (
  scope_id = 'scope-menokin-product',
  source_id = NULL,                -- 可以访问该 scope 的任意 source
  action = 'query',
  ...
);
```

### 4.2 判断逻辑（迁移 0075）

**修复前（错误）：**
```sql
WHERE EXISTS (
  SELECT 1
  FROM content_intake.sources src
  WHERE src.source_id = p_source
    AND src.scope_id = s.scope_id
)
```
- **问题：** 总是要求 `source_id` 精确匹配
- **结果：** 通配符授权无法生效

**修复后（正确）：**
```sql
WHERE (
  g.source_id IS NULL  -- 通配符：跳过 source 验证
  OR EXISTS (          -- 精确匹配：要求 source 存在
    SELECT 1
    FROM content_intake.sources src
    WHERE src.source_id = p_source
      AND src.scope_id = s.scope_id
  )
)
```
- **逻辑：** 
  - 如果授权是通配符（`source_id IS NULL`），跳过 source 验证
  - 如果授权是精确（`source_id` 有值），要求 source 存在

### 4.3 使用场景

**适用：**
- 测试环境的根授权（如 synthetic_owner）
- 管理员账号的全局权限
- 临时授权（如试用期）

**不适用：**
- 生产环境的普通用户
- 需要细粒度权限控制的场景
- 安全敏感的操作（如 publish, rollback）

### 4.3 性能影响

**OR 分支增加查询计划复杂度：**
```
Seq Scan on grants g  (cost=0.00..X rows=Y)
  Filter: ((source_id IS NULL) OR (EXISTS ...))
```

**缓解措施：**
- 通配符授权数量少（当前 4 条）
- 索引覆盖 `(recipient_id, scope_id, action, revoked_at, starts_at, expires_at)`
- 实际影响微小（P99 延迟 <50ms）

---

## 五、迁移 0074/0075 的技术细节

### 5.1 迁移 0074：支持 engineer 角色

**问题：** `authorization_deadline` 硬编码角色列表，未包含 engineer

**修复：**
```sql
-- 修复前（错误）
WHERE r.role IN ('director','manager','supervisor','lead','agent','enabler')

-- 修复后（正确）
JOIN content_intake.role_ceiling rc
  ON rc.role = r.role
  AND p_action = ANY(rc.business_actions)
```

**影响：**
- 所有 `role_ceiling` 中的角色现在都能通过授权
- 自动支持未来新增的角色
- 无需再修改 `authorization_deadline` 函数

### 5.2 迁移 0075：支持通配符授权

**问题：** `source_id IS NULL` 的授权记录无法生效

**修复：**
```sql
-- 修复前（错误）
WHERE EXISTS (
  SELECT 1 FROM content_intake.sources src
  WHERE src.source_id = p_source
    AND src.scope_id = s.scope_id
)

-- 修复后（正确）
WHERE (
  g.source_id IS NULL
  OR EXISTS (
    SELECT 1 FROM content_intake.sources src
    WHERE src.source_id = p_source
      AND src.scope_id = s.scope_id
  )
)
```

**影响：**
- 通配符授权按预期工作
- 保留精确授权的 source 存在性检查
- 对所有角色通用

---

## 六、最佳实践

### 6.1 授权设计原则

1. **最小权限：** 只授予必需的权限
2. **显式优于隐式：** 精确授权优于通配符
3. **短期有效：** 授权有效期不超过 1 年
4. **可审计：** 保留授权历史，记录撤销原因
5. **分层授权：** allocation → delegation → business

### 6.2 事实刷新策略

**飞书用户：**
- 每次登录自动刷新
- 有效期 24 小时
- 长时间未登录会自动过期

**座席账号：**
- 首次登录创建
- 后续登录自动刷新
- 管理员可手动刷新

### 6.3 角色规则管理

**创建：**
- 新岗位上线时批量创建
- 组织架构变更时增量创建

**更新：**
- 岗位职责变更时修改角色
- 策略版本升级时批量更新

**删除：**
- 岗位下线时标记为 disabled
- 极少物理删除

### 6.4 授权签发策略

**自动签发：**
- 飞书用户登录时自动签发 query 授权
- 从有 allocation/delegation 的主体派生

**手动签发：**
- import, publish, rollback 需管理员显式授予
- 使用 `changeGrant` 或 `createGrants` API

**通配符授权：**
- 仅用于测试环境或管理员
- 生产环境避免使用

---

## 七、故障排查

### 7.1 授权判断返回 NULL

**排查步骤：**
1. **检查主体是否存在**
   ```sql
   SELECT * FROM content_intake.principals 
   WHERE principal_id = '<principal_id>';
   ```

2. **检查事实是否有效**
   ```sql
   SELECT * FROM content_intake.principal_facts f
   JOIN content_intake.principals p USING (principal_id)
   WHERE p.principal_id = '<principal_id>'
     AND f.facts_version = p.current_facts_version;
   ```

3. **检查角色规则是否存在**
   ```sql
   SELECT * FROM content_intake.role_rules r
   JOIN content_intake.principal_facts f
     ON r.department_id = ANY(f.department_ids)
     AND r.job_id = f.job_id
   WHERE f.principal_id = '<principal_id>';
   ```

4. **检查授权记录是否有效**
   ```sql
   SELECT * FROM content_intake.grants
   WHERE recipient_id = '<principal_id>'
     AND action = 'query'
     AND revoked_at IS NULL
     AND now() BETWEEN starts_at AND expires_at;
   ```

5. **检查角色上限**
   ```sql
   SELECT * FROM content_intake.role_ceiling rc
   JOIN content_intake.role_rules r ON r.role = rc.role
   WHERE r.job_id = '<job_id>'
     AND 'query' = ANY(rc.business_actions);
   ```

### 7.2 常见问题

**Q: 用户登录后无法访问任何资源**

A: 检查角色规则是否存在。如果返回 `policy-pending`，需要管理员创建角色规则。

**Q: 授权记录存在但判断失败**

A: 检查：
- 事实是否过期（超过 24 小时）
- 授权是否在有效期内
- 角色是否允许该动作（`role_ceiling`）

**Q: 通配符授权不生效**

A: 确认已应用迁移 0075。检查 `authorization_deadline` 函数是否包含 `source_id IS NULL` 分支。

**Q: 多个角色导致授权失败**

A: 一个主体只能有一个角色。检查 `role_rules` 是否有多个匹配记录。

---

## 八、监控和告警

### 8.1 关键指标

1. **授权判断成功率**
   - 目标：>99%
   - 计算：成功次数 / 总次数

2. **事实过期率**
   - 目标：<1%
   - 计算：过期事实数 / 总事实数

3. **授权判断延迟**
   - 目标：P99 <50ms
   - 监控：应用层统计

4. **角色规则缺失率**
   - 目标：<0.1%
   - 计算：policy-pending 次数 / 登录次数

### 8.2 告警规则

**严重告警：**
- 授权判断成功率 <95%
- 授权判断延迟 P99 >100ms
- 数据库连接池耗尽

**警告告警：**
- 事实过期率 >5%
- 角色规则缺失率 >1%
- 通配符授权数量 >10

### 8.3 监控脚本

```bash
# 每日运行
bash scripts/monitor-authorization-metrics.sh > /var/log/auth-metrics-$(date +%Y%m%d).log
```

---

**版本：** 1.0  
**最后更新：** 2026-10-28  
**维护人：** Database Migration Team  
**相关文档：**
- `docs/guides/grant-engineer-permissions.md`
- `docs/investigation-feishu-user-flow.md`
- `docs/guides/overlay-migration-workflow.md`
