# How to 从远端仓库开发、测试并交付

你会得到一条可回滚的工作流：本地写代码，独立跑合成测试，在 Windows WSL 上临时验收，最后按 Git SHA 部署到生产 release。生产目录只接收完整构建结果，不作为编辑器工作区。

## 前置条件

- Git、SSH 和 Tailscale 已在本机配置。
- 本仓要求 Node.js `24.x` 和 pnpm `11.19.0`。
- 远端有可用的部署 SSH key；不要把 key、`api.env`、`feishu.env` 或生成密码放入仓库。
- WSL 远端具备 `bash`、`curl`、`jq`、`ss`、`flock`、`systemctl` 和 GNU coreutils（`stat -c`、`mv -T`、`install`）；非交互 SSH 的 PATH 必须能找到 Node 24 和 pnpm 11.19.0。生产发布由独立的 `<deploy-user>` SSH key 编排，构建使用另一个没有 sudo、不能读取 `/srv/customer-agent/stack` 的 `<build-user>`；测试归档/构建使用不同的 `<test-operator>` SSH key，该账号没有生产 release、生产 stack 或生产 unit 的 sudo 权限。生产白名单覆盖非交互 sudo 探针、以 `customer-agent` 身份执行只读 Git / 配置检查、软链替换、`chown`、受限 incoming 清理和生产 unit restart；部署账号还需要把 production incoming 交给 `<build-user>` 构建，不能让仓库 lifecycle script 继承发布权限或看到生产 env。测试操作者另需只针对测试 release 的固定 SHA 目录和 incoming 临时目录执行删除、对测试 release / `password-accounts.json` 执行 `chown`，以独立的 `customer-agent-test` 身份运行固定测试账号初始化与只读 `cat` / `jq` / `stat`，以及测试 unit 的 `cat` / `start` / `stop` 权限。`customer-agent-test` 不得读取生产 stack 或拥有生产 sudo 权限；生产 unit 继续使用 `customer-agent`。测试操作者还需要对 `/srv/customer-agent/test-stack/acceptance.lock` 和 `acceptance.active` 有限的写权限；账号初始化、启动和清理同一时间只允许一轮验收。
- 了解 [运行环境、端口与发布目录参考](reference-runtime-ports-and-release-layout.md) 的端口和目录合同。

## 步骤

下面命令中的 `<deploy-user>`、`<build-user>`、`<test-operator>`、`<TAILSCALE_IP>`、`<test-unit>`、`<approved-git-sha>` 和 `<previous-full-sha>` 都是占位符。执行前必须替换为实际值；未替换的命令不可直接粘贴运行。`<build-user>` 必须是没有 sudo、不能读取 `/srv/customer-agent/stack` 的独立账号。

1. 从远端仓库获取代码，在本地建立分支。

   ```bash
   git clone https://github.com/tyuanww/customer-agent-prototype.git
   cd customer-agent-prototype
   git switch -c codex/<short-name>
   export PATH="$(brew --prefix node@24)/bin:$(brew --prefix)/bin:$PATH"
   hash -r
   node -v        # v24.x
   pnpm -v        # 11.19.0
   pnpm install --frozen-lockfile
   pnpm electron:install
   ```

   如果 `node -v` 是 25.x，先在 login shell 中加载 Node 24，再继续。项目的 `engines` 会拒绝把 Node 25 当作受支持环境。

2. 先确认入口和工作树，再开始修改。

   ```bash
   git status --short --branch
   pnpm help:dev
   ```

   不要猜 `serve` 或 `desktop`。根脚本的日常入口是 `pnpm dev`，别名是 `pnpm start`。

3. 在 Mac 上跑本地桌面和受影响检查。

   ```bash
   pnpm dev
   pnpm docs:check       # 改文档或链接时
   pnpm lint
   pnpm typecheck
   ```

   桌面 S0 使用合成 fixture。不要把真实飞书或客户数据复制到仓库，也不要在 renderer 里直连远端数据库。

