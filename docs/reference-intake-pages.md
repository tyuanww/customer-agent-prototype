# 资料页与设置页

资料导入工作台分别管理服务端内容和业务权限。内容库挂载 `IntakeLibrary`，资料审核挂载 `IntakeManagement`，设置挂载 `IntakePermissions`。页面可见不代表已经取得写入或发布资格。

## 页面

| 侧栏页签 | 职责 | 数据归属 |
| --- | --- | --- |
| 工作台 | 当前授权资料的待办与入口，不显示不可用的业务统计 | 与资料审核复用同一管理视图；不推算全店总量 |
| 内容库 | 查阅当前服务端正式话术 | 当前发布目录；不提供本机草稿或知识库编辑 |
| SOP | 学习与执行流程 | 正式图文服务交付前明确尚未开放，不调用旧 CSV 管理入口 |
| 资料审核 | 上传、核对来源、逐条审核并发布整批资料 | 既有服务端候选和正式发布事务 |
| 设置 | 「权限」汇总、查看和撤销具体授权；「账号」管理登录账号 | 服务端身份与授权，建账号不产生业务权限 |

`INTAKE_DESTINATION_ROWS` 定义目的地，`intakeSidebarItems` 按岗位与设置资格过滤导航；`intakeRowVisible` 保留各页面的访问边界。原 `content` 目的地及其本机草稿页已删除。

Node.js 24 可直接核对导航定义：

```sh
node --input-type=module -e 'import { INTAKE_DESTINATION_ROWS as rows } from "./apps/desktop/src/renderer/features/dashboard/intake-destination-rows.ts"; console.log(rows.map(({ id, label }) => ({ id, label })))'
```

左下角账号入口显示当前账号信息，并提供退出登录。Main 撤销会话后同步工作台和查询窗口；远端退出未确认时，界面保留相应提示。

内容库没有本机草稿页签，已发布内容按当前业务授权读取。设置里的权限时间仍用本机可读时间和 UTC 偏移。

设置内用「权限」「账号」两个页签；成员详情逐条显示实际授权。新建账号收集姓名、登录名、密码、岗位。岗位只有下面两种，默认「客服」。

设置导航不是岗位的附属开关。Main 从服务端 `/v1/access/settings` 读取一个 `DashboardSettingsView`。该投影只含 `grants`、`accounts` 两个独立开关，以及 `accessRevision`、`expiresAt` 和稳定的拒绝原因。权限资格为 `open` 时显示并允许「权限」，账号资格为 `open` 时显示并允许「账号」。只有恢复说明的 `closed` 授权仍保留数据模型中的文案，但不能单独让设置入口出现。仅审核管理员可管理账号却不能新增授权，仅查询管理员两个能力都关闭。`PageUseReader` 在 revision 前进时丢弃已加载的成员与授权列表，并在 `expiresAt` 到达后先关闭本机入口再重新读取。这个投影只决定窗口和按钮是否可见；每条授权、账号写命令仍由 API 和 PostgreSQL 在命令时重新检查当前会话、事实、来源、期限和父授权。

坐席管理采用请求时授权。服务端 `seat_administration_allowed` 返回 `true` 时，命令完成授权线性化。管理员资格在此后撤销，不取消已经受理的命令；撤销提交之后才开始的新命令必须失败。Main 的 `settings.accounts` 只控制窗口入口，API 的资格检查才是授权边界。

提交时授权没有采用。它要求每次数据库写入前重新校验资格，并用共享锁或两阶段状态覆盖口令文件，但 PostgreSQL 事务不能原子包含文件系统。只有产品要求“撤销必须中止在途命令”时才重新打开该设计；当前不以它作为发布门。

## 岗位

| 岗位 | 动作 |
| --- | --- |
| 客服 | `query` |
| 客服主管 | `content-manage`、`import`、`source-confirm`、`publish` |

不包含 `rollback`、`candidate-cancel`、`review`。页面不能新增、改名或删除岗位。未知岗位返回 `unknown-post`。新建坐席不会因为选了岗位就拿到这些动作，对照见[坐席岗位和角色上限](reports/2026-10-27-seat-post-role-ceiling.md)。

