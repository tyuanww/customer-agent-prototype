# 负责人承接产品 PR 合并前核对

> **当前进度入口：** 本页保存形成时的计划、批准范围或证据，不维护最新进度；当前动作统一见[执行清单](2026-09-06-execution-goal.md)。已批准范围继续有效，历史状态不覆盖新的具体授权与实测。

> 状态：MERGED · POST-MERGE CI PASS（下文保留合并前核对）
> 核对日期：2026-09-06；仅为当前三项产品变更的合并准备，不授权真实运行或部署。

| 顺序 | 当前 PR / head | 本次变更 | 当前检查 |
| --- | --- | --- | --- |
| 1 | [#29](https://github.com/weiweity/customer-agent-prototype/pull/29) / `9e579e1f8e368a9a283ff46cb15b66c29be3c391` | 接收负责人承接合同，追加原子数据库迁移 | MERGEABLE；Linux、PG15、Windows CI 均 SUCCESS |
| 2 | [#30](https://github.com/weiweity/customer-agent-prototype/pull/30) / `2d5424c5c87fb65d6073839d9565591bbc0382d1` | 验证外部批准记录和实际内容摘要，原子离线装载 | MERGEABLE；Linux、PG15、Windows CI 均 SUCCESS |
| 3 | [#31](https://github.com/weiweity/customer-agent-prototype/pull/31) / `344b3da151ec6bd6520d4b375ff1729f1a22b289` | 版本化装包入口、外部锚点校验及失败清理 | MERGEABLE；Linux、PG15、Windows CI 均 SUCCESS |

远端 main 实查为 `bb1925ef1816e7e6bb3e4de490fe071a02cc3f46`，三层 ancestry 连续；当前三个工作区均无代码改动。治理 #67 已合并至 `aa526be8a214953c9a90e7324938d3ed0b82baf7`。逐字节比较治理合并提交与产品不可变快照：OpenAPI `361f20128c88143eb87370f136b67c4de8c1ed5fc02c7072f62c16545951315c`、DDL `859c4a4757d87e642e797ad8a26cfb334c49ae7f8f263966099eb89e6750b38b` 均一致。

既有方案与代码审查、专项测试和全仓验证见各 PR 的实施记录；本轮没有代码变化，未重复运行已通过测试。以上 CI 是各分支当前 head 的证据，合并后的 main CI 尚不存在，不能提前宣称通过。

获准后采用 merge commit 保留堆栈祖先：先合并 #29，等待 main CI；再将 #30 的目标改为 main，核对差异仅剩本切片、CI 通过后合并；最后对 #31 执行同样流程。仓库当前允许 merge commit。每次远端 head 或 main 变化均重新核对，不强推、不删除分支，不在原始工作区覆盖用户文件。

本次需要的批准范围是上述三个 PR 的顺序合并及必要的 PR 目标调整。真实 T5、T6、正式运行接入、部署和客服安装发布仍按各自证据与批准执行。

## 实际合并退出证据

用户于 2026-09-06 18:05 明确允许上述合并；已按顺序执行，每次等待该合并提交的 main CI 全部通过后才进行下一项。

| PR | 实际 merge commit | 对应 main CI（Linux / PG15 / Windows 全通过） |
| --- | --- | --- |
| #29 | `d9da2295162ce0924d8a6e7fb74c18ba1d401272` | [34026547501](https://github.com/weiweity/customer-agent-prototype/actions/runs/34026547501) |
| #30 | `27ff01931030b3617056f4666a9e03a851585bf5` | [34026812026](https://github.com/weiweity/customer-agent-prototype/actions/runs/34026812026) |
| #31 | `00cabbbbb234b16451f43990900421d751c32cd0` | [34027030839](https://github.com/weiweity/customer-agent-prototype/actions/runs/34027030839) |

装包工作区已切至最终 main 的干净 detached checkout，完整 Git tree 与已验证的 #31 候选一致。原始产品工作区的本地文档保留；未删除分支、部署或运行真实 T5。
