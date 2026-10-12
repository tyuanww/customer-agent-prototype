# P2 旧写共存门验收

范围：复审 `2843647` 后推进发布前置门。只限合成开发；新候选的原子发布和坐席闭环仍待后续，不将旧发布回归当成 P2 发布成功。

- 前序 OCR：[逐文件覆盖](prior-ocr.json)，18/18 可审项与 6 项排除补查，无新增已确认缺陷。前序历史外部超时不改写。
- 追加迁移：`0022_intake_legacy_fence`；前 21 段字节与账本保留，旧发布函数 OID/签名/ACL 保留。新增五项内部策略/trigger 函数，八条权限只给既有不可登录 definer，应用角色仍无 schema 权限。
- 修前真实 API/PG 回归：三项新测试失败，旧三项通过；缺口分别是整域 active 相交未拦、目录未继承、撤销目录仍可继承。修前日志保存在本 worktree 的 ignored `.gstack/content-intake-p2-publication/fence-red.log`。
- 实际检查：[checks.json](checks.json)，被测内容：[inputs.json](inputs.json)。Node 24.19.0 / pnpm 11.19.0 / PostgreSQL 15.18；全仓 lint/typecheck/test/build、workspace/docs 检查通过。单独启用相关实库 API 68/68、数据库 19/19 通过。默认全仓测试跳过的无关集成及桌面平台项不声明已验证。

下一依赖：候选材料到既有质量 population/抽检/owner 验收的受控映射 → 人工审批一次票据与原子发布 → 使用资格/第二坐席查询。旧入口只有通用 409，新流程的明确恢复原因随 P2 接线完成。真实飞书、正式 mode 启用、生产角色、平台验收及 Git 对外动作未执行。

审查修复：原生审查确认来源指纹提前修改旁路，实际 app_runtime definer 两次复现 SHA 改变及 revision 留存。现已补齐 advance/restore/worker 首锁与模式启用前的 reservation 检查；包括两个实际 PG 会话的先后顺序回归。

第二轮确认批量取消仍先取 admission 锁，可能与上传互锁；[修前回归](cancel-red.txt)观察到取消等待内容锁时仍持有次级锁。修复后由 SQL sweep 统一锁序，API 不再持有锁常量；实际两 HTTP 请求等待后分别返回取消 200、上传 202。第三轮原生复审无剩余具体缺陷，测试按 summary 审查，父执行器实际运行验证。OCR [逐文件覆盖](ocr-coverage.json)及[全部审查尝试](review-attempts.json)分别记录；首轮外部两次因代码需修复而终止，不能记为通过。

修后外部对抗审查已完成（返回模型 `claude-opus-5`），提出“单批取消缺少首锁”。核对不可变 0013 与实际 22 段安装后的函数，确认第一条语句已是内容锁，先于 batch UPDATE，判定误报；[反证](outside-validation.json)及[检查点 015](exploration-015.json)补充在冻结的 14 次探针报告之外。外部结构化审查运行 540000 ms 后超时，**MISSING COVERAGE**，不写成通过。外部对抗捕获后新增了文档/证据，日志绑定如实为 changed；生产源码 SHA 未变，由最终父级审查另行覆盖文档/证据。

功能验收：[evidence.json](evidence.json) 的机器结论为 `pass`、`open=[]`。隔离范围是本机临时 PG 和合成 API/worker 消费者，不涉及真实租户、网络 transport、生产启用或窗口。300 秒 / 12 探针可选探索在第 10 次后结束；011–014 为修复后的必要重验，没有重启探索计时。001–002、005–008 是探针设置错误；009–010 是两次产品缺陷复现；历史结果均标为 superseded，由相同命令的 011–013 修后证据闭合。014 在最终源码与测试上通过 68 项。

当前验证覆盖：22 段迁移实际安装与 verifier 消费、三种应用角色直接 helper 调用拒绝、整域 active 隔离、空目录完整继承、逐条谱系后续撤销、继承故障全事务回滚、启用/上传两种锁顺序、旧 reservation 恢复与 actor-wide 取消/上传并发。前 21 段 SQL 与账本保持原值。仅 NOLOGIN definer 增加八项必要权限，应用角色仍无新 schema 权限。

探索检查点：[002](exploration-002.json)、[003](exploration-003.json)、[004](exploration-004.json)、[005](exploration-005.json)、[006](exploration-006.json)、[007](exploration-007.json)、[008](exploration-008.json)、[009](exploration-009.json)、[010](exploration-010.json)、[011](exploration-011.json)、[012](exploration-012.json)、[013](exploration-013.json)、[014](exploration-014.json)。[最初缺口复现](fence-red.txt)与修后证据分开保留。
