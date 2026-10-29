# 资料页与权限页

资料导入工作台分别管理本机知识、服务端内容和业务权限。知识库挂载 `DeskKnowledge`，资料页挂载 `IntakeManagement`，权限页挂载 `IntakePermissions`。页面可见不代表已经取得写入或发布资格。

## 页面

| 侧栏页签 | 职责 | 数据归属 |
| --- | --- | --- |
| 概览 | 汇总当前登录者的查询、待办和不准样本；店铺指标按页面标注口径展示 | 已提供的使用记录和运营读取能力。读取失败不记为零次 |
| 话术库 | 按店铺和条件查阅当前可用的正式话术 | 服务端已发布目录及当前使用资格，只读 |
| SOP | 查看当前可见目录和原表预览 | 原表预览不发布为新流程。完整图文步骤识别与分支推进未在本轮交付 |
| 知识库 | 维护本机人设问答，导入文字和锚在单元格上的图片 | `userData/desk-knowledge.json`，不进入浮窗查询或其他电脑 |
| 资料 | 上传规范工作簿，管理候选、来源确认、质量检查、发布及回退 | 服务端材料、冻结候选和正式版本 |
| 权限 | 管理范围内的人员授权与外包坐席账号 | 服务端身份和人工业务授权。建账号不产生业务权限 |

`INTAKE_DESTINATION_ROWS` 拥有这六项导航的 ID、标题和顺序，`intakeRowVisible` 决定当前账号可见的项目，均位于 `apps/desktop/src/renderer/features/dashboard/intake-destination-rows.ts`。实际侧栏随岗位和管理资格变化。旧基线的 `DASHBOARD_MODULE_IDS` 不拥有这组导航。

Node.js 24 可直接核对导航定义：

```sh
node --input-type=module -e 'import { INTAKE_DESTINATION_ROWS as rows } from "./apps/desktop/src/renderer/features/dashboard/intake-destination-rows.ts"; console.log(rows.map(({ id, label }) => ({ id, label })))'
```

左下角账号入口显示当前账号信息，并提供退出登录。Main 撤销会话后同步工作台和查询窗口；远端退出未确认时，界面保留相应提示。

知识库没有「待我处理 / 已发布 / 全部」这组候选筛选。运营看当前人设的卡片；坐席只看已投递的卡片。权限页时间仍用本机可读时间和 UTC 偏移。

权限页两张表的标题是「已有外包坐席」和「范围内的人员」。新建坐席收集姓名、登录名、密码、岗位。岗位只有下面两种，默认「客服」。

## 岗位

| 岗位 | 动作 |
| --- | --- |
| 客服 | `query` |
| 客服主管 | `content-manage`、`import`、`source-confirm`、`publish` |

不包含 `rollback`、`candidate-cancel`、`review`。页面不能新增、改名或删除岗位。未知岗位返回 `unknown-post`。新建坐席不会因为选了岗位就拿到这些动作，对照见[坐席岗位和角色上限](reports/2026-10-27-seat-post-role-ceiling.md)。

纯函数在 `apps/desktop/src/shared/intake-post-actions.ts`：`INTAKE_POSTS`、`DEFAULT_INTAKE_POST`、`actionsForIntakePost`、`intakePostForActions`、`intakePostsCoveredBy`、`intakePostStatusForGrants`。

## 坐席命令

通道是 `dashboard:seats-command`。只在 `contentIntake === "faq-v2"` 时注册。renderer 提交下面四种意图，不能带主体 ID、URL 或操作 ID。

| `action` | 字段 | 成功回复 |
| --- | --- | --- |
| `list` | 无 | `{ ok: true, action: "list", seats }` |
| `create` | `displayName`、`username`、`password`、`post` | `{ ok: true, action: "create", seat }` |
| `reset` | `username`、`password` | `{ ok: true, action: "reset", username }` |
| `disable` | `username` | `{ ok: true, action: "disable", username }` |

