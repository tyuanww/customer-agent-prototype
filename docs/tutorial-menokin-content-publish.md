# Tutorial：管理员导入 MENOKIN FAQ 并发布

本页带你用**当前 main 打的 UNSIGNED** 走完一条可观察的内容链：

`打开工作台 → 管理员登录 → 内容管理选 xlsx → 发布 → 查询「面膜紫适用人群」拿到新 Top 3`

这不是第一次运行浮窗。狐狸 / 查询 / 复制先看 [第一次运行](tutorial-first-run.md)。打包配置看 [macOS 打包态远端](how-to-macos-packaged-product-remote.md)。

xlsx 原文、订单、图片不进 Git。文件放在仓外（例如本机 `Desktop/customer-agent- FAQ/`）。

## 你需要

1. 当前 main **0.3.19** 打的 UNSIGNED `.app`（`pnpm package:mac:local`）。更早的包没有五项工作台和停手文案校验。
2. `~/Library/Application Support/客服话术浮窗 Demo/synthetic-stack.json` 指向 `agent-auth` / `agent-pass`。
3. 本机合成栈和命名隧道健康：`https://agent-auth.jianghua.site/health` 为 200。
4. **管理员**会话（`synthetic_owner`）。话术师可以导入，一期发布仍是 403。
5. 一份仓外 FAQ 表，第一张表有中文表头（快捷短语 / 产品话术 / 业务填写问题 / 客满话术 任一列即可）。

## 步骤

1. 关掉旧的 `.app`，打开这次打的 UNSIGNED。
2. 点狐狸 → 查询胶囊上的工作台图标。登录选 **账号**，用管理员绑定（合成栈是 `synthetic_owner`）。
3. 侧栏点 **内容管理**。应看到两步：导入 / 发布。没有会话时「发布」禁用，文案是未接入，不是假成功。
4. 选择仓外 xlsx。预览大约一百行量级（空白行会跳过）。确认域是产品或活动；售后 / 过敏 / 赔付一期只能管理员发。
5. 点 **发布**。导入会先 `validating`，校验通过后 `staged`，再 `POST /v1/content/publish`。成功面板会写版本号和发布人。失败时屏幕写中文原因和下一步，不要对着英文合同码发呆。
6. 成功后记下 `releaseId`。关掉工作台，回到查询胶囊。
7. 搜 **面膜紫适用人群**。Top 3 必须来自刚发布的目录，不是仓内合成样例。卡片没有匹配分。复制只显示「已复制」。

## 失败时

| 你看到 | 原因 |
| --- | --- |
| 文件和当前登记的来源对不上 | 导入会先把这份表登记为新 snapshot；若仍失败，确认选的是要发的那份表 |
| 上一份还在处理 | 先发布或取消上一份，再导下一份 |
| 403 | 话术师点了发布；换管理员 |
| 未接入：没有内容导入通道 | 没登录，或打包态没读到 `synthetic-stack.json` |
| 表格式或花括号不合法 | 按模板改表后重新导入 |
| Top 3 仍是旧稿 | 查询前会 `refreshAnnounce`；若仍旧，确认发布成功且搜的是新场景原文 |

## 本页不证明

- SOP 写库、话术单条改删、「话术不准」落库
- 软件版本检查、无命中率数字
- 签名 / 公证 / 办公机 Windows / Linux 包
- G0 / Ddev / 真实客户数据
