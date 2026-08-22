# 客服 Agent 产品实施仓开发约束

请用中文汇报执行结果，代码标识符可使用英文。

## 1. 指令定位与权威顺序

本文件是仓库级工作入口，只定义稳定边界、模块职责和执行方法；不要把像素、动画时长、测试矩阵或发布步骤复制到这里。

- 本仓是客服 Agent 的**产品实施仓**，目标覆盖正式开发、测试、打包与上线；`customer-agent-prototype` 只是历史目录名。当前已实现内容仍处于 v3 合成原型模式，不等于 `DEV-M0`、真实数据接入或上线已获授权。
- 完整阅读 `PROJECT_CHARTER.md`，以其作为仓库身份、仓间关系与生命周期模式的 SSOT。`ai-赋能立项` 只负责项目进度、批准范围和阶段门记录；两仓保持独立工作区与 Git 历史，不做跨仓运行时依赖。
- 涉及代码、交互或架构变更前，完整阅读 `DESIGN.md` 与 `DEVELOPMENT_BRIEF.md`。
- `DESIGN.md` 是产品、视觉和交互不变量的 SSOT；`DEVELOPMENT_BRIEF.md` 是工程与验收边界的 SSOT；`docs/reference-project-architecture.md` 记录当前模块归属；`docs/how-to-verify-desktop.md` 记录分层验证方法。
- 发现用户要求、实现与上述文档冲突时，先说明冲突及影响，不得静默选择一套或复制出新的规则。

## 2. 不可破坏的产品与安全边界

- **当前原型模式**只使用合成 fixture。不得读取或提交真实飞书、客户数据、凭证、URL 或 token。用户显式提供的 VOC Excel 只允许一次性只读提取结构与聚合；不得把原文、订单、图片、批次、员工、快递或竞品评价写入仓库或未获批运行链路。
- PostgreSQL、OAuth、线上 API、埋点和正式数据属于本仓后续产品化范围，但只能在获批计划、Ddev、合同和安全门齐备后进入独立模块；不得在当前 renderer 中临时直连。外部模型、自动学习和自动发送继续按专项批准管理。
- 复制成功只表示“已复制”，不得推断或暗示已发送、已采纳、回答正确或问题已解决。
- Electron renderer 不得获得 Node.js 权限；所有窗口保持 `contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`。
- Fox / Query renderer 只能通过类型化、白名单 preload API 请求原生能力，并按能力施加 sender / role / 必要时 main-frame 门禁；当前 Dashboard 保持无 preload。未来正式只读 adapter 必须单独评审，禁止通用 `send/on/invoke`、任意 channel、任意窗口控制和文件系统能力。
- commit、push、创建 PR、merge、deploy 分别需要用户对当前变更明确授权；前一阶段的授权不得自动扩大到下一阶段。

## 3. 模块边界与依赖方向

- `src/main/`：唯一拥有 Electron / OS、BrowserWindow、原生 bounds、应用生命周期、Electron sender 身份判定和原生副作用；可复用 `shared` 中的纯授权谓词。
- `src/preload/`：只把已授权的窄能力适配成类型化 renderer API，不承载业务状态或通用 IPC。
- `src/shared/`：只放跨边界类型、validator、状态模型、几何和纯函数；不得依赖 React、DOM、Electron 或产生 I/O。
- `src/renderer/`：只拥有 React / DOM、局部交互和 ViewModel；当前基线读取合成数据，未来正式数据也必须经过受控 adapter。不得导入 `main`、`preload` 或 Electron，也不得直连数据库或持有凭证。
- `assets/` 中的 canonical 资产是 SSOT；`scripts/` 负责确定性派生。不得手改派生产物制造第二真源。
- 每个状态、协议、常量和不变量必须有一个写入所有者。当前所有权以架构参考文档为准；迁移所有权时必须同步合同、调用方、测试和文档。

## 4. 软件设计纪律

本仓以降低开发者可感知复杂度为首要设计目标。能够运行或测试通过，不等于设计完成。

### 4.1 用复杂度而不是行数判断设计

每次结构性修改都检查三种症状：

1. **变更放大**：一个需求是否需要修改多个位置或同步多份规则。
2. **认知负担**：完成常见改动是否必须同时理解无关模块。
3. **未知依赖**：是否存在难以发现的顺序、平台、状态或失败路径。

文件长度只触发审视，不自动触发拆分。不得为了减少行数，把一个内聚状态机按执行步骤切散，或让一次改动跨越更多文件。