4. 需要 Windows 客户端验收时，把当前 Git SHA 复制到远端临时目录，使用独立测试端口。

   ```bash
   set -eu
   set -o pipefail
   test -z "$(git status --porcelain)" || { echo 'working tree is not clean; commit or stash before remote acceptance' >&2; exit 1; }
   SHA="$(git rev-parse --verify HEAD^{commit})"
   case "$SHA" in
     *[!0-9a-f]*|'') echo "invalid full Git SHA: $SHA" >&2; exit 1 ;;
   esac
   test "${#SHA}" -eq 40
   git cat-file -e "$SHA^{commit}"
   TRACKED_PATHS="$(git ls-tree -r --name-only "$SHA")"
   if printf '%s\n' "$TRACKED_PATHS" | grep -E '(^|/)([^/]+\.env$|\.env(\.[^/]*)?$|[^/]*(credentials?|secrets?)[^/]*(/|$)|id_(rsa|ed25519)([^/]*)?|service-account[^/]*\.json|.*\.(pem|key|p8|p12|pfx|jks|keystore|tfvars|crt|cer|der|csr|asc|gpg))' >/dev/null; then
     echo 'tracked credential-like path found; inspect the commit before copying it' >&2
     exit 1
   fi
   REMOTE_BASE="/srv/customer-agent/test-releases/$SHA"
   REMOTE_TMP="/srv/customer-agent/test-releases/.incoming-$SHA-$(date +%s)-$RANDOM"
   ssh -i ~/.ssh/id_ed25519_test <test-operator>@<TAILSCALE_IP> \
     "set -eu; test ! -e '$REMOTE_BASE'; mkdir -m 0750 '$REMOTE_TMP'"
   if ! git archive --format=tar "$SHA" |
     ssh -i ~/.ssh/id_ed25519_test <test-operator>@<TAILSCALE_IP> \
       "set -eu; tar -xf - -C '$REMOTE_TMP'; cd '$REMOTE_TMP'; command -v node >/dev/null; command -v pnpm >/dev/null; node -e \"if (Number(process.versions.node.split('.')[0]) !== 24) process.exit(1)\"; test \"\$(pnpm --version)\" = 11.19.0; pnpm install --frozen-lockfile; pnpm build:services; printf '%s\n' '$SHA' > '$REMOTE_TMP/.acceptance-sha'; sudo -n chown -R customer-agent-test:customer-agent-test '$REMOTE_TMP'; mv -T -n '$REMOTE_TMP' '$REMOTE_BASE'; test ! -e '$REMOTE_TMP'"; then
     ssh -i ~/.ssh/id_ed25519_test <test-operator>@<TAILSCALE_IP> "sudo -n rm -rf -- '$REMOTE_TMP'" || echo "incoming cleanup failed; inspect $REMOTE_TMP before retrying" >&2
     exit 1
   fi
   ```

   这段命令先要求工作树干净，再用完整 SHA 导出一个原子可见的临时 release；归档只包含该 SHA 的 tracked 内容，不含 `.git`；远端构建成功后才写入 `.acceptance-sha` 标记，后续初始化和清理通过这个标记确认 release 来源。它不应被当成脱敏工具。提交前仍要运行仓库的凭据扫描，并检查 `git ls-tree` 中没有被强制加入的 `.env`、密钥或凭据。`.gitattributes` 当前没有 `export-ignore` / `export-subst` 规则；如果将来加入，必须重新评审归档与部署方式，确保验收内容和批准 SHA 等价。远端安装与 `build:services` 必须使用 Node 24 和 pnpm 11.19.0；失败时不要启动测试 unit。`mkdir` 会以原子方式创建带随机后缀的临时目录，目录已存在时命令会故意失败，避免覆盖另一轮验收。

   测试栈使用 `43180`（API）和 `43181`（口令身份），生产栈继续使用 `43115` 和 `43116`。测试 unit 必须显式设置 `CUSTOMER_AGENT_STACK_ROOT=/srv/customer-agent/test-stack`，并使用独立的 PG 数据目录、对象目录、env 文件和 systemd unit；不得复用 `/srv/customer-agent/stack`。启动已审阅的测试 unit 前，先确认其 `Environment` / `EnvironmentFile` / `ExecStart` 包含该 stack root，然后核对 `/srv/customer-agent/test-stack/profile.json` 的 `stackRoot`、`pgSocketDirectory`、`objectStoreDirectory` 都在测试 stack 下，`databaseName` 不是 `customer_agent_formal`，并且 `apiOrigin`、`identityOrigin` 正好是 `http://127.0.0.1:43180`、`http://127.0.0.1:43181`；任一不匹配就停止，不要靠改客户端端口“凑通”。如果没有能证明这些路径和端口都已替换的测试 unit，先不要启动测试服务。测试结束后停 unit，并确认 `43180/43181` 不再监听。

