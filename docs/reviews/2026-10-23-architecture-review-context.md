# 架构与服务设计盘查上下文（2026-10-23）

这份文档是给外部顾问的输入，不是结论。它记录当前真实状态、我判断有问题的地方、以及我这一轮临时补在症状层的东西。顾问应当自己核对，不要只信这里的判断。

仓库 `/Users/hutou/Desktop/customer-agent-prototype`，`main` 提交 `14106f84`，版本 `0.3.32`。生产在杭州一台 Windows 桌面的 WSL 里。

## 一、当前真实状态（实测）

| 项 | 值 | 来源 |
| --- | --- | --- |
| 生产当前 release | `14106f84a523b1865704d6e95decf92a8baf4bc2` | `readlink -f /srv/customer-agent/current` |
| `/ready` | 200，五项 checks 全 ok | `curl` |
| 迁移账本 | 64 条，最后 `0064_roster_query_requires_reader` | `customer_agent_meta.schema_migrations` |
| 数据库对象 | 7 个 schema，121 张表，294 个函数，114 个触发器 | `information_schema` / `pg_proc` / `pg_trigger` |
| 主体 | 5 个 | `content_intake.principals` |
| 来源 | 6 个，其中 5 个 `legacy`，1 个 `v2-preview` | `content_intake.sources` |
| 授权 | 42 条（含已撤销） | `content_intake.grants` |
| 已发布 SOP 内容 | 0 | `release_lineage` 无 `src-menokin-sop-v2` |
| 代码规模 | renderer 63 个 ts/tsx，IPC 通道 47 个 | 文件统计 |
| 迁移 | 64 个，其中 36 个是手写 overlay | `packages/database/overlays` |

## 二、这套系统现在已经跑通的

顾问需要知道边界，避免把已经工作的部分当问题重做。

- 上传 → 解析 → 候选 → 人工质量检查 → 来源确认 → 发布 → 第二个坐席读到正文与图片字节。合成工作簿在真实 PG15 上 11 项通过。
- 按真实工作簿规模（277 条、47 图、六表不同行数、含多行答案）跑通全链路，坐席分 6 页取回 277 条且标识唯一。杭州实测 16.7 秒。
- Windows / macOS / Linux 三平台未签名包装包已发布，桌面端连杭州 HTTPS 后显示八页工作台。
- 授权链、事实租约、店铺集推进三处各有穷尽检查，附负向对照证明检查能抓到破坏。

## 三、前端设计的问题

### 3.1 导航的身份是复用的，不是声明的

`apps/desktop/src/renderer/DashboardApp.tsx:94-102`：侧栏由基础导航数组循环加条件插入拼出来。

```
for (const item of sidebarItems(canOpenPermissions)) {
  items.push(item);
  if (item.id === 'content') items.push({ id: 'publish', label: '内容管理' });
}
items.push({ id: 'materials', label: '资料管理' });
```

`DashboardApp.tsx:160-163` 再把同一个 `content` 改名为「知识库」。

后果：`content` 这个 id 在旧 profile 里是「内容管理」，在新 profile 里是「知识库」。同一个标识指两件不同的事。页面顺序不是一张表声明出来的，而是插入顺序的副产物。要新增一个板块，你得知道往哪个 `if` 里塞。

判断：这是领域建模错误，不是样式问题。顾问应决定导航是数据驱动的一张声明表，还是继续靠条件拼装。

### 3.2 单文件过大且职责混杂

实测行数：`QueryApp.tsx` 1873，`DashboardApp.tsx` 1406，`overlay-controller.ts` 1808，`FoxApp.tsx` 1083，`dashboard-manifest.ts` 830。

`DashboardApp.tsx` 同时拥有：profile 分支、导航构建、窗口拖拽与折叠动效状态机、会话轮询、按角色算按钮可见性、以及 8 个页面的挂载。

判断：这是复杂度集中，不是行数问题。顾问应判断该按「一个页面一个模块」还是按「一个状态机一个模块」拆。

### 3.3 两个 profile 共用一个组件

`DashboardWorkspace({ profile }: { profile: 'legacy' | 'intake' })`，全文散落 `profile === 'intake'` 判断。旧 profile 的模块（`WordingLibraryModule`、`AnnounceModule`、`ContentModule`）与新 profile 的模块（`IntakeLibrary`、`DeskKnowledge`、`IntakePermissions`）在同一次渲染里并存，靠条件互斥。

判断：如果旧 profile 已经不是产品方向，那么它是一份需要偿还的并存债务。如果两条线都要维护，那么它们应该是两个应用入口，而不是一个组件的两个分支。

### 3.4 前端在判断权限

`DashboardApp.tsx:160`：`const canOpenPermissions = profile === 'intake' && window.dashboardPermissions !== undefined;`

即：有没有挂 preload 对象，决定侧栏出不出「权限」。服务端另有真正的授权判定。

