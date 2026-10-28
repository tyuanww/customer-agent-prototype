# 服务端规范化操作手册

**目标环境**：杭州 Linux 生产服务器  
**服务名称**：customer-agent-stack  
**操作时间**：建议在业务低峰期执行（预计停机时间 < 5 分钟）

---

## 前置检查

在执行任何操作前，先确认以下信息：

```bash
# 1. 确认当前服务状态
sudo systemctl status customer-agent-stack

# 2. 确认当前 release 软链指向
ls -l /srv/customer-agent/current

# 3. 备份当前配置（如果有）
sudo cp -r /srv/customer-agent/current /srv/customer-agent/backup-$(date +%Y%m%d-%H%M%S)

# 4. 确认目标提交存在
cd /srv/customer-agent/releases
ls -ld 5e9b9d99 5e9b9d996481f9da8a2cbd8a0de5bab58d85d15a 2>/dev/null || echo "目标目录不存在"
```

---

## 操作步骤

### 步骤 1：停止服务

```bash
sudo systemctl stop customer-agent-stack

# 验证服务已停止
sudo systemctl status customer-agent-stack | grep "Active:"
```

**预期输出**：`Active: inactive (dead)`

---

### 步骤 2：创建规范的 release 目录

```bash
# 切换到 customer-agent 用户（或使用 sudo -u customer-agent）
sudo -u customer-agent mkdir -p /srv/customer-agent/releases/5e9b9d996481f9da8a2cbd8a0de5bab58d85d15a
```

---

### 步骤 3：复制内容到新目录

```bash
# 如果旧目录 5e9b9d99 存在且有内容
if [ -d /srv/customer-agent/releases/5e9b9d99 ]; then
  sudo cp -a /srv/customer-agent/releases/5e9b9d99/* \
    /srv/customer-agent/releases/5e9b9d996481f9da8a2cbd8a0de5bab58d85d15a/
  echo "内容已复制"
else
  echo "警告：旧目录不存在，请手动部署新版本"
fi
```

---

### 步骤 4：更新 current 软链

```bash
# 原子性更新软链（-n 避免嵌套，-f 强制覆盖）
sudo ln -snf /srv/customer-agent/releases/5e9b9d996481f9da8a2cbd8a0de5bab58d85d15a \
  /srv/customer-agent/current

# 验证软链
ls -l /srv/customer-agent/current
```

**预期输出**：软链应指向完整 SHA 目录

---

### 步骤 5：验证目录权限

```bash
# 检查属主和权限
ls -ld /srv/customer-agent/releases/5e9b9d996481f9da8a2cbd8a0de5bab58d85d15a
ls -ld /srv/customer-agent/current

# 如果属主不是 customer-agent，修复：
# sudo chown -R customer-agent:customer-agent /srv/customer-agent/releases/5e9b9d996481f9da8a2cbd8a0de5bab58d85d15a
```

**预期输出**：属主应为 `customer-agent:customer-agent`

---

### 步骤 6：启动服务

```bash
sudo systemctl start customer-agent-stack

# 等待 5 秒让服务完全启动
sleep 5
```

---

### 步骤 7：验证服务状态

```bash
# 检查 systemd 状态
sudo systemctl status customer-agent-stack

# 检查 API 健康
curl -s http://127.0.0.1:43115/health | jq

# 检查最近日志
sudo journalctl -u customer-agent-stack --since "1 minute ago" --no-pager | tail -20
```

**预期输出**：

- systemd 状态：`Active: active (running)`
- `/health` 返回：`{"status":"ok", ...}`
- 日志中无错误或崩溃信息

---

### 步骤 8：验证 PostgreSQL 连接

```bash
# 使用服务配置的 socket 路径测试连接
psql -h /srv/customer-agent/stack/data/pg15-socket -p 43199 \
  -U runtime -d customer_agent_formal -c "\conninfo"
```

**预期输出**：显示连接信息，无权限或连接错误

---

### 步骤 9：功能验证（可选）

如果有测试账号，可以：

```bash
# 1. 测试身份服务
curl -X POST http://127.0.0.1:43112/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"test","password":"test"}'

# 2. 测试授权判定（需要有效 token）
# 参考 docs/operations/2026-10-27-migration-0074-ledger-fix.md 中的 SQL 测试
```

---

## 回滚方案

如果新版本出现问题，立即回滚：

```bash
# 1. 停止服务
sudo systemctl stop customer-agent-stack

# 2. 恢复旧软链（假设备份目录是 backup-20261027-233000）
sudo ln -snf /srv/customer-agent/backup-20261027-233000 \
  /srv/customer-agent/current

# 3. 启动服务
sudo systemctl start customer-agent-stack

# 4. 验证
sudo systemctl status customer-agent-stack
curl -s http://127.0.0.1:43115/health | jq
```

---

## 清理旧版本（可选）

**警告**：确认新版本稳定运行至少 24 小时后再执行清理。

```bash
# 列出所有 release 目录
ls -lh /srv/customer-agent/releases/

# 删除旧的短 SHA 目录（如 5e9b9d99）
# sudo rm -rf /srv/customer-agent/releases/5e9b9d99

# 保留最近 3 个版本，删除更早的
# （需要根据实际情况手动判断）
```

---

## 后续维护

### systemd 自动重启配置

确保服务配置了自动重启：

```bash
sudo systemctl cat customer-agent-stack | grep -A3 "\[Service\]"
```

应包含：

```ini
[Service]
Restart=on-failure
RestartSec=5s
```

如果没有，编辑服务文件：

```bash
sudo systemctl edit --full customer-agent-stack
```

添加上述配置，然后：

```bash
sudo systemctl daemon-reload
sudo systemctl restart customer-agent-stack
```

### 开机自启

```bash
sudo systemctl enable customer-agent-stack
```

---

## 故障排查

### 问题 1：服务启动后立即退出

**可能原因**：

- PostgreSQL 未启动或 socket 路径错误
- 端口 43115/43112 被占用
- 环境变量缺失

**排查命令**：

```bash
# 查看完整启动日志
sudo journalctl -u customer-agent-stack --since "5 minutes ago" --no-pager

# 检查端口占用
sudo netstat -tlnp | grep -E '43115|43112|43199'

# 检查 PostgreSQL 进程
ps aux | grep postgres
```

### 问题 2：/health 返回 503

**可能原因**：

- 数据库连接失败
- migration 未应用或有冲突
- 权威来源（如配置或依赖服务）不可达

**排查命令**：

```bash
# 检查数据库是否可连接
psql -h /srv/customer-agent/stack/data/pg15-socket -p 43199 \
  -U runtime -d customer_agent_formal -c "SELECT 1;"

# 检查 migration 状态
psql -h /srv/customer-agent/stack/data/pg15-socket -p 43199 \
  -U runtime -d customer_agent_formal \
  -c "SELECT position, id FROM customer_agent_formal.content_intake.schema_migrations ORDER BY position DESC LIMIT 5;"
```

### 问题 3：Authorization deadline 返回 NULL

**参考文档**：`docs/operations/2026-10-27-migration-0074-ledger-fix.md`

---

## 联系方式

- **技术负责人**：（待填写）
- **紧急联系**：（待填写）
- **文档位置**：`/Users/hutou/Desktop/customer-agent-prototype/docs/operations/`

---

**最后更新**：2026-10-27  
**版本**：1.0
