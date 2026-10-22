# SOP 链路审核（2026-10-23）

范围：上传 → 候选 → 发布 → 坐席可见，含前后端与权限。只读审核，代码改动仅一处 lint 修复与新模板文件。

## 结论

后端链路在同一进程内是通的，且已被集成测试逐条断言。业务侧今天**跑不通**，原因不在后端逻辑，是五件互相独立的事：

1. 业务手里的 SOP 模板会被解析器拒绝。实测 6 张表全部 `MISSING_ENTRY_CODE_HEADER`。
2. 生产库当前没有任何有效授权，所有来源仍是 `legacy`。任何人无法上传、发布或按 v2 读取。
3. 只给 import 权限的人走不到候选，需要同时给 content-manage。
4. 266 行的 SOP 要逐条完成 266 次人工质检才能发布。
5. 坐席看不到图片，且发布后的 SOP 条目落在「产品」页签而不是「SOP」页签。

第 1、2 条让链路完全走不动。第 3 到 5 条让链路能走但不可用。

## 一、技术链路（已通）

| 环节 | 入口 | 证据 |
| --- | --- | --- |
| 上传 | `files.ts:87` → `authority.ts:41-45` → `input-format.ts` → `capacity.persist` | 目标用例 202 |
| 接收 | `candidate.ts` `receive`，要求 `mode='v2-preview'` | 同上 |
| 解析 | `service.ts:181` `sourceUsesSopWorkbook` → `tryParseSopAsFaq` | 同上 |
| 图片 | `sop-media.ts` reserve → `withObjectLock` + `persistAttachment` → complete | 同上 |
| 冻结 | `sop-freeze.ts` → `freeze_sop_parsed_candidate`（0040:1200） | 同上 |
| 质量 | `quality-access.ts`，reviewer 角色 | 同上 |
| 发布 | `publication.ts` → `publish_candidate`（0043）→ `project_sop_release_media`（0040:1389） | 同一用例 202 |
| 坐席 | `usage.ts` entitlement → snapshot → preview（`sop-preview.ts`） | 同一用例断言文字与 PNG 字节 |

实测：`content-intake.integration.test.ts` 178/178，连续 4 次通过。`pnpm test:db:integration` 77/77 两次。迁移 61 条可从空库装齐并核验。

工作配置是「product 域 + `mapping_version='sop-not-imported'`」。真实的 `sop-v1` 元组仍不可用，因为 `0034:85` 要求非 CSV 对象的 `selectedSheets` 等于 FAQ 三元组，而 `sop-v1` 分支写六张表名。

## 二、阻断项

### B1 业务模板被拒（实测）

`~/Desktop/话术模板-20261022/SOP-模板.xlsx` 用当前解析器解析：

```
ok: false
issues: 6 × MISSING_ENTRY_CODE_HEADER（每张表一条）
```

模板第 1 行是「【示例·导入前请删除】第一步：……」，不是表头；六张表都没有「条目编码」列，空表连第 1 行都没有。

已生成 `SOP-模板-含条目编码.xlsx`（新文件，原文件未改）。六张表第 1 行为 `条目编码 | 答案`，过敏表的三个示例行下移到第 2 至 4 行并带 `DEMO-1..3`。实测解析 `ok: true, issues: 0`，产出的三条 `businessEntryId` 为 `DEMO-1..3`，且原来的两格同一行仍拼成一段。

界面表现（读码）：解析任务落 `failed`，提示「校验未通过」，问题表逐行列出 `工作表 / 行 / 列 / 修正建议`，文案是「第一行表头必须包含「条目编码」列，为每行填写稳定编码」。`IntakeUpload.tsx:94-111` 不渲染 `issue.code`，只渲染 `message`。

表头比较是精确字符串相等（`sop.ts:291`）。`条目编码 ` 带尾随空格会被判为缺失。

### B2 生产无有效授权（实测，2026-10-23 只读）

