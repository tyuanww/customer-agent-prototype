# 资料页与权限页

`contentIntake: "faq-v2"` 的工作台在原外壳里打开两张操作页。资料页上传并核对 FAQ 候选。权限页给已有人员授岗位，并新建、重置、停用外包坐席。旧工作台的整库替换不走这两页。

## 页面

| 页面 | 侧栏 | 打开条件 |
| --- | --- | --- |
| 资料管理 | 内容管理 | `contentIntake === "faq-v2"` |
| 权限配置 | 内容管理后面的「权限」 | 同上，且 preload 提供 `dashboardPermissions` |

「权限」不是第六个 `DASHBOARD_MODULE_IDS`。没有权限 preload 时侧栏保持原来的五项。

资料页筛选是「待我处理」「已发布」「全部」。表列是名称、范围、状态、下一步、时间。点开一行只显示当前步骤。时间用本机可读时间和 UTC 偏移。

权限页两张表的标题是「已有外包坐席」和「范围内的人员」。新建坐席收集姓名、登录名、密码、岗位。岗位只有下面两种，默认「客服」。

## 岗位

| 岗位 | 动作 |
| --- | --- |
| 客服 | `query` |
| 客服主管 | `content-manage`、`import`、`source-confirm`、`publish` |

不包含 `rollback`、`candidate-cancel`、`review`。页面不能新增、改名或删除岗位。未知岗位返回 `unknown-post`。

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

运行脚本映射的失败文案还有：请选择岗位。请设定密码。人员没有写入，已停止。口令没有写入，已停止。账号没有读取。未知错误码变成「账号没有保存。」IPC 在调用脚本前还会返回：账号输入无效。无权访问此窗口能力。账号尚未接入当前运行模式。node 没启动、15 秒超时、标准输出超过 64KiB，或回复通不过 `seatAccountReply`，也是「账号没有保存。」

Electron 主进程把意图交给 `scripts/synthetic-stack/seat-account-runtime.ts`。人员写入合成库 `customer_agent_synthetic`（Unix socket，端口 43199）。口令只以 salt 和 scrypt 哈希写入 `CUSTOMER_AGENT_STACK_ROOT` 下的 `password-accounts.json`，默认目录是用户主目录的 `.customer-agent-synthetic-stack`。明文密码不进页面、不进数据库、不进 git。

`127.0.0.1:43101` 的 `POST /password` 每次调用 `reloadPasswordAccounts`。口令文件读失败返回 503，错误是 `accounts_unavailable`。读成功后，用户名必须等于 `SYNTHETIC_IDENTITIES` 里的 `bindingId`，再查口令文件。已登记主体改了哈希，下次登录就会读到，不用重启身份服务。新建外包坐席不在这组名字里，所以仍是 401 `invalid_credentials`。`POST /exchange` 只接受 `ALLOWED_BINDINGS`，也就是同一组登记主体。

浏览器地址带 `preview=intake` 且主机是 `127.0.0.1` 或 `localhost` 时，坐席列表、新建、重置、停用只改这块页面的内存，不写口令文件，也不写数据库。

## 窗口

工作台标准窗约 1180×760，最小 980×680，见 `DASHBOARD_WINDOW_CHROME`。低于这个最小窗时仍是同一套桌面侧栏，不改成手机导航。侧栏分组字是 11px。

## 相关

- [如何操作资料页和权限页](how-to-operate-intake-pages.md)
- [为什么岗位和登录是分开的](explanation-intake-pages.md)
- [资料导入开发说明](how-to-develop-content-intake.md)
