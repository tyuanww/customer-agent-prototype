# 打包与签名

> 本文说明三类桌面包（macOS / Windows / Linux）怎么出、各自签不签、怎么验。它是当前实现的参考，不构成发布授权。
>
> 一句话：**macOS 有完整的签名 + 公证门禁；Windows 与 Linux 在本仓只能出本机未签名包。**

## 1. 三条路径

| 平台 | 本机验证命令 | 外发命令 | 签名 |
| --- | --- | --- | --- |
| macOS | `pnpm package:mac:local` | `pnpm package:mac` | 本机未签名 / 正式签名 + 公证 |
| Windows | `pnpm package:win` | **无** | 只有未签名 |
| Linux | `pnpm package:linux` | **无** | 只有未签名 |

产物目录分账，不会同名覆盖：

- 本机验证 → `release/local-unsigned/`（文件名强制带 `UNSIGNED`）
- 正式 macOS → `release/distribution/`（禁止出现 `UNSIGNED`）

两类目录都被 Git 忽略。`release/` 是本地构建缓存，可删后重打。

## 2. macOS：签名与公证

### 本机未签名（`package:mac:local`）

显式关掉签名与公证，只用于本机验证：

```
-c.mac.identity=null
-c.mac.notarize=false
-c.mac.forceCodeSigning=false
```

后验会**要求** `codesign --verify` 失败——真签上了反而报错。这保证本机包不会被误当成已签名产物。

### 正式外发（`package:mac`）

先跑 fail-closed 前置检查 `scripts/verify-mac-release-env.mjs`，缺任一条件直接退出，不产出可误外发的包：

| 检查 | 要求 |
| --- | --- |
| 平台 | 必须在 macOS 上构建 |
| Xcode | `xcodebuild -version` 可用（完整 Xcode，不能只有 CLT） |
| Bundle ID | `build.appId` 不得是 `local.` 前缀或含 `.demo.` |
| 签名证书 | `security find-identity -v -p codesigning` 里有 `Developer ID Application:`，或设置了 `CSC_LINK` |
| 公证凭证 | `APPLE_API_KEY` / `APPLE_API_KEY_ID` / `APPLE_API_ISSUER` 三件齐，**或** `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID`，**或** `APPLE_KEYCHAIN` / `APPLE_KEYCHAIN_PROFILE` |

构建后 `scripts/verify-mac-package.mjs distribution` 再验三项：

```
codesign --verify --deep --strict <app>
spctl --assess --type execute <app>
xcrun stapler validate <app>
```

当前仓库的 `appId` 仍是 `local.demo.customer-agent`，所以 `package:mac` **现在一定失败**——这是设计如此。正式首次外发前必须先由公司确定长期 Bundle ID。

配置骨架（`apps/desktop/package.json` 的 `build.mac`）：`hardenedRuntime: true`、`gatekeeperAssess: false`、`forceCodeSigning: true`、`notarize: true`，entitlements 用 `build/entitlements.mac.plist`（允许 JIT 与未签名可执行内存，Electron 需要）。

**证书、`.p8` / `.p12`、Apple ID 密码、Keychain profile 不得提交仓库，也不得打印到日志。**

## 3. Windows：只有未签名

`scripts/package-windows.mjs` 的 mode 不是 `local` 就直接抛错：

> Windows packaging in this Demo is local-unsigned only. There is no signed distribution path.

本仓**没有** Authenticode / EV 签名路径。`build.win.signExecutable = false`，并关闭 `CSC_IDENTITY_AUTO_DISCOVERY`。

后验 `scripts/verify-windows-package.mjs` 要求：

- 存在 `-UNSIGNED.exe`（改名会失败）
- `win-unpacked/resources/icon.ico` 与 `apps/desktop/build/icon.ico` **字节一致**
- Electron / Chromium / 项目第三方许可非空
- 拒绝 `.blockmap`、`latest*.yml`、`app-update.yml`

这个门的边界要说清：**它只证明离线包的文件结构与资源副本，不检查 PE 可执行文件内部的图标资源，也不检查 Authenticode 状态。** 真实的 Windows 安装、任务栏图标、系统签名仍需在 Windows 设备上验收。

### 内部工具的口径：签名是可选，不是必需

一期交付面是**内部办公机**，不是陌生终端用户下载。签名解决的三件事里，只有一件可能变成硬性条件：

| 签名的作用 | 对内部办公机 |
| --- | --- |
| SmartScreen「未知发布者」提示 | 基本不触发——见下 |
| 篡改可检测 | 弱收益（只证明来自发布方） |
| 企业策略强制（AppLocker / WDAC） | **唯一可能变成必需的一条** |

**为什么走内部渠道分发就不弹 SmartScreen**：SmartScreen 跟 Mark-of-the-Web（MOTW，即 `Zone.Identifier`）走。浏览器下载会写入 MOTW，`scp` / U 盘 / 网络共享**不会**。

**实测（2026-09-27，办公机 `desktop-faejk8s`，Windows 10 家庭中文版 19045）**：

| 检查 | 结果 |
| --- | --- |
| WDAC 策略（`CiPolicies\Active`） | 空；`CiTool` 不存在 |
| AppLocker（`Get-AppLockerPolicy`） | cmdlet 不存在（家庭版不支持） |
| `EnableSmartScreen` 策略 | `0`（未启用策略级拦截） |
| 已安装应用 Authenticode | `NotSigned`，`SignerCertificate` 为空 |
| 已安装版本 | 0.3.21，**能装能跑** |
| scp 过去的安装包 MOTW | **无**（`installer_motw: false`） |

