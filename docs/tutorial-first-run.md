# 第一次运行客服话术浮窗 Demo

本页带你在本机把 Demo 跑起来，并走完一条可观察的主链：

`狐狸头 → 查询胶囊 → 合成 Top 3 → 人工选择 / 复制 → Dashboard`

> **这是合成数据、无后端、不代发的本地 Electron Demo。**
> 复制成功只表示剪贴板写入成功，不表示已发送、已采纳或回答正确。
> Dashboard 是交互式合成 BI / 架构故事，不是生产系统。

相关文档：[如何验证](how-to-verify-desktop.md) · [项目架构](reference-project-architecture.md) · [桌面合同](reference-desktop-contracts.md) · [How to 启动检索浮窗](how-to-run-macos-semantic-query.md) · [API adapter 衔接](reference-api-adapter-handoff.md) · [失败安全说明](explanation-failure-safe-lifecycle.md) · [README](../README.md)

---

## 0. 先看结果长什么样

成功时桌面上只剩一颗透明狐狸头。点它会展开玻璃查询胶囊；输入合成问法后出现最多 3 条**原文**话术卡，卡片上没有匹配分。点「复制话术」后按钮变成「已复制」，随后收起回狐狸头。查询胶囊上的 Dashboard 图标会打开第三个标准系统窗，顶栏写着「演示数据」和「无后端 · 不保存」。

如果出现「已发送」、真实客户原文、登录框或任何联网业务请求，说明你不在本 Demo 的预期路径上，请立刻停下来对照本页与 `README.md`。

---

## 1. 需要什么

| 要求 | 本仓合同 | 说明 |
| --- | --- | --- |
| Node.js | **24.x**（`engines.node` 为 `>=24 <25`，`.nvmrc` 为 `24`） | 不要用 22 或 25 |
| pnpm | **11.19**（`packageManager` 锁定 `pnpm@11.19.0`） | 用 corepack 或已安装的 11.19.x |
| 操作系统 | 本机 macOS 即可看浮窗 | Windows 观感与安装需 Windows 设备，见 [如何验证](how-to-verify-desktop.md) |

企业 CA / 系统根证书**不是通用安装步骤**。只有当前这台开发机走企业拦截 TLS 时，才需要：

```bash
export NODE_OPTIONS=--use-system-ca
export NODE_EXTRA_CA_CERTS=/etc/ssl/cert.pem
```

换电脑时：改用那台电脑的 Node 24 路径；没有企业证书拦截就不要抄这两行。禁止关闭 TLS 验证。

本页命令默认使用这台已核实的 Node 24 位置：

```bash
cd ~/Desktop/customer-agent-prototype
export PATH="$HOME/homebrew/opt/node@24/bin:$HOME/homebrew/bin:$PATH"
hash -r
node -v    # 成功标志：v24.x
pnpm -v    # 成功标志：11.19.x
```

---

## 2. 安装依赖与 Electron 运行时

```bash
pnpm install --frozen-lockfile
pnpm electron:install
```

| 步骤 | 可观察成功标志 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 结束码 0；没有改写 `pnpm-lock.yaml`；`node_modules/` 就位 |
| `pnpm electron:install` | 在 `apps/desktop` 显式准备本仓锁定版本的 Electron 桌面运行时。成功时后续根命令 `pnpm dev` 能启动窗口，而不是报缺少 Electron 二进制 |

应用不访问外部业务网络。`pnpm install` 只拉注册表依赖；`pnpm dev` 只连本机 Vite / HMR。

---

## 3. 启动 Demo

```bash
pnpm dev
```

如果你在 macOS Finder 中双击启动，可以直接运行仓根目录的 [`启动客服Agent.command`](../启动客服Agent.command)。它只检查 Node 24、pnpm 和本地 Electron 运行时，不会偷偷安装依赖或访问业务网络；终端窗口保持打开，便于看到启动错误。

| 可观察成功标志 | 失败时不要继续 |
| --- | --- |
| 桌面出现约 88px 的透明狐狸头（视觉约 64px），无方形底板 | 终端报缺 Node 24 / 缺 Electron 运行时 |
| 查询胶囊尚未出现 | 启动后直接弹出 520×760 旧工作台，说明跑错了构建 |
| 狐狸附近没有「已发送」一类文案 | 窗口里出现真实订单号、飞书链接或登录 |