判断：客户端只应决定「展示什么」，不应参与「是否有权」。现在的写法让「能力挂载」与「权限成立」成为同一件事，任何一方改动都可能让两者分叉。

### 3.5 演示数据与真实界面混在一份清单里

`dashboard-manifest.ts` 830 行，内含 KPI 数值、决策条目、无命中率等固定样例（例如 `value: '8.4%'`、`'29 / 346 次合成操作'`）。`DESIGN.md:110-133` 明确要求没有接口时写「未接入」、不得用样例数字充当生产数据。

判断：文档与代码冲突。顾问应决定这份 manifest 是删除、还是隔离成只在本地预览可达。

### 3.6 容量假设未经前端验证

后端有 5000 源的容量测试，桌面端也有对应探针（`content-intake-usage-http.test.ts`）。但这台杭州机器上该探针固定预算 110 秒会被顶破，本机实测同一用例 43.5 秒。也就是说：前端在大目录下的分页行为，只有在一台快机器上被验证过。

判断：这是产品风险，不是代码缺陷。真实客户库若接近这个量级，需要重新测。

## 四、数据库与后端设计的问题

### 4.1 域枚举是冻结合同的，新板块只能借道

冻结的上游合同只定义了四个域：`presale` / `campaign` / `aftersale` / `product`。SOP 不属于任何一个，于是被登记成 `domain='product'` 加 `mapping_version='sop-not-imported'`，再靠 `packages/content-intake/src/sop-source.ts` 里的字符串判断认回自己。

证据：`apps/api/src/content-intake/sop-source.ts:10-15`。

后果：新增一个板块（例如新店铺、新品类、新内容形态）不能只加数据，必须要么改上游合同，要么继续叠加这类标记字符串。这是「可扩展」要求的结构性障碍，也是最值得顾问看的一处。

### 4.2 读权限由已发布内容推导，写权限又需要读权限

`content_intake.store_set_members` 决定一个坐席能读哪些来源，它的期望集合来自 `release_lineage` 里当前有效的行。也就是说：没有发布过内容，可读集合就是空的。

但发布本身要求 `import` / `publish` 授权，而上传界面要先拿到来源列表。这一轮我遇到的死锁就是它的表现：SOP 从未发布，店铺集被推进成零成员版本，授权随之失效，于是再也发不出去。

我加了两个迁移把症状堵住（见第六节），但根因没有动。顾问应判断：读权限的推导基数是否应该包含「尚未发布但已登记」的来源。

### 4.3 一个人的身份有两种互斥来源

生产里有两种主体：`confirmed-hangzhou`（手写）和 `feishu-job-roster`（登录投影）。同一个飞书账号曾被建成两个主体，而 `principals_user_id_key` 是 `user_id` 单列唯一，第二个建不出来，登录直接抛异常。

这一轮的做法是删掉历史主体、改由投影生成。判断：这是一个身份模型问题。一个真人应当只有一个主体，身份来源应当是属性而不是并列的两种类型。

### 4.4 事实租约 5 分钟，靠定时任务续期

`principal_facts_check` 约束 `valid_until <= checked_at + 5 minutes`。所有授权判定都要求事实在窗口内。

后果：任何一次组织变更最多 5 分钟后生效，这是设计意图；但任何一次长操作（例如 277 条上传加人工检查加发布）都会中途失去权限。现在的补偿是每 4 分钟跑一次 `refresh-roster-facts.mjs`，它同时重跑签发。

判断：用定时任务续期是把一个会话级概念变成了后台进程的职责。顾问应决定租约应该由「谁」续：登录、请求、还是后台。

### 4.5 同一个决策有两份实现

`authorization_sources`（返回集合）与 `authorization_deadline`（返回截止时间）是两个函数，靠 `authorization-set-agreement` 测试保持答案一致。

判断：两个入口、一个语义。任何一次改动都要同时改两处并重跑对齐测试。顾问应判断能否收敛成一个。

### 4.6 授权模型有六个交互概念

`grants` / `allocations` / `delegations` / `steward` / `role_rules` / `role_ceiling`。这一轮所有线上故障都发生在这一层：签发人事实过期导致签不出授权、店铺集推进导致授权被永久撤销、角色策略与登录用了两套职务编号。

判断：表达力很强，可操作性很差。顾问应判断是否需要一个更窄的模型，哪怕牺牲一部分表达力。

### 4.7 迁移账本要手工抄录实测值

64 个迁移，每个的摘要、ACL 清单、对象清单、函数清单、触发器清单都钉在 `packages/database/src/verifier.ts`。这些值必须跑真实 PG15 后从报错里抄下来，不能推导。

这一轮我为了三个迁移，先后改了 6 处钉值，每次都要跑两次完整库测试确认。漏改一处，CI 就红。

判断：这是流程成本，不是正确性问题。但它决定了「加一个迁移」的代价，长期会阻止合理的表结构演进。

