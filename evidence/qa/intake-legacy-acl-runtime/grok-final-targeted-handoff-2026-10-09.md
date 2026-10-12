两个工作区在实验前后都停在预期 HEAD，工作树干净。完整 /review 仍是未完成，这轮没有把它改成 PASS。

产品 codex/intake-organization 为 1c5d5e1401f5dc9fe2d47de333f37ed6c29c8e51。治理 codex/content-intake-p2-contracts 为 0125a97c284a78262a52a67b3d9834107a0f59bc。实验只用临时 PG15 和合成数据，证据在 /tmp/review-final-20261009/self/。

A. 来源 mode 的三种顺序

命令：node /tmp/review-final-20261009/self/mode-order.mjs。第一次因包导出只能走 ESM 而失败，改为绝对路径后重跑一次。三次都走管理路由 management-http.ts:72-77 的真实 POST，状态来自 sendIntake。代理只在 SQL 边界放行第二个会话，没有改写返回行。

输入 SHA-256：files.ts fff26fce413629e5cd78aebdbdc4d10b94d95deb6a17041ddc380e5c95f913f5，transaction.ts 9906ed543c4e30329a2b768d95ebe11929279be0721f7dee3dc06be73b0736ae，authority.ts de05d233acef0091e69ef9b391f4a11666610d1c985c99fbc35c5f2c24d9dfaa，management-http.ts b57937ad7d6848e3bd5ddbe4bffa897fd259d4af0aea0a0bb0aebe894ff0b1da。

原始结果 /tmp/review-final-20261009/self/mode-order.json，18253 字节，SHA-256 113e9f8065e644083f2816ceefbc735259550ebb59ed51db377236ff5fa48d48。日志 mode.stderr.log SHA-256 f9ddd61adf85641aa6b0fdd06be5a96809f62e98221bfb8c56161b596db048ed。执行 3，失败 0，未执行 0。

┌──────────┬─────────────────┬────────────────────────┬────────────┬──────────────┬─────────────────┐
│ 安排     │ 锁              │ 最终 SELECT 读到的     │ HTTP       │ 实际提交位置 │ 对象 / 回执 /   │
│          │                 │ mode                   │            │              │ reservation     │
├──────────┼─────────────────┼────────────────────────┼────────────┼──────────────┼─────────────────┤
│ 回执     │ 上传会话已持有  │ v2-preview，未改写     │ 201        │ 更新 COMMIT  │ 1 个 input      │
│ INSERT   │ advisory        │                        │            │ 05:33:       │ 对象，1 条      │
│ 之后、   │ (724019,1)      │                        │            │ 04.808Z，    │ intake:upload   │
│ 最终     │ ExclusiveLock   │                        │            │ 晚于上传     │ 回执，          │
│ SELECT   │ ；更新会话      │                        │            │ COMMIT 05:   │ reservation     │
│ 之前     │ Lock/advisory， │                        │            │ 33:04.805Z   │ adopted；提交后 │
│          │ granted=false， │                        │            │              │ mode 为 legacy  │
│          │ 被上传会话阻塞  │                        │            │              │                 │
├──────────┼─────────────────┼────────────────────────┼────────────┼──────────────┼─────────────────┤
│ 最终     │ 同样等待        │ v2-preview，未改写     │ 201        │ 更新 COMMIT  │ 同上；HTTP      │
│ SELECT   │ advisory        │                        │            │ 05:33:       │ 返回时快照仍是  │
│ 返回之后 │ (724019,1)      │                        │            │ 05.908Z，    │ v2-preview      │
│ 、COMMIT │                 │                        │            │ 晚于上传     │                 │
│ 之前     │                 │                        │            │ COMMIT 05:   │                 │
│          │                 │                        │            │ 33:05.907Z   │                 │
├──────────┼─────────────────┼────────────────────────┼────────────┼──────────────┼─────────────────┤
│ HTTP     │ 无锁等待，      │ 上传过程中没有并发更新 │ 201；同一  │ HTTP         │ 对象、回执、    │
│ 返回之后 │ 更新耗时 1ms    │                        │ operation  │ 返回之后     │ adopted         │
│          │                 │                        │ 再传一次为 │              │ reservation     │
│          │                 │                        │ 409 MODE_  │              │ 保持 1 条       │
│          │                 │                        │ CONFLICT   │              │                 │
└──────────┴─────────────────┴────────────────────────┴────────────┴──────────────┴─────────────────┘

前两个窗口里，mode 变化事务无法在窗口内提交。这是锁等待记录，不是推断。content-intake.integration.test.ts:754-768 的受控替身会改写 SELECT 行，本轮没有使用。schema.v1.25.sql:10359-10365 的 lock_content() 取 pg_advisory_xact_lock(724019,1)，与观察到的锁一致。产品角色不能绕过 source_write_lock；本轮没有使用 session_replication_role=replica。

B. 18 个哈希与目录身份列

