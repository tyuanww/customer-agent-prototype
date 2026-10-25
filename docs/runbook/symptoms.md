# 处理仓库里已经写出的十种故障句

你已经看到其中一句时，按该节做。每句都写在被引用的文件里。本文不新增告警，不新增指标，不新增主机。

## 访问日志把 userId 写成 anonymous

`apps/api/src/app.ts` 在访问日志里写入这个值。请求没有记下已认证主体时，`userId` 是 `anonymous`。同一行的形状由 `apps/api/src/request-log.ts` 的 `formatApiAccessLog` 固定。键依次是 `level`、`requestId`、`userId`、`path`、`method`、`statusCode`、`durationMs`。`level` 是 `info`。这一行写到标准输出。

**先看。** 按这一行的 `path` 和 `statusCode` 分支。

1. `path` 是 `/health` 或 `/ready`，并且 `statusCode` 是 200 时，这是探针自己的访问记录。到此为止。
2. `statusCode` 是 401 时，这次调用没有通过现有的认证。让客户端带上该接口已经接受的 bearer 令牌，再发一次。
3. `statusCode` 是 200，并且 `path` 以 `/v1` 开头时，处理函数在没有记下主体的情况下返回了。用同一令牌再发一次。

**确认。** 需要认证的那次调用，下一行 `userId` 是 64 个十六进制字符。这一行里没有原始用户编号。`durationMs` 为 0 表示没有记下开始时间。改看 `statusCode` 和 `path`。

## 未处理的请求写出 diagnostic=API_REQUEST_FAILED

`apps/api/src/runtime-diagnostics.ts` 把诊断写到标准错误。句子是 `[api] diagnostic=API_REQUEST_FAILED`。驱动错误的 `code` 匹配 `[0-9A-Z]{5}` 时，后面还有 ` database_code=` 和这五位。这五位是 SQLSTATE，可以含大写字母，不只是数字。`apps/api/src/app.ts` 的请求错误处理用代码 `API_REQUEST_FAILED` 调用它，再返回 `apps/api/src/contract-http-errors.ts` 里的内部错误。HTTP 状态是 500。正文的 `error.code` 是 `INTERNAL`。`error.message` 是 **服务内部错误**。异常原文不进入正文，也不进入这行诊断。

**先看。** 用访问日志里的 `requestId` 把标准错误和那一行 JSON 对上。读 `path`。有 `database_code` 时，读这五位。

**修复。** 按 `path` 上的这次失败处理。有 `database_code` 时，修数据库返回的这个码。没有这个码时，失败不是带五位码的驱动错误。修 `path` 对应的处理函数抛出的那次错误。

**确认。** 同一 `path` 的下一次调用不再是 500。标准错误里不再出现这个 `requestId` 的 `API_REQUEST_FAILED`。

## 名册读取失败后职务接口仍返回没有权限，请找人开通

`apps/api/src/auth-routes.ts` 在读取名册权限抛错时，调用 `request.log.warn`，参数是 `[api] roster permission read failed`。`apps/api/src/app.ts` 创建应用时把 Fastify 的 `logger` 设为 `false`。当前进程不把这句 Fastify 日志打到标准输出。你能核对的是 `GET /v1/auth/job` 的响应。

抛错且令牌快照还在时，处理函数把存储结果换成该快照的职务，并把状态写成 `denied`。`permission_state` 于是是 `denied`。`message` 是 **没有权限，请找人开通。** 抛错且没有快照时，响应是 404。`error.message` 是 **职务未识别**。

数据库里真实的拒绝状态也使用同一句 **没有权限，请找人开通。** 单看这句分不出读取失败和真实拒绝。

**先看。** 在 API 已经连接的库上调用 `content_intake.roster_permission_for_user`。再看这次 `GET /v1/auth/job` 的访问日志。`path` 以 `/v1/auth/job` 开头。

**修复。** 这个函数抛错时，先修这次数据库错误，再请求 `GET /v1/auth/job`。函数能返回状态时，响应里的 `permission_state` 应与该状态一致。函数返回空，而响应仍是 `denied` 时，读取没有抛错。`apps/api/src/project-roster-login.ts` 在事实里的职务对不上名册时，也会用快照职务并写成 `denied`。核对事实里的职务编号。

