# 运行装配：无认领清单时的合成拒绝

2026-10-08。分支 `codex/intake-organization`。只在一次性 PG15 集群里使用既有合成 seed。没有认领清单、真实店铺、真实来源、保留期或生产账号。没有改迁移、生产 HTTP、VERSION，也没有把实验打进 API dist。

## 命令

先构建既有运行依赖，再只跑本文件。未设置环境变量时该文件 4 项全部 skip，skip 不是通过。

```sh
export PATH="$HOME/homebrew/opt/node@24/bin:$HOME/homebrew/bin:$PATH"
pnpm --filter @customer-agent/contracts build:runtime
pnpm --filter @customer-agent/database build:runtime
pnpm --filter @customer-agent/content-intake build
CUSTOMER_AGENT_API_PG15_INTEGRATION=1 pnpm --filter @customer-agent/api exec vitest run tests/intake-scope-runtime.integration.test.ts
```

环境：macOS arm64、Node 24.19.0、pnpm 11.19.0。数据库由现有 `Pg15Harness` 新建并在结束时关闭；harness 要求 PostgreSQL 15。最终 **4/4 PASS**。没有重跑组织刷新或会话锁原 8 项。

## 合成输入

`seedIntakeSyntheticHost` 已有的一次性身份和空目录：`rel_native_base` 有 catalog 行，lineage 与 legacy `release_items` 都是 0。店铺只使用 seed 里的 `shop-a` / `source-a` 与 `shop-b` / `source-b`。装配输入固定为 `{ claimManifest: null }`。测试把非空对象交给装配函数，只为证明它被拒绝；那些字段没有写入目录或授权。

角色观察使用 seed 里的 `director` 与 `agent`。停用、换岗和换部门走既有 `createOrganizationFactsWriter`。会话锁安装既有 `experiments/intake-runtime/session-lock.sql`，不改 SQL。

## 通过项

| 验证 | 实际观察 |
| --- | --- |
| 管理员与空目录 | `gate_owner` 能看到空 catalog，且能执行 `inherit_legacy_catalog`、能写身份表。`legacyAdopted` 仍为 false，`content_current` 与 lineage/grant 计数不变 |
| 来路不明的清单 | `null`、空对象、空数组、多字段，以及带 seed 标识的对象都返回 `CLAIM_LIST_UNUSABLE`。错误文本不包含这些标识，账本不变 |
| 受限账号 | 没有目录 SELECT 时结果是 `ASSEMBLY_UNREADABLE`，不视为已承接。只补目录 SELECT 后能看见空目录，仍不是管理员池，`legacyAdopted` 为 false |
| 身份表 | 安装窄函数后，用途账号对 sessions、subject_bindings、capability_bindings、login_requests 的插入/更新/删除/清空均为 42501；不能替换函数、不能 `SET ROLE` 到函数 owner、不能插入 lineage 或调用 inherit。函数正文没有 DML。账本不变 |
| 角色名 | `director` 的登录角色是 owner、岗位规则是 director，但没有业务 grant，查询和发布都不成立。把 `agent` 的登录角色改成 owner、岗位规则改成 director 后，仍不能查询 `shop-b`，也不能发布或管理 `source-a`；原查询 grant 仍在。writer 停用后查询消失。换到另有 director 规则的岗位后，查询 grant 还在，`shop-b` 和发布仍没有。部门落到没有规则的 `dept-out` 后查询消失。grant 总数与 `shop-b` 授权保持 0。自由文本角色名被身份表 CHECK 拒绝 |

## 未证明

没有获准的认领清单，因此没有做首次承接、后续修改或范围内显式停用。没有真实店铺名、来源清单、保留期或生产账号。生产 factory、HTTP 路由、正式 ACL 迁移和完整坐席签发/分页、管理与 worker 权限都没有接线。窄函数仍只由测试安装，现有 `transaction.ts` 未改接。原生组织同步、审批 transport 和历史删除不在本轮。组织刷新与会话锁的既有证据没有重跑。
