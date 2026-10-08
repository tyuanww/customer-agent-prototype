# 用途装配候选

2026-10-08。产品版本保持 0.3.26。工作区从 `0e6aea9e3b10b170f95e1e6114e2ec8d5fdf9872` 分出 `codex/intake-runtime-assembly-candidate`。只使用一次性 PG15 里的合成身份。没有真实组织、客户、员工、凭据或业务库。

这是正式合同前的实验。11 项专项通过不表示用途 ACL 已冻结，也不表示生产装配获准。旧会话锁 8 项和无认领清单 4 项没有重跑，不能把它们记成这次的 PASS。

## 命令

在 `apps/api` 下，PATH 含 `$HOME/homebrew/opt/node@24/bin` 和 `$HOME/homebrew/bin`。依赖目录是指向集成工作区的符号链接，没有执行 `pnpm install`。

```sh
./node_modules/.bin/eslint \
  experiments/intake-runtime/assembly.ts \
  experiments/intake-runtime/purpose-boundary.ts \
  tests/intake-runtime-assembly.test.ts \
  tests/intake-runtime-assembly.integration.test.ts
CUSTOMER_AGENT_API_PG15_INTEGRATION=1 \
  ./node_modules/.bin/vitest run \
  tests/intake-runtime-assembly.test.ts \
  tests/intake-runtime-assembly.integration.test.ts
```

环境：Mac arm64、Node v24.19.0、pnpm 11.19.0、PostgreSQL 15.18 Homebrew、vitest 3.2.7。集成测试自己 `Pg15Harness.start()`、建库 `intake_runtime_assembly`、迁移、`seedIntakeSyntheticHost`，结束后关闭集群。

结果：**11/11 PASS**（单测 4，PG15 7）。日志 [vitest-final.log](vitest-final.log)，sha256 `2c1391fb3b10484e339d3c841927f61740830116dc53a812d104ac7ab559c750`。日志只有测试摘要，没有租约 token、会话密钥或连接口令。

eslint 退出码 0。`tsc --noEmit` 对本任务文件没有新错误。既有 `tests/support/intake-synthetic-host.ts` 仍因缺少 `apps/api/dist` 报模块找不到；没有为了消掉它生成 dist 或改该文件。没有跑全仓 `pnpm test`、`pnpm build` 或 `workspace:check`。新增源码、测试和这份日志共 83877 字节；两份说明和本 README 另计。基线 `workspace:check` 已超 32 MiB 约 331 KiB。没有删除历史证据，也没有放宽阈值。

## 原始提交 57325a9 输入哈希（回收前）

| 文件 | sha256 |
| --- | --- |
| `purpose-acl.sql` | `849d46d06d392f5bd52b64307401e649492f9ec8dd172fc817b189a38eab7856` |
| `purpose-boundary.ts` | `fb0bbb1d74609cd0083056837c3c29740ca50036ab03fad2a83b6fab9dd2a1aa` |
| `assembly.ts` | `c437adc9dc1eedb09968e0e1d80d3c132d1b907fc87c624ffc337832001f76a7` |
| `session-lock.sql`（未改） | `4e8928fd8bc2efd2e8ec45d2fc3d08e000fa82373f6c237a9472d3fc549efca1` |
| `intake-runtime-assembly.test.ts` | `a02b8e8b22d044d6a8d203983eb3e7bbdf61c3240db38e7fb573ca01d8ac5703` |
| `intake-runtime-assembly.integration.test.ts` | `c0ec965d78d13f6da4c0e559e34c4eb9e86c98190651664242e91d489bb40668` |

权限矩阵和接线差异见 [PURPOSE-ACL.md](../../../apps/api/experiments/intake-runtime/PURPOSE-ACL.md)、[INTEGRATION.md](../../../apps/api/experiments/intake-runtime/INTEGRATION.md)。

## 未验证

