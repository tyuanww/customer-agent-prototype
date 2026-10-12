# 当前 Mac 安装包 CSV 合成验收

2026-10-09（Asia/Shanghai），`codex/intake-organization`、版本 `0.3.26`。打包时 HEAD 为 `54f428ca8296aba9a75d2205439b3063cfef8c9b`，包含本轮尚未提交的 CSV 集成修改；不能仅用 HEAD 代表被测内容。`package-inputs.json` 记录 227 个打包输入的 SHA-256，构建、解包和验收后均一致。

## 实际结果

- `pnpm package:mac:local` 退出 0。标准本机未签名后验通过，版本保持 `0.3.26`；未修改或跳过打包门禁。
- 先保留原同版本 DMG/ZIP，再将本次新 DMG 只读挂载，以 `ditto` 复制到本轮专属 `installed/` 目录。没有覆盖 `/Applications` 或用户已安装应用；挂载已卸载。
- 使用该安装副本的真实可执行文件运行现有 `content-intake-real-stack.spec.ts`，选择 `purpose-runtime` 与 `csv`：**1/1 PASS，21.8 秒**。运行时断言 `app.isPackaged=true`、版本及可执行路径正确，使用独立 userData 和本地合成配置文件。
- 已覆盖含 UTF-8 BOM 的原始 CSV 文件上传、API 隔离解析、逻辑记录第 3 行 H 列缺失答案的错误、完整错误报告保存后由 ExcelJS 回读、修正后候选、同一候选修订为 v2、逐项检查、原生确认取消不提交发布、确认后 `direct-v1` 发布、取消另一候选不影响已发布版本。
- 另一普通客服读取已发布的三条话术；引号、逗号及换行正文保持一致，实际系统剪贴板与查询正文一致。撤销 query 权限后，新查询和旧复制请求均拒绝；越范围店铺拒绝。
- 实际 HTTP、PG15 受限用途连接均被消费：business 2157、usage 427、worker 40、organization 30 次。审批事实和 review binding 均为 0，没有伪造审批通过。
- 合成 PG 数据目录、userData 和临时 CSV/报告文件在断言消费后清理，Electron 已关闭。安装副本、DMG/ZIP 与截图保留在本轮专属目录。

## 产物与证据

全部大产物保留于 `.gstack/qa-reports/intake-csv-mac-package-20261009/`，不纳入 Git。安装包详情见 [package-installed-artifact.json](package-installed-artifact.json)，命令、环境、日志和 11 张截图指纹见 [package-checks.json](package-checks.json)。

| 产物 | SHA-256 |
| --- | --- |
| 新 DMG | `8b174e8949aaf3bda65d0a79df2cc30434ecd9f465a7e9a2ca06c5a9ab4fc6df` |
| 新 ZIP | `df94019e158d55c9e341b4353e60e3360b2ba95a4aa0505a8b1ee429f703bc73` |
| 安装副本 app.asar | `7f65cea4aded4e5c0f443751d1dce262216fe40486e10f23aaef8e31427dec56` |

`lipo -archs` 为 `x86_64 arm64`；本轮只在 arm64 Mac 上执行。`codesign --verify --deep --strict` 返回 1，明确提示未签名，符合本机未签名产物预期。

- [原始构建日志](package-build.log)
- [原始挂载、复制、卸载日志](package-install.log)
- [实际安装副本 E2E 日志](package-e2e.log)
- [安装副本运行身份](package-identity.json)
- [打包输入指纹与旧产物保留位置](package-inputs.json)

截图中的错误报告、发布结果与另一客服查询正文已经目视复核。实际 CSV 字节、报告和剪贴板内容由 E2E 断言消费；临时文件随自有目录清理，没有把重新生成的文件冒充本轮原件。

## 边界

原生文件选择、保存和确认响应由测试控制，不能计为本轮人工操作 macOS 弹窗的证据。API/PG15 是本机合成测试宿主，未接真实飞书、客户资料或生产配置。未进行签名、公证、远程发布或 Windows 验收，也未重复旧 XLSX 安装包与无关历史测试。

安装包成功不替代独立的 workspace 预算检查，不改变完整外部 `/review` 的 `INCOMPLETE` 状态；本次新资料 CSV 闭环不验证旧非空目录认领 ACL 草稿。