**确认。** 存储状态是 `ready` 时，响应的 `permission_state` 是 `ready`，并且 `message` 为空。存储状态是 `denied` 时，保留 **没有权限，请找人开通。**

## 授权动作读取失败后四个动作都是 false

`apps/api/src/auth-routes.ts` 在读取授权动作抛错时，调用 `request.log.warn`，参数是 `[api] authorization actions read failed`，并改用 `NO_AUTHORIZATION_ACTIONS`。和上一节一样，这句 Fastify 日志不进当前进程的标准输出。

响应里的 `actions.query`、`actions.import`、`actions.publish`、`actions.rollback` 于是都是 `false`。查询没有返回行时，`apps/api/src/project-roster-login.ts` 也返回同样的四个 `false`。响应正文分不出抛错和没有行。

**先看。** 在 API 已经连接的库上执行 `readAuthorizationActions` 使用的那次查询。查询写在 `apps/api/src/project-roster-login.ts`。

**修复。** 查询抛错时，修这次数据库错误。查询返回一行时，下一次 `GET /v1/auth/job` 的四个动作与该行一致。查询没有行时，四个 `false` 就是这个函数的结果。

**确认。** 查询成功返回一行后，响应里的四个动作与该行相同。

## 健康探针在探测前以 FATAL 退出

`scripts/ops/customer-agent-health-check.sh` 在发出探测前会以退出码 1 结束。日志是这两句之一。

`FATAL monitor env unreadable` 后面是它要读的文件。单元 `scripts/ops/customer-agent-health-check.service` 把这个路径设为 `/srv/customer-agent/monitor.env`，并以 `customer-agent` 运行。

`FATAL FEISHU_ALERT_WEBHOOK is empty` 表示该文件里的这个键是空的。

**先看。** 读单元日志里的那一句，以及句中的路径。

```bash
journalctl -u customer-agent-health-check.service --no-pager
```

**修复。** 按句中的路径处理。

1. 句子是 `monitor env unreadable` 时，让单元里的 `customer-agent` 能读取该文件。
2. 句子是 `FEISHU_ALERT_WEBHOOK is empty` 时，把已有的 webhook 写入这个键。值不能是空字符串。

**确认。** 再启动 `customer-agent-health-check.service`。退出码不再是 1。新日志里没有 `FATAL`。探测地址返回 200 时，脚本可以不再写别的句子。探测地址没有返回 200 时，下一节的 `probe failed` 会出现。

## 健康探针日志写出 probe failed

`scripts/ops/customer-agent-health-check.sh` 在探测没有返回 200 时写下 `probe failed`。同一行有计数、阈值、`url` 和 `http_code`。阈值是 3。拿不到状态码时，`http_code` 是 `none`。进程仍以退出码 0 结束。单元显示成功，只说明脚本跑完了。

`CUSTOMER_AGENT_HEALTH_URL` 为空时，脚本使用文件里的默认地址 `https://agent-auth.jianghua.site/ready`。它探测的是 `/ready`。`/health` 在依赖不可用时仍会返回 200。

计数小于 3 时，脚本不发送文本。计数正好是 3 时，它向 `FEISHU_ALERT_WEBHOOK` 发送文件里已经写好的那条文本，其中有 `探针连续失败`。计数大于 3 时，它不再发送。

同一脚本还会写下 `WARN cannot persist counter` 或 `WARN alert delivery failed`。

**先看。** 读 `probe failed` 那一行的 `url`、`http_code` 和计数。

**修复。** 按这一行的内容处理。

1. `http_code` 是 `503` 时，请求日志里的同一个 URL。响应里的 `checks` 有 `database`、`schema`、`auth`、`storage`、`content`。不是 `ok` 的项是 `not_ready`。修该项，直到同一个 URL 返回 200，并且 `status` 是 `ready`。检查全是 `not_ready`，同时标准错误有 `diagnostic=READINESS_REPOSITORY_CONTRACT_FAILED` 时，就绪查询抛错了。响应正文不含查询错误原文。
2. `http_code` 是 `none` 时，这次 `curl` 没有拿到状态码。修到日志里的那个 URL 能返回状态码。不要改去探测 `/health`。
3. 日志有 `WARN cannot persist counter` 时，计数没有写入句中的文件。单元把该文件设为 `/var/lib/customer-agent/health-failures`。单元打开了 `PrivateTmp`。不要把计数放进 `/tmp`。让 `customer-agent` 能写入单元已经指定的那个文件。
4. 计数正好是 3，并且下一行是 `WARN alert delivery failed` 时，发往 `FEISHU_ALERT_WEBHOOK` 的请求失败了。修正这个键里已有的值。计数已经大于 3 之后，脚本要先看到一次 200 并写下 `recovered`，才会把计数写回 0。之后再连续失败到 3，才会再发送一次。