纯函数在 `apps/desktop/src/shared/intake-post-actions.ts`：`INTAKE_POSTS`、`DEFAULT_INTAKE_POST`、`actionsForIntakePost`、`intakePostForActions`、`intakePostsCoveredBy`、`intakePostStatusForGrants`。

## 坐席命令

通道是 `dashboard:seats-command`。远程工作台和显式 FAQ 合成工作台可使用；窗口、会话与账号管理权限由 Main 和服务端检查。账号能力来自 `GET /v1/intake/seats/administration` 的 `{ canManage: boolean }`；Main 在每次调用前检查当前 `settings.accounts`，服务端再用 `content_intake.seat_administration_allowed(actorId)` 复核。renderer 提交下面四种意图，不能带主体 ID、URL 或操作 ID。

| `action` | 字段 | 成功回复 |
| --- | --- | --- |
| `list` | 无 | `{ ok: true, action: "list", seats }` |
| `create` | `displayName`、`username`、`password`、`post` | `{ ok: true, action: "create", seat }` |
| `reset` | `username`、`password` | `{ ok: true, action: "reset", username }` |
| `disable` | `username` | `{ ok: true, action: "disable", username }` |

`seats` 的每一项和 create 的 `seat` 都是 `displayName`、`username`、`post`、`enabled`。类型在 `apps/desktop/src/shared/seat-account-intent.ts`：`isSeatAccountIntent`、`seatAccountReply`、`SeatAccountApi`、`SeatAccountRecord`。`isSeatAccountIntent` 只核对字段形状和岗位是两种之一，不核对登录名正则。

登录名必须匹配 `^[A-Za-z0-9_-]{1,64}$`，由 `seatUsername` 检查。不合规则、姓名为空或长于 256 字、重置或停用找不到人，错误都是 `missing-person`，文案是「没有可授权的人。」绑定 ID 是 `synthetic_` 加登录名。停用只把人员标成不可用，不删除。

Main 把服务端的可操作拒绝映射为岗位、登录名、重名、权限或口令文件错误。回复形状不通过 `seatAccountReply`、IPC 输入或窗口校验失败时返回明确失败，不伪造保存成功。

Electron 主进程把意图交给产品 API 的账号路由（`GET /v1/intake/seats/administration`、`GET`/`POST /v1/intake/seats`、`POST /v1/intake/seats/:username/password`、`DELETE /v1/intake/seats/:username`）。身份行由迁移 `0068` 引入的 `SECURITY DEFINER` 函数写入：`backend_identity.create_seat`、`list_seats`、`disable_seat`。它们的所有者是集群所有者，`EXECUTE` 只授给 `intake_business`，能力角色拿不到任何身份表的写权限。

迁移 `0078` 将建席与业务授权分开。创建和登录只建立身份、岗位及其事实，不签发或恢复业务授权，也不要求存在已发布或可分配来源。管理员需另行人工授予查询权限。迁移不修改已有授权；已有自动授权需要按实际业务情况另行审查。

口令只以 salt 和 scrypt 哈希写入服务端 `CUSTOMER_AGENT_STACK_ROOT` 下的 `password-accounts.json`，由身份服务的 `/password` 每次重读，所以写入立即生效。明文密码不进页面、不进数据库、不进 git。

身份行与口令文件是两个存储边界，不能伪装成单个原子提交。数据库身份先提交，口令随后写入。口令写入失败时 API 返回 `SEAT_PASSWORD_NOT_WRITTEN`，界面明确提示身份记录没有丢失并引导从账号列表重置密码，不误报“账号没有保存”。该恢复路径不要求重新创建登录名。

同一口令文件的写入由相邻的 `.lock` 目录跨进程串行。创建和重置先异步计算 scrypt 哈希，再在短临界区内读取、修改、同步临时文件并原子替换账号文件。锁等待使用异步定时器，不阻塞 API 事件循环，10 秒后失败。锁目录记录随机持有者令牌和进程 ID；持有进程仍存活时，即使目录时间很旧也不能抢锁。持有进程已退出时可以立即回收。无法读到持有者的锁目录超过 30 秒后才回收。释放时先复核令牌仍属于自己，再删除锁。两个管理员并发写入时，后完成的一方会读到前一方提交的完整文件，不会用旧快照覆盖它。

