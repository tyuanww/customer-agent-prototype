#!/usr/bin/env bash
set -euo pipefail

# 部署 0074 迁移到杭州环境
# 用法: ./deploy-0074-to-hangzhou.sh

SHA="56497a9a85107941b410d2f0cfe86ca335e94dd5"
REMOTE_HOST="root@100.93.46.46"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519_pc2}"

echo "=== 部署 0074 迁移到杭州 ==="
echo "SHA: $SHA"
echo "远程主机: $REMOTE_HOST"
echo ""

# 1. 创建 bundle
echo "[1/5] 创建 Git bundle..."
git bundle create "/tmp/${SHA}.bundle" HEAD
git bundle list-heads "/tmp/${SHA}.bundle"

# 2. 传输到杭州
echo ""
echo "[2/5] 传输 bundle 到杭州..."
scp -i "$SSH_KEY" "/tmp/${SHA}.bundle" "${REMOTE_HOST}:/var/lib/ca-build/${SHA}.bundle"

# 3. 在杭州部署
echo ""
echo "[3/5] 在杭州解包并构建..."
ssh -i "$SSH_KEY" "$REMOTE_HOST" bash -s -- "$SHA" <<'EOF'
set -eu
SHA="$1"
DEST="/srv/customer-agent/releases/$SHA"

echo "  → 清理旧目录..."
rm -rf "$DEST"
mkdir -p "$DEST"

echo "  → 初始化 Git 仓库..."
git -C "$DEST" init -b scratch
git -C "$DEST" fetch "/var/lib/ca-build/${SHA}.bundle" HEAD:refs/heads/main
git -C "$DEST" checkout "$SHA"

echo "  → 安装依赖..."
cd "$DEST"
pnpm install --frozen-lockfile

echo "  → 构建服务..."
# 跳过 database 的生成器检查，只构建运行时
pnpm --filter @customer-agent/contracts build
pnpm --filter @customer-agent/retrieval-core build
pnpm --filter @customer-agent/job-roster build
pnpm --filter @customer-agent/content-intake build
pnpm --filter @customer-agent/database build:runtime
pnpm --filter @customer-agent/api build

echo "  → 设置权限..."
chown -R customer-agent:customer-agent "$DEST"

echo "  → 切换软链..."
ln -sfn "$DEST" /srv/customer-agent/current

echo "  → 重启服务（会自动应用迁移）..."
systemctl restart customer-agent-stack

echo ""
echo "部署完成！"
EOF

# 4. 验证健康状态
echo ""
echo "[4/5] 验证健康状态..."
sleep 5
ssh -i "$SSH_KEY" "$REMOTE_HOST" 'curl --fail --show-error --max-time 5 http://127.0.0.1:43115/health'

# 5. 验证端点
echo ""
echo "[5/5] 验证 API 端点..."
ssh -i "$SSH_KEY" "$REMOTE_HOST" bash <<'VERIFY'
echo "  → /v1/intake/sources:"
curl --silent --output /dev/null --write-out '%{http_code}\n' --max-time 5 http://127.0.0.1:43115/v1/intake/sources

echo "  → /v1/events/usage:"
curl --silent --output /dev/null --write-out '%{http_code}\n' --max-time 5 http://127.0.0.1:43115/v1/events/usage

echo ""
echo "当前软链:"
readlink -f /srv/customer-agent/current
VERIFY

echo ""
echo "=== 部署完成 ==="
echo ""
echo "查看日志: ssh -i $SSH_KEY $REMOTE_HOST 'journalctl -u customer-agent-stack -n 50'"
echo "回滚命令: ssh -i $SSH_KEY $REMOTE_HOST 'ln -sfn /srv/customer-agent/releases/<old-sha> /srv/customer-agent/current && systemctl restart customer-agent-stack'"
