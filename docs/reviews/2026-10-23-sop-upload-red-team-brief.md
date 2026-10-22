# 红队审查任务书：SOP 自助上传（上传 → 候选 → 发布 → 坐席可见）

这份文档是给审查者的任务书，不是结项报告。它的作用是让审查者在一个精确的范围内攻击，而不是泛泛评估。

审查对象是**未提交的工作树**，不是 main。下面「仓位」一节说明到底有什么暴露在外。

---

## 一、仓位（先读这一节，它决定你能攻击到什么）

| 项 | 状态 |
| --- | --- |
| 仓库 | `/Users/hutou/Desktop/customer-agent-prototype` |
| 基线 commit | `e1f2cabb`（`refactor(api): name every dependency, and gate grants on live qualification (#105)`） |
| 分支 | `main`，未提交改动 |
| 已改文件 | 10 个（`git diff --stat`） |
| 新增文件 | 7 个 |
| 迁移 | **1 个新增**：`0061_sop_entry_code_identity`（只替换一个函数体） |
| 台账文件 | 已按实测抄录更新（`verifier.ts` / `planner.ts` / `generate-migrations.mjs` / `contract-set.mjs` / 生成产物 / 三个测试） |

新增文件与职责。

| 文件 | 行数 | 职责 |
| --- | --- | --- |
| `apps/api/src/content-intake/sop-media.ts` | 114 | 图片三步握手（reserve → 写字节 → complete），失败清理 |
| `apps/api/src/content-intake/sop-freeze.ts` | 122 | SOP 专用 freeze，构造 15 键 material / 18 键 entry / 7 键 p_media；含行身份守卫 |
| `apps/api/src/content-intake/sop-preview.ts` | 78 | 坐席读图：发布副本走 SQL，审阅中的走暂存 |
| `apps/api/tests/input-format.test.ts` | 75 | 来源格式四元组 + policy version 例外 |
| `apps/api/tests/sop-preview.test.ts` | 58 | 读图来源与失败关闭 |
| `apps/api/tests/sop-row-identity.test.ts` | 41 | 已发布行文字不得在同一位置被改写（位置式 ID） |
| `apps/api/tests/sop-entry-code.test.ts` | 60 | 插入行后编码与正文稳定、空/重复编码拒绝、表头不入目录 |
| `scripts/audit-sop-v2-readiness.mjs` | 196 | 只读就绪审计，无 `--apply` |
| `packages/database/overlays/0061_sop_entry_code_identity.sql` | 179 | 只把 0040 的 SOP 行身份守卫收窄到位置式 ID |

已改文件里只有四处是行为变更，其余是类型与常量。

| 文件 | 变更 |
| --- | --- |
| `apps/api/src/content-intake/service.ts` | SOP 分支改走 `freezeSopParsed`；`createIntakeUsage` 注入 `createReleasePreviewReader`（第 290 行）；确定回滚时释放已持久图片 |
| `apps/api/src/content-intake/candidate.ts` | 抽出 `materialFor()`，通用 freeze 与 SOP freeze 共用 |
| `apps/api/src/content-intake/input-format.ts` | 新增 `sop-v1` 四元组分支 |
| `apps/api/src/content-intake/material.ts` | policy version 例外，改为复用 `sourceInputFormat` 已作的判定 |
| `apps/api/experiments/sop-row-deletion/{media-lifecycle,persistent-media}.ts` | 改为从生产模块再导出（-116 / -56 行），不再持有第二份实现 |

### 已验证（可以当事实用）

- `apps/api/tests/content-intake.integration.test.ts` **177/177 通过**，含目标用例「上传 202 → 候选 validated → 发布 202 → 坐席取到文字与图片字节」。
- `input-format.test.ts` 5/5、`sop-preview.test.ts` 2/2、`sop-row-identity.test.ts` 5/5、`content-intake-material.test.ts` 19/19。
- `apps/api/src` 的 `tsc --noEmit` 干净，改动文件 eslint 干净。
- 审计脚本在本地临时 PG15 上跑过两轮（该集群已删除），第二轮证实 `domain='product'` + `mapping='sop-not-imported'` 的来源会被 `0040` 判定为 SOP 来源。