进程在锁内崩溃时，旧账号文件保持完整。下一次写入会识别已退出的持有者并回收锁，同时删除同一目标留下的临时文件。若崩溃发生在临时文件同步后、rename 前，旧文件生效；若发生在 rename 后、锁清理前，新文件已经完整生效。macOS 和 Unix 在 rename 后同步父目录；Windows 的断电后目录持久性未被本验证证明。PostgreSQL 与文件系统无法组成同一事务，所以创建在数据库提交后、口令写入前崩溃会留下可由账号列表识别的身份记录，重置口令完成恢复。

三个命令的完成边界分别如下。新建账号在身份提交且口令文件写入成功后完成；口令写入失败时保留身份，由重置口令恢复。重置密码在口令文件原子替换后完成，数据库只读取并确认账号存在。停用在数据库绑定被标记为停用后完成，口令条目保留，登录准入拒绝已停用绑定。

网络延迟不改变服务端语义。请求到达后，资格查询在撤销提交前返回 `true`，该命令已经受理，可以在撤销后完成；资格查询在撤销提交后执行，必须返回 `SEAT_FORBIDDEN`。API 回复丢失时，操作结果可能未知。`create` 可由列表和重置口令恢复；`reset` 可再次用同一目标账号重置；`disable` 是幂等操作。客户端不能根据超时推断这些操作失败。

旧路径（桌面 `spawn` `scripts/synthetic-stack/seat-account-runtime.ts` 并以 `stack_owner` 连 `customer_agent_synthetic`）已删除：那个脚本不在安装包内，那个 socket 也不在坐席的机器上，所以按钮在打包版里从未成功过。

`127.0.0.1:43101` 的 `POST /password` 每次调用 `reloadPasswordAccounts`。口令文件读失败返回 503，错误是 `accounts_unavailable`。固定名单里的用户名仍按 `SYNTHETIC_IDENTITIES` 核验。名单之外，只有口令文件里的 `bindingId` 正好是 `synthetic_seat_<登录名>`、且数据库里该绑定 `enabled = true`，才发登录码。停用后同一口令被拒。`POST /exchange` 对固定名单照旧；对坐席绑定再查一次 `enabled`，所以停用发生在发码之后也不能换票。

浏览器地址带 `preview=intake` 且主机是 `127.0.0.1` 或 `localhost` 时，坐席列表、新建、重置、停用只改这块页面的内存，不写口令文件，也不写数据库。

## 窗口

工作台标准窗约 1180×760，最小 980×680，见 `DASHBOARD_WINDOW_CHROME`。低于这个最小窗时仍是同一套桌面侧栏，不改成手机导航。侧栏分组字是 11px。

## SOP 归一化来源

SOP 作者工作簿使用 `SOP场景`、`SOP步骤`、`SOP分支`、`SOP话术`、`SOP资源`、`SOP搜索词` 六个规范表。资源图片可来自 WPS `DISPIMG`。解析器只读取包内安全 PNG、JPEG 或 GIF，并在工作表、行、列或容量错误时整次失败。作者预览只接收资源元数据，不接收原始路径。

正式 SOP 页面仍等待 `SOP-CONTENT-A` 的完整严重性顺序和 `SOP-CONTENT-B` 的 D/E 节点语义。当前实现不展示伪可用入口，也不把静态过敏树当作正式目录。发布、查询和桌面 typed seam 已分别具备独立测试。生产组合由 INT-API 和 INT-DESKTOP 完成。

## 相关

- 原本机草稿操作文档只保留为已撤功能历史。
- [如何导入正式资料和管理设置](how-to-operate-intake-pages.md)
- [为什么岗位和登录是分开的](explanation-intake-pages.md)
- [资料导入开发说明](how-to-develop-content-intake.md)
