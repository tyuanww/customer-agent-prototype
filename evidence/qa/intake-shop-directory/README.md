# 已接收店铺名称合同 · 最小合成消费

本轮在原产品集成工作区原位实现，版本 0.3.26。消费已版本化接收的 OpenAPI 1.21 / schema.v1.23 与 0033，不复制候选 SQL，也不新增真实店铺、凭据或目录维护 UI。源合同、实际冻结/export/intake 和总体验收由主 Agent 记录；本目录只拥有名称消费验证。

## 实现

- API `shop-directory.ts` 复用原事务 owner 和已认证产品会话，调用冻结 prepare 函数，在原 beforeCommit 执行 finalize；最晚时钟及 COMMIT 仍属原 owner。HTTP 只开放冻结 GET `/v1/intake/shop-directory`，128 KiB 响应预算、no-store、精确失败原因；私有 envelope/会话引用/key 不输出。提交未知不给页面，新的只读重试重新核验。
- Main `loadIntakeAccess` 读完所有名称页，核对稳定截止、游标、重复项和店铺集合严格相等。任一失败丢弃全部名称，保留原已发现的授权编号，界面明确名称不可用。名字只改变显示，不决定 query 权限。名称期限单独管理，不缩短或延长业务权限；wall clock 回拨不能延长名字生命周期。
- Query 继续传原 shopId；名称重复时附 shopId 区分，失效只退回编号及提示。既有类型化 IPC 增加显示投影，没有新增 channel 或通用请求能力。
- `seedIntakeSyntheticDirectory` 仅用于一次性测试库：默认一条明确合成名称/合成 key，可选同名两店仅服务独立 Electron 用例。没有正式 bootstrap 或运行写入口。

## 实际证据

命令、退出码和每份输出 SHA 见 `checks.json`，源输入指纹见 `source-sha256.json`；本轮异常输出修复的两文件精确指纹另随对应 `checks.json` 条目绑定。主 Agent 后续修改的 Main 注释及完整输入指纹以其最终归档为准。

- `api-pg-recovery.log`：实际 loopback HTTP＋真实 ProductAuth＋正式 NOLOGIN usage 能力的 PG15 4/4 PASS。覆盖只投影有权名称、无认证/伪选择拒绝、缺名整次拒绝、更名使旧游标失效、撤权后空集合、prepare 成功但最终守卫前到期拒绝、实际 COMMIT 后丢响应不返回页面且新读恢复。
- `api-pg-invalid-output.log`：修复数据库返回值 schema 失配被错误归类为请求错误的问题。实际 PG prepare 后注入缺少 `validUntil` / 名称 257 字两个无效响应，经真实 HTTP 均返回 503 `SHOP_DIRECTORY_UNAVAILABLE`，整页不泄露，新读可恢复；真实参数错误仍 400 `SHOP_DIRECTORY_CURSOR`。最终目录 PG 6/6＋usage HTTP 18/18，共 24/24 PASS；`lint-invalid-output.log`、`api-types-invalid-output.log` 均退出 0。两处输出解码共用服务端错误映射，未改请求校验或正常路径。
- `api-http.log`：原 usage 路由与目录认证错误单测 18/18 PASS。
- `desktop.log`：QueryApp 与目录/Query/access 5 文件 135/135 PASS。随后单独增强目录请求起点的 monotonic 截止并补回拨回归；`desktop-final.log` 受影响 4 文件 40/40 PASS，QueryApp 96 项的未变输入结果复用，不重复计为新覆盖。
- `lint-final.log`、`api-types.log`、`desktop-types-final.log`：受影响 lint 与 API/Desktop 类型检查通过。初次 `api-pg.log` 记录旧 verifier 指纹导致迁移验证拒绝，未进入目录业务；0033 verifier 更新后 `api-pg-final.log` 3/3 通过，最终恢复补项使用上述 4/4。首次 `desktop-types.log` 被并行 host 与旧 API dist 参数签名阻塞，重建后最终检查通过。保留原失败，不混作一次成功。
- 新真实 Electron 文件 `content-intake-shop-directory-real-stack.spec.ts` 已编写且类型/lint 通过。要求 host `purpose-runtime`、可选 `duplicateShopNames`，读取两个具名同名选项，切换仍使用不同 ID，并用受限 usage 新签 shop-b 资格。主 Agent 随后统一实际执行 Mac Electron 4/4 PASS，新增名称用例通过：重名显示编号、shop-b 新资格 200；完整命令与证据由主 Agent 归档。本次仅服务端异常归类修改，复用正常路径的该结果。

未包含：真实名称/店铺范围、真实组织装配、目录登记维护界面、原工作台统一接线、生产注册、Windows/Linux 人工设备验证。完整外部 /review 仍 INCOMPLETE；没有本子任务 commit、push 或发布。