命令：python3 /tmp/review-final-20261009/self/prepare-and-hash.py，随后 node priv.mjs 与修正后的 node bait.mjs。priv.mjs 第一次同样因包解析失败。诱饵表第一次只授予了 INSERT，调用前的 DELETE 得到 42501，函数体没有执行；补上 DELETE 授权后重跑一次。

legacy-check-freeze-checks.json SHA-256 9a24429573f9fd56ac668120029d70752a986bd0484619e8114bf7aadef9e6ff。directory-acl.sql SHA-256 49b4555f80cfe8d7302c67d081cc49a915949b613acda564dcd408a6232c67fa。schema.v1.25.sql 706504 字节，SHA-256 0620ee58a19543736f58b8dcf54ad5a2d0865cd48a74e24a245bbb384f1b7998。

哈希日志 hash-compare.json SHA-256 af4aa526f7bf099773e547a25db2eaf06fc1200cadc0ffa050c39569431555df：18/18 字节数和 SHA-256 一致，mismatch 0。目录结果 priv.json SHA-256 c2fb37fbcdca1e6a1ec82d5a69afd1e5b6a522cc89934f909fe4af110f26a0cd。诱饵结果 bait.json SHA-256 47b9c96b5116c52876a80e8802101c39aee0c0cab70b0d6a82f9ae8c4f79ed91。

直接更新：rev_nobody 和已 SET ROLE intake_usage 的 rev_usage 对 token_hash、user_id、两处 principal_id 的 UPDATE ... WHERE false 全部是 SQLSTATE 42501。两者 SET ROLE intake_directory_fn_owner 也是 42501。该所有者是 NOLOGIN、NOSUPERUSER。列授权仍只给它，位置是 directory-acl.sql:16-18、schema.v1.25.sql:13887-13889、产品迁移 0033:990-992。

intake_usage 可以执行 backend_review.lock_content()。在它的会话里先创建 pg_temp 诱饵 pg_advisory_xact_lock(integer,integer)、current_setting(text)、hashtext(text)、clock_timestamp()，函数成功返回，诱饵表 0 行。集群所有者在同一会话调用，同样 0 行。

publish_candidate、preview_rollback、execute_rollback、manage_shop_directory_steward、read_shop_directory 对 intake_usage 和 PUBLIC 都没有 EXECUTE。usage 调用得到 42501，诱饵 0 行。所有者调用时：preview_rollback 已经走过 0032:196 的 hashtext(...) 后才返回 SCOPE_DENIED，诱饵仍是 0 行；publish_candidate 与 execute_rollback 在 0032:37 和 0032:287 因请求缺少 confirmed 提前返回 MODE_CONFLICT，只执行到 0032:25、0032:284 的 clock_timestamp() 初始化，这两次没有走到各自后面的 hashtext。无特权角色在 public 创建 hashtext 得到 42501。

点名函数的函数体扫描没有发现对 token_hash、user_id、principal_id 的 UPDATE ... SET。治理库还有 86 个、产品迁移库还有 97 个 search_path 含 public 或 pg_temp 的 SECURITY DEFINER，只做了清单，没有逐个调用。

这一面没有可执行的越权路径，因此没有修复建议。

C. 测试后半、种子、114 例与版本链

家族探针命令：

PATH="$HOME/homebrew/opt/node@24/bin:$HOME/homebrew/opt/postgresql@15/bin:$PATH" node --experimental-strip-types scripts/probe-intake-family-sql.mjs --output /tmp/review-final-20261009/self/family-probe.json

脚本 SHA-256 d1e4ecdb61f1b0f5e71e7bab5c3abddab4d2230bb5295bebd5911a745780a812。结果 family-probe.json 30834 字节，SHA-256 0e5610de3dee95efa9e6c37cfa5e2bc0e5f612b2979c555bb6bac2ee76b4b554。stderr SHA-256 5c7bd823c9e78576be7c2ab6a15e0b2fda7dea07a0eb55254fcffbf8eaa2a5ff。114 例全部 PASS，oracle 100，失败 0。先前沙箱里的 shmget 失败没有当作产品失败。

治理测试是 /tmp 副本，证据目录改到 /tmp/review-final-20261009/self/gov/，端口改为 56247、56244 和随机端口。仓库 output/ 没有新文件。

• CSV：副本第一次按 import.meta.url 去 /tmp 找 protocol.json。改为治理仓库绝对路径后重跑，{"status":"PASS","checks":35}。stdout SHA-256 5ddfb0b6d01a6ddc8b1f9f4961c77bd38c3f2be4aafa4e9c904b8baf53bde250。
• runtime closure：17/17 PASS。stdout SHA-256 7f64fbe540f6707fc6fb7005db813464e52366ce3799ac3b2603bbd5dde0ede2。覆盖八个 INVOKER 助手的授权前后、旧行复制、七类拒绝、历史不可变和 schema 1.25 新装后的所有者属性。
• 店铺目录：253 项 PASS。stdout SHA-256 42122c0e5a3ce36cf67c16346245d89607aa232a4954bfa0e47c2ff9d6e928bc。种子 INSERT 在 content-intake-shop-directory-contract.pg.mjs:66-139，包括 12 个合成身份、角色、11 个 scope 和登记员。测试末尾 523-525 的 public.hmac 改名是一次性库里的超时探针，不是产品缺陷。

