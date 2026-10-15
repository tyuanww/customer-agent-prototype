# 第一份目录基线与 0035 前置校验

日期 2026-10-15。这一份只定两件事：怎样把本库已经存在的当前发布登记成 intake 目录基线，以及 0035 前置校验怎样承认栈自己的五个登录角色、并说明 109 条触发器指纹差在哪。登记和校验修正的实现在这份文字之后。这里不改任何库，不迁杭州，不改办公机。

## 验收原句

The first intake catalog baseline registers the same existing rows already on that database, does not move `content_current` id=1, and does not copy `rel_20` or `rel_27`. After that registration, later publication uses the existing `publish_candidate`.

The 0035 predecessor check accepts the five production login memberships `stack_runtime`→`app_runtime`, `stack_content_admin`→`app_content_admin`, `stack_backend_auth`→`app_backend_auth`, `stack_backend_review`→`app_backend_review`, and `stack_backend_worker`→`app_backend_worker`, keeps those five roles, and explains where the 109-trigger fingerprint on that production-shaped database differs from the frozen hash.

## 目录基线

每一份库只登记自己 `content_current` 里 id=1 的 `current_release_id`。Mac 开发库现在是 `rel_20`。杭州生产库现在是 `rel_27`。两行不是同一份发布，不能互相抄。

登记是单独一次操作，不放进 0035 到 0041。迁移跑完不会自动登记，所以排演和以后的杭州迁移都不会顺手写上 `rel_27`。杭州要登记时，用当时那条库自己的当前发布，另一次调用。

操作只做这一句插入：

```sql
INSERT INTO content_intake.release_catalogs (release_id, format_version)
SELECT current_release_id, 'intake-v2.1'
FROM public.content_current
WHERE id = 1
ON CONFLICT (release_id) DO NOTHING;
```

`release_catalogs` 的更新和删除已被 `immutable_history` 挡住，插入没有这道闸。`format_version` 只能是 `intake-v2.1`。`sop_nodes`、`sop_edges`、`media` 用表上的空数组默认值。已有同一 `release_id` 时什么都不做。

这句插入登记的是本库已经挂在当前指针上的那一批 `release_items`。它不 `UPDATE content_current`，所以 id=1 的指针不动。它不 `INSERT`、不改、不删 `release_items`，所以不复制行。它不连接另一份库，所以不复制 `rel_20`，也不复制 `rel_27`。

登记之后，后续发布才用现有的 `content_intake.publish_candidate`。不另写发布器，不手改已生成的 `0032_intake_direct_publication.sql`。函数体仍在那份生成迁移里。成功时它在自己的事务末尾才 `UPDATE content_current`（现文件第 177 行），并为新发布插入目录行（第 165 行）。失败时它在那之前 `RAISE`，指针留在原处。

现有函数在移动指针之前有一道目录门（第 63–67 行）：

```sql
IF v_base IS NULL
  OR NOT EXISTS (SELECT 1 FROM content_intake.release_catalogs WHERE release_id=v_base)
  OR EXISTS (SELECT 1 FROM public.release_items WHERE release_id=v_base AND category=k.domain) THEN
  RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='MODE_CONFLICT';
END IF;
```

注释写明：bootstrap 和 legacy-domain adoption 需要各自批准的身份映射；这个发布器不猜测映射，也不把删掉旧行当成隐式迁移。登记满足的是其中的目录谓词：基线发布已经在 `release_catalogs` 里。它不满足条目谓词。`category` 与 scope 的 `domain` 是同一组值。当前发布上只要这个域还有 `release_items`，现有函数就拒绝，指针不动。

2026-10-15 只读测量：

| 库 | 指针 | 目录行 | product | presale | campaign | aftersale |
| --- | --- | --- | --- | --- | --- | --- |
| Mac `customer_agent_synthetic` | `rel_20` | 0 | 106 | 3 | 2 | 2 |
| 杭州 `customer_agent_formal`，账本停在 `0034_intake_csv_v1_24` | `rel_27` | 0 | 106 | 75 | 4 | 223 |

四个话术域都已经有条目。登记之后，这四个域上的 `publish_candidate` 仍然是 `ZA003` `MODE_CONFLICT`。这是现有函数的结果，不是另一次发布。集成测试里的 `rel_native_base` 会删掉 product 条目再挪指针，那不是这次登记。`scope-menokin-sop` 的 domain 是 `sop`，`release_items.category` 不允许这个值，所以条目谓词对它为假。这次不用它绕过四个话术域。

来源模式是登记之后的另一步，不是这句插入。Mac 上五个 `src-menokin-*` 现在都是 `legacy`，`mode_version` 为 1。上传页只列 `v2-preview`。要上传的四个话术来源（`src-menokin-faq`、`src-menokin-presale`、`src-menokin-aftersale`、`src-menokin-campaign`）改成 `v2-preview` 时，`mode_version` 必须加一，否则现有约束报 `VERSION_REGRESSION`。`src-menokin-sop` 保持 `legacy`。模式改完，发布调用的仍是 `publish_candidate`。域里还有条目时，这次调用失败，`content_current` id=1 仍是 `rel_20`。

