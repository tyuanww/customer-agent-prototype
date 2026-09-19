# How-to：账号 identity 用 agent-pass

> **状态：** 已实现（`feat/docs-agent-pass-hostname`）。  
> **不包含：** 改 beian DNS、把远端清单标已观察。

## 拍板

1. 操作文档里的 identity origin 写成 `https://agent-pass.jianghua.site`。
2. DNS 只给空闲主机名加 CNAME，不覆盖已有隧道占用的名字。
3. 单测夹具仍可用别的 https 主机名。
