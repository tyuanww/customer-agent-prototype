# P10 第一刀：安装包不打进 PG / API

> **状态：** 实现中（`feat/p10-no-bundled-stack`）。  
> **不包含：** 把 PostgreSQL 15 打进安装包、Windows 上移植 `postgres.ts`、API 绑 `0.0.0.0`。

## 拍板

1. 当前包只有 desktop `out` 与离线 profile / 图标 / 许可。这不是免装依赖的产品主链。
2. 本轮**不**做包内后端。办公机首轮仍是 P3 离线；产品主链是 P4 远端 + 登录交付检索。
3. 打包 `extraResources` / `files` 不得出现 postgres、pg15、`apps/api`、stack 入口。
4. 缺配置弹窗不得叫操作员「先装合成栈 / PostgreSQL」。
5. 本刀不声称办公机实机已通过。

## 明确不做

- 不拷 Homebrew PG15 dylib
- 不把 unix socket 改成办公机 TCP 监听
- 不削弱 fail-closed、不缺文件当 S0