### 4.8 应用代码内嵌了 680 行 ACL 断言

`apps/api/src/repository/runtime-boundary-probe.ts` 680 行，把运行时角色的关系权限、列权限、函数权限逐条写成 SQL 断言，作为健康检查的一部分。

判断：安全价值明确，但它让「改一个 GRANT」同时变成「改应用代码」。

## 五、服务器与运维设计的问题

- **单点。** 生产是杭州一台 Windows 桌面机里的 WSL，systemd 管三个 unit：`customer-agent-stack`、`customer-agent-tunnel`、以及新加的 `customer-agent-roster-refresh`。机器同时被日常使用。
- **数据库没有定时备份。** 实测 `systemctl list-timers` 里没有备份任务。`/srv/customer-agent/backups/` 里几个 dump 都是手工执行留下的。数据库 49 MB。
- **自启依赖有人登录。** 文档记录 `WSL-Start-CustomerAgent` 的 `BootTrigger` 不触发，实际把 WSL 拉起来的是 `WSL-Start-Dockerd` 的 `LogonTrigger`。
- **发布流程是手抄命令。** 现在是「Mac 打 bundle → scp → 杭州 tmux 里构建 → 切软链 → restart」。这一轮我跑了 6 次，两次因 SSH 卡住重来。没有 CI 到部署的直连。
- **回滚只能切代码，不能退 schema。** 账本一旦前进到 64，旧 release 起不来。退库只能 `pg_restore` 那份手工 dump。

## 六、我这轮补在症状层的东西（需要顾问判定是否算债）

| 迁移 | 做了什么 | 我的判断 |
| --- | --- | --- |
| `0062_store_set_authority_retention` | 阻止店铺集被推进成零成员版本；把 restamp 从「永久撤销」改成「推进版本戳」 | 症状修复。根因在 4.2 |
| `0063_store_set_keep_members_boundary` | 补 0062 漏掉的函数所有者与 PUBLIC 撤销 | 0062 的缺陷修复，不是设计 |
| `0064_roster_query_requires_reader` | 期望集合为空时不推进版本 | 也是 4.2 的症状修复 |
| `refresh-roster-facts` 定时器 | 每 4 分钟续事实并重跑签发 | 4.4 的补偿 |
| 生产管理账号 `principal-menokin-admin` | 作为一个非真人签发方，满足 `issuer <> recipient` | 4.6 的绕行 |

这些都能跑，都有测试，但每一条都是「让当前模型能工作」，不是「把模型改对」。

## 七、想请顾问回答的问题

1. 域（domain）应当是可扩展的数据，还是编译器/合同层的枚举？如果必须扩枚举，扩展成本怎么降到「加一行数据」。
2. 读权限能否不再由已发布内容推导？如果不能，如何打破「要发布先要读权限」的循环。
3. 一个真人多个主体，应该合并成一个主体加多种身份，还是维持并列？迁移成本多大？
4. 事实租约的正确持有者是谁？会话、请求、后台任务，还是引入短期令牌？
5. 六个授权概念能否收敛成三个以内？代价是什么？
6. 导航与页面应当由数据驱动到什么程度？现有 8 页是否需要重新做信息架构？
7. 迁移账本的手工抄录能否自动化？如果不能，如何降低每次结构变更的成本？
8. 生产的单点、无备份、无 CI 部署，是否应当在功能开发之前先解决？

## 八、不能丢的不变量

顾问提方案时，这几条是当前系统已经证明有效的，改动需要显式评估。

- renderer 不得获得 Node 权限，所有窗口 `contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`。
- 桌面只能通过类型化白名单 preload 请求原生能力，主进程校验 sender 身份与主 frame。
- 复制只表示「已复制」，不得推断为已发送或已采纳。
- 业务数据不出仓库。真实客户库只能在仓外受控流程中只读，不上传、不进运行链路。
- 授权判定必须在服务端成立，客户端只决定展示。
- 已撤销的授权不可恢复，历史行不可删除。

## 九、怎么复核这份文档

```bash
cd /Users/hutou/Desktop/customer-agent-prototype
git log --oneline -12
pnpm help:dev
node scripts/check-sop-workbook.mjs <任意 xlsx>
node scripts/verify-intake-upload-mount.mjs
```

生产只读核对（需要杭州 SSH key）：

```bash
ssh -i ~/.ssh/id_ed25519_pc2 root@100.93.46.46 'readlink -f /srv/customer-agent/current; curl -s http://127.0.0.1:43115/ready'
```

库内只读核对：

```bash
sudo -n -u customer-agent env PATH=/opt/pg15/usr/lib/postgresql/15/bin:/usr/bin:/bin \
  psql -h /srv/customer-agent/stack/data/pg15-socket -p 43199 -d customer_agent_formal -U stack_owner -c \
  "SELECT count(*), max(migration_id) FROM customer_agent_meta.schema_migrations"
```
