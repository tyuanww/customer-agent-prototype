#!/bin/zsh

# Double-click launcher for the local Electron demo.
# Keep this file beside package.json so it remains portable with the folder.

set -u

PROJECT_ROOT="${0:A:h}"
cd "$PROJECT_ROOT" || exit 1

# Prefer the project's supported Node 24 installation on this development Mac.
# The launcher deliberately does not install dependencies or change global caches.
export PATH="/Users/hutou/homebrew/opt/node@24/bin:/Users/hutou/homebrew/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

print "客服 Agent Demo"
print "目录: $PROJECT_ROOT"
print "边界: 合成数据 · 无后端 · 无正式 API adapter · 复制≠发送"
print "衔接缺口: docs/reference-api-adapter-handoff.md"

if ! command -v node >/dev/null 2>&1; then
  print -u2 "未找到 Node.js。请安装 Node 24 后重试。"
  read -r "?按回车关闭..."
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [[ "$NODE_MAJOR" != "24" ]]; then
  print -u2 "当前 Node.js 是 $(node --version)，项目要求 Node 24.x。"
  read -r "?按回车关闭..."
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  print -u2 "未找到 pnpm。请安装 pnpm 后重试。"
  read -r "?按回车关闭..."
  exit 1
fi

if [[ ! -x "$PROJECT_ROOT/apps/desktop/node_modules/.bin/electron-vite" ]]; then
  print -u2 "项目依赖尚未安装。请先运行："
  print -u2 "  pnpm install --frozen-lockfile"
  print -u2 "  pnpm electron:install"
  read -r "?按回车关闭..."
  exit 1
fi

print "正在启动 Electron 开发模式（Ctrl-C 可停止）..."
pnpm dev
STATUS=$?

print ""
print "开发进程已退出，状态码: $STATUS"
read -r "?按回车关闭..."
exit "$STATUS"
