# 运行装配候选收尾（2026-10-09）

状态：本地合成候选已验证；**不进入生产构建、不激活真实运行**。起点 `01d7a0c6ef965a7e36a0578168b92d04038ea298`，版本保持 0.3.26。主 Agent 统一回收，不修改共享计划/TODOS、合同锁或 migration。

## 实际补齐

新增 [`runtime-candidate.ts`](../../../apps/api/experiments/intake-runtime/runtime-candidate.ts) 是一个资源所有者：先完整检查显式配置，再逐一验证四个用途池和独立 auth 池，检查对象存储，装配原有认证、usage、management HTTP，最后只监听回环地址。生产 `app.ts` / `server.ts` / API 导出不引用它，`tsconfig.build.json` 仍排除 experiments。

比较过两个边界：直接在既有 server 加启用开关，会混合旧单池和新四用途的启动/关闭责任，也可能提前打开未授权的正式路径；本轮采用独立候选 owner，复用冻结协议已经确定的应用装配责任。未迁移事务/角色/解析/授权知识，不重做既有工程边界方案批准。正式启用不是把 profile 改成 production：该值被拒绝。

| 接口 | 所有者与约束 |
| --- | --- |
| `startIntakeRuntimeCandidate(config)` | 本候选拥有启动顺序、五个池、插件与资源收尾；显式本机 Unix socket，五个不同 LOGIN，无环境配置读取 |
| OAuth code → ProductSession | 复用 `createFeishuIdentityProvider` 与 `createProductAuthService`；本测试注入模拟 OAuth 响应，未向真实飞书发请求 |
| HTTP actor → 登记主体 | 使用真实私有 actor 对象；另要求当前 tenant/app 内有效组织登记，未登记/跨 app 拒绝；原事务仍逐次校验会话、当前事实与业务授权 |
| `observe(principalId)` | 仅可信本地控制，不注册 HTTP；复用 registered-refresh，从登记读取 open_id，再经原回环 transport、共享 token/配额 owner、双扫描 observer |
| `write(originalObservation)` | 复用原受限组织 writer 的 CAS、原信封摘要、期限、回执与 COMMIT 未知语义；重新 observe 不是旧写恢复 |
| `close()` | 同一 promise 幂等；先停止新控制/取消观察并关闭 token owner，再等待 HTTP 解析队列与在途操作，最后关闭认证和四用途池 |

worker 只接原 management 插件的终态与报告路径。每次池借出仍由 `runtime-pool` 执行冻结 `SET ROLE/assert_purpose`。登录 UI role 不能变成 business grant。配置验证前依赖仍由调用者持有；配置通过后即由候选接管 provider，启动失败也关闭一次。对象目录保留供重启恢复；不自动删除资料或认领旧目录。

## 验证

一次性 PostgreSQL 15.18，Mac arm64，Node 24.19.0、pnpm 11.19.0。工作区依赖使用 APFS 克隆，包内相对 workspace 链接指向本 worktree；没有安装依赖或共享可写 dist。

```sh
CUSTOMER_AGENT_API_PG15_INTEGRATION=1 pnpm --filter @customer-agent/api exec vitest run tests/intake-runtime-closeout.integration.test.ts --no-file-parallelism
```

最终 **23/23 PASS**，真实执行当前35段迁移后，非超级用户分别消费 auth/business/usage/worker/organization。原始结果见 [PG 日志](pg-final.txt)，精确输入/命令/摘要见 [checks.json](checks.json)。主要验证：

- 注入合成响应的既有 Feishu provider 完成 code→open_id→已有身份绑定→真实会话；本机原生形状通讯录 HTTP、登记观察、受限组织写入、原信封重放、usage 资格及 management 拒绝闭环。
- 有效整理身份通过实际 multipart 上传→异步隔离解析→坏文件终态→worker 报告落盘→既有报告下载；未产生候选/发布。
- 停用、部门/精确岗位变化与事实到期不借旧资格；岗位变化失效旧 entitlement，未假定所有换岗必然禁止新的合法 query。
- 缺岗位、无登记与 HTTP 503 均未修改旧事实或延长期限。异 app 的已认证身份拿不到 intake 资格。
- 在途通讯录读取能被 close 取消；数据库无残留候选连接；重启后同一观察回执可重放且不重复增加事实版本。
- 用途交换、管理员账号、auth 缺权限、存储不可用均启动失败并释放已取得资源；scope 不同、远端通讯录 origin、重复 LOGIN、production profile、隐式数据库地址在取得资源前拒绝。