### 4.2 优先深模块与信息隐藏

- 新模块必须能回答：它提供什么独特价值、隐藏什么知识、调用方最少需要知道什么。
- 只有当新模块以更窄、更稳定的接口隐藏一组内聚决策时才抽取；禁止只转发同名参数、重复现有 API 或仅为目录整齐而创建 wrapper / re-export。
- 时序、generation / epoch、ACK、bounds、平台差异和恢复策略应封装在拥有它们的模块内，不把配套规则推给每个调用方。
- 按“谁拥有并隐藏这项知识”划分模块，不按“先执行 A、再执行 B”划分模块。

### 4.3 每一层提供不同抽象

- 新增一层必须承担至少一种实质职责：授权、校验、策略、状态、转换、生命周期或错误归一化。
- 若一层只是把几乎相同的参数继续向下传递，应删除、合并或重新定义其抽象；安全边界所需的 preload 仍必须保持最小且有语义。
- 通用机制下沉，产品 / UI 特例上移。只围绕当前真实需求做“适度通用”的接口，不为假想未来预建模式、参数、插件点或框架。

### 4.4 消除错误状态，不掩盖错误

- 优先通过类型、validator、状态机和 API 设计消除无效状态，并在最合适的边界归并具有相同恢复策略的错误。
- renderer IPC、用户输入、文件和环境变量属于不可信边界，必须 fail-closed 校验；“定义错误不存在”不得削弱安全检查。
- 禁止未说明的空 `catch`、无证据 fallback、静默失败或层层原样 rethrow。只有在拥有恢复策略的边界才能有意合并 / 屏蔽同类错误，并须用注释或测试说明原因；影响用户承诺的可恢复失败必须给出可见反馈。内部诊断保留足够上下文，但不得泄露敏感信息。

### 4.5 注释记录不可从代码直接看出的知识

- 公共接口和跨进程合同说明调用方必须知道的语义、单位、边界、副作用、顺序与失败模式，不泄漏不必要实现细节。
- 实现注释解释“为什么”、不变量和非显然取舍，不逐行复述代码。
- 一项跨模块设计知识只记录在一个 SSOT；其他位置链接或导入，不复制会漂移的说明与数值。

## 5. 变更工作流

1. `.codegraph/` 存在时，理解或定位代码先用 CodeGraph，再用 `rg` 补充；不要从文件名猜调用关系。
2. 修改前检查工作树并保护用户已有改动。先写清本次变更的所有者、不变量、最小接口、失败路径和验证面。
3. 中等以上结构变更至少比较两个边界方案，选择接口更简单、信息泄漏更少、调用方认知负担更低的方案。
4. 实现完整可运行的纵向切片；不得留下伪按钮、未接线状态、临时重复常量或静默补丁。
5. Bug 若暴露重复知识、错误抽象或缺失不变量，应在授权范围内修根因；超出范围时明确记录债务、影响和后续入口，不用特殊分支伪装完成。
6. 实现后按浅模块、pass-through、信息泄漏、重复、特殊情况、隐含顺序和晦涩命名做一次设计复审。

## 6. 验证与证据

- 仅在依赖缺失或锁文件变化时安装依赖；统一使用 Node.js 24.x 与 pnpm，提交 `pnpm-lock.yaml` 的有效变化。
- 先跑受影响模块的窄测试，再按影响面扩展。代码变更至少实际运行 `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`。
- Float / handoff / 原生窗口行为追加 `pnpm test:float` 与相关 Electron E2E；品牌资产追加 `pnpm test:assets`；Dashboard 追加对应 component / E2E。具体路由以 `docs/how-to-verify-desktop.md` 为准。
- 生成物、打包或目录调整追加 `pnpm workspace:check`；正式打包只使用对应 package 脚本及其 fail-closed 后验。
- 自动化不得冒充真实 Stage Manager、Dock、系统焦点、签名 / 公证或 Windows 合成器证据。未实机验证的项目必须明确标为未确认。
- 若环境阻塞，保留实现并报告命令、关键输出、阻塞层级和未验证范围；不得把“测试文件存在”写成 PASS。

## 7. 最终汇报

最终回复至少包含：实现内容、影响的模块 / 信任边界、实际运行的命令与结果、未运行项、已知限制和 Git 状态。只有运行入口发生变化时才重复启动方法。

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
- Author a backlog-ready spec/issue → invoke /spec