`seats` 的每一项和 create 的 `seat` 都是 `displayName`、`username`、`post`、`enabled`。类型在 `apps/desktop/src/shared/seat-account-intent.ts`：`isSeatAccountIntent`、`seatAccountReply`、`SeatAccountApi`、`SeatAccountRecord`。`isSeatAccountIntent` 只核对字段形状和岗位是两种之一，不核对登录名正则。

登录名必须匹配 `^[A-Za-z0-9_-]{1,64}$`，由 `seatUsername` 检查。不合规则、姓名为空或长于 256 字、重置或停用找不到人，错误都是 `missing-person`，文案是「没有可授权的人。」绑定 ID 是 `synthetic_` 加登录名。停用只把人员标成不可用，不删除。

运行脚本映射的失败文案还有：请选择岗位。请设定密码。人员没有写入，已停止。口令没有写入，已停止。账号没有读取。未知错误码变成「账号没有保存。」IPC 在调用脚本前还会返回：账号输入无效。无权访问此窗口能力。账号还不能在这里改。node 没启动、15 秒超时、标准输出超过 64KiB，或回复通不过 `seatAccountReply`，也是「账号没有保存。」

Electron 主进程把意图交给产品 API 的三个路由（`GET`/`POST /v1/intake/seats`、`POST /v1/intake/seats/:username/password`、`DELETE /v1/intake/seats/:username`）。身份行由迁移 `0068` 引入的 `SECURITY DEFINER` 函数写入：`backend_identity.create_seat`、`list_seats`、`disable_seat`。它们的所有者是集群所有者，`EXECUTE` 只授给 `intake_business`，能力角色拿不到任何身份表的写权限。

迁移 `0078` 将建席与业务授权分开。创建和登录只建立身份、岗位及其事实，不签发或恢复业务授权，也不要求存在已发布或可分配来源。管理员需另行人工授予查询权限。迁移不修改已有授权；已有自动授权需要按实际业务情况另行审查。

口令只以 salt 和 scrypt 哈希写入服务端 `CUSTOMER_AGENT_STACK_ROOT` 下的 `password-accounts.json`，由身份服务的 `/password` 每次重读，所以写入立即生效。明文密码不进页面、不进数据库、不进 git。

旧路径（桌面 `spawn` `scripts/synthetic-stack/seat-account-runtime.ts` 并以 `stack_owner` 连 `customer_agent_synthetic`）已删除：那个脚本不在安装包内，那个 socket 也不在坐席的机器上，所以按钮在打包版里从未成功过。

`127.0.0.1:43101` 的 `POST /password` 每次调用 `reloadPasswordAccounts`。口令文件读失败返回 503，错误是 `accounts_unavailable`。固定名单里的用户名仍按 `SYNTHETIC_IDENTITIES` 核验。名单之外，只有口令文件里的 `bindingId` 正好是 `synthetic_seat_<登录名>`、且数据库里该绑定 `enabled = true`，才发登录码。停用后同一口令被拒。`POST /exchange` 对固定名单照旧；对坐席绑定再查一次 `enabled`，所以停用发生在发码之后也不能换票。

浏览器地址带 `preview=intake` 且主机是 `127.0.0.1` 或 `localhost` 时，坐席列表、新建、重置、停用只改这块页面的内存，不写口令文件，也不写数据库。

## 窗口

工作台标准窗约 1180×760，最小 980×680，见 `DASHBOARD_WINDOW_CHROME`。低于这个最小窗时仍是同一套桌面侧栏，不改成手机导航。侧栏分组字是 11px。

## 相关

- [如何记下一条人设知识](how-to-operate-desk-knowledge.md)
- [如何操作资料页和权限页](how-to-operate-intake-pages.md)
- [为什么岗位和登录是分开的](explanation-intake-pages.md)
- [资料导入开发说明](how-to-develop-content-intake.md)
