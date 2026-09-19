# P10：Linux userData 跟随 XDG_CONFIG_HOME

> **状态：** 已实现（`feat/p10-linux-xdg-userdata`）。  
> **不包含：** 改 API bind、包内 PostgreSQL、把 CI AppImage 当成 Linux 实机勾选。

## 拍板

1. 栈侧 Linux 目录与 Electron `app.getPath('userData')` 一致：`$XDG_CONFIG_HOME/<name>`，否则 `~/.config/<name>`。
2. `CUSTOMER_AGENT_DESKTOP_USERDATA` 仍优先。
3. 打包 profile 路径在写入时解析，不在 import 时冻死。