已批准哈希全部重算一致：schema 1.23 4c2969459265262f...9cc978e（699965），1.24 c4ceffa9...f744c5（705427），1.25 0620ee58...1b7998（706504），OpenAPI 1.22 3f741eb9...ed43a94（423919）。产品契约副本里的三份 schema 与治理文件相同。1.23 到 1.24 是 2 个 hunk、83 行追加、0 行删除，正文是 CSV 格式守卫。1.24 到 1.25 是 2 个 hunk、17 行追加、0 行删除，正文是八个 public.* 谓词对 intake_runtime_fn_owner 的 EXECUTE。生成器 build_customer_agent_runtime_closure.mjs:10-20 在前序哈希不符时拒绝拼接。

这个链条足以证明未变化前缀的字节仍是已批准版本。它不足以代替对 schema.v1.23.sql:1-13922 和 openapi.v1.22.yaml 全文的语义逐行审查。本轮没有展开这两段。

给主 Agent 的结论

没有新的可行动缺陷。完整 /review 仍未完成。

┌─────────────────────────────────────────────────┬─────────────────────────────────────────────────┐
│ 既有缺口                                        │ 结论                                            │
├─────────────────────────────────────────────────┼─────────────────────────────────────────────────┤
│ 最终 SELECT 前、SELECT 与 COMMIT 之间、COMMIT   │ 实际验证通过                                    │
│ 后的真实 mode 变化                              │                                                 │
├─────────────────────────────────────────────────┼─────────────────────────────────────────────────┤
│ 前两个窗口内的 mode 提交                        │ 实际验证通过：锁等待证明提交落在上传 COMMIT     │
│                                                 │ 之后                                            │
├─────────────────────────────────────────────────┼─────────────────────────────────────────────────┤
│ 受控 SELECT 行替身                              │ 本轮没有使用，已与真实交错分开                  │
├─────────────────────────────────────────────────┼─────────────────────────────────────────────────┤
│ 18 个治理 PG 输入哈希                           │ 实际验证通过                                    │
├─────────────────────────────────────────────────┼─────────────────────────────────────────────────┤
│ 无特权角色和 intake_usage 直接更新目录身份列    │ 实际验证通过                                    │
├─────────────────────────────────────────────────┼─────────────────────────────────────────────────┤
│ lock_content 的 pg_temp 诱饵                    │ 实际验证通过                                    │
├─────────────────────────────────────────────────┼─────────────────────────────────────────────────┤
│ publish_candidate、preview_rollback、execute_   │ 实际验证通过：42501，没有可执行路径             │
│ rollback、目录函数对 intake_usage 的调用        │                                                 │
├─────────────────────────────────────────────────┼─────────────────────────────────────────────────┤
│ preview_rollback 已执行到的 hashtext            │ 实际验证通过                                    │
├─────────────────────────────────────────────────┼─────────────────────────────────────────────────┤
│ publish_candidate:40 与 execute_rollback:290 的 │ 有理由接受为限制：这两次调用提前返回；同一      │
│ hashtext                                        │ search_path 已由 preview_rollback 覆盖          │
├─────────────────────────────────────────────────┼─────────────────────────────────────────────────┤
│ 其余 86/97 个含 public 或 pg_temp 的 DEFINER    │ 有理由接受为限制：任务要求只计数，              │
│                                                 │ 未逐个动态执行                                  │
├─────────────────────────────────────────────────┼─────────────────────────────────────────────────┤
│ CSV 与 runtime closure 的 PG 后半               │ 实际验证通过                                    │
├─────────────────────────────────────────────────┼─────────────────────────────────────────────────┤
│ 店铺目录种子 INSERT 及该 PG 测试                │ 实际验证通过                                    │
├─────────────────────────────────────────────────┼─────────────────────────────────────────────────┤
│ 家族探针 114 例                                 │ 实际验证通过                                    │
├─────────────────────────────────────────────────┼─────────────────────────────────────────────────┤
│ schema 1.23/1.24/1.25 与 OpenAPI 1.22           │ 实际验证通过                                    │
│ 的字节身份和追加链                              │                                                 │
├─────────────────────────────────────────────────┼─────────────────────────────────────────────────┤
│ schema 前缀与 OpenAPI 的语义逐行重读            │ 有理由接受为限制：哈希只证明字节未变            │
├─────────────────────────────────────────────────┼─────────────────────────────────────────────────┤
│ 生产 HTTP、Windows 人工验收、真实客户或员工数据 │ 仍未完成                                        │
├─────────────────────────────────────────────────┼─────────────────────────────────────────────────┤
│ 拒绝后重放的临时 reservation、资格撤销、        │ 仍未完成                                        │
│ 角色变更竞争                                    │                                                 │
├─────────────────────────────────────────────────┼─────────────────────────────────────────────────┤
│ 完整 /review                                    │ 仍未完成                                        │
└─────────────────────────────────────────────────┴─────────────────────────────────────────────────