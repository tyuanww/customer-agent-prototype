# 登记负责人确认的 SOP 使用资格

此命令为已发布的 SOP 登记分组及逐条使用资格。需要包含迁移 90 的同版本服务构建，以及当前负责人账号的有效产品会话。来源确认、质量检查、发布和查询授权仍各自执行。

先按[查询事实参考](reference-sop-unified-contract-intake.md#正常查询与权限事实)准备审核 JSON。确认人必须与执行命令的 director 主体一致，并持有对应来源的 import 和 source-confirm 资格。逐条风险和复制许可来自负责人明确确认；暂缺时填写 `unclassified` 和 `null`，查询继续阻断。材料发布的 routine 风险不能替代逐条使用风险。

审核文档绑定原表和实际上传转换文件的 SHA-256，并引用原发布的候选、来源、流程和图摘要。本地审核记录版本用于区分事实文件，不表示飞书上游版本。准备精确的原件、转换文件和审核文件后，先执行文件检查：

```sh
node scripts/ops/register-owner-reviewed-sop-facts.mjs \
  --config /private/pilot/facts-config.json \
  --token-file /private/pilot/session-token.txt \
  --document /private/pilot/reviewed-facts.json \
  --original /private/pilot/original.xlsx \
  --artifact /private/pilot/upload.xlsx \
  --source-version local-review-1 \
  --expected-version 0 \
  --operation-id pilot-facts-1
```

所有文件参数都使用绝对路径。默认检查原件、转换文件和审核字节，返回 `FILES_VALIDATED`。它不读取配置或 token，不连接数据库，也不证明现场权限或发布状态可用。

取得当前具体登记授权后，为同一命令追加 `--apply`。配置 JSON 仅包含 `authMode`、`authDatabase`、`businessDatabase`。数据库值采用现有运行环境的显式 DSN；两者必须指向同一数据库，分别使用既有认证和 business 目的登录。`authMode` 沿用运行环境的 `mock` 或 `feishu` 值。配置文件和 token 文件必须是普通文件，禁止组与其他用户访问，可使用 0600 权限，不接受符号链接。token 文件保存已有会话的 token，不在命令参数中传入。命令不创建会话或修改口令，执行完也不注销该已有会话。

成功返回 `APPLIED` 和事实版本。若返回 `commit: unknown`，保留原审核字节、版本、操作 ID 和预期事实版本，恢复同一操作；不要更换操作 ID 再写一份。若关闭资源失败，输出仍保留已确认的提交结果，不能将它解释为写入失败。明确回滚的错误应先核对其原因，再决定是否需要重新审核输入。

最后使用实际查询账号验证流程、复制资格和图片。只有查询可用、原文与图片核对通过后，才能记录业务验收完成。合成集成测试不替代这一步。