```
grants: 54 行，not_revoked = 0
revoked_at 全部为 2026-10-15 21:28:16，原因「撤回 rel_32 引导函数新造的根授权及其业务授权」
store_sets: 0
policy_versions: 1
sources: 5 个全部 legacy
current_release: rel_27
release_revocations: 0
```

这是 2026-10-15 的一次有意清理，不是故障。但它意味着 `authorization_sources` 对所有动作都返回空，`scopesFor` 直接 `SCOPE_DENIED`。验收条件「各个账号权限正常」在生产环境当前不成立。

恢复需要三步，顺序不能颠倒：来源切 `v2-preview`（要新增 mapping 行并递增 `mode_version`）、建立 store set、签发 live grant。第三步不能完全自助，见 B4。

### B3 坐席看不到 SOP 图片（读码）

API 能返回图片字节，桌面端没有路径取它。缺的不是一个 `<img>`，是四层：

1. 快照契约把 `media` 限死 `maxItems: 0`（`runtime-schema.generated.ts:9843-9869`），API 也固定返回空数组（`usage.ts:412`）
2. `IntakeQueryRow` 没有媒体字段（`shared/content-intake-query.ts:5-8`）
3. Query preload 没有 preview 方法（`preload/content-intake-query.ts:19-35`）
4. renderer 卡片没有图片节点；全仓只有两个 `<img>`，都是品牌 Fox 头

`IntakeCatalog.preview(objectId)` 在 `content-intake-usage.ts:197-208` 已实现，但 desktop 内零调用点。原工作簿 47 张图是流程步骤的一部分，现在全部丢失。

### B4 首个 publish grant 无法自助创建（读码）

- `authority.ts:89-98` 只对 `business + import + director/manager/engineer` 免除 parent，其他动作必须有同动作 parent
- `bootstrapRootAllocation`（`authority.ts:173`）无生产调用，且有测试断言它不得被调用（`apps/api/tests/grant-issuer-deadline.integration.test.ts:77-83`）
- `authority.ts:126` 禁止自授

所以新租户拿到 import 之后，publish/review/rollback 只能靠 SQL 播种。B2 的第三步就卡在这里。

### B5 只有 import 权限看不到候选（读码）

上传与解析能走完，但打不开候选。

```89:91:apps/desktop/src/main/content-intake-upload.ts
  private canManage(access: IntakeAccess | null) {
    return !!access && Date.now() < Date.parse(access.validUntil) && access.capabilities.some(c => c.scope.sourceId === this.sourceId
      && c.actions.includes('content-manage') && Date.now() < Date.parse(c.validUntil));
```

`canOpen` 要求 `content-manage`（`content-intake-upload.ts:124`），`upload-open` 成功后又检查一次（`content-intake-management.ts:179`）。所以业务方若只被授予 import，会停在「解析完成但打不开」的状态，界面上没有解释。

这条与 B4 叠加：给业务方配权限时，import 与 content-manage 必须一起给，否则链路中途断掉。

## 三、影响可用性但不影响正确性

### C1 材料只能单向翻 14 页，且回不去（读码）

`files.ts:168` 的 cursor 是签名 offset，且 `offset === 0` 直接拒绝。桌面每页 20 条，只有「下一页材料」（`IntakeManagement.tsx:70`）。重新点「查看材料」回到第一页。

266 行等于 14 页（13×20+6）。第 3 页发现错误无法回看。质量检查页有上一页/下一页，材料页没有。

### C2 质量检查要求 266 条全过（读码）

`content-normalize.ts:543-546`：

```ts
if (ordinaryCount <= 500) return Object.freeze({ initial: ordinaryCount, expanded: ordinaryCount });
```

SOP 材料是 routine（`material.ts:138`，SOP 行的 `riskNote` 为空、无 disable），所以 `ordinaryCount = 266`，`initialTarget = 266`。

界面 20 条一页，可前后翻，但 `submit` 的按钮条件是 `quality.checked !== quality.total`（`IntakeManagement.tsx:432`）。等于 266 次人工判断，零缺陷才能 passed。这比 FAQ 的小批量重得多。

