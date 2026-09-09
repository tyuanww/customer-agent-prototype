#!/bin/zsh

# Double-click launcher for the local synthetic customer-agent client.
# Keep this file beside package.json so it remains portable with the folder.
#
# It starts the local synthetic stack (isolated PostgreSQL 15 cluster, synthetic
# identity provider, API, worker, seeded content) and then the Electron client,
# both pointing at the same resolved loopback origins. Nothing here installs
# dependencies, touches the user's own PostgreSQL installation, or reaches the
# network beyond the local package registry already installed.

set -u

PROJECT_ROOT="${0:A:h}"
cd "$PROJECT_ROOT" || exit 1

# Prefer the project's supported Node 24 installation on this development Mac.
export PATH="/Users/hutou/homebrew/opt/node@24/bin:/Users/hutou/homebrew/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

print "客服 Agent 合成客户端"
print "目录: $PROJECT_ROOT"
print "边界: 纯合成数据 · 本机 loopback · 复制≠发送"
print "说明: docs/how-to-verify-desktop.md"

pause_and_exit() {
  print -u2 "$1"
  read -r "?按回车关闭..."
  exit "${2:-1}"
}

if ! command -v node >/dev/null 2>&1; then
  pause_and_exit "未找到 Node.js。请安装 Node 24 后重试。"
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [[ "$NODE_MAJOR" != "24" ]]; then
  pause_and_exit "当前 Node.js 是 $(node --version)，项目要求 Node 24.x。"
fi

if ! command -v pnpm >/dev/null 2>&1; then
  pause_and_exit "未找到 pnpm。请安装 pnpm 后重试。"
fi

if [[ ! -x "$PROJECT_ROOT/apps/desktop/node_modules/.bin/electron-vite" ]]; then
  pause_and_exit "项目依赖尚未安装。请先运行：
  pnpm install --frozen-lockfile
  pnpm electron:install"
fi

print ""
print "正在准备本机合成环境（首次启动会初始化隔离数据库，请稍候）..."
if ! node scripts/synthetic-stack/stack.ts start; then
  print -u2 ""
  print -u2 "合成环境启动失败。上面 [stack] 行给出了具体原因。"
  print -u2 "可用诊断：node scripts/synthetic-stack/stack.ts status"
  print -u2 "日志目录：$HOME/.customer-agent-synthetic-stack/logs"
  read -r "?按回车关闭..."
  exit 1
fi

# Resolve the origins from the single stack profile rather than hardcoding them,
# so the client always follows whatever the stack actually started.
DESKTOP_ENV="$(node scripts/synthetic-stack/stack.ts desktop)" || pause_and_exit "无法读取合成环境配置。"
print ""
print "正在启动 Electron 客户端（Ctrl-C 可停止客户端；合成环境仍在后台运行）..."
print "停止合成环境：node scripts/synthetic-stack/stack.ts stop"

eval "export ${DESKTOP_ENV%% pnpm*}"
pnpm dev
STATUS=$?

print ""
print "客户端已退出，状态码: $STATUS"
print "合成环境仍在运行。如需一并停止：node scripts/synthetic-stack/stack.ts stop"
read -r "?按回车关闭..."
exit "$STATUS"
