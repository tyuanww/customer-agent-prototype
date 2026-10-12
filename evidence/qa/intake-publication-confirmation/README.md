# 发布二次确认：合成验收

2026-10-08，产品0.3.26；本切片在旧审批合同下新增 Main 原生二次确认，不代表取消审批已经接入。代码、锁文件指纹见 [input-sha256.json](input-sha256.json)，命令和限制见 [results.json](results.json)，原始输出以 JSON 字符串保存于 [logs.json](logs.json)。

Main 冻结待发布请求后打开绑定 Dashboard 的原生警告框，默认取消；取消不创建 workflowPending、不发发布 HTTP，保留表单；确认返回后重验活跃代际与当前权限。重复命令被已有 active 状态拒绝，退出/失效后的迟到确认不得执行。已发请求的未知恢复仍使用同一原操作，不再弹窗。实际 IPC factory 已注入原生确认，未装配时失败关闭。

验证通过：55项定向单元/组件；完整 lint、typecheck、test、build；1项 Electron→preload→Main→HTTP wire 验证（取消零请求、确认一次）；1项实际 Electron→HTTP→PG15 的上传/修订/来源/合成审批/质量/确认发布→普通坐席查询闭环。普通 test 命令包含环境门控跳过项，不能当成所有 PG/设备检查通过；本次受影响的真实链路单独运行。

对话框只替换选择/按钮返回值以确定性驱动测试，未声称真人点击或Windows实机验收。代码与本机独立审查没有待修发现；历史外部审查超时及完整 /review 的 INCOMPLETE 保留。未调用真实飞书/员工/客户或凭据；没有生产启用、打包或外发。

附带证据维护：前一组织观察提交的原始 stdout 末尾空行曾触发 staged whitespace 检查。本轮改为 JSON 字符串封装，解码后保留原始字节及 capture receipt 的 hash；未重跑或改写原测试结论。
