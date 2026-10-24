# 坐席创建为什么做不出来（顾问诊断材料，2026-10-24）

给外部顾问的材料。要求：只看第 2 节和第 4 节。第 2 节是结论，第 4 节是要你回答的问题。

## 1. 症状

运营要能给外包客服建账号，然后逐个授权。今天做不到。

已试过三次，都失败：

| 尝试 | 做法 | 结果 |
| --- | --- | --- |
| 一 | API 直接写 `subject_bindings` + `principals` + `facts` + `role_rules` | 生产 ACL 不允许，四条路由全部 500 |
| 二 | 补 GRANT 给 `intake_business` | 查生产 ACL 发现那两张表只有集群所有者能写，不是漏授权 |
| 三 | 写 `role_rules` 时顺带修策略版本 | 这一步本身成了另一个 bug：写 `role_rules` 会作废全部已盖章的查询授权（已修，见 0066） |

三次都假设「API 角色可以写坐席那几行」。证据说不能。

## 2. 根因

**坐席生命周期从来没有一个特权所有者。桌面路径用集群所有者身份连一个本地合成库来代替它，这个替代在打包应用和生产环境里都不存在。**

证据链，逐条可查：

| # | 事实 | 类型 |
| --- | --- | --- |
| 1 | 生产 ACL：`backend_identity.subject_bindings` 只有 `stack_owner` 有 INSERT/UPDATE/DELETE；`content_intake.role_rules` 只有 `stack_owner` 有 INSERT。`intake_business` / `intake_usage` / `intake_directory_fn_owner` / `intake_runtime_fn_owner` 全都是 SELECT | 生产实测 |
| 2 | 桌面脚本的连接身份是 `user: 'stack_owner'`（`scripts/synthetic-stack/seat-account-runtime.ts:28`） | 读码 |
| 3 | 它连的库是硬编码 `customer_agent_synthetic`（`profile.ts:289`），socket 在 `<STACK_ROOT>/data/pg15-socket`（`profile.ts:284,287`） | 读码 |
| 4 | 打包清单只有 `out/**/*` 和 `package.json`（`apps/desktop/package.json` 的 `build.files`），该脚本不在包内 | 读码 |
| 5 | 脚本不存在时 IPC 直接返回「账号还不能在这里改。」（`seat-account-ipc.ts:65`） | 读码 |
| 6 | `/v1/intake/seats` 在仓内零调用方；渲染层仍走 `window.dashboardSeats` → spawn 本地脚本 | 实测 grep |

也就是说：**按钮存在，但它调的是本机一个不在包内的脚本，那个脚本要连一个本机不存在的数据库。** 运营在自己的电脑上点它，永远失败。

这解释了为什么「装了包也建不了账号」，也解释了为什么这个功能看起来一直差一点。

## 3. 为什么不是补授权就能解决

补 GRANT 会让 `intake_business` 获得对身份表的写权限。那等于把「谁能创建身份」这条边界交给任何一个能通过 `may_administer_seats` 的会话。

schema 现在是 owner-only，这是有意的：运行时角色不该直接造身份。

仓库里已经有正确的形状，而且已经在生产跑过：

```sql
CREATE FUNCTION backend_identity.admit_feishu_agent(p_open_id TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER ... AS $$
  IF p_open_id !~ '^ou_[A-Za-z0-9]{6,64}$' THEN RAISE EXCEPTION ... END IF;
  uid := left('usr_' || p_open_id, 128);
  INSERT INTO backend_identity.subject_bindings(...) VALUES (...) ON CONFLICT DO NOTHING;
$$;
REVOKE ALL ON FUNCTION backend_identity.admit_feishu_agent(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION backend_identity.admit_feishu_agent(TEXT) TO app_backend_auth;
```

生产里那条 `provider=feishu` 的绑定就是它创建的，所以这个形状在生产上成立。

坐席应该照这个形状做，而不是让任何 API 角色拿表的写权限。

## 4. 需要顾问判断的三件事

我不确定的是判断，不是事实。事实在上面。

### 4.1 坐席创建该不该有运行时特权函数

`admit_feishu_agent` 的入参是一个飞书 open id。它不可伪造，而且用户 id、绑定 id 都在函数内部推导，调用方什么都决定不了。

坐席创建的入参要多得多：显示名、登录名、岗位。都是调用方给的。函数得自己推导 user_id、binding_id、tenant、role，并且校验岗位在允许集合里。

安全面比 `admit_feishu_agent` 大，但比「给 API 角色表写权限」小。

> 问题：这个形状是否可接受？如果不接受，替代是「部署期 CLI 建账号」，代价是运营每次建人要跑命令，UI 上没有按钮。你倾向哪个。

### 4.2 一个真人一个主体，现在做不到

`principals_user_id_key` 是 `user_id` 单列唯一，而 `identity_scope` 被用来表达登录方式（`feishu-job-roster` / `production-admin` / `confirmed-synthetic`）。

所以「同一真人既有飞书身份又有账号密码身份」不是合并逻辑的问题，是表结构不允许。

> 问题：`user_id` 该不该是唯一键？如果允许一个主体多种凭证，凭证是否应拆到独立表，`identity_scope` 退化为「这条凭证谁核发的」。

### 4.3 审计与当前状态互相引用

`content_intake.grant_history.grant_id` 外键指向 `content_intake.grants`，而授权模型要求「撤销保留历史，不删行」。

生产实测：15 条外键自称 `convalidated` 却违反，约 117 行孤儿，全部指向一个已删除的历史主体。一份备份都还原不了（已用 `NOT VALID` 止血，见迁移 0065）。

> 问题：审计历史该引用「当前状态行」，还是自带不可变快照？如果引用，那「父行可以删」和「父行永远不能删」只能选一个。

## 5. 已经解决、不用再看的部分

| 项 | 状态 |
| --- | --- |
| 运营能不能授权 | 能。40 条根授权写入了运营本人的飞书主体，写前写后用真实触发器验证过 |
| 备份能不能还原 | 能。15 条约束改 `NOT VALID` 后演练 `DRILL PASSED`，账本 65、表 121、授权行 42 两侧一致 |
| 写 `role_rules` 作废全部查询授权 | 已修（0066 重盖触发器），实测策略版本 2→3 后可授出来源从 1 保持为 1 |
| 权限验证为什么会假绿 | 已修。原探针以超级用户连库绕过全部 GRANT；新工具按能力各自用自己的 LOGIN 连接 |

## 6. 一句总结

卡点不是缺代码，是**身份创建没有特权所有者，而桌面端用集群凭据冒充了它**。补授权会把边界问题变成安全问题。正确的修法是把坐席生命周期收成一个 owner 拥有的函数，入参不带任何身份字段。

这件事我可以直接做。要顾问看的是：这个形状的边界是否够窄，以及 4.2、4.3 两条更大的是不是该一起定。
