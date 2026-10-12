# 回环组织传输：观察方到资格消费者

任务 A。工作区 `/Users/hutou/.codex/worktrees/intake-org-runtime-candidate/customer-agent-prototype`，分支 `codex/intake-org-runtime-candidate`，起点 `0e6aea9e3b10b170f95e1e6114e2ec8d5fdf9872`，版本 0.3.26。只使用合成 fixture。没有读取真实令牌，没有连接飞书，没有改登录、角色上限、migration、共享 seed 或生产启动。实验通过不是正式合同批准，也不是生产装配获准。

## 所有者与最小接口

比较过两个边界。A 把套接字、令牌、字节预算和已发布频率折进观察方。B 把这些线路工作留在新的传输模块，原生字段、双扫描和五分钟窗口仍由既有观察方拥有，数据库仍只由既有受限 writer 拥有。采用 B。失败的读取不会变成快照，writer 事务里仍然没有网络 I/O。没有再加一层只转发同名参数的包装。

最小接口就是观察方已经导出的 `OrganizationTransport`：`user(openId, signal)` 与 `jobTitles(pageToken, signal)` 都返回原始 JSON 字符串。`createOrganizationHttpTransport` 实现该接口。调用方注入 `{ token, expiresAtMs }` 供应者、回环 origin 和 `requestTimeoutMs`。传输不读环境，不调用 `auth/v3/tenant_access_token/internal`。

失败路径：传输抛出只含代码的 `OrganizationTransportError`。观察方把非自身 `Rejected` 的错误收成 `DEPENDENCY_UNAVAILABLE`，并且不返回 snapshot。writer 不会被调用，事实版本和截止都不续期。页面不一致、缺字段、重名、停用和错命名空间仍由观察方拒绝。`checkedAt` 仍是注入时钟上的观察起点，`validUntil` 仍是起点加 300000 毫秒。

真实网络装配保持关闭。origin 必须是 `http://127.0.0.1:<显式端口>`，不能带用户信息、路径、查询或片段。只发 GET，`redirect: 'error'`，不重试。`Authorization: Bearer` 与 `Accept: application/json` 是仅有的请求头。

## 已执行的线路边界

依据 2026-10-08 查阅的公开文档：

- 用户 GET：https://open.feishu.cn/document/server-docs/contact-v3/user/get 。1000 次/分钟且 50 次/秒。查询固定 `user_id_type=open_id`、`department_id_type=open_department_id`。应用身份是注入的 tenant access token，不是登录 owner。
- 职务 GET：https://open.feishu.cn/document/contact-v3/job_title/list 。10 次/分钟，`page_size=50`。启用字段仍是布尔 `status`。
- 两份文档都没有公布单次请求时限。`requestTimeoutMs` 只是本实验预算，必须是 1 到 180000 的整数，对齐观察方既有 180 秒。

频率用完即拒绝，不排队、不退避。时钟回拨不重新发放额度。职务窗口和用户窗口分开。一次成功观察是 4 次职务调用；同一分钟内的第三次观察在职务调用上失败，观察方不产出快照。100 页双扫描无法同时满足 10 次/分钟和 180 秒，这是合同缺口，没有放宽上限。

响应字节上限 1048576。超过的 Content-Length 在读正文前拒绝；无长度的分块正文超过上限时取消读取。正好 1048576 字节可以返回。错误正文不进入异常文本。

供应者只在 `expiresAtMs > now` 时可用，没有时钟容差，也没有刷新循环。空令牌、控制字符和超长令牌拒绝。供应者抛出的文本不会成为错误消息。没有实现单飞合并。

授权仍只使用已确认的 `open_id`、`department_ids`、`user.job_title` 和职务目录的精确 `name`。姓名、租户管理员标记和登录身份不扩大授权。

## 消费链

合成 `node:http` 替身只监听 `127.0.0.1:0`。路径是原生用户与职务列表。同一传输实例依次经过既有观察方、临时 `synthetic_facts_writer`、`createContentIntakeService` 的 entitlement / snapshot / authorizations。

同一事实刷新得到 facts version 2、revocation 0，不延长已签发资格的 `valid_until`。多写 `mappingVersion` 被 writer 以 `INVALID_INPUT` 回滚。换岗后旧 snapshot 为 `PERMISSION_CHANGED`，角色投影为 `lead`，业务动作仍只有 `query`，新资格的 revocationGeneration 为 1。部门改到未映射部门后角色为空，新资格为 `SCOPE_DENIED`，旧 snapshot 为 `PERMISSION_CHANGED`，grant 行数不变。停用后 authorizations 与旧 snapshot 都是 `ORG_FACTS_UNAVAILABLE`。三次变化后 current facts version 为 5，revocation generation 为 3。`role_rules` 与 `user_id=user-agent` 不变。

