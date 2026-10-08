# 主 Agent 回收：传输资源释放修复

基于 `cd0d17c134af5966e49db8e7a9571331d41c635d` 追加修复，原交付日志、指纹与提交不改写。本轮不接真实网络，不改 observer、writer、角色规则或生产装配。

回收发现：独立调用 transport 时，HTTP 可接受但超过本模块格式限制的 `Content-Length: 000000000000001` 会在头验证处抛出 `UNAVAILABLE`。原 finally 只清计时器，尚未读取的响应不取消。回环服务器 flushHeaders 后挂起，50ms 请求预算下失败后再等 150ms，实测 `responseClosed=false`、`socketsRemaining=1`。经 observer 调用时其 finally 会补 abort，因此此前完整消费链没有把失败写成事实，但 transport 自己的资源释放不应依赖外层。

修复把每条退出路径的 abort 放回 transport 的 finally。已有状态拒绝、响应大小、取消和正常读完都经过同一收尾；异常头也会及时关闭连接。新测试直接调用 transport 并观察服务端响应 close，不使用 observer，不等待远端主动关闭。同时更正 token 注释：仅在内存缓存至到期，不在此获取或持久化。

实际定向测试 24/24 通过，lint 与 API typecheck 退出 0，命令、源码/日志指纹见 [cleanup-results.json](cleanup-results.json)。新测试覆盖原复现；原 4 项 PG15 记录保留，不标为本轮重跑。原始日志末尾空行保留，其 diff --check 样式提示不是代码失败。完整外部 /review 仍 INCOMPLETE。