快捷键默认是 `⌘⇧空格`（Windows / Linux 为 `Ctrl+Shift+Space`）。若被系统占用，狐狸头会出现警示点，查询窗会写「请点击狐狸头打开」——这是可见降级，不是静默失败。

---

## 4. 主链逐步走一遍

每一步都先看结果，再做下一步。全程只使用仓内合成 fixture。

### 4.1 打开查询

1. 单击狐狸头（不要双击等待；首击必须立刻打开）。
2. 成功标志：玻璃查询胶囊出现（约 600×88）；输入框自动聚焦；胶囊上有 `DEMO` / `MOCK AUTH` 徽标；「智能检索」默认 ON。话术卡片不再贴 `DEMO · 合成数据`。
3. 提示文案包含「只复制不代发」。

贴边半露、探头、睡眠表情不是本条主链的必做步骤。若狐狸贴在屏幕左右边缘，原生 88px 窗仍应完整留在工作区，看起来各露一半——这是 renderer 裁切，不是把窗推出屏外。

### 4.2 输入合成问题并查询

在输入框输入：

```text
澄芽氨基酸洁面怎么用
```

按 `Enter`（中文输入法组合期按 Enter 不应提交）。

| 可观察成功标志 | 明确不会发生 |
| --- | --- |
| 查询按钮至少约 280ms 显示「检索中」 | 出现「AI 正在生成答案」 |
| 出现 **3** 张独立话术卡，正文是 fixture 原文 | 卡片上出现数值匹配分 |
| 卡片有适用场景、渠道 / 分类、有效状态、非数字匹配原因、「复制话术」 | 出现过期活动话术（例如精确问 `青禾会员日积分怎么兑` 应 no-hit） |

其他可对照的合成问法见 `README.md`「建议演示顺序」。不要用真实客户原文做演示。

### 4.3 人工选择并复制

1. 读完至少一张卡片，确认正文是合成话术，不是模型现写。
2. 点第一张卡的「复制话术」，或在结果态按数字键 `1`。
3. 成功标志：该按钮变为「**已复制**」；列表标题旁出现「已复制」；约 900ms 后查询收起回狐狸头。
4. 到任意文本框粘贴，应得到卡片上的原文。

复制失败时候选必须还在，查询不得收起。页面任何位置都不得出现「已发送」「已采纳」「已解决」。

### 4.4 打开 Dashboard

重新点狐狸头打开查询，再点胶囊右侧的线框 Dashboard 图标（`aria-label` 为「打开运营工作台」）。也可：狐狸 / 查询右键 →「打开运营工作台」，或系统 Tray / 应用菜单。macOS 在应用就绪后点程序坞图标同样打开 / 恢复 Dashboard，不会展开查询。

| 可观察成功标志 | 明确不会发生 |
| --- | --- |
| 出现第三个标准系统窗，约 1180×760，可缩放、非置顶、出现在任务栏 | 浮窗自己变成 520×760 工作台 |
| 标题为「客服运营工作台 · 演示数据」；顶栏有「演示数据」和「无后端 · 不保存」 | 出现登录、OAuth、真实工单号 |
| 打开成功后，浮窗收起为狐狸头；关掉 Dashboard 后狐狸仍在 | Dashboard 关闭导致整应用退出 |
| 左侧能切到「管理概览」「VOC / 工单洞察」等九个一期模块 | Publish 按钮可点；「工单垃圾桶」可进入 |

若打开失败，查询窗必须仍可用，并显示「工作台未打开，请重试。查询窗口仍保持可用。」不要把失败理解成「已经切到工作台」。

侧栏「演示环境」里可以再次看到完整边界：`MOCK AUTH / SYNTHETIC DATA / NO BACKEND`。

---

## 5. 停下来时记住的三句话

1. **synthetic-only**：话术与看板全部是仓内虚构合成数据。
2. **no backend**：没有 PostgreSQL、飞书、对象存储、线上 API 或模型调用。本仓也没有可切换的 API adapter。
3. **no send**：复制不是发送；adopted 只等于复制成功。正式记账还要先有 `query_id` 与候选四元组，再 `POST /v1/events/adoption`。

合成 fixture **不能**直接插入正式库。字段、鉴权、版本、生效期、租户与复制语义见 [API adapter 衔接](reference-api-adapter-handoff.md)。

下一步若要核对测试与打包门禁，打开 [如何验证桌面 Demo](how-to-verify-desktop.md)。
