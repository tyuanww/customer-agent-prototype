# 实际用途消费者合成验证

2026-10-08；产品 0.3.26。基于 `codex/intake-runtime-assembly-candidate` 的 `4eea8ea0d5f7c9ad20cc3254577c6ca237610810` 追加。仅合成 XLSX、身份、来源、scope 和历史记录，数据库由 Pg15Harness 创建并销毁。不读取真实数据、凭据或客户资料。旧 probe SQL 和历史日志保留不改。

## 实际结果

- 新专项 **13/13 PASS**：10 项实际 PG15 + 3 项适配单测，[consumer.log](consumer.log)。生产 service 消费实际 multipart 字节、接收/解析、确认来源、冻结质量与检查、确认发布；另一名真实合成认证主体读取 3 个非空 snapshot 页并检查 query 资格。发布/回退幂等、实际业务授权/撤销、确认回退、未知提交恢复、最后期限回滚均通过。
- 实际 worker 失败收尾写 report / 容量 / job；容量第一次 COMMIT 已提交但响应丢失时，事务不 ROLLBACK，连接标坏释放，占用保留。原 capacity 实现的 [红灯](capacity-before-fix.log) 精确失败于多发送 ROLLBACK；最终实现在专项中通过。红灯以 HEAD 的 capacity.ts 临时替换，finally 恢复，其余输入保持当时版本。
- approval-v1 使用管理员导入的合成历史包对象、review binding、候选与 lineage；撤销和过期均令实际旧 snapshot / rollbackPreview 拒绝，direct 新目录仍可读。并非真实飞书审批运行。
- 最后期限增加“回执确实已经写入”断言后，单独 [deadline.log](deadline.log) **1/1 PASS**，证明是在写完回执后到期并整体回滚；这是一处仅测试断言的补证，13 项日志生成于该断言追加前，其余测试输入未变。
- 默认 `terminalPool` 省略路径的 8 项既有实际 PG 回归已通过。首次从根目录运行时 7 PASS / 1 FAIL，[原日志](default-path-first.log) 保留；唯一失败是 capacity CLI 测试的相对路径要求 cwd=apps/api，未改源码。改用正确 cwd 重跑该项 [1 PASS](default-path-cli.log)，没有重跑其它已过项目。
- 定向 eslint、API `tsc --noEmit`、API build 均退出 0；[lint](lint.log)、[typecheck](typecheck.log)、[build](build.log) 原命令成功时无输出。没有全仓 PASS 声明；主 Agent 集成后统一执行全仓门禁。

这次确认并修复的生产内部问题只有容量事务 COMMIT 未知后仍 ROLLBACK；另增加可选 terminalPool 作为失败收尾依赖，默认原池。其余用途权限和锁适配均在 experiments 中，未接入生产 HTTP / factory / 正式 ACL。实际输入使用 Request 构造 multipart 后进入 `service.upload`，**没有启动 HTTP server**；复制验证是 query 资格检查，**未实测系统剪贴板**。

## 命令与输入

Mac arm64、Node v24.19.0、PostgreSQL 15.18、vitest 3.2.7；pnpm 锁定 11.19.0。PATH 含 `/Users/hutou/homebrew/opt/node@24/bin` 和 `/Users/hutou/homebrew/opt/postgresql@15/bin`。没有安装依赖；依赖符号链接仍指向主集成目录。API dist 由本工作区 `tsc -p tsconfig.build.json` 构建，未复制主工作区 dist，未提交生成物。

新专项（仓库根）：

```sh
CUSTOMER_AGENT_API_PG15_INTEGRATION=1 apps/api/node_modules/.bin/vitest run apps/api/tests/intake-runtime-consumers.integration.test.ts apps/api/tests/intake-runtime-consumer-pool.test.ts
CUSTOMER_AGENT_API_PG15_INTEGRATION=1 apps/api/node_modules/.bin/vitest run apps/api/tests/intake-runtime-consumers.integration.test.ts -t 'expires before COMMIT'
./node_modules/.bin/eslint apps/api/src/content-intake/service.ts apps/api/src/content-intake/capacity.ts apps/api/experiments/intake-runtime/consumer-pool.ts apps/api/tests/intake-runtime-consumer-pool.test.ts apps/api/tests/intake-runtime-consumers.integration.test.ts
```

默认路径首次命令（仓库根，已解释其中 CLI 的 cwd 错误）：

```sh
CUSTOMER_AGENT_API_PG15_INTEGRATION=1 apps/api/node_modules/.bin/vitest run apps/api/tests/content-intake.integration.test.ts -t 'capacity: serializes tenfold admission|capacity: adopted references|capacity: report quota refusal|records terminal failure when session revocation|replay of a terminal failed job|concurrent failure finalizers|records parser cancellation|cannot freeze after import permission'
```

正确 cwd 下重跑唯一失败项，以及 API 编译检查（apps/api）：

```sh
CUSTOMER_AGENT_API_PG15_INTEGRATION=1 ./node_modules/.bin/vitest run tests/content-intake.integration.test.ts -t 'capacity: serializes tenfold admission'
./node_modules/.bin/tsc -p tsconfig.build.json
./node_modules/.bin/tsc --noEmit
```

[checks.json](checks.json) 绑定最终输入与日志 SHA-256。仓内日志仅删除行尾空白和多余 EOF 空行；没有删改测试结果，原件为 `/tmp/intake-consumer-*.log`。空成功日志 SHA-256 为空文件的标准值，退出码见本报告。红灯日志对应修复前 capacity；最终输入清单不冒充红灯源码。默认路径测试和共享合成 host/seed 未修改。

## 权限与剩余边界

[用途矩阵](../../../apps/api/experiments/intake-runtime/PURPOSE-ACL.md) 和 [接线说明](../../../apps/api/experiments/intake-runtime/INTEGRATION.md) 解释旧 probe 与新增 consumer 候选。新 ACL 信任实际 service 绑定 actor 和业务授权；它不是逐用户 SQL 隔离。DB 仍拒绝根 allocation 新建/修改、身份安全列、业务角色组织事实改写、直接 publication、跨用途 report/input 和角色升级。

正式 ACL、窄锁迁移、生产账号/factory、真实范围与认领清单仍未批准或装配，本轮不声称已启用。旧 assembly 保持缺清单 `checked-not-activated / ready:false / legacyAdopted:false`。完整 `/review` 仍为 INCOMPLETE，没有重做旧角色审核或外部多模型流程，没有 push、PR、部署。工作区体积及全仓验证由主 Agent 集成负责。