**确认。** 探测返回 200 且计数原先不是 0 时，日志有 `recovered`，计数文件里是 0。探测返回 200 且原先没有计数时，新日志不再出现 `probe failed`。需要发送文本时，计数到达 3 的那一次日志是 `alert sent`。

## 备份脚本以 FATAL 退出且没有留下完整 dump

`scripts/ops/customer-agent-backup.sh` 在留下完整 `.dump` 之前以退出码 1 结束，并写下 `FATAL`。失败的这一次不会修剪已经存在的 dump。被中断时可能留下 `.partial`。只把 `.dump` 当作完整备份。

**先看。** 读 `customer-agent-backup.service` 的日志，找到 `FATAL` 那一句。句中的路径就是脚本当时用的路径。

```bash
journalctl -u customer-agent-backup.service --no-pager
```

**修复。** 按 `FATAL` 后面的句子处理。

1. 句子含 `pg_dump not found under` 时，句中的目录里要有可执行的 `pg_dump`。单元默认把 `CUSTOMER_AGENT_PG15_BIN` 设为 `/opt/pg15/usr/lib/postgresql/15/bin`。
2. 句子含 `no PostgreSQL socket at` 时，先让句中的套接字出现。脚本默认端口是 `43199`，套接字目录在栈根下的 `data/pg15-socket`。单元把栈根设为 `/srv/customer-agent/stack`。
3. 句子含 `content.env unreadable` 时，让 `customer-agent` 能读取句中的文件。默认文件是栈根下的 `content.env`。文件里要有 `DATABASE_NAME`，或者设置 `CUSTOMER_AGENT_BACKUP_DATABASE`。
4. 句子含 `no database name` 时，在 `content.env` 里写下 `DATABASE_NAME`，或设置 `CUSTOMER_AGENT_BACKUP_DATABASE`。
5. 句子含 `cannot create` 时，脚本没能创建夜间目录。单元只允许写入 `/srv/customer-agent/backups`。`ProtectSystem=strict` 下，别的路径要先写进 `ReadWritePaths`。
6. 句子含 `more than 999 backups in one second` 时，等过这一秒再运行。脚本拒绝覆盖已经存在的文件名。
7. 句子含 `pg_dump failed` 或 `pg_dump produced an empty file` 时，脚本会删掉 `.partial`。先看 `FATAL` 上面的 `pg_dump` 错误并修它。
8. 句子含 `cannot finalise` 时，改名没有完成。修好单元允许写入的目录后再运行。
9. 句子含 `retention removed` 时，这一次的 dump 已经是 `.dump`。删掉的份数和脚本算出的份数不一致。不要删掉最新的那一份。让 `rm` 能删掉最旧的那些文件后再运行。

**确认。** 下一次运行写下 `dump done bytes=`。退出码是 0 或 3。夜间目录里新的备份以 `.dump` 结尾。

## 备份脚本以状态 3 退出并写下 offsite copy NOT CONFIGURED

`scripts/ops/customer-agent-backup.sh` 在 dump 和保留都完成后，发现 `CUSTOMER_AGENT_BACKUP_COPY_TO` 为空，就写下 `offsite copy: NOT CONFIGURED`，并以退出码 3 结束。这份 dump 只在一块盘上。单元 `scripts/ops/customer-agent-backup.service` 把 0 和 3 都当作成功。单元没有失败，不表示副本已经写好。

副本目录创建失败时，句子是 `cannot create`，退出码是 1。复制失败时，句子含 `offsite copy to` 和 `failed`，退出码也是 1。夜间目录里的 dump 已经在。

