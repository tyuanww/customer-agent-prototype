# How to 发布一版到官网下载页

官网就是本仓的 `gh-pages` 分支，域名 `download.jianghua.site`。页面上的版本号、各平台下载链接、文件大小和 SHA-256 都是**写死在 HTML 里**的，没有构建步骤。

正式 Release 发布后，`.github/workflows/download-page.yml` 读取 Windows 安装器和 macOS DMG 的资产元数据，重写 `gh-pages` 上的 `index.html` 和 `windows.html`。官网只展示 Windows 和 macOS。脚本遇到缺包、重复平台资产、缺摘要或遗留 Linux 链接会退出。

## 准备发布资产

1. 冻结正式提交，确认标签、`VERSION` 和完整提交 SHA 一致。等同一次由 push 触发的完整 CI 成功，确认它提供 `windows-local-unsigned` 与 `mac-local-unsigned`。Mac job 使用现有未签名打包入口并核对包内构建 SHA。Windows job 核对安装器与主程序的 PE 属性和包内构建 SHA。
2. 获得对应未签名包分发授权后，创建草稿 Release。在 GitHub Actions 运行 **Publish artifact to release**，输入该标签。工作流从标签 SHA 对应的同一 CI run 取包。
3. 回读 Release，确认同平台各只有一个资产，文件名为 `customer-agent-<VERSION>-win-x64-UNSIGNED.exe` 和 `customer-agent-<VERSION>-mac-universal-UNSIGNED.dmg`。核对 GitHub 的 `sha256:` digest 与工作流记录一致。重跑会沿用已存在且摘要完全相同的附件。发现其他同平台附件时先核对保留哪一个，再使用现有受控发布权限处理。
4. 将已验摘要的安装包和受管配置配套交付给部署员。先给 Windows 和 Mac 的目标用户下发并回读远端配置，再打开应用验收首装、升级和重开。官网下载仅提供安装包。受管配置由部署员经内部设备下发渠道交付。[Windows 受管首装](how-to-office-machine-product-remote.md#受管首装) · [macOS 受管首装](how-to-macos-packaged-product-remote.md#受管首装)
5. 用 `node scripts/ops/production-smoke.mjs --expected-version "$(cat VERSION)"` 确认正式 API 已切换到标签对应的版本，再按批准发布 Release。**Download page** 工作流会再次核验该版本和线上就绪状态，通过后才更新官网。如果发布事件未触发工作流，用下一节的手动入口补发，再核对官网与同一 Release 的链接和 SHA-256。

## 补发官网下载页

补发与当前生产 API 版本一致的已发布 Release：

1. GitHub → Actions → **Download page** → **Run workflow**。
2. `tag` 填当前生产 API 版本对应的标签。
3. 跑完网页在 1 分钟内更新，Cloudflare 会缓存一会儿。

本机想先看会改成什么，在仓库里对着 `gh-pages` 的 worktree 跑：

```sh
git worktree add /tmp/jianghua-download-pages gh-pages
node scripts/update-download-page.mjs --dir /tmp/jianghua-download-pages --from-release v0.3.25          # 写入两个文件
node scripts/update-download-page.mjs --dir /tmp/jianghua-download-pages --check --from-release v0.3.25  # 只报告，不写
```

`--from-release` 用你的 `gh` 登录去读 Release；离线时也可用 `--manifest <file|->` 喂 `manifestFromRelease` 那个形状的 JSON。跑完 `git -C /tmp/jianghua-download-pages diff` 看改了什么。

真要把一个**更旧**的 Release 发到页面上（回滚），加 `--allow-downgrade`——默认是拒绝的，理由见 Troubleshooting 第一行。

## 脚本拒绝发布的情形

脚本要么把页面完整改对，要么报错退出，不存在「改了一半」。下面这些都会让它停下来：

| 情形 | 报错 |
| --- | --- |
| GitHub Release 是草稿、预发行或缺少状态 | `must be a published stable release` |
| Release 同平台有多个附件 | `release vX.Y.Z has multiple win assets` 或 `multiple mac assets` |
| 页面上的下载链接指向**别的仓库** | `page links a release on <owner>/<repo>, but this script publishes ...` |
| 页面不再链接 Windows 或 macOS（少一个下载按钮） | `page no longer links the mac asset` |
| 页面仍链接已停用的 Linux 平台 | `page links the unsupported linux platform` |
| 一个页面里出现了**两个不同版本号** | `page carries more than one version: ...` |
| 某个链接的文件名无法归类到平台 | `page links an asset this script cannot map: ...` |
| 要发布的版本**比页面现有的更旧** | `<file> advertises vX.Y.Z; refusing to publish the older v...` |

最后一条是最容易踩的：`workflow_dispatch` 补发一个**已经发过的老** Release，默认会被拒绝。这不是故障，是防止官网被无声地退回旧版本。

## Verification

- 打开 `https://download.jianghua.site/`，hero 与「下载」段的 `vX.Y.Z` 是这次版本，「下载 · <大小>」与该 Release 资产一致。
- 点页面上任一下载按钮，确认目标为该 Release 中对应平台的唯一附件。
- 点 SHA-256 芯片，复制出的值等于 Release 资产的 digest。
- 工作台「打开下载页」用的是数据库里 `is_current=true` 那一行，和官网是**两条独立链路**；改官网不会改工作台，见下。

## 工作台「打开下载页」是另一条链路

工作台按钮读 PG 表 `ops_loop.software_release_catalog` 里 `is_current=true` 的那一行。仓库里只有 migration schema 和两个只读函数（`list_software_releases` / `current_software_release`），**没有 seed、没有写 API**，这一行是带外直写的。

**只能在跑 API 的那台机器上做。** `DATABASE_URL` 只接受 loopback URL（见 [reference-api-runtime-config](reference-api-runtime-config.md)），这张表的 PG 就在那台机器本机，开发机连不过去。

两条语句必须**原子**。先清后插，如果 INSERT 失败而 UPDATE 已经生效，目录里会一行 `is_current` 都没有，工作台按钮直接空掉——比指向旧版本更糟。所以包在事务里：

```sql
BEGIN;

UPDATE ops_loop.software_release_catalog SET is_current = FALSE WHERE is_current;

INSERT INTO ops_loop.software_release_catalog
  (catalog_id, version, platform, sha256, download_url, signed, is_current)
VALUES ('sw_0325_win', '0.3.25', 'win-x64',
        '84795e68bc316e45999287c5532b883c232a80aa9619b68c475fc202a479aac1',
        'https://github.com/tyuanww/customer-agent-prototype/releases/download/v0.3.25/Demo-0.3.25-win-x64-UNSIGNED.exe',
        FALSE, TRUE);

COMMIT;
```

`sha256` 和 `download_url` 从 Release 资产原样复制，别手打（`gh release view v0.3.25 --json assets`）。表上有 CHECK 兜底：`platform` 只接受 `mac-universal` / `win-x64` / `linux-x64`，`sha256` 必须是 64 位小写 hex，`download_url` 必须以 `https://` 开头——写错会在 INSERT 时报错，这正是要包事务的原因。

事后核一下，应该只剩一行、且指向刚发布的版本：

```sql
SELECT catalog_id, version, platform, is_current
FROM ops_loop.software_release_catalog WHERE is_current;
```

部分唯一索引 `software_release_one_current` 保证同一时刻只有一行 `is_current`。这是正式数据写入，需要单独授权。

## Troubleshooting

| 你看到 | 怎么处理 |
| --- | --- |
| workflow 报 `refusing to publish the older vX.Y.Z` | 你要发的版本比页面现有的旧。确认确实要回滚才加 `--allow-downgrade`（本机跑）；CI 里没有这个开关，页面只会向前走。 |
| Actions 里没跑 | Release 是 `draft` 或 `prerelease`；这两种不会触发 `published`。发布正式 Release，或用 `workflow_dispatch` 补。 |
| workflow 红在「Rewrite the page」 | 该 Release 缺 Windows 或 macOS 资产、同平台有多个附件、资产缺 SHA-256，或页面仍保留 Linux 链接。修复后重跑。 |
| 页面没变 | 页面已经是该版本（workflow 会跳过推送）；或 Cloudflare 还在缓存，等一会儿。 |
| 官网更新了但工作台没更新 | 预期。两条链路，工作台要直写上面那张表。 |