5. 在远端运行测试账号初始化时，确认当前 release 的 package script 存在。

   ```bash
   ssh -i ~/.ssh/id_ed25519_test <test-operator>@<TAILSCALE_IP> bash -s -- "$SHA" <<'REMOTE'
   set -eu
   SHA="$1"
   case "$SHA" in
     *[!0-9a-f]*|'') echo "invalid full Git SHA: $SHA" >&2; exit 1 ;;
   esac
   test "${#SHA}" -eq 40
   RELEASE="/srv/customer-agent/test-releases/$SHA"
   test "$(sudo -n -u customer-agent-test cat "$RELEASE/.acceptance-sha")" = "$SHA"
   test -d /srv/customer-agent/test-stack
   test ! -L /srv/customer-agent/test-stack
   test "$(readlink -f /srv/customer-agent/test-stack)" = /srv/customer-agent/test-stack
   exec 9>/srv/customer-agent/test-stack/acceptance.lock
   flock -n 9 || { echo 'another test acceptance is running' >&2; exit 1; }
   mkdir -m 0700 /srv/customer-agent/test-stack/acceptance.active
   printf '%s\n' "$SHA" > /srv/customer-agent/test-stack/acceptance.active/sha
   export CUSTOMER_AGENT_STACK_ROOT=/srv/customer-agent/test-stack
   cd "$RELEASE"
   command -v node >/dev/null
   command -v pnpm >/dev/null
   PNPM_BIN="$(command -v pnpm)"
   test -x "$PNPM_BIN"
   sudo -n -u customer-agent-test test -x "$PNPM_BIN"
   sudo -n -u customer-agent-test env "CUSTOMER_AGENT_STACK_ROOT=$CUSTOMER_AGENT_STACK_ROOT" "$PNPM_BIN" run identity:accounts:init
   test "$(sudo -n -u customer-agent-test stat -c '%a' "$CUSTOMER_AGENT_STACK_ROOT/password-accounts.json")" = 600
   test "$(sudo -n -u customer-agent-test stat -c '%U' "$CUSTOMER_AGENT_STACK_ROOT/password-accounts.json")" = customer-agent-test
   REMOTE
   ```

   如果看到 `ERR_PNPM_NO_SCRIPT`，说明当前目录不是包含该脚本的 release，先运行 `pnpm run` 并切到准确的 release；不要把命令加到生产 package.json 临时绕过。脚本只把 scrypt hash 写入测试 stack root 的 `password-accounts.json`（权限 `0600`），终端打印的测试密码只出现一次；不要让 SSH、CI、tmux 或 systemd 日志记录它，也不要在生产 stack root 运行这个脚本。初始化会以原子 `mkdir` 建立跨命令的 `acceptance.active` 租约，持有该租约的一轮验收收尾前不允许下一轮初始化。若初始化、启动或 readiness 检查中断，重试前先执行步骤 6 的停服务与清理命令，确认一次性密码文件和该 SHA 的 release 已删除。

   账号初始化完成后，再启动已安装测试 unit。启动前的检查必须 fail-closed（把 `<test-unit>` 换成实际 unit 名；没有该 unit 就停下，不要临时复制生产 unit）。下面示例要求 unit 直接出现字面量 `Environment=CUSTOMER_AGENT_STACK_ROOT=...`；如果实际 unit 使用 `EnvironmentFile`，必须先读取并审阅被引用文件，再把检查改成等价的显式断言后才能启动：

   ```bash
   ssh -i ~/.ssh/id_ed25519_test <test-operator>@<TAILSCALE_IP> bash -s -- "$SHA" <<'REMOTE'
   set -eu
   SHA="$1"
   case "$SHA" in
     *[!0-9a-f]*|'') echo "invalid full Git SHA: $SHA" >&2; exit 1 ;;
   esac
   test "${#SHA}" -eq 40
   RELEASE="/srv/customer-agent/test-releases/$SHA"
   test "$(sudo -n -u customer-agent-test cat "$RELEASE/.acceptance-sha")" = "$SHA"
   test -d /srv/customer-agent/test-stack
   test ! -L /srv/customer-agent/test-stack
   test "$(readlink -f /srv/customer-agent/test-stack)" = /srv/customer-agent/test-stack
   exec 9>/srv/customer-agent/test-stack/acceptance.lock
   flock -n 9 || { echo 'another test acceptance is running' >&2; exit 1; }
   test "$(cat /srv/customer-agent/test-stack/acceptance.active/sha)" = "$SHA"
   export CUSTOMER_AGENT_STACK_ROOT=/srv/customer-agent/test-stack
   TEST_UNIT=customer-agent-test-stack.service
   UNIT_TEXT="$(sudo -n systemctl cat "$TEST_UNIT")"
   printf '%s\n' "$UNIT_TEXT" | grep -Fq 'Environment=CUSTOMER_AGENT_STACK_ROOT=/srv/customer-agent/test-stack'
   printf '%s\n' "$UNIT_TEXT" | grep -Fq "/srv/customer-agent/test-releases/$SHA"
   printf '%s\n' "$UNIT_TEXT" | grep -Eq '^User=customer-agent-test$'
   if printf '%s\n' "$UNIT_TEXT" | grep -E '/srv/customer-agent/stack([/[:space:]]|$)|43115|43116|customer_agent_formal' >/dev/null; then
     echo 'test unit references production settings; stop and review it' >&2
     exit 1
   fi
   test "$(systemctl show --property=KillMode --value "$TEST_UNIT")" = control-group
   check_test_profile() {
     sudo -n -u customer-agent-test jq -e '
       .stackRoot == "/srv/customer-agent/test-stack"
       and .apiOrigin == "http://127.0.0.1:43180"
       and .identityOrigin == "http://127.0.0.1:43181"
       and .databaseName == "customer_agent_synthetic"
       and .pgSocketDirectory == "/srv/customer-agent/test-stack/data/pg15-socket"
       and .objectStoreDirectory == "/srv/customer-agent/test-stack/objects"
     ' /srv/customer-agent/test-stack/profile.json >/dev/null
   }
   if sudo -n -u customer-agent-test test -e /srv/customer-agent/test-stack/profile.json; then
     check_test_profile
   fi
   if sudo -n -u customer-agent-test test -e /srv/customer-agent/test-stack/content.env; then
     sudo -n -u customer-agent-test grep -Eq '^DATABASE_NAME=customer_agent_synthetic[[:space:]]*$' /srv/customer-agent/test-stack/content.env
   fi
   sudo -n systemctl stop "$TEST_UNIT"
   sudo -n systemctl start "$TEST_UNIT"
   for attempt in $(seq 1 30); do
     if check_test_profile 2>/dev/null \
       && curl --fail --show-error --max-time 5 http://127.0.0.1:43180/ready >/dev/null; then
       break
     fi
     test "$attempt" -lt 30 || { sudo -n systemctl stop "$TEST_UNIT"; exit 1; }
     sleep 2
   done
   REMOTE
   ```