### C3 解析进度要手动刷新（读码）

提交后 250ms 的定时器只读 Main 内存（`IntakeManagement.tsx:290-306`，注释写明 `current() projects Main memory only`）。HTTP 取 parse-job 只有 `content-intake-upload.ts:295`，由 `upload-refresh` 命令触发。

后果：解析完成后界面一直停在「正在校验内容」，直到用户点「刷新解析进度」。B1 的六条错误也要刷新后才出现。

### C4 审阅界面不显示条目编码（读码）

`tryParseSopAsFaq` 把 `title` 设为表名（`sop.ts:236`），`IntakeManagement.tsx:71` 只渲染 `title` 与 `answerText`。266 张卡片只会出现 6 种标题，差异列表同理（`:44-45`）。编码现在是身份，但界面上看不到。

### C5 SOP 条目落在「产品」页签，SOP 页签永远为空（读码）

`content-intake-catalog.ts:63` 用 `domain: scope.domain` 建目录行。SOP 来源注册在 product scope，所以条目 `domain='product'`，出现在「产品」页签。

`IntakeLibrary.tsx:36-40` 另有一个硬编码的 `sop` 页签，`:195` 对它直接返回空态「这一栏还没有 SOP 目录」。所以业务方找不到自己发布的 SOP。

### C6 桌面按钮要求 binding 角色是 owner（读码）

`project-roster-login.ts:98-112` 对 import/publish/rollback 额外要求 `subject_bindings.role='owner'`。合法 director 若 binding 不是 owner，API 允许但界面无按钮。生产三个 binding 是 `owner / owner / coach`，其中 `hz-reviewer` 是 `coach`。

## 四、可靠性

`content-intake.integration.test.ts` 的 `discovery: completes the 5000-source menu through real HTTP and Main before authority expires`（:2300）是唯一被实测抓到的间歇失败。

- 探针 SIGTERM 预算 120000ms（:2348），用例超时 150000ms（:2375）
- 实测单次 95880ms，占预算 80%
- 两个套件并行运行时该用例失败（`run3` 捕获到失败用例名）
- 桌面有同形的 5000 来源测试 `apps/desktop/tests/unit/content-intake-usage-http.test.ts`

推断：并发导致超出 120s 被杀。未做单变量实验，标为推断。它与 SOP 链路无关。

本轮我自己并行跑了两组套件，制造了 44 个临时 PG15 集群目录（642MB），已清理。

## 五、本轮改动

| 文件 | 改动 |
| --- | --- |
| `apps/api/tests/sop-preview.test.ts` | 删除一个未使用的常量。`pnpm lint` 之前因此报错，是我上一轮漏掉的 |
| `~/Desktop/话术模板-20261022/SOP-模板-含条目编码.xlsx` | 新增。原模板未动 |

除此之外未改代码。

验证：`pnpm lint` 通过（修复前 exit 1）、`pnpm build:services` 通过、`pnpm --filter @customer-agent/desktop typecheck` 通过、`pnpm test:db:integration` 77/77、`content-intake.integration.test.ts` 178/178 连续 4 次。

## 六、未验证

- 真实 Menokin 工作簿不在仓库（`faq/minokin话术库/` 不存在），266 行 47 图的规模没跑过。审核用的是同目录的模板文件。
- 权限矩阵来自读码（`0057:21-27`、`role-ceiling.ts:11-38`），SOP 来源上的运行时角色尝试没逐角色跑。演进的 FAQ 用例覆盖了 director/manager/supervisor/enabler/agent。
- 生产库没有执行任何写操作，B2 的三步恢复未演练。
- B5、C2、C3、C5 来自读码，没有在真实桌面端逐步点击验证。桌面端 typecheck 通过，但没有启动应用。
- `IntakeMaterial` 契约是两种变体的判别联合（`faq-p1.1` 或 `faq-csv-v1`），没有 sop 变体。若按真 `sop-v1` 元组注册，会在契约校验处失败，这也是当前走 product 域的原因。