### 未验证（不要当成事实）

- **真实工作簿从未端到端跑通。** 所有通过都是合成工作簿（`createSyntheticSopWorkbook`）。47 张图、2.27 MB、266 行、六张真实表名的场景没有跑过。原始文件已不在 `faq/minokin话术库/`，我无法复现。
- **生产库从未写入。** 杭州库只做过只读查询。
- **桌面端零改动。** 前端能不能上传，取决于库里有没有 `v2-preview` 来源与对应 grant，代码没动过。
- **行身份已修复。** 见 `docs/reviews/2026-10-23-sop-row-identity.md`。业务方必须在表头写「条目编码」列，编码是身份、行号只是位置；插入行不再改写已发布条目。

### 已知红（基线就有，不是本次引入）

`apps/api/tests/sop-{media-capacity,media-delivery,row-deletion-candidate,trusted-stage}.integration.test.ts` 四个文件断言 `migrationCount: 53`，仓库实际有 60 个迁移，因此全红。我在干净树上用 `git stash` 复现过同样的失败，确认与本次改动无关。

---

## 二、规则（请严格遵守，否则审查没有价值）

1. **不许假想。** 每一条结论必须给出 `文件:行号` 或一条可复现的命令。写不出锚点的判断，请直接删掉，不要写「可能存在」「建议评估」。
2. **不许过度防御。** 不要写「这个设计是合理的，因为」「考虑到安全，建议」这类缓冲句。发现了就说发现了，没发现就说没发现。
3. **区分三种陈述。** 每条结论标注它是「已实测」「读码推断」「猜测」。猜测必须写明用什么实验可以证伪。
4. **可以攻击文档本身。** 上面「已验证」表里任何一条，如果你复现不出来，那就是文档在撒谎，请直接指出来。
5. **不要给通用建议。** 不要写「建议加强测试」「建议补充文档」。要写就写「在 X 文件 Y 行，Z 情况会让 W 发生，由 V 命令可复现」。
6. **允许结论是「没问题」。** 但要说清你查了什么才知道没问题。

---

## 三、攻击面 A：数仓负责人视角的红队

请站在一个要为本项目数据可信度签字的人的位置。你的问题不是「代码有没有 bug」，而是「半年后我能不能证明某条坐席看到过的话术，当时是什么内容、从哪个文件来、经过谁的手」。

### A1 数据源与来源真伪

- `0038_menokin_sop_domain_v1_27.sql:104` 与 `:108` 注册了 `src-menokin-sop`，tuple 是 `sop-v1 / sop-not-imported / not-imported`，`structure_digest = 55db6226...`。
- 我在 `apps/api/src/content-intake/input-format.ts` 加了一个 `sop-v1` 分支，返回六张真实表名。
- **但这条分支今天一定失败**，因为 `0034_intake_csv_v1_24.sql:85` 把所有非 CSV 对象的 `selectedSheets` 钉死为 FAQ 三元组。我把它写成了显式 BLOCKED 注释。

请攻击：如果为了上线改用「捷径」（把 SOP 来源注册在 `product` 域，`mapping='sop-not-imported'`），`material.selectedSheets` 会记成 FAQ 三张表名，而实际文件是六张表。这对数据可信度的影响是什么？请给出具体的查询或对账方式，说明这种不一致以后会不会被发现。

### A2 发布不可变性与血缘

- 发布触发器在 `0040_intake_repair_successor_v1_28.sql:1396`（判定 SOP）与 `:1414`（要求图片 payload 为 `purpose='sop-media'` 且预约已 adopted）。
- `public.release_source_bindings` 的 domain CHECK 在 `0002_identity_and_content.sql:60` 与 `0004_import_release_announce.sql:478`，都只有四域。
- direct publish 只是**复制** base 的绑定：`0042_intake_occupied_domain_publish.sql:156`、`0043_intake_publish_default_tenant.sql:171`。