6. 验收前后都检查端口和 readiness。

   下面命令在 Mac 发起 SSH，heredoc 内的端口检查由 Windows 的 WSL 远端执行；不要把 heredoc 内命令单独拿到 Mac shell 检查本机端口。测试 unit 启动且客户端验收期间：

   ```bash
   ssh -i ~/.ssh/id_ed25519_test <test-operator>@<TAILSCALE_IP> bash -s <<'REMOTE'
   set -eu
   READY_PATH=/ready
   curl --fail --show-error --max-time 5 "http://127.0.0.1:43180${READY_PATH}"
   LISTENERS="$(ss -ltnp)"
   assert_loopback() {
     port="$1"
     printf '%s\n' "$LISTENERS" | awk -v port=":$port" '$1 == "LISTEN" && $4 ~ (port "$") { seen=1; if ($4 != "127.0.0.1" port) bad=1 } END { exit(!(seen && !bad)) }'
   }
   assert_loopback 43115
   assert_loopback 43116
   assert_loopback 43180
   assert_loopback 43181
   REMOTE
   ```

   验收期间只能让测试客户端指向测试入口。完成后关闭测试客户端和测试 unit，再运行下面的收尾检查；它会把 `ss` 失败、生产端口消失和测试端口仍在监听都视为失败：

   ```bash
   ssh -i ~/.ssh/id_ed25519_test <test-operator>@<TAILSCALE_IP> bash -s <<'REMOTE'
   set -eu
   TEST_UNIT=customer-agent-test-stack.service
   sudo -n systemctl stop "$TEST_UNIT"
   test_listener() {
     printf '%s\n' "$1" | awk '$1 == "LISTEN" && ($4 ~ /:43180$/ || $4 ~ /:43181$/) { found=1 } END { exit(!found) }'
   }
   for attempt in $(seq 1 30); do
     LISTENERS="$(ss -ltnp)"
     if ! test_listener "$LISTENERS"; then break; fi
     test "$attempt" -lt 30 || { echo 'test stack did not stop listening' >&2; exit 1; }
     sleep 2
   done
   LISTENERS="$(ss -ltnp)"
   assert_loopback() {
     port="$1"
     printf '%s\n' "$LISTENERS" | awk -v port=":$port" '$1 == "LISTEN" && $4 ~ (port "$") { seen=1; if ($4 != "127.0.0.1" port) bad=1 } END { exit(!(seen && !bad)) }'
   }
   assert_loopback 43115
   assert_loopback 43116
   if test_listener "$LISTENERS"; then
     echo 'test stack is still listening' >&2
     exit 1
   fi
   REMOTE
   ```

   测试端口已经停止监听后，用同一个测试操作者、在独占锁内删除一次性凭据和该 SHA 的临时 release；stack 的 PG 数据目录是否保留要按测试留存策略单独决定。清理不依赖生产 readiness，避免生产故障时把测试密码留在共享主机上：

   ```bash
   ssh -i ~/.ssh/id_ed25519_test <test-operator>@<TAILSCALE_IP> bash -s <<'REMOTE'
   set -eu
   test -f /srv/customer-agent/test-stack/acceptance.active/sha
   SHA="$(cat /srv/customer-agent/test-stack/acceptance.active/sha)"
   case "$SHA" in
     *[!0-9a-f]*|'') echo "invalid full Git SHA: $SHA" >&2; exit 1 ;;
   esac
   test "${#SHA}" -eq 40
   RELEASE="/srv/customer-agent/test-releases/$SHA"
   test -d /srv/customer-agent/test-stack
   test ! -L /srv/customer-agent/test-stack
   test "$(readlink -f /srv/customer-agent/test-stack)" = /srv/customer-agent/test-stack
   exec 9>/srv/customer-agent/test-stack/acceptance.lock
   flock -n 9 || { echo 'another test acceptance is running' >&2; exit 1; }
   test "$(cat /srv/customer-agent/test-stack/acceptance.active/sha)" = "$SHA"
   if [ -e "$RELEASE" ] || [ -L "$RELEASE" ]; then
     test -d "$RELEASE"
     test ! -L "$RELEASE"
     test "$(sudo -n -u customer-agent-test cat "$RELEASE/.acceptance-sha")" = "$SHA"
   fi
   sudo -n systemctl stop customer-agent-test-stack.service
   LISTENERS="$(ss -ltnp)"
   if printf '%s\n' "$LISTENERS" | awk '$1 == "LISTEN" && ($4 ~ /:43180$/ || $4 ~ /:43181$/) { found=1 } END { exit(!found) }'; then
     echo 'test stack is still listening; do not delete its release' >&2
     exit 1
   fi
   sudo -n rm -f /srv/customer-agent/test-stack/password-accounts.json
   sudo -n rm -rf -- "$RELEASE"
   test ! -e "$RELEASE"
   test ! -e /srv/customer-agent/test-stack/password-accounts.json
   rm /srv/customer-agent/test-stack/acceptance.active/sha
   rmdir /srv/customer-agent/test-stack/acceptance.active
   echo 'test credentials, release, and acceptance lease cleaned'
   REMOTE
   ```

   这段清理也适用于中断后 release 已经不存在、但租约仍保留的情况：使用 `acceptance.active/sha` 记录的原 SHA 收尾，不要用另一轮 SHA 覆盖租约。清理完成后单独运行生产 readiness 检查；失败表示生产故障，不要因此重试删除：

   ```bash
   ssh -i ~/.ssh/id_ed25519_test <test-operator>@<TAILSCALE_IP> \
     'curl --fail --show-error --max-time 5 http://127.0.0.1:43115/ready'
   ```

