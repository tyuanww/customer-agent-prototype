# How to 发下一轮桌面大版本

发完一轮之后，下一轮按六条发布面分开做。合进 `main` 不会让坐席看到新包，也不会换杭州进程，也不会换线上话术。

2026-10-20 仓库版本是 `0.3.31`。根目录 `VERSION` 和 `apps/desktop/package.json` 都是 `0.3.31`。GitHub Release `v0.3.31` 的三个 UNSIGNED 附件对应提交 `b4cbd6ff618ac8cfa0cf88efef3ef8d17748bda9`。下载页是 `v0.3.31`。应用内当前行是 `sw_0331_mac`。杭州代码软链是 `b4cbd6ff618ac8cfa0cf88efef3ef8d17748bda9`。公网健康检查是 `0.3.31`。回滚软链是 `8036766886799b052fcc690615671c2fb2b4006c`。话术指针仍是 `rel_27`。`v0.3.30`、`v0.3.29`、`v0.3.27` 的附件没有被覆盖。

2026-10-19 仓库版本改成 `0.3.30`。根目录 `VERSION` 和 `apps/desktop/package.json` 都是 `0.3.30`。GitHub Release 和下载页仍是 `v0.3.29`，三个 UNSIGNED 附件仍对应 `8b1bf72`。新包还没有发出。

2026-10-18 已发布安装包的实测状态写在这里。当时根目录 `VERSION` 和 `apps/desktop/package.json` 都是 `0.3.29`。GitHub Release `v0.3.29` 的三个 UNSIGNED 附件对应提交 `8b1bf7215f1a8b29301229107e61dbc2f09c799a`。下载页是 `v0.3.29`。应用内当前行是 `sw_0329_mac`。杭州代码软链是 `8036766886799b052fcc690615671c2fb2b4006c`。公网 `https://agent-auth.jianghua.site/health` 在 2026-10-19 返回 `version` `0.3.29`。这个字符串来自杭州 `api.env` 的 `CUSTOMER_AGENT_BUILD_VERSION`。回滚软链是 `d66a9234f6c1de6ef45b16158523eb01e4580e91`。话术指针仍是 `rel_27`。`v0.3.27` 的三个附件没有被覆盖。已安装的 0.3.29 包不含 `8036766` 里的窗口标题修正。

## How to 看现在跑的是哪一份

在仓库根目录运行 `pnpm where`。它打印三行。第一行是根目录 `VERSION`、当前提交前 7 位和分支。第二行读 Mac 上 `客服话术浮窗 Demo` 的 `synthetic-stack.json`，指向写成杭州、本机、离线或未知。文件损坏时写「读不了」，不会中断另外两行。第三行读本机未签名包或 `release/distribution` 里的 `build-identity.json`。印章只记录打包时的 `HEAD`。没有这份文件，或里面没有提交号时，版本号相同也不能当成同一次构建。工作台窗口标题用的是进程启动时已经解析的会话来源，不再另读一份磁盘 profile。这条命令只在这台 Mac 的仓库里用，不在杭州上跑。

2026-10-17 上一轮的实测状态留在这里，方便对照。它不是现在的版本。根目录 `VERSION` 和 `apps/desktop/package.json` 当时都是 `0.3.28`。杭州代码软链是 `ddeec39052a4353dd623be2b5b9a10ddfe40feb8`。公网 `https://agent-auth.jianghua.site/health` 返回 `version` `0.3.28`。这个健康检查字符串来自 `api.env` 的 `CUSTOMER_AGENT_BUILD_VERSION`，不是根目录 `VERSION` 文件。话术指针仍是 `rel_27`。GitHub Release `v0.3.27` 的三个附件仍指向 `d09f7da354b1a72bc0e8f8126f6487c751fc99df`，不要覆盖。

## Prerequisites

- 产品版本同时写 `apps/desktop/package.json` 和根目录 `VERSION`。两处必须是同一串。健康检查仍只看 `api.env` 里的 `CUSTOMER_AGENT_BUILD_VERSION`。
- Node 24。Mac 用 `$HOME/homebrew/opt/node@24`。杭州用 `/usr/local/bin/node`，这次是 v24.21.0。pnpm 锁在 `11.19.0`。
- 六条面各自要一句单独的授权。代码部署、新的 GitHub Release、下载页、应用内目录、话术发布，不能用同一句「继续」带过。
- 四张话术表是售前、活动、售后、FAQ。SOP 不在这一轮。