请攻击：SOP 的内容进了 `content_intake.release_lineage`，但不进 `release_source_bindings`，也不进 `v_release_source_gate` 的计数与哈希。一个 release 的 `source_binding_hash` 因此不覆盖 SOP。请给出具体的复核 SQL，说明当 SOP 内容变化时，会不会出现「gate 显示 ready 但实际内容已变」的窗口。

### A3 图片字节的可追溯性

- 图片走 `reserve_sop_media_payload` / `complete_sop_media_payload`，实现在 `sop-media.ts`。
- 字节落在本机对象存储，元数据在 `content_intake.objects` 与 `sop_media_objects`。
- 坐席读图必须带 entitlement，路由在 `apps/api/src/content-intake/usage-http.ts:21`（`GET /v1/intake/preview`）。

请攻击：这些图不在任何备份或迁移脚本里。`docs/how-to-run-backend-on-hangzhou.md` 的迁数据流程搬的是 `~/.customer-agent-formal/objects/`。请指出：如果对象存储与数据库不一致（文件在、行不在，或反过来），现在哪个断言会先炸，哪个会静默通过。`linked-preview.ts:15-16` 是进程内 Map，请判断它在多进程或重启后的具体后果，不要泛泛说「不可靠」。

### A4 诊断能力

- 审计脚本 `scripts/audit-sop-v2-readiness.mjs`，只读，输出七项 gap。
- 生产库实测（2026-10-23，只读）：`policy_versions` 有 v16，`store_set_*` 全空，`content_intake.grants` **0 行**，`principals` 3 个，`release_lineage` 只有 `rel_28..rel_32` 各 1 条，`rel_27` 为 published 且 `release_items` 408 条但 lineage 为 0。

请攻击：坐席今天读的到底是哪条路径？`apps/api/src/content-intake/usage.ts` 的 snapshot 用 `release_lineage` 驱动 entries，lineage 为空则返回 0 条。请用 SQL 证明坐席现在能不能看到内容，以及「发布成功」的判定标准应该是什么。

---

## 四、攻击面 B：前后端连接

- 桌面端零改动。domain 联合写死在 `apps/desktop/src/shared/content-intake-upload.ts:16`。
- UI 用 `as const` 索引：`apps/desktop/src/renderer/features/dashboard/IntakeUpload.tsx:8`（`domainWord`），`apps/desktop/src/main/content-intake-management.ts:26`（`DOMAIN_LABEL`）。多一个域会类型报错，少一个会显示 undefined。
- 契约把 domain 限死四值：`packages/contracts/src/generated/openapi.generated.ts:2767`。
- `IntakeMaterial` 是两种变体的判别联合：同一文件 `:2403` 起是 `faq-p1.1` 变体，另一种是 `faq-csv-v1`。**没有 sop 变体。**
- 上传前置门禁：`apps/api/src/content-intake/files.ts:44` 要求 `mode='v2-preview'`，否则 `MODE_CONFLICT`。

请攻击下面三条，每条都要给出「谁先炸、报什么错、用户看到什么」：

1. 前端拿到的来源列表来自 `GET /v1/intake/sources`，经 `parseContractSchema('IntakeSourceList')`。如果库里出现 `domain='sop'` 的来源，前端会怎样失败？是白屏、少一项、还是整个列表消失？
2. entitlement 签发在 `usage-http.ts:27`，读图在 `:21`。中途撤权时，已经签出去的 entitlement 会不会继续给字节？请找到具体的复核点，指出复核是发生在读图前还是读图后。
3. `createReleasePreviewReader`（`sop-preview.ts`）同一个 objectId 优先返回发布副本。如果一条候选刚发布、发布副本与暂存副本的 sha256 不一致，会返回哪一个，另一个会怎样？

---

## 五、攻击面 C：耦合度、解耦、扩展性

产品的明确要求是「后续支持新增店铺、新增板块」。请按这个要求审，不要按「未来可能」审。