- 正式 snapshot 分页闭包、完整发布成功、质量计划写入、授权写入。
- approval-v1 的真实失效行。usage 不能插入 `approval_facts` 已验证。
- 治理冻结、export、intake、正式迁移号、生产账号和真实来源清单。
- 完整外部 `/review` 仍是 INCOMPLETE。没有为消除该标记再次调用。
- 旧角色审核 15/15 没有重做。

## 2026-10-08 主 Agent 回收修复

原 `vitest-final.log` 与以上 11 项历史证据保留；本节覆盖追加修复后的候选。版本仍是 0.3.26，未改正式迁移、运行工厂或 HTTP。

实际发现并修复：

- 数据库检查等待中调用 cancel/close 后仍返回 running，并发 start 也能重复通过。现在启动前占位、每次异步读前后检查取消，失败后释放占位；借用连接由调用方拥有。本模块不终止数据库查询，等待返回后丢弃结果。
- 缺认领材料的成功依赖检查改为 `checked-not-activated` / `ready:false`，不再宣称运行。始终 `legacyAdopted:false`。
- 函数属主原先缺文本 digest、随机票据和 family 校验的 EXECUTE。一次性 PG15 上三者原先均 42501；仅向 NOLOGIN 属主补足这三项，并给 purpose_gap 加对应检查。已逐项撤权证明缺失可被发现；business 仍不能直接执行随机票据函数。
- 把实验资格/目录/授权入口显式命名为 probe，去掉固定 shop-a。临时资格 SQL 只用于验证现有 service 会话锁尚不兼容时的租约/context/ACL 组合。实际消费者接线与删除条件见 INTEGRATION，不把空目录读取写成完整分页或复制通过。

先跑新增回归得到 4 个失败：[红灯日志](vitest-recovery-red.log)。其中并发启动旧实现表现为等待超时，后将测试改成释放等待后断言拒绝，避免把超时作为最终回归断言。随后完整本专项 **15/15 PASS**（单测 7，PG15 8）：[修复后日志](vitest-recovery.log)。它们仍不覆盖完整发布成功、非空正式 snapshot、真实 approval-v1 失效与质量/授权写入。

本次在仓库根运行：

```sh
PATH=/Users/hutou/homebrew/opt/node@24/bin:$PATH \
  CUSTOMER_AGENT_PG15_BIN=/Users/hutou/homebrew/opt/postgresql@15/bin \
  CUSTOMER_AGENT_API_PG15_INTEGRATION=1 \
  apps/api/node_modules/.bin/vitest run apps/api/tests/intake-runtime-assembly.test.ts apps/api/tests/intake-runtime-assembly.integration.test.ts
./node_modules/.bin/eslint apps/api/experiments/intake-runtime/assembly.ts apps/api/experiments/intake-runtime/purpose-boundary.ts apps/api/tests/intake-runtime-assembly.test.ts apps/api/tests/intake-runtime-assembly.integration.test.ts
```

vitest 和 eslint 退出码 0。`apps/api` 下 `./node_modules/.bin/tsc --noEmit` 仍被已有测试宿主对缺失 `apps/api/dist` 的导入阻塞，全部诊断只落在 `tests/support/intake-synthetic-host.ts`，不是完整 typecheck PASS：[原始诊断](typecheck-recovery.log)。未修改共享宿主或为通过检查生成 dist；主 Agent 集成时统一 build/typecheck。没有运行完整 `/review`、旧角色审核或工作区体积检查。

修复后 `purpose-acl.sql` SHA-256：`4bb27efc556c9931b70386c29982db68dd2ee9e050feccc1dd6772a160fae23c`。修复后 vitest 日志 SHA-256：`06b7daa6205c20a56f6cf274898219af4e0b3546706b4b654bc525bf82a54aea`。仓内新增日志仅裁去行尾空白与多余 EOF 空行，未删改测试输出；未规范化原件仍在 `/tmp/intake-runtime-recovery-{red,green,typecheck}.log`。