## Steps

1. 在跟踪 `origin/main` 的工作树里改桌面包版本，合进 `main`。不要把功能分支推成 `main`。不要改已经合过的迁移 `0042` 到 `0045`。

2. 打三个平台的未签名包。Linux 包不在这台 Mac 上打。新的 GitHub Release 用新 tag。不要替换 `v0.3.27` 已有附件。

3. 下载页由 `.github/workflows/download-page.yml` 在 `release: published` 之后改写。页面可以暂时仍显示旧版本，用带查询串的地址再看一次。步骤见 [发布到官网下载页](how-to-publish-download-page.md)。

4. 应用内「打开下载页」读 `ops_loop.software_release_catalog` 里唯一的 `is_current` 行。先把旧的当前行清掉，再插入新行，两句放在同一个事务里。2026-10-17 的当前行是 `sw_0328_mac`。不要再插入一遍。

5. 杭州换代码用 bundle，不用 `git clone`。命令、失败原句和回滚软链见 [在杭州跑这条后端](how-to-run-backend-on-hangzhou.md) 的「更新代码」。不要删 `/srv/customer-agent/stack/profile.json`。不要在 release 目录里改文件。健康检查字符串是 `api.env` 里的 `CUSTOMER_AGENT_BUILD_VERSION`。改之前先复制 `api.env`。

6. 话术指针另说。没有点名四张表的发布授权时，不要调用发布。已暂存的售后批次 `imp_J7-9g4FrODq8vwbBh5RDv4wy` 绑的是售后 v1。`rel_27` 的售后是 v6。发出去会把售后退回 v1。本地 `faq/minokin话术库/` 的四份表对不上已登记快照，不能拿来直接发。

## Verification

代码软链和健康检查：

```bash
curl --fail --show-error --max-time 15 https://agent-auth.jianghua.site/health
```

期望 body 里的 `version` 等于这次 `CUSTOMER_AGENT_BUILD_VERSION`。未登录的 `GET /v1/intake/sources` 和 `GET /v1/events/usage` 应是 `401`。`POST /v1/intake/health` 不是现有路径，`404` 不表示录入没挂上。

话术指针仍要用杭州上的 `stack_owner` 去读 `content_current`。这次读到的是 id `1`、`rel_27`。不要为了核对去发布。

坐席机器上的趋势图读的是本机 `usage-journal.json`。杭州有 `GET /v1/events/usage` 不等于已安装的 `0.3.28` 会去调它。打包后的应用不读 `CUSTOMER_AGENT_DESKTOP_*`。要看新包，先完全退出再打开。

工作台模式不要靠预加载对象猜测。`contentIntake` 为 `faq-v2` 时保留「权限」和「资料管理」。没有这份设置的远端工作台会藏起「知识库」「权限」「资料管理」，并保留「内容管理」。

## Troubleshooting

| 你看到 | 怎么处理 |
| --- | --- |
| `You appear to have cloned an empty repository`，接着 `reference is not a tree` | bundle 里只有 `refs/remotes/origin/main`。不要 `git clone` 这个文件。按杭州 how-to 用 `git init -b scratch` 再 fetch。 |
| `refusing to fetch into branch 'refs/heads/main' checked out` | 默认分支已经是 `main`。先 `git init -b scratch`。 |
| 健康检查仍是上一版版本号 | 软链对了，但 `api.env` 里的 `CUSTOMER_AGENT_BUILD_VERSION` 还是旧字符串。先复制 `api.env`，只改这一键，再重启。 |
| 端口变成 `43178` / `43179` | `profile.json` 被删了，端口按目录重算。从备份放回，再重启。不要改 release 树来修端口。 |
| 售后话术变少或退回旧稿 | 发布用了售后 v1 批次。把指针停在 `rel_27`。不要用 `stack_owner` 冒充 owner 去补发。 |
| 坐席趋势图没有历史查询 | 已安装的桌面包读本机记录。服务端路由返回 `401` 只说明路由在。 |

## Related

- [在杭州跑这条后端](how-to-run-backend-on-hangzhou.md)
- [发布到官网下载页](how-to-publish-download-page.md)
- [换成这一版未签名包](how-to-upgrade-unsigned.md)
- [用一张表整库替换](how-to-replace-one-library.md)
- [CHANGELOG](../CHANGELOG.md)
