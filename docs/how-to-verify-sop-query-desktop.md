# 独立 SOP 查询的桌面合成验证

本切片基于 `7071a2e74a4011a907350b4715991d63a163f796`，消费冻结合同集 `cs-ai-c11-openapi-1.25.0-schema-1.30-0fb1dc76ee2b` 的 `POST /v1/sop/query`。批准和运行边界分别见该目录的 `approval.v1.json`、`installation.v1.json`。产品实施获批不等于正式运行、业务映射或部署获批。

## 开启与所有权

仅在既有相邻、非正式端口的 loopback 合成 API / identity profile 上，增加以下环境配置。

```sh
CUSTOMER_AGENT_DESKTOP_CONTENT_INTAKE=faq-v2
CUSTOMER_AGENT_DESKTOP_SOP_QUERY=menokin-sop-query-v1
```

打包 profile 使用 `mode: "synthetic-local"`、`contentIntake: "faq-v2"`、`sopQuery: "menokin-sop-query-v1"`。省略 SOP 开关不会自动开启；`product-remote` 带该开关会被拒绝。正式 profile 的旧样例入口也关闭。

在查询条的筛选区域点击「打开 SOP 流程」。SOP 窗口独立选择店铺、流程类别和问题，不继承查询条的商品筛选。本切片不发送 `product_context`，不把 FAQ 商品 ID 猜成 category/sku。Query 改变条件、重新查询、取消、失效或销毁时，同时清空已开的 SOP 内容与操作句柄。

- Main 的 `SopQueryRuntime` 拥有授权会话请求、店铺选择句柄、上下文代数、图、当前位置、展示截止与复制句柄。店铺发现只提供选项，查询接口才判定资格。
- shared 的 `sop-query.ts` 验证独立 wire 形状和最小窗口投影，不跨 app 导入 API 实现。响应必须关联本次 request_id 和冻结合同响应头。
- `SopWindowController` 继续拥有原生窗口、加载、拖动和布局。独立 sandbox preload 仅增加 `queryCommand`。Query 只能打开窗口，SOP 主 frame 才能提交命令。
- renderer 获得当前节点的逐条消息和显式分支，不获得 token、用户 ID、preview_handle 或网络方法。正文保持原文，每条消息独立遵守 `copy_allowed`。

## 推进、复制与失效

只有显式边可推进，不以 sequence、行顺序或正文推断路径。不完整、重复、循环、悬空或不可达图整体拒绝。`blocked / stale / no_match` 不保留旧正文和操作。

独立查询响应不含旧图谱 action-check 所需的 entitlementId/graphDigest，不能伪造这些参数。本切片每次推进和复制前重读同一个查询上下文，核对原 release 和完整图；改变复制许可同样使旧结果失效。新响应不能延长原租约。展示截止取原租约与首次请求开始后 30 秒的较早时间，截止后撤下内容，需人工重新查询。本切片未实现后台 observe 续读。

每次上下文变化增加代数并中止请求。即使传输迟到，结果也不得恢复正文。复制只接受 Main 为当前消息颁发的随机句柄；重查、推进、退出及失效后旧句柄作废。重读期间的撤权、失败或会话变化不会写剪贴板。

## 媒体缺口

`media_refs` 有 preview_handle/MIME/到期时间，但独立消费尚无可核验的句柄解析请求、字节长度和 SHA256 响应协议。不能猜 URL，也不能套用另一套 entitlement/objectId 接口。任何非空媒体集合均阻断整图展示、推进与复制，不降级成只复制文字。需协调者补齐并冻结安全媒体消费合同后另行实现。

## 验证入口

```sh
pnpm --filter @customer-agent/desktop exec vitest run tests/unit/sop-query-runtime.test.ts tests/unit/sop-window-ipc.test.ts tests/unit/product-runtime-config.test.ts tests/component/SopQueryView.test.tsx
pnpm build
pnpm --filter @customer-agent/desktop exec playwright test tests/e2e/sop-query.spec.ts
```

第一组使用真实 loopback HTTP 和合成响应，第二组运行实际 Main、preload、renderer 与系统剪贴板。它们不证明 PostgreSQL 发布或数据库读取完成。必要时以 `SOP_ELECTRON_EXECUTABLE` 指向已安装的 Electron 43 可执行文件，无需下载另一份。

### 联合实际 PG 宿主

由协调者启动和清理 API worker 的合成 PG/HTTP/identity 宿主。将下列 JSON 放入 `CUSTOMER_AGENT_SOP_SYNTHETIC_PROBE`，再运行 `tests/e2e/sop-query-host.spec.ts`。没有该变量时测试明确跳过。

```json
{
  "synthetic": true,
  "apiOrigin": "http://127.0.0.1:43120",
  "identityOrigin": "http://127.0.0.1:43121",
  "shop": "shop-a",
  "group": "过敏流程SOP",
  "query": "合成过敏",
  "branches": [],
  "expectedMessage": "合成过敏情况请先停手，再确认情况。"
}
```

```sh
pnpm --filter @customer-agent/desktop exec playwright test tests/e2e/sop-query-host.spec.ts
```

宿主需支持现有合成浏览器登录、授权/来源发现和独立 SOP 查询。`branches` 是实际显式边标签列表，空数组表示当前节点已有目标消息。`expectedMessage` 必须来自同一合成种子，不能填真实 Excel 原文。探针不自建响应、不 seed 数据库、不假登录；它检查实际窗口正文并逐字比对系统剪贴板。PG 是否来自正常解析/发布链，仍需由宿主证据说明，不能由桌面 PASS 推断。

### 自动管理临时 PG 的联合用例

`apps/api/tests/support/sop-query-synthetic-host.ts` 提供可复用宿主，可运行下面的入口。它创建真实临时 PG，读取宿主保存的合成图消息，通过真实登录和产品 Main 完成查询、逐字复制，再撤销父查询授权验证清空。它不以固定 HTTP 响应代替数据库。

```sh
CUSTOMER_AGENT_SOP_QUERY_CANDIDATE=1 pnpm --filter @customer-agent/desktop exec playwright test tests/e2e/sop-query-postgres.spec.ts
```

宿主提供实际授权/来源发现路由，以及符合严格 profile 的独立相邻 identity 端口。用例在这些前提不满足时失败，不注入假授权目录。测试保存窗口截图和实际 release/lease 关联，并在复制后撤销父授权，检查旧内容清除与复制拒绝。宿主使用持久化发布 fixture，不能据此宣称普通上传/发布链或含媒体的完整 B12 已贯通。
