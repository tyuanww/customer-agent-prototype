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

未签名包的后果：经外部渠道下载后通常触发 SmartScreen 警告或拦截。办公机一期交付面就是 Windows，**这个警告目前是已知且未解决的。**

要正式分发 Windows，必须另走独立的 `release/distribution/` 与公司代码签名证书门禁，不能复用本机 `UNSIGNED` 产物。这不在当前实现范围内。

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