结论：**在这台办公机上，未签名包不触发任何策略阻断。** 内部工具不需要为此买代码签名证书。

### 什么时候必须签

只有两种情况：

1. **办公机被 IT 用 AppLocker 或 WDAC 强制模式管起来。** 那是**拒绝执行**，不是弹警告，自签也不够，必须走企业 CA 或 Azure Trusted Signing。上面的实测已确认当前没有。
2. **将来要对外分发**（外包、客户、公开下载）。那时 MOTW 会出现，SmartScreen 会拦，按 §3.2 清单办。

### 3.1 如果你确实要签（自签，零成本）

内部固定几台机器，自签是甜点：无「未知发布者」、有篡改检测、发布方显示成你设的组织名。成本是**每台目标机器导一次根证书**。

```powershell
# 1) 生成自签代码签名证书（有效期内放你需要的年限）
$cert = New-SelfSignedCertificate -Type CodeSigningCert `
  -Subject "CN=Menokin Internal, O=Menokin" `
  -KeyUsage DigitalSignature -FriendlyName "Menokin Internal Code Signing" `
  -CertStoreLocation "Cert:\CurrentUser\My" `
  -NotAfter (Get-Date).AddYears(3)

# 2) 导出公钥证书（分发用，不含私钥）
Export-Certificate -Cert $cert -FilePath MenokinInternal.cer

# 3) 签名（signtool 随 Windows SDK 提供）
signtool sign /fd SHA256 /a /n "Menokin Internal Code Signing" `
  /tr http://timestamp.digicert.com /td SHA256 `
  "客服话术浮窗 Demo-0.3.21-win-x64-UNSIGNED.exe"
```

拿到 `.cer` 的机器上，导入到**受信任的根证书颁发机构**（管理员）：

```powershell
Import-Certificate -FilePath MenokinInternal.cer `
  -CertStoreLocation Cert:\LocalMachine\Root
```

要接进本仓的打包链，得加 `distribution` 模式与签名后验（当前 `package-windows.mjs` 只支持 `local`）——那是另一轮代码改动，**当前未做**。

诚实边界：自签能消掉「未知发布者」，但 **SmartScreen 云端信誉是另一套**（按证书信誉算），自签证书没有信誉。所以自签只对**不带 MOTW** 的文件有效；对外分发仍要正规链。

### 3.2 对外分发才需要（正规链）

| 路线 | 年费 | CI 可行性 | SmartScreen |
| --- | --- | --- | --- |
| Azure Trusted Signing | ~$10/月 | 云端签，无需硬件 token；electron-builder 26 原生支持 `azureSignOptions` | 立即有信誉 |
| OV 证书 | $200–400 | **2023-06 起必须硬件 token / 云 KMS**，CI 要自托管 runner | 要攒下载量 |
| EV 证书 | $400–600 | 同上 | 立即有信誉 |

**Azure Trusted Signing 最省事**，但需要 Azure 组织身份验证。本仓 `package-windows.mjs` 与 `verify-windows-package.mjs` 目前都没有对应分支；接入前先确认真有必要。

未签名包的后果：**带 MOTW 时**（即经浏览器下载）通常触发 SmartScreen 警告或拦截。走 scp / U 盘不受影响。

要正式分发 Windows，必须另走独立的 `release/distribution/` 与签名门禁，不能复用本机 `UNSIGNED` 产物。


## 4. Linux：只有未签名

`scripts/package-linux.mjs` 同样只支持 `local`，且必须在 Linux 上跑（macOS / Windows 开发机执行会失败）。产物是 `-UNSIGNED.AppImage`。

## 5. 三个平台共有的行为

- **打包前 `CSC_IDENTITY_AUTO_DISCOVERY=false`**（Windows / Linux），macOS local 用 `identity=null`。
- **图标确定性生成**：纯 Node 从透明狐狸头合成 master，再生成 `icon.icns` / `icon.ico` / `icon.png`。
- **不生成自动更新元数据**：`publish: null`，后验明确拒绝 `latest*.yml` 与 `app-update.yml`；软件目录禁止 `latest.yml`。
- **TLS 桥接**：调用方未显式给 `NODE_EXTRA_CA_CERTS` 时，打包器仅在进程内临时桥接 macOS 系统根证书给 Node，保持 TLS 校验开启，结束后删临时文件。
- **许可随包**：携带 Electron / Chromium / React 的第三方许可说明。

## 6. 怎么验（不出外包）

```bash
# macOS 本机验证
pnpm package:mac:local
# Windows 未签名包
pnpm package:win
# Linux 未签名包（须在 Linux 上）
pnpm package:linux
```

每个命令内部都会跑自己的 fail-closed 后验，通过才算产出成功。后验只证明「这个包的结构对不对」，不证明「这台机器上装能跑」——后者要人上机勾选，见[办公机产品主链](how-to-office-machine-product-remote.md)。

## 7. 相关

- [内容导入与发布合同](reference-content-publish.md)
- [How to：办公机产品主链（远端）](how-to-office-machine-product-remote.md)
- [How to：办公机首轮离线安装](how-to-office-machine-first-round.md)
- [Tutorial：管理员导入 MENOKIN FAQ 并发布](tutorial-menokin-content-publish.md)
