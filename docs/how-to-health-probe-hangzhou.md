# 健康探针与告警（杭州）

`docs/how-to-run-backend-on-hangzhou.md` 的「已知缺口」里曾写了三条：子进程崩溃不自愈、单点、**没有告警**。
前台栈单元已经覆盖子进程崩溃重启；本文件覆盖依赖异常时的告警与自愈。去单点不在范围内。

> **状态（2026-10-02）：watchdog 已安装并在杭州 WSL 运行。** `customer-agent-stack.service` 使用前台 supervisor，watchdog timer 已启用；本次未启用健康告警 timer，因为机器上还没有 `/srv/customer-agent/monitor.env`。下面的安装命令保留给新机器或重装时复用。

## 两个单元，分工不同

| | 做什么 | 出问题时 |
| --- | --- | --- |
| `customer-agent-health-check` | 探 `/ready`，连续失败 3 次**发飞书** | 通知人 |
| `customer-agent-stack-watchdog` | 探 `/ready`，依赖异常时**跑 `stack.ts start`** 修复 | 自己修 |

**子进程崩溃由栈单元负责**：`customer-agent-stack.service` 使用 `Type=simple`，以 `stack.ts start --foreground --no-seed` 启动。identity、API 或 worker 任一异常退出，前台 supervisor 会停止剩余进程并以失败退出，systemd 的 `Restart=on-failure` 随后重启整组。watchdog 继续保留，用于进程都还活着但 `/ready` 依赖不完整的情况。

**为什么看门狗仍然调用 `stack.ts start`**：主 unit 仍 active 时，普通 `start` 是 detached、幂等的本机依赖修复入口；它只启动缺失的进程，不会打扰活着的进程。看门狗先检查主 unit，主 unit 已 inactive 就退出，把进程所有权留给 systemd，避免重新产生脱离 supervisor 的进程。生产 unit 使用独立的 `--foreground` 模式，不能在已有生产 supervisor 上重复启动。

## 为什么探的是 `/ready` 而不是 `/health`

这一点值得先讲清楚，因为它决定了这套东西有没有用。

| 端点 | 行为 |
| --- | --- |
| `/health` | 静态。只回 `{status:'ok', service, version}`，**不碰数据库、认证、存储**。依赖全挂时它照样回 200。 |
| `/ready` | 依赖不全就回 **503** 并带 `retry-after: 1`。 |

历史上那台机器的失效方式是：**API 单独崩掉，systemd 单元仍显示 `active`，而 `/ready` 已经是 503**；现在这类子进程退出由前台 supervisor 交给 systemd 重启。探针继续覆盖另一类故障：进程都活着，但依赖没有就绪。
所以仍然必须探 `/ready`，探 `/health` 会在依赖故障期间一直报平安 —— 你会以为自己有监控，其实没有。
脚本里探的是 `/ready`，并且有测试钉住这个选择。

## 文件

| 文件 | 作用 |
| --- | --- |
| `scripts/ops/customer-agent-health-check.sh` | 探针。连续失败 3 次发飞书告警。 |
| `scripts/ops/customer-agent-health-check.service` | oneshot，以 `customer-agent` 身份运行。 |
| `scripts/ops/customer-agent-health-check.timer` | 开机 2 分钟后起，之后每分钟一次。 |
| `scripts/ops/customer-agent-stack.service` | `Type=simple` 前台栈单元；子进程退出时由 systemd 重启整组。 |
| `scripts/ops/customer-agent-stack-watchdog.sh` | 探 `/ready`，不 ok 就跑 `stack.ts start`。 |
| `scripts/ops/customer-agent-stack-watchdog.service` | oneshot，同上身份。 |
| `scripts/ops/customer-agent-stack-watchdog.timer` | 开机 4 分钟后起，之后每分钟一次。 |

脚本是纯 `bash` + `curl` + `awk`，**不依赖仓库、不依赖 node**，所以可以单独拷到机器上。
（看门狗要调 `node`，但 `node` 是栈本身就在用的，不算新依赖。）

## 安装

### 1. 写配置文件

```bash
sudo -u customer-agent tee /srv/customer-agent/monitor.env >/dev/null <<'EOF'
FEISHU_ALERT_WEBHOOK=<把飞书机器人 webhook 地址填这里>
EOF
sudo chmod 600 /srv/customer-agent/monitor.env
```