根 `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` 均实际通过。独立审查修复后重跑根lint/typecheck、API常规测试及23项PG；experiments未进入构建，复用未变正式源码的build及其他包测试。根测试时新增文件含19个用例，API常规运行567 PASS / 351 SKIP；之后补入worker端到端用例，重新运行API typecheck、局部lint、API常规测试及最终23项实际PG验证。没有因此机械重跑无改动的桌面构建与测试。最终API常规测试567 PASS / 355 SKIP（其中本候选23项仅由显式PG命令启用），package smoke 3/3 PASS。根测试的database 26、desktop 7个跳过继续保留；普通根test不启用PG，不将SKIP写成PASS。

前几轮新测试存在测试输入/断言错误：漏 `challenge_method`、误用403替代既有404拒绝、尝试UPDATE不可变事实、把预期授权拒绝诊断误认作零诊断。已修正测试；到期用原writer写入合成短租约并等待实际截止，不绕开不可变约束。这些测试输入问题未改产品业务实现；独立审查的两项候选生命周期/接口问题则按上述记录修复。原失败日志与最终日志均保留，摘要列在checks。

## 审查和复用

本机最终差异审查已核对：资源没有新增第二事务所有者；scope过滤不复制角色规则；actor未clone；shutdown先settle再end；未知写回执不被close伪装为回滚；新模块没有生产导入。独立只读复核发现 provider.close 抛错可能阻止既有 auth owner 关闭池，以及对象展开丢失 class provider 原型方法；候选已改为显式委托、收集关闭异常后继续释放并最终汇总，三项实际PG回归通过。另纠正管理员负例使用真实 gate_owner，按当前隔离DB所有其他客户端连接验证无泄漏。外部审查交主 Agent，**完整 `/review` 仍 INCOMPLETE**。

原 observer/writer/transaction/service/runtime-pool 以及35段SQL未改。以前的上游字段矩阵、受限发布/回退、COMMIT未知与旧8行承接证据仍保留原输入范围，见[正式合成接入](../intake-parallel-recovery/runtime-formal/README.md)和[旧目录ACL](../intake-legacy-acl-runtime/README.md)。本轮没有重新模拟未知COMMIT故障，也没有重做15/15角色审核。新候选真实跑了回执跨重启重放，但不能据此把整套发布或未知提交矩阵写成本轮复测。

## 剩余正式条件与准确消费者

- 可信 registrar 仍须建立 `backend_identity` 登录绑定、`content_intake.principals` 归一主体、`intake_organization` tenant/app/principal/open_id 的一致性并维护登记有效期。候选可以检查已认证user_id是否有当前scope登记；冻结的用途ACL不允许应用读取全部身份安全列，不能把该检查称为真实租户/完整主体绑定证明。不得为此扩大本轮ACL。
- 真实 Feishu client/redirect与凭据由既有身份provider配置拥有；真实组织 app token、租户证明、新鲜度和多实例配额协调仍需要实际环境输入与批准。当前 transport 只接受回环地址；不新增token端点、后台自动同步或真实通讯录发现。
- 五个正式受限LOGIN的安全连接配置、对象目录/容量配置、维护者、真实来源与具名主体由环境及既有范围决定提供；不从合成fixture复制名称、ID或凭据。Menokin/飞书表格CSV/首期岗位范围已经确定，不重问。
- 当前启动API固定本机合成验证，不替代生产server注册、部署、安全密钥托管、旧内容认领、真实资料接入及Mac/Windows最终安装验收。

新README的本地引用全部可读；整仓docs:check在新worktree缺少13个旧文档指向的被忽略.gstack文件，退出1，本轮未复制或修改这些历史证据。workspace:check实际为remainder 39.4 MiB / 32 MiB，root policy PASS。源码体积预算由任务A并行处理；本任务不调阈值、不排除证据、不删除历史。没有push、PR、合并或部署。
