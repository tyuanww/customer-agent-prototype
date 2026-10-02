# 运行环境、端口与发布目录参考

这份参考把本仓目前的开发、测试和生产边界固定下来。端口数字、目录角色和服务状态是运行合同的一部分；需要改动时先更新这里，再更新对应的 systemd 或测试脚本。

## 环境角色

| 环境 | 位置 | 用途 | 允许的数据 |
| --- | --- | --- | --- |
| Mac 开发 | 开发 Mac | 写代码、跑单元测试、桌面开发态 | 合成 fixture；正式数据不进入桌面 S0 |
| WSL 生产 | Windows 办公机上的 WSL | 提供杭州远端后端和正式试点数据 | 受控生产数据；API 和 PostgreSQL 留在 WSL 内 |
| WSL 测试 | 同一台 WSL 的临时服务 | 连接 Windows 客户端做验收 | 独立合成 profile、独立端口、独立 stack root |
| GitHub Actions | 托管 runner | CI、Linux/Windows 可行性和合同检查 | 仓库合成数据与测试 fixture |

同一台 Windows 主机可以同时承担生产和测试，但两个 stack 必须同时满足以下条件：不同端口、不同 stack root、不同数据库 / 对象目录、不同 systemd unit，并且测试完成后停用测试 unit。测试客户端不能指向生产端口。

## 端口合同

| 端口 | 监听地址 | 所属 | 说明 |
| --- | --- | --- | --- |
| `3100` | `127.0.0.1` | Mac 直接 `formal-dev` API | `pnpm dev:api` 默认端口；只用于 API 配置 / 路由开发，桌面不会自动接入 |
| `43100` | `127.0.0.1` | Mac 合成 API | `scripts/synthetic-stack/stack.ts` 默认 API origin；自定义 stack root 可能按 profile 偏移 |
| `43101` | `127.0.0.1` | Mac 合成口令身份服务 | 只供同一套 Mac 合成 API 使用；自定义 stack root 可能按 profile 偏移 |
| `43115` | `127.0.0.1` | 生产 API | 通过受控 HTTPS 隧道访问；不直接暴露到局域网 |
| `43116` | `127.0.0.1` | 生产口令身份服务 | 只供生产 API 使用 |
| `43180` | `127.0.0.1` | 测试 API | 临时测试端口，验收后应无监听 |
| `43181` | `127.0.0.1` | 测试口令身份服务 | 临时测试端口，验收后应无监听 |
| `43199` | Unix socket 文件名后缀 | 各 stack 的 PG15 | 只在对应 stack root 的 socket 目录内使用，不开放 TCP；`profile.json.pgPort` 只是 socket 连接参数，不是 TCP listener |

查看端口和 readiness：

```bash
set -eu
LISTENERS="$(ss -ltnp)"
assert_loopback() {
  port="$1"
  printf '%s\n' "$LISTENERS" | awk -v port=":$port" '$1 == "LISTEN" && $4 ~ (port "$") { seen=1; if ($4 != "127.0.0.1" port) bad=1 } END { exit(!(seen && !bad)) }'
}
assert_optional_loopback() {
  port="$1"
  printf '%s\n' "$LISTENERS" | awk -v port=":$port" '$1 == "LISTEN" && $4 ~ (port "$") && $4 != "127.0.0.1" port { bad=1 } END { exit(bad) }'
}
assert_loopback 43115
assert_loopback 43116
assert_optional_loopback 43180
assert_optional_loopback 43181
READY_PATH=/ready
curl --fail --show-error --max-time 5 "http://127.0.0.1:43115${READY_PATH}"
if printf '%s\n' "$LISTENERS" | awk '$1 == "LISTEN" && $4 ~ /:43180$/ { found=1 } END { exit(!found) }'; then
  curl --fail --show-error --max-time 5 "http://127.0.0.1:43180${READY_PATH}"
fi
```

以上检查在 Windows 的 WSL 远端执行；不要在 Mac shell 里用 `127.0.0.1` 代替远端地址。测试完成后还要确认 `43180/43181` 没有 `LISTEN` 行。

测试端口返回连接失败是验收后的正常状态；生产端口必须仍返回 `200` 和 `status: "ready"`。

## 发布目录合同

生产机使用按 Git SHA 命名的发布目录，`current` 只是软链：

```text
/srv/customer-agent/releases/<git-sha>/   # 一个可回滚版本
/srv/customer-agent/current               # 当前生产版本的软链
/srv/customer-agent/stack/                # PG、对象、日志和私有 env
```

生产 unit 当前为 `customer-agent-stack.service`，运行身份是非 root 的 `customer-agent`；仓库中的模板使用 `Type=simple` 和 `stack.ts start --foreground --no-seed`，由 systemd 监督 identity、API、worker 的退出并按 `Restart=on-failure` 重启。代码目录保留 Git 元数据和依赖，便于回滚和复核；生产进程不应从工作树分支直接启动。

部署完成后核对：

```bash
# 以下核对在 WSL 远端执行；Git 检查用生产运行身份，避免 dubious ownership。
readlink -f /srv/customer-agent/current
sudo -n -u customer-agent git -C /srv/customer-agent/current rev-parse HEAD
sudo -n -u customer-agent git -C /srv/customer-agent/current status --short
systemctl is-active customer-agent-stack.service
READY_PATH=/ready
curl --fail --show-error --max-time 5 "http://127.0.0.1:43115${READY_PATH}"
```

`current` 下出现未知本地修改必须停下并备份，不能用切换版本覆盖。当前已知的生产特例是 `apps/desktop/assets/app-icon.png`，它不是生产 API 运行时输入；允许继续切换前必须把它单独备份，并保留旧 release，不能把这项例外扩展到其他文件。

## 空间占用与回滚窗口

每个完整 release 通常会带一份 `node_modules`。旧 release 保留 rollback 窗口，但长期保留全部依赖会快速放大磁盘占用。清理前先保留当前版本、上一个经过验收的版本和最近一次备份，再用以下只读检查列出候选：

```bash
du -sh /srv/customer-agent/releases/*
find /srv/customer-agent/releases -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort
```

删除旧 release 属于运维变更，必须先确认回滚窗口、备份和当前软链，再逐目录处理。不要删除 `/srv/customer-agent/stack/data`、`objects`、`logs` 或任何仍被 unit 使用的目录。

## 相关

- [How to 从远端仓库开发、测试并交付](how-to-remote-development-and-deployment.md)
- [How to 选择开发端口并运行本地服务](how-to-development-ports.md)
- [为什么开发、测试和生产要分开](explanation-environment-boundaries.md)
- [杭州后端操作手册](how-to-run-backend-on-hangzhou.md)
- [打包与签名边界](reference-packaging-and-signing.md)