7. 部署已验收的 SHA 时创建新的 production release，不在 `current` 中原地拉代码。

   先确认本次 migration 已做向后兼容评审，并且生产 PG 有可恢复的最新备份 / 快照；readiness 回滚只能切回代码和进程，不能撤销已经提交的 schema 变更。部署账号是受限的非 root 编排账号：它只通过 `sudo -n` 的白名单规则执行目录准备、软链替换、`chown` 和生产 `systemctl restart`；clone、依赖安装和构建脚本都必须以没有 sudo、不能读取生产 stack 的 `<build-user>` 身份运行，避免仓库 lifecycle script 继承切换权限或读取生产凭据。先用 `sudo -n true` 验证不会等待交互式密码；不要以 root 或 `customer-agent` 运行 `pnpm install` / 构建脚本。审批过的完整 SHA 必须已推送到 GitHub，部署前必须确认当前 release 没有未备份的本地修改，并预先配置 deploy lock 文件的写权限。下面整段切换脚本必须以 `<deploy-user>` 身份在 WSL 本机的持久 `tmux` / `screen` 会话中执行，避免 Mac 到 WSL 的 SSH 断开后留下半完成状态；如果会话断开，重新连接后先执行步骤 8 核对 current、unit 和 readiness，再决定是否重试。

   ```bash
   SHA="<approved-git-sha>"
   case "$SHA" in
     *[!0-9a-f]*|'') echo "invalid full Git SHA: $SHA" >&2; exit 1 ;;
   esac
   test "${#SHA}" -eq 40
   bash -s -- "$SHA" <<'REMOTE'
   set -eu
   SHA="$1"
   case "$SHA" in
     *[!0-9a-f]*|'') echo "invalid full Git SHA: $SHA" >&2; exit 1 ;;
   esac
   test "${#SHA}" -eq 40
   CURRENT="/srv/customer-agent/current"
   RELEASES="/srv/customer-agent/releases"
   STACK_ROOT="/srv/customer-agent/stack"
   BUILD_USER="<build-user>"
   exec 9>/srv/customer-agent/deploy.lock
   flock -n 9 || { echo 'another deployment is running' >&2; exit 1; }
   sudo -n true
   test -L "$CURRENT"
   sudo -n -u customer-agent git -C "$CURRENT" rev-parse --is-inside-work-tree >/dev/null
   DIRTY="$(sudo -n -u customer-agent git -C "$CURRENT" status --short)"
   test -z "$DIRTY" || test "$DIRTY" = ' M apps/desktop/assets/app-icon.png'
   PREVIOUS="$(readlink -f "$CURRENT")"
   if [ "$DIRTY" = ' M apps/desktop/assets/app-icon.png' ]; then
     sudo -n install -D -m 0600 "$CURRENT/apps/desktop/assets/app-icon.png" "/srv/customer-agent/backups/app-icon-$SHA.png"
   fi
   DEST="$RELEASES/$SHA"
   INCOMING="$RELEASES/.incoming-$SHA-$$"
   test ! -e "$DEST" && test ! -e "$INCOMING"
   trap 'sudo -n rm -rf -- "$INCOMING"' EXIT
   sudo -n install -d -o "$BUILD_USER" -g "$BUILD_USER" -m 0750 "$INCOMING"
   sudo -n -u "$BUILD_USER" git clone https://github.com/tyuanww/customer-agent-prototype.git "$INCOMING"
   sudo -n -u "$BUILD_USER" git -C "$INCOMING" checkout --detach "$SHA"
   sudo -n -u "$BUILD_USER" env PATH="$PATH" sh -s -- "$INCOMING" <<'BUILD'
   set -eu
   INCOMING="$1"
   cd "$INCOMING"
   command -v node >/dev/null
   command -v pnpm >/dev/null
   node -e "if (Number(process.versions.node.split('.')[0]) !== 24) process.exit(1)"
   test "$(pnpm --version)" = 11.19.0
   pnpm install --frozen-lockfile
   pnpm build:services
   test -z "$(git status --porcelain --untracked-files=no)"
   BUILD
   for file in content.env api.env feishu.env password-accounts.json profile.json; do
     sudo -n -u customer-agent test -f "$STACK_ROOT/$file"
     test "$(sudo -n -u customer-agent stat -c '%a' "$STACK_ROOT/$file")" = 600
     test "$(sudo -n -u customer-agent stat -c '%U' "$STACK_ROOT/$file")" = customer-agent
   done
   test "$(sudo -n -u customer-agent jq -r .stackRoot "$STACK_ROOT/profile.json")" = "$STACK_ROOT"
   test "$(sudo -n -u customer-agent jq -r .apiOrigin "$STACK_ROOT/profile.json")" = http://127.0.0.1:43115
   test "$(sudo -n -u customer-agent jq -r .identityOrigin "$STACK_ROOT/profile.json")" = http://127.0.0.1:43116
   test "$(sudo -n -u customer-agent jq -r .databaseName "$STACK_ROOT/profile.json")" = customer_agent_formal
   test "$(sudo -n -u customer-agent jq -r .pgPort "$STACK_ROOT/profile.json")" = 43199
   test "$(sudo -n -u customer-agent jq -r .pgSocketDirectory "$STACK_ROOT/profile.json")" = "$STACK_ROOT/data/pg15-socket"
   test "$(sudo -n -u customer-agent jq -r .objectStoreDirectory "$STACK_ROOT/profile.json")" = "$STACK_ROOT/objects"
   sudo -n -u customer-agent grep -Eq '^DATABASE_NAME=customer_agent_formal[[:space:]]*$' "$STACK_ROOT/content.env"
   sudo -n chown -R customer-agent:customer-agent "$INCOMING"
   sudo -n mv -T "$INCOMING" "$DEST"
   trap - EXIT
   NEXT_LINK="/srv/customer-agent/current.next.$$"
   test ! -e "$NEXT_LINK" && test ! -L "$NEXT_LINK"
   sudo -n ln -s "$DEST" "$NEXT_LINK"
   sudo -n mv -Tf "$NEXT_LINK" "$CURRENT"
   test "$(readlink -f "$CURRENT")" = "$DEST"
   test "$(sudo -n -u customer-agent git -C "$CURRENT" rev-parse HEAD)" = "$SHA"
   READY_PATH=/ready
   ready=0
   if sudo -n systemctl restart customer-agent-stack.service; then
     for attempt in $(seq 1 30); do
       if curl --fail --show-error --max-time 5 "http://127.0.0.1:43115${READY_PATH}"; then ready=1; break; fi
       sleep 2
     done
   fi
   if [ "$ready" -ne 1 ]; then
     ROLLBACK_LINK="/srv/customer-agent/current.rollback.$$"
     test ! -e "$ROLLBACK_LINK" && test ! -L "$ROLLBACK_LINK"
     sudo -n ln -s "$PREVIOUS" "$ROLLBACK_LINK"
     sudo -n mv -Tf "$ROLLBACK_LINK" "$CURRENT"
     if ! sudo -n systemctl restart customer-agent-stack.service; then
       echo 'rollback restart failed; stop and inspect the service' >&2
       exit 1
     fi
     rollback_ready=0
     for attempt in $(seq 1 30); do
       if curl --fail --show-error --max-time 5 "http://127.0.0.1:43115${READY_PATH}"; then rollback_ready=1; break; fi
       sleep 2
     done
     test "$rollback_ready" -eq 1 || { echo 'rollback readiness failed; stop and inspect the service' >&2; exit 1; }
     test -d "$DEST" && test ! -L "$DEST"
     test "$(sudo -n -u customer-agent git -C "$DEST" rev-parse HEAD)" = "$SHA"
     FAILED="$RELEASES/.failed-$SHA-$(date +%s)-$$"
     test ! -e "$FAILED" && test ! -L "$FAILED"
     sudo -n mv -T "$DEST" "$FAILED"
     echo "rollback complete; failed build retained at $FAILED" >&2
     exit 1
   fi
   REMOTE
   ```

   这一步只在部署授权覆盖该 SHA 时执行。`content.env` 必须明确声明 `customer_agent_formal`，并且生产 `profile.json` 的 stack root、API 和身份 origin 必须仍对应 `/srv/customer-agent/stack`、`43115` 和 `43116`；任一 env 文件缺失、权限不是 `0600` 或 profile 不一致都会在切换前失败，避免误启动合成 seed。`flock` 防止两次部署同时切换；临时目录构建失败由 trap 清理，完整目录才会进入 `releases`；readiness 回滚成功后，失败产物改名为 `.failed-*` 保留诊断现场，原 SHA 路径释放以便重试。`mv -Tf` 在 Linux 上用临时软链替换 `current`，切换后立即核对目标 SHA，readiness 失败就恢复 `PREVIOUS` 并重启；回滚也失败时必须停下人工处理。发现 current 有未知本地修改时，命令会直接退出，不能覆盖；已备案的 `apps/desktop/assets/app-icon.png` 特例不属于生产 API 运行时输入。

