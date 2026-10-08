# 工作区源码预算：分类修复与未启用的预算候选

2026-10-09。起点 `01d7a0c6ef965a7e36a0578168b92d04038ea298`，独立分支 `codex/intake-size-closeout`。本轮只修改工作区统计及对应单测，版本仍为 0.3.26，不修改业务权限、合同锁、冻结快照、历史 migration 或既有证据。共享计划和 TODOS 由主 Agent 回收后更新。

## 实际根因与修复

旧 `workspace-hygiene.mjs` 的排除分类没有跟上 workspace 的新增包，也没有覆盖已经明确为派生产物的图标。三个包的 dist、依赖目录和精确 icon 文件被错算成源码。脚本的既有声明本来就要求可重建输出和依赖不影响源码预算，因此本轮修复属于原政策内的分类纠正。

修复仅增加十二个精确路径：contracts、content-intake、retrieval-core 各自的 dist / node_modules，以及当前和迁移前的三种 icon 文件。没有排除整个 build、contracts、evidence，也没有把已提交 generated source 移出预算。清理 allowlist 未扩大，没有运行 clean，没有删除任何文件。

十二条增长测试在旧实现全部失败，修复后卫生单测 **41/41 PASS**。另外六条正向计费回归证明：冻结合同、旧 migration、生成源码、审计日志、构建配置和未知 build 文件仍会使预算增长；不能借分类把这些文件藏掉。

## 真实计量与增长归因

当前指标是**磁盘 allocated bytes**，不是 Git blob 的 logical bytes，不是安装包、内存或产品存储容量。实现使用 `lstat.blocks × 512`（无分配块时回退 size），包括目录项大小；同一设备/inode 只计一次，不跟随符号链接。不同文件系统的块粒度可能产生差异。逻辑字节仅作跨提交增长对比，不能直接代入原 32 MiB allocated 门禁。

对集成树的同一次只读盘点（该树未被本任务修改）：

| 范围 | 原统计 / allocated | 纠正后 / allocated | 说明 |
| --- | ---: | ---: | --- |
| 全部计费区 | 42,231,334 B / 40.2749 MiB | 39,894,976 B / 38.0468 MiB | 排除误计 2,336,358 B / 2.2281 MiB |
| 冻结合同 `contracts/upstream` | 13,471,808 B | 相同 / 12.8477 MiB | 80 个文件，保留全部版本 |
| 已冻结证据 `evidence` | 8,942,016 B | 相同 / 8.5278 MiB | 594 个文件，不删除历史失败或日志 |
| 其余源码、测试、文档、资产、迁移和配置 | — | 17,481,152 B / 16.6713 MiB | 保留受审 generated source 与 canonical 资产 |

最大目录贡献还包括桌面源码 2.50 MiB、文档 2.44 MiB、桌面测试 2.01 MiB、API 测试 1.44 MiB；单文件最大者是 database 生成的 migration catalogue（921,600 allocated B），仍计入。完整目录分解和最大文件见 [inventory.json](inventory.json)。

干净独立 worktree 在 build 前原统计为约 38.1 MiB，集成树为约 40.3 MiB；差异主要来自本地构建输出。修复后这些已知输出的增长不再改变计费区。新增本轮代码、测试、文档和审计文件仍正常增加少量计费；因此本分支最终计量与上述基线盘点不必完全相同。

跨提交使用 `git ls-tree -rlz` 比较原始 blob 字节，避免用当前磁盘分配量假装历史实测：

| 区间 | 新冻结合同 | 新证据 | 其余源码等 | 合计 logical bytes |
| --- | ---: | ---: | ---: | ---: |
| `54f428ca..f6f8cf35`（CSV 消费） | 1,231,392 | 336,878 | 78,584 | 1,646,854 |
| `f6f8cf35..89bca38`（旧 CHECK 权限闭包） | 1,238,292 | 173,011 | 51,620 | 1,462,923 |
| `89bca38..01d7a0c`（Grok 回执） | 0 | 13,199 | 1,077 | 14,276 |

最新 16 件 v4 包占第二行合同增量的大部分；最新快照及文件锁更新必须共同保留。大块历史 DDL/OpenAPI 版本看起来重复，但它们是受哈希约束的独立输入，不是可随意删除的重复缓存。详见 [history-growth.json](history-growth.json)。

## 尚未启用的预算治理候选