**先看。** 读同一段日志里的 `dump done` 和后面的 `offsite` 句子。读单元环境里的 `CUSTOMER_AGENT_BACKUP_COPY_TO` 和 `ReadWritePaths`。

**修复。** 按日志处理。

1. 句子是 `NOT CONFIGURED` 时，把 `CUSTOMER_AGENT_BACKUP_COPY_TO` 设成一个目录。单元当前的 `ReadWritePaths` 是 `/srv/customer-agent/backups`。目录不在已允许写入的路径里时，先把该路径加进 `ReadWritePaths`。
2. 句子含 `offsite copy to` 和 `failed` 时，夜间 dump 保留。修好目标目录后再运行。脚本会用新的序号另写一份，不会覆盖已经存在的文件名。

**确认。** 日志出现 `offsite copy done`。退出码是 0。目标目录里有同名的 `.dump`。

## SOP 页面写出没有权限，请找人开通

`apps/desktop/src/renderer/features/dashboard/SopLibraryModule.tsx` 在 SOP 状态是 `closed` 时写出 **没有权限，请找人开通。** 上传、修改、删除和自定义步骤都不可用。

`apps/desktop/src/main/page-use.ts` 在 `GET /v1/sop/catalog` 被拒绝时把 SOP 状态写成 `closed`。之后的 SOP 写入返回 `FORBIDDEN` 时也写成 `closed`。`apps/api/src/ops-loop-routes.ts` 只允许 `role` 为 `coach` 或 `owner` 的账号读取和导入这个目录。

目录返回 401 时，`page-use.ts` 会把会话变成未登录。SOP 页面那时使用的是 **请先登录后再管理 SOP。** 那是另一句。

**先看。** 在访问日志里找 `path` 为 `/v1/sop/catalog` 的一行，读 `statusCode`。桌面进程里对应的一行是 `[desktop] product-http`，后面有状态码和 `FORBIDDEN`。

**修复。** `statusCode` 是 403 时，换用 `role` 为 `coach` 或 `owner` 的账号重新登录，再打开 SOP。新的登录会再次读取目录。

**确认。** SOP 空状态不再出现 **没有权限，请找人开通。** 目录里有步骤时，步骤列表出现，上传可用。目录是空的且状态是 `open` 时，页面写出 **还没有 SOP 步骤。上传 CSV 后会出现在这里。**

## SOP 页面写出服务暂不可用，请重试

`apps/desktop/src/shared/dashboard-ops-loop.ts` 里的 `unavailable` 是 **服务暂不可用，请重试**。`apps/desktop/src/renderer/features/dashboard/SopLibraryModule.tsx` 在 SOP 状态是 `unavailable` 时展示这句。上传不可用。

`apps/desktop/src/main/page-use.ts` 在这些情况下把状态写成 `unavailable`。目录结果不是成功，也不是拒绝或未认证。目录正文过不了现有的 `SopCatalogResponse`。写入返回 `UNAVAILABLE`、`OVERLOADED` 或 `RATE_LIMITED`。

**先看。** 读 `/v1/sop/catalog` 的访问日志。没有这一行时，读桌面进程里的 `[desktop] product-http transport`。有 HTTP 状态时，桌面进程的一行是 `[desktop] product-http`，后面有状态码和错误码。

**修复。** 按状态处理。

1. `statusCode` 是 503 时，路由在运营循环依赖没有装上时返回 `OVERLOADED`。重新登录只会再读一次。换用已经带有运行时连接的 API 进程，再重新登录。
2. `statusCode` 是 429 时，路由返回 `RATE_LIMITED`，并带 `retry-after` 为 1。等过这一秒后重新登录，让页面再次读取目录。
3. `statusCode` 是 200 而页面仍是这句时，正文不是现有的 `SopCatalogResponse`。不要给合同加字段。让响应符合现有解析，再重新登录。
4. 桌面日志是 `product-http transport` 时，请求没有拿到 HTTP 状态。访问日志里不会有这一次调用。恢复桌面已经在用的连接，再重新登录。

**确认。** 页面不再出现 **服务暂不可用，请重试**。有步骤时列表出现。没有步骤时出现 **还没有 SOP 步骤。上传 CSV 后会出现在这里。** 上传可用。
