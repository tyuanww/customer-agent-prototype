# 坐席账号纵切为什么被撤回（2026-10-24）

`0066` 与 A2 的坐席账号实现曾推送为 `7eeb601d`，随后撤回为 `43ba6c6d`。实现保留在分支 `wip/seat-accounts`。本文记录撤回原因，因为它决定了下一张卡怎么写。

## 结论

这条纵切在真实 schema 上有四个阻断问题。其中第一条不是缺陷，是**设计冲突**，需要先决定才能继续。

## 1. 写 role_rules 会让整个租户的查询授权失效（决定性问题）

`content_intake.role_rules` 上挂着 `role_history` 触发器，调用 `record_policy_history()`：

```sql
INSERT INTO content_intake.policy_versions VALUES (coalesce(NEW.tenant_id,OLD.tenant_id), coalesce(NEW.app_id,OLD.app_id), 1)
  ON CONFLICT (tenant_id,app_id) DO UPDATE SET version = content_intake.policy_versions.version + 1;
```

而 `authorization_sources` 要求 `grants.policy_version` 等于当前策略版本，`authorization_deadline` 同样。

生产实测（事务内插入一行 `role_rules` 后回滚，库状态未变）：

```text
policy_now=30
operator_sources_before=2
INSERT role_rules ...
policy_after_probe_insert=31
operator_sources_after_probe=0        ← 运营本人的可授出来源归零
policy_after_rollback=30
operator_sources_now=2
```

后果链：`may_administer_seats` 要求 `authorization_sources(...)` 非空。建第一个坐席时该检查在当前版本下通过，插入 `role_rules` 之后版本 +1，此后再建坐席、再授任何权都失败。

**这是一个自锁开关：** 第一个坐席建完，运营就再也授不出权，包括给那个坐席授权的权。

所以坐席创建**不能**在运行时写 `role_rules`。岗位到角色的映射必须在部署期就位。

真问题是：任何 `role_rules` 变更都会作废全部已盖章的查询授权，而唯一会重盖 `policy_version` 的 `restamp_query_grants` 只挂在 `store_set_current` 上（0059）。这属于授权判定语义，本线工作不得自行改动，因此停下。

## 2. 四条路由在 `intake_business` 下没有任何写权限

路由经 `management-http.ts` 注册，池是 `intake.business`，即 `SET ROLE intake_business`。实测权限：

| 检查 | 结果 |
| --- | --- |
| `intake_business` INSERT `backend_identity.subject_bindings` | false |
| `intake_business` UPDATE `backend_identity.subject_bindings` | false |
| `intake_business` INSERT `content_intake.principals` | false |
| `intake_business` INSERT `content_intake.role_rules` | false |

四个端点在生产上会全部 500。

对照 `project_feishu_roster`：登录侧拿的是 `GRANT EXECUTE ... TO intake_business`（0046），写操作收在 definer 函数里。坐席应沿用同一形状，而不是让 renderer 侧角色直接 DML。

## 3. `reset` / `disable` 能寻址内置合成身份

两者只按 `binding_id = 'synthetic_' || username` 找行，不校验目标是不是坐席。

`synthetic_owner` 的 `user_id` 是 `usr_synthetic_owner`，对应主体 `hz-allocator`，**持有 7 条根授权**。于是：

```text
POST /v1/intake/seats/owner/password   → 给该绑定设口令，等于拿到主账号身份
DELETE /v1/intake/seats/owner          → 停用主账号的绑定
```

这把「坐席管理」变成「任意合成身份接管」。修法至少两条同时做：坐席绑定换独立命名空间（`synthetic_seat_*`），且 `reset`/`disable` 要求目标存在 `seat_posts` 行。

## 4. 授权门过松

`may_administer_seats` 只检查「有 `action='query'` 的 allocation 且 `steward_id IS NOT NULL`」加「有非空可授出来源」，**不看角色有没有分配权**。

`0057_role_ceiling.sql` 写明 `supervisor`/`lead`/`agent` 的 `may_allocate = false`。而 `authorization_sources` 对 `agent` 的 `query` 是放行的，所以一个持有根授权加一条 query 业务授权的客服主体也会通过。

另外 `steward_id IS NOT NULL` 几乎恒真：经 API 创建的 allocation 一律把 steward 设成 recipient 自己。区分「根」的真正判据是 `parent_grant_id IS NULL`。

## 我的验证为什么没抓到这些

我在杭州临时集群上跑出的 `verify=PASS`、`may_administer(operator)=true`、`project_seat_login=projected` 全部通过，但这些证据**无效**。

原因：探针以 `stack_owner` 连接，而它是超级用户（`rolsuper = true`），绕过所有 `GRANT` 检查。生产 API 以 `intake_business` 连库，权限缺口在那条路径上才暴露。

这是本轮最该记住的一条：**用超级用户跑权限测试，等于没跑。** 后续任何涉及 ACL 的验证必须以目标角色连接，或显式 `SET ROLE`。

## 撤回后的状态

| 项 | 状态 |
| --- | --- |
| `main` | `43ba6c6d`，树与 `11b57260` 一致（只差坐席改动） |
| 坐席实现 | 保留在 `wip/seat-accounts`，未删除 |
| 生产 | 未部署 0066，仍是账本 65 |
| 0065 / 备份 / 恢复演练 / 数据字典 | 不受影响，仍在线上 |

## 下一步需要先决定的一件事

**岗位到角色的映射在哪里写，以及写完之后谁来重盖已盖章的查询授权。**

三个方向：

1. **部署期预置**：迁移里插入 `job-seat` 与 `job-seat-supervisor` 两条规则，并在同一事务内重盖该租户的 query 授权。需要回答 `restamp_query_grants` 能否被显式调用，以及重盖后原有 `expires_at` 语义是否保持不变。
2. **改为不依赖 `role_rules`**：坐席的角色直接存在 `seat_posts` 上，`authorization_deadline` 额外读它。这会改动判定函数，属于语义变更。
3. **接受一次性地基调整**：把 `role_rules` 变更也接上 restamp，作为一次性架构修正，之后运行时写 `role_rules` 才是安全的。

我倾向 3，因为它同时消掉一个既有的地雷（任何策略管理改动都会静默作废全部查询授权），但它改的是授权判定链路，需要先批准。

在这条决定之前，A2 的坐席创建不能实现。

## 复现

```bash
# 生产只读复现：一行 role_rules 如何清空可授出来源
sudo -u customer-agent env PATH=/opt/pg15/usr/lib/postgresql/15/bin:/usr/bin:/bin \
  psql -h /srv/customer-agent/stack/data/pg15-socket -p 43199 \
       -d customer_agent_formal -U stack_owner
```