这次不删条目，不改 0032 的谓词，也不为了让指针离开 `rel_20` 去手插目录行。谓词要放行已有条目的域，需要另一次批准，改的是同一个 `publish_candidate`，而不是新的发布器。那一次不在这份设计里。

## 0035 前置校验

`0035_intake_legacy_check_acl_v1_25.sql` 仍是生成文件，只给 `intake_runtime_fn_owner` 授八个函数的 `EXECUTE`。失败点在跑这句 SQL 之前的 `verifyLegacyCheckPredecessor`。五个登录角色保留，不 `REVOKE`。它们是 API 连接用的，由 `ensureLoginRoles` 在迁移之后创建。

2026-10-15 在杭州只读读到的成员，与这份创建一致。`admin_option` 都是假。没有第二份成员关系：

| 登录角色 | 能力角色 | `rolinherit` | `rolcanlogin` |
| --- | --- | --- | --- |
| `stack_runtime` | `app_runtime` | 真 | 真 |
| `stack_content_admin` | `app_content_admin` | 真 | 真 |
| `stack_backend_auth` | `app_backend_auth` | 假 | 真 |
| `stack_backend_review` | `app_backend_review` | 假 | 真 |
| `stack_backend_worker` | `app_backend_worker` | 假 | 真 |

现有环境登录例外只放行 `permits_environment_member` 为真的 intake 角色，并且要求成员 `NOINHERIT`。五个 `app_*` 的这个标志是假，而且前两个登录角色是 `INHERIT`，所以现在会被算进 `memberships`。修正只把上表这五对从计数里拿掉，并且五对都要同时满足：成员是 `LOGIN`、不是超级用户、没有建库、建角色、复制、`BYPASSRLS`、没有 `admin_option`、没有第二份成员、`rolinherit` 与表中一致。

除此之外的成员仍然算失败。`GRANT app_runtime TO runtime_bad` 这种额外登录仍然失败。某一个生产登录如果改成相反的 `INHERIT`、带上 `admin_option`，或再拿一份角色，也失败。十七个能力角色本身仍必须在，且保持不能登录。干净安装没有这五对时，`memberships` 仍是 0。

触发器指纹按 `verifyCatalogueState` 里现有的 `trigger.manifest` 计算：表、触发器名、函数标识、`tgtype`、`tgenabled`、`pg_get_triggerdef`。条数期望 109。冻结哈希是在 PostgreSQL 15.18 上对 0001–0034 干净安装重算的，`search_path` 为 `"$user", public`，结果是 `97259c3711dd67a7b8cab797fe5d667518f9778cf5a1276f17969c060c5e9505`。

同一条 SQL 在杭州生产形态库上只读重算：PostgreSQL 15.19，同一 `search_path`，账本最大 id 是 `0034_intake_csv_v1_24`，当前发布 `rel_27` 且已有 `release_items`，五个登录角色都在。条数也是 109。哈希是 `650390f58729bcd850bc65150f5f5152da7acdb20bb2b0e7a2884e342757bb21`。

两边 109 条里，107 条字节相同。不同的只有 `public.import_batches` 上这两条的 `tgenabled`。`tgtype` 都是 17，`pg_get_triggerdef` 文本相同：

| 触发器 | 函数 | 冻结安装 | 这条生产形态库 |
| --- | --- | --- | --- |
| `backend_review_sync_wait_on_batch_failed` | `backend_review.sync_wait_on_batch_failed()` | `O`（启用） | `D`（禁用） |
| `import_batches_restore_snapshots` | `public.trg_restore_snapshots_on_import_failed()` | `O`（启用） | `D`（禁用） |

差不在 PostgreSQL 15.18 和 15.19 的定义排版，也不在函数体。函数安全清单在当初的失败信息里没有出现，这两条定义文本也与冻结安装一致。校验不把这两条重新启用。重新启用会改变这条库上的导入失败行为，不在这次修正里。

`verifyLegacyCheckPredecessor` 把这个说明作为返回值。清单哈希等于冻结哈希时，说明是没有这处差。哈希不同时，只把这两条清单里、`definition=` 之前的 `tgenabled` 从 `D` 读成 `O` 再哈希；结果等于冻结哈希才通过，并返回上面两行的名字和 `D`/`O`。改了定义文本、禁用了别的触发器、或条数不是 109，仍然失败。0041 的就绪指纹是另一组 112 条哈希，不借用这条例外。

把上表五对从成员计数里拿掉之后，同一条杭州库上的 `memberships` 为 0，十七个能力角色仍在。这是只读复核，没有 `GRANT` 或 `REVOKE`。
