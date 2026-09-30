# 查采集数据（业主手册）

回答四个问题，各一条 `SELECT`。**你不用会 SQL**：把语句整段复制进去回车即可。

> **状态**：视图与只读角色已写进迁移 `0018_owner_read_views`，**但登录账号还没建**——
> 那是部署动作，不在代码里。下面第 1 步是一次性的。

## 1. 一次性准备（部署人在杭州机器上做）

只读能力角色 `app_owner_read` 迁移已经建好（NOLOGIN）。还需要一个**能登录**的账号挂在它下面，
以及一条从你电脑过去的隧道路径。密码由部署人设，不写在任何文档或对话里。

```bash
sudo -u postgres psql -d customer_agent_formal <<'SQL'
CREATE ROLE owner_read LOGIN PASSWORD '<部署时设>';
GRANT app_owner_read TO owner_read;
SQL
```

## 2. 怎么连上

PostgreSQL **不监听 TCP**（`listen_addresses = ''`，走 Unix socket）。所以要先有一条 SSH 隧道，
再让 `psql` 连到本机的一个 socket 端口。

```bash
# 终端 A：保持开着
ssh -N -L 5433:/srv/customer-agent/stack/data/pg15-socket/.s.PGSQL.43299 root@100.93.46.46
```

```bash
# 终端 B
psql "host=/tmp port=5433 dbname=customer_agent_formal user=owner_read"
```

**三种常见报错，对应三种解法：**

| 报错 | 原因 | 怎么办 |
| --- | --- | --- |
| `Connection refused` | 隧道没开，或连了 TCP 端口而不是 socket | 回第 2 步，确认终端 A 还开着；`host=` 用 socket 目录不是 IP |
| `no pg_hba.conf entry for host ...` | 连的方式不对（PG 不监听 TCP） | 同上，走 socket |
| `permission denied for schema public` | 用错了账号 | `\conninfo` 看当前用户；必须是 `owner_read`（挂在 `app_owner_read` 下） |

## 3. 四个问题，四条语句

### Q1 坐席都问了什么、库里匹配上了吗

```sql
SELECT * FROM vw_owner_asked_questions ORDER BY asked_at DESC LIMIT 50;
```

列名说人话：`asked_at` 提问时间、`agent` 坐席、`question` 提问内容、
`library_matched` **话术库里找到了内容**（true/false）、`waited_ms` 等了多久。

> **重要**：`question` 可能是空的，且 `question_retention` 列会写 `suppressed`。
> 那是脱敏策略的结果，**不是查询写错了**。

### Q2 每次提问给坐席看了哪几条、他抄了哪一条

```sql
SELECT * FROM vw_owner_shown_scripts ORDER BY asked_at DESC LIMIT 50;
```

> **重要**：`copied_to_clipboard = true` 表示**话术被复制进输入框**，
> **不是「已发送」**。系统不掌握坐席最后有没有发出去。

> **`snapshot_was_stale` 这一列**：`true` 表示坐席当时用的是**旧的本机快照**，
> 他看到的那条话术可能**已经被改过或删掉了**。想知道「哪些已删话术还在被坐席看到」，
> 就查这一列：
>
> ```sql
> SELECT * FROM vw_owner_shown_scripts WHERE snapshot_was_stale ORDER BY asked_at DESC;
> ```
>
> 只想看「坐席当时真正看到的」，加 `WHERE NOT snapshot_was_stale`。

### Q3 哪些问题在库里没找到

```sql
SELECT * FROM vw_owner_unmatched_questions ORDER BY asked_at DESC LIMIT 50;
```

> **信息缺口（已知）**：未命中时系统**不记录「比对过哪些候选」**，
> 所以这个视图只有提问、没有候选列。这是设计如此，不是漏写。

### Q4 每个坐席每天问了多少、命中多少、抄了多少

```sql
SELECT * FROM vw_owner_agent_daily ORDER BY day DESC, questions DESC;
```

`copy_rate` 是**「抄 / 问」**，不是「发送成功率」。当天没提问的坐席不会出现在结果里。

## 4. 两个已知的信息缺口

- **未命中时看不到比对过什么。** 只有「问了这个、没命中」，没有候选列表。
- **「抄了」不等于「发了」。** 系统记录到复制为止；发送发生在被支持的工作台里，采集不到。

## 5. 视图怎么维护（给接手的人）

视图是迁移 `packages/database/overlays/0018_owner_read_views.sql`，走 `pnpm db:migrations:generate`。

**改了 `query_events` / `candidate_impressions` / `adoption_events` / `app_users` 的列，
必须同步改这个 overlay**：视图引用的列一旦被改名或删除，四个视图会一起报错，
护栏是 `packages/database/src/verifier.ts` 里的 `REQUIRED_VIEWS`——
漏改会在迁移验证阶段直接失败，不会静默带着坏视图上线。

## 6. 为什么只能看视图，不能看表

`app_owner_read` 对 `query_events` 等基础表**没有任何权限**（`SELECT` 都会 42501），
只对四个视图有 `SELECT`。视图由 `cs_ai_definer` 拥有，以它的权限执行，
所以看不到 `request_hash`、`hash_key_version`、`tenant_id`、各类指纹列。

这是有意的：**语义层是唯一路径**，绕过它就读不到内部字段。
