# P10：栈写入的 synthetic-stack.json 对齐 Electron userData

> **状态：** 实现中（`feat/p10-desktop-userdata-path`）。  
> **不包含：** 把 PG15 打进包、Windows 上跑 unix socket 的本机栈。

## 拍板

1. 打包客户端从 `app.getPath('userData')/synthetic-stack.json` 读配置。
2. 栈侧写入必须跟同一目录：macOS Application Support、Windows `%APPDATA%`、Linux `~/.config`。
3. `CUSTOMER_AGENT_DESKTOP_USERDATA` 仍覆盖，供测试和 `--user-data-dir`。
4. 本刀不让办公机免装 PG。
