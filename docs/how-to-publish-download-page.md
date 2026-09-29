# How to 发布一版到官网下载页

官网就是本仓的 `gh-pages` 分支，域名 `download.jianghua.site`。页面上的版本号、三个平台下载链接、文件大小和 SHA-256 都是**写死在 HTML 里**的，没有构建步骤。以前每次发版只能靠人手工改这 8 处，所以官网很容易落后于 GitHub Release。

现在由 `.github/workflows/download-page.yml` 自动改：**每次 `gh release create` 后**（`release: published`），workflow 拉取该 Release 的三个资产元数据，重写 `gh-pages` 上的 `index.html` 和 `windows.html`，然后提交推送。数据全部来自 Release，不来自页面，所以页面最多是「旧」，不会「错」。

## Prerequisites

1. 这次发布的 Release 已经建好，且带三个平台的资产：
   - `Demo-<VERSION>-win-x64-UNSIGNED.exe`
   - `Demo-<VERSION>-mac-universal-UNSIGNED.dmg`
   - `Demo-<VERSION>-linux-x86_64-UNSIGNED.AppImage`
2. 那三个资产都有 GitHub 的 `sha256:` digest。缺一个，脚本会直接失败，不会发出带错链接或错校验值的页面。
3. 改 workflow 或脚本的 PR 已合入 `main`（workflow 从默认分支取脚本，不从那三个 tag 取，所以补发老 Release 不会因为 tag 里没有脚本而失败）。

## Steps

正常发版不用手动做事。`gh release create <tag>` 一发布，workflow 自己跑。

补一个**已经发过**的 Release（例如 0.3.25 发布时该 workflow 还没合入）：

1. GitHub → Actions → **Download page** → **Run workflow**。
2. `tag` 填 `v0.3.25`（or 对应 tag）。
3. 跑完网页在 1 分钟内更新，Cloudflare 会缓存一会儿。

本机想先看会改成什么，在仓库里对着 `gh-pages` 的 worktree 跑：

```sh
git worktree add /tmp/jianghua-download-pages gh-pages
node scripts/update-download-page.mjs --dir /tmp/jianghua-download-pages --from-release v0.3.25          # 写入两个文件
node scripts/update-download-page.mjs --dir /tmp/jianghua-download-pages --check --from-release v0.3.25  # 只报告，不写
```

`--from-release` 用你的 `gh` 登录去读 Release；离线时也可用 `--manifest <file|->` 喂 `manifestFromRelease` 那个形状的 JSON。跑完 `git -C /tmp/jianghua-download-pages diff` 看改了什么。

## Verification

- 打开 `https://download.jianghua.site/`，hero 与「下载」段的 `vX.Y.Z` 是这次版本，「下载 · <大小>」与该 Release 资产一致。
- 点页面上任一下载按钮，落到 `.../releases/download/<tag>/Demo-<VERSION>-...`。
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
| Actions 里没跑 | Release 是 `draft` 或 `prerelease`；这两种不会触发 `published`。发布正式 Release，或用 `workflow_dispatch` 补。 |
| workflow 红在「Rewrite the page」 | 该 Release 缺一个平台资产，或资产没有 sha256 digest。补资产后重跑。 |
| 页面没变 | 页面已经是该版本（workflow 会跳过推送）；或 Cloudflare 还在缓存，等一会儿。 |
| 官网更新了但工作台没更新 | 预期。两条链路，工作台要直写上面那张表。 |
