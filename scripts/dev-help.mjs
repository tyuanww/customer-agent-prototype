#!/usr/bin/env node
/**
 * Golden-path helper for a missing or unknown root script.
 * `pnpm help:dev` is the recovery command documented in README / CONTRIBUTING.
 */
const text = `客服话术浮窗 Demo · 开发入口

第一次看到狐狸头：
  export PATH="$HOME/homebrew/opt/node@24/bin:$HOME/homebrew/bin:$PATH"
  node -v          # v24.x
  pnpm -v          # 11.19.x
  pnpm install --frozen-lockfile
  pnpm electron:install
  pnpm dev         # 或 pnpm start；会先准备 contracts runtime
  # 手动启动合成栈 / API 时：pnpm build:services
  # macOS 也可双击 启动客服Agent.command（会自动准备服务运行时）

若刚才看到 ERR_PNPM_NO_SCRIPT / Missing script：
  1. 这个名字不是仓根脚本。先跑：pnpm run
  2. 日常入口是 pnpm dev（别名 pnpm start），不是 pnpm serve / pnpm desktop
  3. 验证命令按「要证明什么」选：pnpm docs:check · pnpm typecheck · pnpm lint
  4. 逐步说明：docs/tutorial-first-run.md
  5. 贡献约定：CONTRIBUTING.md

文档写错了或命令对不上：
  GitHub Issues → 模板「文档」或「缺陷」
`;

process.stdout.write(text);
if (process.argv.includes('--check')) {
  const required = [
    'pnpm dev',
    'pnpm start',
    'pnpm build:services',
    'ERR_PNPM_NO_SCRIPT',
    'docs/tutorial-first-run.md',
    'CONTRIBUTING.md',
  ];
  const missing = required.filter((item) => !text.includes(item));
  if (missing.length > 0) {
    process.stderr.write(`dev-help missing: ${missing.join(', ')}\n`);
    process.exit(1);
  }
}