- 域与范围的注册是数据驱动：`content_intake.scopes`（`0021` 建表，`0038` 放开 sop）、`content_intake.sources`、`source_mappings`。
- 但域的**类型**分散在至少五处：契约 `openapi.generated.ts:2767`、桌面 `content-intake-upload.ts:16`、`IntakeUpload.tsx:8`、`content-intake-management.ts:26`，以及数据库三处 CHECK（`0002:60`、`0004:274`、`0004:478`）。
- 我这次为了不碰契约，把 `ParseContext.domain` 放宽到含 `sop`（`packages/content-intake/src/policy.ts`），这是**类型放松**，请重点审它有没有削弱别处的检查。

请回答：

1. 新增一个店铺，今天需要改几个文件、几处数据？给出清单。
2. 新增一个板块（domain），今天需要改几个文件、几处数据？其中哪些必须一次原子提交，否则会出现半可用状态？
3. 我这次的三处改动里，哪一处增加了耦合？特别是 `candidate.ts` 抽出 `materialFor()` 之后，通用 freeze 与 SOP freeze 是否真的共用同一份事实，还是只是看起来共用？

---

## 六、我自己认为最可能出错的地方（供你验证，不是结论）

列在这里是为了让你先打我，而不是听我辩解。每一条都是我可证伪的陈述。

1. `sop-freeze.ts` 里 `rowBindings` 与 `assets.rows` 的合并，我用长度相等（`rows.length !== material.entries.length`）做校验。JSON 里两条 entry 带同一个 `businessEntryId` 会让 `materialFromParse` 的 Map 变少，长度校验会先拒，所以重复 ID 不是这里的漏洞。**真正的漏洞是位置平移**，见 `docs/reviews/2026-10-23-sop-row-identity.md`。
2. `service.ts` 里图片持久化发生在 freeze 事务**之前**。已在确定回滚时调用 `release`，但这条路径没有集成测试覆盖，只做了读码与 lint。持久泄漏的判定标准仍未定。
3. `sop-preview.ts` 的失败关闭只在 `readAttachment` 缺失或抛错时触发。如果 SQL 返回的 payload 元数据与文件内容不一致，`readAttachment` 会不会自己发现，我没有实测。
4. `input-format.ts` 的 `sop-v1` 分支目前是死路（被 `0034:85` 挡）。如果有人在补 overlay 迁移时忘了同步这个注释，代码会看起来像能用。

---

## 七、请按这个格式输出

```
## 结论
（三行以内，只说有没有阻断级问题）

## 阻断项
每条格式如下。
- [层级] A1/B2/C3
- 位置：文件:行号
- 触发条件：具体输入或状态
- 后果：谁看到什么错误
- 证据：命令 或 读码行号
- 类型：已实测 / 读码推断 / 猜测
- 证伪方式：一条可执行的检查

## 非阻断项
（同上格式，标注严重度）

## 我复现不出来的文档声明
（如果「仓位」一节里有你说不通的，列在这里）

## 我确认没问题的部分
（写清你查了什么）
```

---

## 八、复现环境

```sh
cd /Users/hutou/Desktop/customer-agent-prototype
pnpm install

# 目标用例（单条）
cd apps/api
CUSTOMER_AGENT_API_PG15_INTEGRATION=1 npx vitest run \
  tests/content-intake.integration.test.ts \
  -t "second synthetic seat receives published SOP text"

# 全文件
CUSTOMER_AGENT_API_PG15_INTEGRATION=1 npx vitest run tests/content-intake.integration.test.ts

# 我的三个新单测
npx vitest run tests/input-format.test.ts tests/sop-preview.test.ts tests/content-intake-material.test.ts

# 就绪审计（需 DSN，只读，无 --apply）
node scripts/audit-sop-v2-readiness.mjs --dsn <dsn>
```

集成测试需要本机 PostgreSQL 15（`pg_config --bindir` 能解析到）。每次跑都会新建临时集群并在结束时删除。

生产库我没有给你连接串，也不建议给。A 组里需要生产数据的判断，请改为「给出应当执行的只读 SQL」，由持有权限的人执行。
