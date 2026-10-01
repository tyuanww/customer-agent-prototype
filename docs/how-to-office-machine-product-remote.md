# How to：办公机产品主链（远端，未观察）

本页给**办公机操作员**勾选。开发机不得代填。全部行保持 **未观察**，直到真人在那台 Windows 上看过窗口。

P4 / P7 已在 `main`。本页证据必须是当前 `main`（v0.3.26）**为**那台 Windows **新打、并在那台上安装勾选**的 `UNSIGNED.exe`。开发机可 `pnpm package:win` 出包，不得代填勾选。macOS 打包态勾选不能抄到本页。首轮离线勾选仍走 [办公机首轮](how-to-office-machine-first-round.md)，两页不要混填。

不要在办公机安装 PostgreSQL、Node、合成栈。产品主链走远端 HTTPS；检索由登录交付到 `%APPDATA%\客服话术浮窗 Demo` 旁的仓外目录。登录只有 **飞书** 和 **账号**。

安装包仍禁止外发、未签名。

## 准备

1. 当前 `main`（v0.3.26）的 UNSIGNED Windows 安装包（文件名含 `UNSIGNED`）。本机产物是 `release/local-unsigned/windows/客服话术浮窗 Demo-0.3.26-win-x64-UNSIGNED.exe`。勾选仍须在那台办公机上由人完成。
2. 办公机**需要网络**（与首轮断网相反）。
3. 把 `synthetic-stack.json` 放到 `%APPDATA%\客服话术浮窗 Demo\synthetic-stack.json`：

```json
{
  "mode": "product-remote",
  "apiOrigin": "https://agent-auth.jianghua.site",
  "identityOrigin": "https://agent-pass.jianghua.site"
}
```

两个 origin 必须不同、必须是 `https://` 主机名。不要 IP、不要路径、不要 userinfo。不要在本机装数据库来「补主链」。

## 勾选（全部未观察）

| # | 步骤 | 预期 | 通过 / 未通过 / 未观察 |
| --- | --- | --- | --- |
| 1 | 安装并启动带 `product-remote` 配置的 UNSIGNED 包 | 出现狐狸头，不是「请先装数据库」 | **未观察** |
| 2 | 飞书登录 | 系统浏览器授权后进会话，不是 CAPABILITY_DENIED JSON 糊在胶囊里 | **未观察** |
| 3 | 账号登录 | POST 打 identity origin，不是 API origin | **未观察** |
| 4 | 登录后查询 | 有 Top 3 / 复制；不是 leftover `/v1/search` 慢查询 | **未观察** |
| 5 | 关窗取消、断网 | 网络错误不是「登录已失效」 | **未观察** |
| 6 | 工作台 → 内容管理 → 点「取消未完成导入」 | 查不到在途批次时写「当前没有未完成的导入」，不是假成功 | **未观察** |
| 7 | 手选将替换 → 展开「内容导入」→ 选表 → 点发布 | 成功两行：`已发布 rel_* · 姓名` + 四库 delta，回执可去系统同步 / 话术库；失败写中文原因与下一步 | **未观察** |
| 8 | 内容管理未登录 | 徽章「未接入」，取消/发布禁用，不写假发布 | **未观察** |
| 9 | 系统同步 · 话术版本更新 | 四张卡（产品→活动→售前→售后）写「本版已更新」或「本版沿用」；老板打开看板，坐席狐狸紫点仍在 | **未观察** |
| 10 | 坐席狐狸头 | 发布后 ≤10s 内侧品牌紫点；可贴边，紫点对黄故障点 | **未观察** |
| 11 | 查询胶囊点「知道了」或看满 ≥1s | Top 3 仍在；横幅是 muted「某库话术已更新」，不是 `is-invalid` | **未观察** |

### 关于第 6 行（取消未完成导入）

「取消未完成导入」不点具体批次，桌面发一个哨兵批号，API 扫掉**本 actor 全部**在途导入。两种结果都要认：

- **有在途批次** → 取消成功，界面写「已取消未完成的导入，可以重新导入」。
- **没有在途批次** → API 返回 404，界面写「当前没有未完成的导入。登录还在，不必重新登录。」

第二种是**故意的**，不是缺陷。哨兵批号不代表任何单一批次，所以「扫到 0 条」是资源不存在；报成功会让操作员以为队列已清空，而实际还有 staged 批次堵着。合同与锁的细节见 [内容导入与发布合同](reference-content-publish.md#5-一次只有一个进行中的导入)。

## 不要当作已通过

- 本页存在于仓库里
- 开发机 unit / CI 绿
- 首轮离线勾选
- Authenticode、M5 设备清单、包内 PostgreSQL
- [macOS 打包态远端页](how-to-macos-packaged-product-remote.md)
- [Linux 打包态远端页](how-to-linux-packaged-product-remote.md)