8. 记录部署后的证据。

   下面命令在 Mac 发起 SSH，核对由 WSL 远端执行：

   ```bash
   ssh -i ~/.ssh/id_ed25519_pc2 <deploy-user>@<TAILSCALE_IP> bash -s <<'REMOTE'
   set -eu
   readlink -f /srv/customer-agent/current
   sudo -n -u customer-agent git -C /srv/customer-agent/current rev-parse HEAD
   sudo -n -u customer-agent git -C /srv/customer-agent/current status --short
   systemctl is-active customer-agent-stack.service
   READY_PATH=/ready
   curl --fail --show-error --max-time 5 "http://127.0.0.1:43115${READY_PATH}"
   REMOTE
   ```

## Verification

代码改动至少按 [如何验证桌面](how-to-verify-desktop.md) 选择检查。当前基线的关键证据包括：Node 24 + pnpm 11.19.0、合成栈桌面 E2E 通过、`pnpm lint`、`pnpm typecheck`、Windows `0.3.25` local-unsigned 包后验通过，以及生产 `43115` readiness 保持 `200`。

Windows 包仍是未签名包。包结构后验不等于真实安装、企业策略、签名、公证或自动更新验收，边界见 [打包与签名](reference-packaging-and-signing.md)。

## Troubleshooting

