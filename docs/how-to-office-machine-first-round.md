# How to：办公机首轮离线验收（Windows）

本页给**办公机操作员**勾选。工程侧已能产出带精确 `{ "mode": "synthetic-offline" }` 的未签名 Windows 安装包；**本页结果必须由那台 Windows 填写，开发机不得代填。**

首轮只验：安装 / 启动 / 狐狸头 / 快捷键 / 卸载。不断网以外的产品主链（登录、查询 Top 3、复制、STALE、SOP）都不在本轮。

安装包**禁止外发**、未签名，文件名带 `UNSIGNED`。不要写成已签名或可给客户。

## 准备

1. 从已跑过 `pnpm package:win` 的机器拷贝：

   `release/local-unsigned/windows/客服话术浮窗 Demo-0.3.0-win-x64-UNSIGNED.exe`

   不要从 Git 拉安装包（产物不入库）。
2. 办公机**断开网络**。
3. 不安装 Node / pnpm / Git。Electron 自带运行时即可。
4. 记下日期、机器名、操作人。

## 勾选

| # | 步骤 | 预期 | 通过 |
| --- | --- | --- | --- |
| 1 | 双击 `UNSIGNED.exe` 安装（当前 NSIS oneClick、当前用户） | 安装完成，开始菜单或桌面出现「客服话术浮窗 Demo」 | ☐ |
| 2 | 启动应用 | **不要**出现「缺少合成栈配置」类弹窗后退出。应出现可拖动狐狸头浮窗 | ☐ |
| 3 | 看 `%APPDATA%\客服话术浮窗 Demo\synthetic-stack.json` | 内容为精确 `{"mode":"synthetic-offline"}`（可有换行） | ☐ |
| 4 | `Ctrl+Shift+Space` | 打开查询胶囊。本轮**不要求**输入查询得到 Top 3 | ☐ |
| 5 | 点狐狸头 | 同样打开查询胶囊 | ☐ |
| 6 | 卸载（Windows 设置 → 应用） | 应用从开始菜单消失 | ☐ |
| 7 | 卸载后看 `%APPDATA%\客服话术浮窗 Demo` | 可能仍在。若在，手工删除整目录。不要当成安装包会自动清 userData | ☐ |

失败时记下：是否有启动失败对话框、文案、是否其实连着网、安装包文件名是否含 `UNSIGNED`。

## 不要当作已通过

- 登录（飞书 / 账号）
- 产品查询、复制、STALE
- SOP / 内容草稿 / 话术不准 / P0
- Authenticode、Gatekeeper、企业分发
- M5 设备清单

## 签署（办公机填写）

- 日期：
- 机器：
- 操作人：
- 结果：通过 / 失败
- 备注：