**当前门禁仍是 32 MiB，修复后仍 FAIL，不能宣称已消除所有超额。** 保留必要历史后仍超约 6.05 MiB，不能在原上限内通过简单清缓存收尾。

建议把“所有必要输入共用 32 MiB”改为三组独立上限，仍保留总量上限；每一字节仍属于一个计费组，不是排除证据或合同：

| 组 | 基线实测 | 候选上限 | 余量与依据 |
| --- | ---: | ---: | --- |
| 源码、测试、文档、资产、migration、generated source 与配置 | 16.67 MiB | 20 MiB | 约 3.33 MiB；允许本期装配/验收及普通迭代增长，不把历史合同占用误当运行代码增大 |
| 冻结合同输入 | 12.85 MiB | 15 MiB | 约 2.15 MiB；容纳一个与最近 14/16 件完整包相近的新增冻结版本，下一版仍需重新核验 |
| 冻结审计证据 | 8.53 MiB | 10 MiB | 约 1.47 MiB；覆盖本期并行收尾和设备证据，但不为任意截图/整段重复日志无限留空 |
| 合计 | 38.05 MiB | 45 MiB | 任一分组超限即非零退出，不能靠另一组余量掩盖；不是简单翻倍为 64 MiB |

[预算候选 diff](budget-policy-candidate.patch) **没有应用到运行脚本**，没有改变 CI 结果。补丁基于本分支已纠正分类的脚本：加入可审计三组分解、逐组失败和总量 45 MiB；显式更紧的总量参数仍生效。分类测量复用同一 inode 集合，不重复计入硬链接。候选在仓外临时副本上 **6/6 PASS**，覆盖三组单独超额（即使合计低于45）、跨组硬链接、显式收紧总量和当前树。这只是候选有效性，不代表原门禁 PASS。

唯一需要的决定：**是否接受上述 20/15/10 MiB 分组门限及 45 MiB 总量，作为当前仓库必要输入增长后的预算政策。** 如接受，主 Agent 应应用候选、同步 `docs/how-to-verify-desktop.md` §5 和架构中的计量说明，补入正式单测并在最终集成树重测；不能仅用命令行临时 override 宣称默认门禁通过。若不接受，32 MiB 继续有效，保留失败状态并另行决定可审计历史存放政策；本轮不搬走冻结材料。

复现候选（只写 `.gstack` 临时副本）：

```bash
mkdir -p .gstack/qa-reports/intake-size-closeout
cp scripts/workspace-hygiene.mjs .gstack/qa-reports/intake-size-closeout/budget-candidate.mjs
patch .gstack/qa-reports/intake-size-closeout/budget-candidate.mjs < evidence/qa/intake-size-closeout/budget-policy-candidate.patch
node --test evidence/qa/intake-size-closeout/budget-candidate.test.mjs
```

## 实际验证与边界

环境 Mac arm64、Node 24.19.0、pnpm 11.19.0。本 worktree 创建时依赖缺失，首次 pnpm 脚本由 pnpm 11 自动使用现有 store 装配 657 个包（下载 0）；没有更改锁文件，不使用其他 worktree 的可写 dist 或 package 链接。

- 红例：12 FAIL / 29 未选中，证明旧分类错误。
- 卫生完整单测：41/41 PASS；受影响 ESLint PASS。
- 首次桌面 typecheck 因干净工作区缺 packages/API dist 失败；没有修改业务代码消除错误。只在本 worktree 执行根 build 后，再跑桌面 typecheck PASS。
- 根 build PASS，锁定合同/codegen/migration 检查通过；没有改构建输入或业务源码。
- `workspace:check` 的根目录政策 PASS，32 MiB 体积门禁仍 FAIL。
- 文档全检在独立干净 worktree 因13个既有 `.gstack` 忽略文件链接不存在而 FAIL；本轮 README 的相对引用均存在。没有复制他人可写缓存、制造空证据或修改旧报告掩盖这一限制；集成树应按自己的真实文件复核。
- 预算候选只在临时文件验证，6/6 PASS。文档/差异/指纹与最终实际命令见 [checks.json](checks.json)。

没有重跑不受本工具改动影响的 PG、API、桌面行为、角色15/15或既有外审，没有借用它们宣称新输入通过。主 Agent 集成后的新工作区计量应重新执行；构建产物分类修正不能替代正式包、真人 Mac 或 Windows 验收。无 push、PR、合并、部署、真实资料或凭据读取。