### `pnpm` 报 `ERR_PNPM_NO_SCRIPT`

先运行 `pnpm help:dev` 和 `pnpm run`，确认所在目录和当前 SHA。部署 release 与测试 release 不一定包含同一批辅助脚本，不能用“看起来像当前版本”的目录代替准确 SHA。

### 生产 readiness 失败

先只读检查 `systemctl is-active`、`ss` 和 `journalctl -u customer-agent-stack.service -n 80 --no-pager`。不要直接重播 seed、删除 PG 数据或覆盖 `api.env`。如果只是 API 子进程退出，当前 watchdog 仍是已知缺口，按 [TODOS.md](../TODOS.md) 的运维债处理。

### 切换脚本中断后的手动回滚

如果 WSL 的持久会话在软链切换后中断，先不要重试部署。登录 WSL 后确认 `current`、服务状态和 readiness，再把已知的上一个完整 release 目录填入 `PREVIOUS`，并在同一个 deploy lock 内执行下面的 fail-closed 回滚；`PREVIOUS` 必须是 40 位 SHA 目录，不能是软链：

```bash
set -eu
PREVIOUS="/srv/customer-agent/releases/<previous-full-sha>"
test -d "$PREVIOUS"
test ! -L "$PREVIOUS"
test "$(sudo -n -u customer-agent git -C "$PREVIOUS" rev-parse HEAD)" = "$(basename "$PREVIOUS")"
exec 9>/srv/customer-agent/deploy.lock
flock -n 9 || { echo 'another deployment is running' >&2; exit 1; }
CURRENT=/srv/customer-agent/current
ROLLBACK_LINK="/srv/customer-agent/current.rollback.manual.$$"
test ! -e "$ROLLBACK_LINK" && test ! -L "$ROLLBACK_LINK"
sudo -n ln -s "$PREVIOUS" "$ROLLBACK_LINK"
sudo -n mv -Tf "$ROLLBACK_LINK" "$CURRENT"
sudo -n systemctl restart customer-agent-stack.service
curl --fail --show-error --max-time 5 http://127.0.0.1:43115/ready >/dev/null
```

如果 readiness 仍失败，停下保留现场并人工处理；不要删除 `PREVIOUS`、PG 数据或私有 env。

### 远端目录占满磁盘

先运行 `du -sh /srv/customer-agent/releases/*` 和 [空间参考](reference-runtime-ports-and-release-layout.md) 的检查。保留当前 release、上一个验收版本和备份，再单独审批旧目录清理；不要把 `node_modules` 或 `release` 的清理命令套到 `/srv/customer-agent/stack`。

## 相关

- [运行环境、端口与发布目录参考](reference-runtime-ports-and-release-layout.md)
- [为什么开发、测试和生产要分开](explanation-environment-boundaries.md)
- [杭州后端操作手册](how-to-run-backend-on-hangzhou.md)
- [第一次运行](tutorial-first-run.md)
