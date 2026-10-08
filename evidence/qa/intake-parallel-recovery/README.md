# A/B/C 并行回收记录

2026-10-08；产品版本 0.3.26。主 Agent 接收用户回传的三路本地提交，逐路核对文件/日志/提交边界，独立复核后追加修复。只使用合成 fixture/回环 HTTP/一次性 PG15；没有真实数据、凭据或生产配置读取，没有 push/PR/部署。

## 接收范围

| 线 | 原交付与修复分支 | 产品集成提交 | 判定 |
| --- | --- | --- | --- |
| A | cd0d17c + a1eac11 | 3927172 + 0d7e8d7 | 接收离线 HTTP transport；异常响应自行释放连接 |
| B | 57325a9 + 4d47afa + b9381d2 + 4eea8ea | 4fc7bbc + b647f64 + 146dfe1 + 1dd2ba9 | 接收离线 ACL/依赖探针，完整用途装配未完成 |
| C | 7e4a3bd + 70dab62 | 治理 103a05b + 45f5c0d；不进入产品合同锁 | DRAFT；冻结/export/intake 尚未发生 |

产品原集成基线 576e3b0，A/B 分出基线 0e6aea9；治理原基线 6f318d4。原产品 Desktop 工作区未修改。A 原日志和 B 原 vitest-final.log 保留；追加日志的空白处理和哈希以各证据页为准。

## 本机回收发现与修复

- A：非法 Content-Length 后 transport 返回失败但响应未释放。实际回环挂起正文复现，finally 统一 abort，新增响应 close 回归。令牌仅内存缓存的注释已纠正。详见 [A 修复](../intake-organization/http-transport/cleanup-review.md)。
- B：取消/关闭在 DB 等待后仍能返回 running；并发 start 没有占位。现逐次等待后复核且保留单次启动占位；没有认领时输出 checked-not-activated / ready:false。NOLOGIN 属主缺 digest(text,text)、gen_random_bytes、assert_family_catalog 的 EXECUTE，已补最小权限并逐项撤权验证；用途业务账号没有因此获得这些直接权限。详见 [B 修复](../intake-runtime-assembly/README.md)。
- C：原 sd1 游标包含会话 hash 且可改截止/页边界；名称校验及维护人停用门有缺口。修复为独立服务端私有 key 的 sd2 HMAC，session hash 只作绑定上下文；补 Unicode 名称、等待与最终截止、新鲜维护人门。候选没有产品运行授权。

## 验证方法与复用

检查绑定本目录 checks.json 中的命令、输入哈希、环境、退出码与日志 SHA。根目录 build 先构建 API dist，再跑 typecheck，解决 B 独立工作区因缺 dist 不能完整检查的问题；未安装依赖。集成专项运行 A transport/消费、B 单测/PG 和原无认领检查共 47 项。完整 test 中环境门跳过仍保留，不能将它们记成 PG 通过。

实际结果：产品 lint/typecheck/test/build、文档/合同/codegen/迁移一致性通过；47/47 专项通过。工作区根规则通过，源码预算失败（约 32.6 MiB / 32 MiB、超约 600 KiB）。治理最终 PG140/140、合同3/3、生成/lint/docs通过，保留23条既有 OpenAPI warning；release41/41步退出0为组合证据，运行期间改动影响到的部分已补最终字节验证，不称单次最终输入全量通过。治理集成树与已验证候选逐字相同，索引日志已核验哈希并复制到治理集成工作区的忽略 output 目录。

未改变的旧角色 15/15、会话锁 8 项、observer/writer 原证据继续绑定原输入，不重新认证全部历史。桌面/正式 HTTP/迁移和合同未改，本轮不重跑实际 Electron 直发链或现场设备验收。上轮直发证据仍是那一版本的结果。新组织专项脚本已包含 A 两个新测试文件。

完整外部 `/review` 保持 **INCOMPLETE**；本轮没有为消除此标记调用外部模型。根规则与体积预算分别报告，已知预算失败不隐去、不清理历史或放宽阈值。

## 仍缺的正式接入条件

1. A 的可信 open_id 登记、映射 provenance 持久化、真实认证/令牌生命周期、共享配额和目录完整性/新鲜度合同；usage 实测仍用 harness 管理池。
2. B 的实际 service 会话锁与四池接线、完整资格/非空 snapshot/复制、完整发布和回退、质量计划/授权写入、旧 approval-v1 实际失效行。临时 SQL 副本只是权限探针，不能升级成第二套服务实现。正式 ACL 须先治理/intake。用途角色隔离数据库能力，不提供逐用户行隔离；p_actor 仍须由可信服务绑定，不能由任意 SQL 调用者冒充主体。
3. C 的维护人轮换、正式私有签名 key 注入/轮换、受限调用与会话/锁职责，满足条件后再批准精确版本、export/intake、接产品名称消费者。
4. 真实店铺/来源/授权/旧目录认领、保留期、生产账号及现场验收仍按既有事项等待输入；缺清单不能用空目录或岗位标签自动认领。

未新增业务 TODO。当前计划与 TODOS 只更新原事项的实际完成及剩余条件。