未知 COMMIT 只保留原快照 S1。随后观察换成未映射部门并仍用 expectedFactsVersion 1 得到 S2；`write(S2)` 为 `VERSION_CONFLICT`，`write(S1)` 重放为 facts version 2。库里的 version 2 仍是 `dept-a` / `job-agent`。后页 HTTP 500 不写新事实，截止不变，且该页只请求一次。

## 正式化仍缺的合同项

这些项没有在本任务里发明规则，也没有把两次一致扫描当成上游原子快照：

1. `mappingVersion`、`directoryDigest`、`observedUntil` 仍只在观察结果旁返回。writer 拒绝多余键，所以不能落库。
2. `open_id` 与 principal 的对应由调用方给出。没有可信绑定登记或跨应用隔离证明。
3. 两次全量扫描只能发现漂移。没有观察新鲜度、缓存 TTL 或上游快照版本。
4. 令牌的保管、轮换、撤销、租户证明、时钟偏差和单飞合并没有决定。本传输只消费已注入且未过期的令牌。
5. 官方职务 10 次/分钟，与最多 100 页、双扫描、180 秒观察窗不能同时成立。
6. 1 MiB 预算是实验上限，不是已冻结合同字段。
7. 传输错误没有新的 OpenAPI 码，观察方继续收成 `DEPENDENCY_UNAVAILABLE`。没有传输层重试。
8. 没有生产装配开关。候选代码留在 `apps/api/experiments/intake-organization/`，`tsconfig.build.json` 排除 `experiments/**/*.ts`。

## 验证

指纹与命令见 [results.json](results.json)，输入见 [inputs.json](inputs.json)。日志为 [unit.txt](unit.txt)、[pg.txt](pg.txt)、[eslint.txt](eslint.txt)、[typecheck.txt](typecheck.txt)、[build.txt](build.txt)。`*.log` 被仓库忽略，所以证据用同内容的 txt。Node v24.19.0，pnpm 11.19.0，vitest 3.2.7，PostgreSQL 15.18。单元 23 通过。PG15 四项在 `CUSTOMER_AGENT_API_PG15_INTEGRATION=1` 下 4 通过、0 跳过。API typecheck 与 build 通过。`apps/api/dist` 不含本候选。

观察方与 writer 的 SHA-256 与 [既有原生观察输入](../native-observer/input-sha256.json) 相同，19 项单位测试和 10 项旧 PG 测试没有重跑。完整 `/review` 仍是 INCOMPLETE，本次没有再调用。workspace 32 MiB 阈值没有改。

## 交给主 Agent 的共享文件建议

本任务没有修改这些文件。

`docs/reference-content-intake-p2-contract-handoff.md` 在「原生组织观察离线切片」末段后增加：

```markdown
同目录 `http-transport.ts` 把传输边界接在既有观察方之前，只接受注入的应用身份令牌和 `http://127.0.0.1:<显式端口>`。它用全局 fetch 消费合成回环，不读取环境、不调用 token 端点、不跟随重定向、不重试。用户接口按 1000 次/分钟且 50 次/秒拒绝，职务接口按 10 次/分钟和 `page_size=50` 拒绝。字节上限为 1048576，请求预算不超过观察方既有 180 秒。失败不产生快照。该候选不进入 API dist。正式化仍缺映射版本与目录摘要的持久字段、open_id 绑定登记、新鲜度/缓存、令牌生命周期、10 次/分钟与 100 页双扫描的相容性，以及传输错误到正式错误码的映射。两次一致扫描不是上游原子快照。证据见回环传输验收 `evidence/qa/intake-organization/http-transport/README.md`。
```

`docs/reference-project-architecture.md` 约第 106 行那段末尾追加一句：同目录 `http-transport.ts` 是回环传输候选，注入应用令牌并执行已发布频率、1 MiB、超时和取消；真实网络装配仍关闭。

`docs/how-to-develop-content-intake.md` 约第 289 行后说明：下面两条独立测试还不在 `test:intake:organization` 里。

`apps/api/package.json` 的 `test:intake:organization` 在现有两个测试文件之后追加：

```text
experiments/intake-organization/transport.test.ts experiments/intake-organization/transport-consumer.integration.test.ts
```

追加后，how-to 里「19 项加 10 项」的句子也要改成包含这 23 项与 4 项，否则文档会少报本候选。
