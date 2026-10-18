# 为什么开发、测试和生产要分开

这套产品同时包含 Electron 桌面端、合成测试栈和带受控数据的远端 API。把它们放进同一个工作树或同一个端口，看起来省步骤，实际会让代码、凭据、数据库和验收结果互相污染。现在的设计用目录、端口和进程身份把这些边界固定住。

## 三条边界

```text
Mac 本地代码 / 合成 fixture
        │ git SHA + 可复现构建
        ▼
Windows WSL 测试栈 43180/43181  ──> Windows 测试客户端
        │ 验收通过后停用
        │ 明确部署动作
        ▼
Windows WSL 生产栈 43115/43116 ──> 受控 HTTPS 隧道 ──> 办公机客户端
```

Mac 是开发边界，WSL 是部署和验收边界。生产 API 与 PG 只在 WSL 内监听 loopback；客户端经受控入口访问，不直接连接数据库。测试栈即使和生产在同一台 Windows 主机，也必须使用独立的 stack root、数据库、对象目录和 systemd unit。

## 为什么不能直接在生产目录写代码

生产目录的职责是保存一个可回滚的构建输入。直接在 `/srv/customer-agent/current` 修改会造成三个问题：运行中的进程可能读到半套文件；Git SHA 不再代表实际运行内容；回滚软链也无法回到修改前的精确状态。当前生产目录还有一处已存在的图标本地修改，这正是不能用 `git pull` 或覆盖复制来更新的例子。

正确做法是本地从远端拉取、切分支、开发和验证；部署时按一个完整 Git SHA 创建新的 release 目录，安装锁定依赖，构建服务，再原子切换 `current` 软链。这样每个运行版本都能回答“哪一个提交、哪一套依赖、哪一次 readiness 检查”。

## 为什么 loopback 仍然需要身份校验

loopback 只限制网络范围，不能证明请求者是谁。生产 API 当前通过产品会话、角色和能力规则授权；口令身份服务只绑定生产 API。把 API 从 loopback 搬到公网或仅靠隧道，并不会自动补上可信身份来源，所以远端访问准入和真实身份接入必须单独评审。

## 为什么测试不能证明生产已验收

测试栈可以证明合成 fixture、端口隔离、登录主链和桌面行为在指定版本上可运行。它不能证明生产数据正确、正式身份源可用、Cloudflare / 企业策略完整或真实业务已经获准。生产 readiness 只证明数据库、schema、auth、storage、content 当前就绪，仍要和业务验收、安装验收分别记录。

## 取舍

这套边界多了一次构建和一次切换，但换来了可回滚、可审计和不污染生产数据。保留有限数量的旧 release 会占空间，应该按回滚窗口清理，而不是为了省磁盘复用生产工作树。

## 当前本地与办公的边界

这次对齐的是 Mac 上正在测试的那一套，不是办公机，也不是生产。

本地打包客户端保持 `synthetic-local`。六页工作台（管理概览、话术库、知识库、SOP、系统同步、权限）只在这份配置里已经写着 `contentIntake: faq-v2` 时继续使用。刷新配置可以改两个 loopback 地址，但不能凭空加上这个标记，也不能在非 loopback 地址上保留它。

办公机 `product-remote` 仍走旧工作台：登录后读公告目录，再搜索和复制。当前代码不接受在 `product-remote` 上打开 faq-v2。

生产端口 43115/43116、合同激活和 `productionConsumerReady` 都不属于这次改动。六页工作台读 intake 快照。旧公告目录里的 `rel_20` 仍留在公告链上，不会被复制进 intake。intake 表在迁移之后如果还没有上传并发布，查询结果是空的。

Mac 人机验收和办公机 Windows 验收清单保持未观察。本文不把任何一项写成通过，也不把这次本地对齐称作上线。

## 开发、测试和生产各用哪一套库

Mac 只做两件事。开发用本机合成库 `customer_agent_synthetic`，端口 `43100` / `43101`。测试用同一台 Mac 上另一套可丢弃的库 `customer_agent_test`，数据目录 `~/.customer-agent-test-stack/pg15`，套接字端口 `43219`，不监听 TCP。这套库只跑到迁移 `0041_intake_readiness_v1_29`，没有演示话术，没有当前发布，没有训练告知。迁移自带的 5 条来源登记还在，发布目录是空的。建完后这套库已经停掉，数据还在，删掉 `~/.customer-agent-test-stack` 即可。它没有自己的 API，也不改 `43100` 上正在用的合成库。这两套库都不复制到杭州。

杭州 WSL 上的 PostgreSQL 是唯一生产库。API 和身份服务只在那台机器的 `43115` / `43116` 监听。办公机经隧道访问 API，不连接数据库。

## 训练样本从哪一张表来

系统同步里的话术公告只表示有新版本，不承载训练。训练告知是 `privacy_notices` 里 `status = current` 的那一行，每个人的同意或拒绝写在 `notice_decisions`。

旧工作台在坐席接受当前告知之后，查询改走 `POST /v1/search`，`collection_mode` 为 `pilot_recorded`，问题写入该 API 所连库的 `query_events`。没有当前告知、告知还没点、或者点了拒绝时，查询保持 `synthetic`，本机 hydrate 继续可用，不写这张训练账。

六页 faq-v2 的查询和复制仍只读快照、只写剪贴板，不写 `query_events`。把六页也写进同一张训练账需要合同允许，这次没有改合同。

杭州库里的告知正文要由人写出再入库。这次没有连接杭州，没有插入告知，也没有把采集模式改成无条件的 `pilot_recorded`。

## 相关

- [运行环境、端口与发布目录参考](reference-runtime-ports-and-release-layout.md)
- [How to 从远端仓库开发、测试并交付](how-to-remote-development-and-deployment.md)
- [杭州后端操作手册](how-to-run-backend-on-hangzhou.md)