只认 `FEISHU_ALERT_WEBHOOK` 一个键。想探别的地址再加 `CUSTOMER_AGENT_HEALTH_URL=`（默认 `https://agent-auth.jianghua.site/ready`）。
**这两个键此前仓库里都不存在**，是新建的。

### 2. 放脚本与单元文件

```bash
sudo install -m 0644 scripts/ops/customer-agent-stack.service /etc/systemd/system/
sudo install -m 0755 scripts/ops/customer-agent-stack-watchdog.sh /srv/customer-agent/scripts/
sudo install -m 0644 scripts/ops/customer-agent-stack-watchdog.service /etc/systemd/system/
sudo install -m 0644 scripts/ops/customer-agent-stack-watchdog.timer /etc/systemd/system/
sudo install -m 0755 scripts/ops/customer-agent-health-check.sh /srv/customer-agent/scripts/
sudo install -m 0644 scripts/ops/customer-agent-health-check.service /etc/systemd/system/
sudo install -m 0644 scripts/ops/customer-agent-health-check.timer   /etc/systemd/system/
sudo systemctl daemon-reload
```

### 3. 启用

```bash
sudo systemctl enable --now customer-agent-stack.service
sudo systemctl enable --now customer-agent-health-check.timer
sudo systemctl enable --now customer-agent-stack-watchdog.timer
```

### 4. 确认

```bash
systemctl list-timers --all | grep customer-agent
journalctl -u customer-agent-health-check -n 20 --no-pager
journalctl -u customer-agent-stack-watchdog -n 20 --no-pager
```

## 验证（照做一遍，别只看它「在跑」）

```bash
# 1) 现在站点是好的：跑一次不应该有告警，计数文件应为空
sudo -u customer-agent /srv/customer-agent/scripts/customer-agent-health-check.sh; echo "exit=$?"
sudo cat /var/lib/customer-agent/health-failures 2>/dev/null || echo "(尚无计数文件=正确)"

# 2) 手动把计数顶到 2，再跑一次 -> 应发出告警
echo 2 | sudo tee /var/lib/customer-agent/health-failures
sudo -u customer-agent /srv/customer-agent/scripts/customer-agent-health-check.sh; echo "exit=$?"
# 飞书群里应该收到一条；计数变成 3

# 3) 清回去
echo 0 | sudo tee /var/lib/customer-agent/health-failures
```

## 几个刻意的设计，改动前请先读

- **计数文件在 `/var/lib/customer-agent/health-failures`，不在 `/tmp`。**
  单元开了 `PrivateTmp=true`，每次调用都有独立的 `/tmp`，计数会每分钟归零，阈值永远到不了，告警永远不发。
  这是「看起来装了监控」的典型写法，所以有测试专门钉住这个配对。
- **只告警一次（第 3 次），第 4、5 次不再发。** 每次尝试都写 journal，重复发没有新信息。
  恢复后计数清零，下次再出问题会重新告警。
- **脚本永远 `exit 0`（除非配置读不到）。** 非零退出会让单元变成 `failed`，从而分不清「站点挂了」和「监控自己坏了」。
  配置读不到时反而**故意** `exit 1` 并打 FATAL：读不到配置的探针不许伪装成正常探针。
- **脚本不打印 webhook 地址、不打印响应体。**
- **看门狗用 `mkdir` 做锁，不用 `flock`。** `flock` 是 util-linux 的工具，机器上没有的话命令直接失败，而旧写法会把「失败」读成「锁被占用」——于是**每次运行都静默退出 0，看门狗看起来健康却从不工作**。锁在 10 分钟后自动作废，所以一次 `SIGKILL` 不会永久废掉它。
- **看门狗调 `stack.ts start`，不是 `restart`**，且带 `--no-seed`（与栈单元自己的 ExecStart 一致），所以既不会打扰活着的进程，也不会改变已有内容。

## 实测到的一个真实情况（装之前请先看）

2026-09-30 只读核对杭州库：

```
import_batches: failed 20 / 350 行，published 9 / 499 行，staged 1 / 106 行
```

- **20 个失败批次的错误码全是 `MAX_ATTEMPTS_EXHAUSTED`**（内容 worker 重试耗尽），集中在 9/23。
- **那个 staged 批次 `imp_kaVmpuBEfbw8LFAJ9mAbPehU` 从 9/28 起卡住**，106 行既没发布也没清理。
- **`query_events` 最新一条是 9/24**，之后没有新批次 —— 采集侧已停摆约一周。

所以这两个 timer 装上去**大概率立刻会响**。这不是误报：它们要报的正是这个。
