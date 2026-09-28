# How to 换成这一版未签名包

把本机已装的未签名 Demo 换成当前 `VERSION` 打出来的 UNSIGNED 包。不走 `latest.yml`，也不自动更新。

## Prerequisites

1. 当前仓库 `VERSION`（现在是 0.3.23）对应的 UNSIGNED 产物，在 gitignored 的 `release/local-unsigned/`。
2. 先退出正在跑的「客服话术浮窗 Demo」。
3. Windows 办公机勾选仍由人在那台机器上做，见 [办公机产品主链](how-to-office-machine-product-remote.md)。

## Steps

1. 看 [CHANGELOG](../CHANGELOG.md) 这一版的 Added / Changed，确认你要的是这版行为（将替换、下架两步确认、`matchesLease`）。

2. macOS：打开 `release/local-unsigned/` 里文件名含 `UNSIGNED` 的 `.dmg`，把 App 拖到「应用程序」，覆盖旧的「客服话术浮窗 Demo」。Gatekeeper 警告按未签名包处理，见 [打包与签名](reference-packaging-and-signing.md)。

3. Windows：把 `客服话术浮窗 Demo-<VERSION>-win-x64-UNSIGNED.exe` 拷到 ASCII 路径后静默安装 `/S /currentuser`。步骤与路径见办公机 how-to。

4. 启动后看查询胶囊或工作台关于版本的软件目录行。文件名仍可含 `UNSIGNED`；界面徽章写「未签名」。

## Verification

- 工作台内容管理有折叠外的「将替换」，闲置折叠 summary 是「内容导入」。
- 话术库详情下架是两步确认。
- 查询胶囊操作员芯片不显示 `synthetic_owner`。

## Troubleshooting

| 你看到 | 怎么处理 |
| --- | --- |
| 仍是旧顶栏 / 仍写「待开发」 | 旧进程没退干净，或装到了另一用户目录。退出后再装这一版 UNSIGNED。 |
| Gatekeeper / SmartScreen | 未签名包的预期。不要为此去生成 `latest.yml`。 |
| 没有 Linux 包 | `package:linux` 必须在 Linux 主机上跑。 |
