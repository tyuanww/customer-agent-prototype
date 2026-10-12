# 冻结运行合同的产品合成接入

2026-10-08；产品版本0.3.26；接续 `326af87`，治理批准候选 `6a25304`。本轮在既有集成工作区并行推进生成/目录/受限运行，不重做角色审核或P1规划。

## 精确批准与接收

用户“批准，没问题，先推进”承接上一轮明确列出的精确三摘要：OpenAPI `bde5124df711333e6860c0cea1734f47fe5c45c95b56c0d5cde3d2e9466246d7`、schema `4c2969459265262fabfe38ae425ab8c1275c46274d03ae09ec39b75ae9cc978e`、installation `1683c487d6dc84e84b44d9f2a80ca9ab9cfb941144ace8d3b2cf7f520bb58486`。

治理冻结/导出源 `e35c0c01b5510ffcff75f2b19ba441ad53a9b504`，回执提交 `830e1c826b2ee479146ccd23d7437e634b4b6be8`。完整v2包共12件、9个runtime伴随源，manifest SHA `a15e0193a8e577e9f1c4a1c52b5b7cba7a11674e3cd157c1eb135fa5e4f2aa1a`。产品实际intake为CREATED，消费锁1.21.0/1.23仍VERIFIED_NOT_ACTIVATED，runtime/Ddev=false。机器DRAFT注解保持原字节；所属仓精确冻结批准决定生命周期。

## 实现及所有权

- 0033把roles→organization→session→directory→directoryAcl→acl放在既有runner的单个事务。安装前校验批准installation、所有伴随源及前32段manifest/overlay依赖；不重装完整reference schema。前32段字节、来源不变。
- `runtime-pool.ts`持有四用途连接，借出前SET ROLE/assert_purpose，失败销毁；处理空闲连接错误并保持诊断。正式transaction直接调用窄锁，无SQL替换桥。组织writer/observer/registered-refresh迁入单一src所有者，真实transport继续关闭。合成host用组织池完成登记、双扫描观察和事实写入，再由原业务/usage/worker消费。
- 名称目录HTTP复用原事务prepare/finish和最终截止，COMMIT结果未知不给页面。Main完整分页并要求shopId集合与已有授权集合相等，任页失败/过期只回退编号；同名附ID。没有新增目录管理界面或IPC channel。
- 数据库后验扩展到新schema、7个新角色、精确ACL/对象/函数和完整trigger定义，含WHEN/deferrability；合法低权环境LOGIN与静态能力分开检查。

## 实际验证与复用

日志、命令、输入指纹以本目录checks及review记录为准；原失败保留，补验不覆盖旧记录。

- 根lint/typecheck/build分别实际执行。根 `pnpm test` 已执行至桌面阶段：contracts24、retrieval9、content56、database36、API561通过；受环境门控database21/API315/desktop7跳过，不计PASS。桌面1342通过，唯一失败是旧合同来源断言；按实际消费锁改为精确1.21/1.23后，该35项文件全部通过。之后单独执行并通过未运行的artifact/architecture/workflow阶段，不虚构一次完整pnpm test退出0。
- migration PG初跑36/38通过，两项历史篡改测试仍把现在批准的SECURITY DEFINER当作异常；更新为篡改回INVOKER后，两项补验通过。其余输入不变复用；新增32→33安装、角色冲突回滚、缺函数回滚均通过。独立verifier实际PG21/21，包含权限/角色/WHEN/延迟属性篡改拒绝。
- 目录HTTP/受限usage最终PG6/6＋HTTP18/18及桌面期限、分页、缺名、重名回归见[名称专项](../../intake-shop-directory/README.md)。相关Main最后仅修正陈旧注释，最终源哈希由本目录绑定，不改变已测行为。
- 正式service/用途池/组织观察/登记刷新/历史probe的分层验证见[运行接线专项](../../intake-runtime-formal/README.md)，包含实际idle断连后的重新取连接。
- 最终暂存检查修正了0033生成头注释的空行号尾空白，执行SQL不变、前32段不变；等价指纹见 `migration-header.json`。重新生成后，generator/planner31项、实际PG安装/两种回滚3项及database构建/lint通过。旧专项记录保留实际被测摘要，不改写历史证据。原始测试日志的尾空行/失败输出空白按原字节保存，源码与文档的差异检查单独排除这些日志。
- 根合成HTTP/CLI9/9：产品默认合成链与四域受限用途链，以及CLI退出/信号清理。
- Mac实际Electron4/4：上传/错误报告ExcelJS回读/修订取消/来源质量/原生取消和确认/另一客服真实剪贴板，纠正回退，总监具名权限预览取消/保存/撤销，重名店铺显示并按不同ID切店。弹窗输入由测试控制，不冒充人工原生窗口体验。

## 审查与限制

本机与独立定向审查覆盖生成依赖、原子安装、池生命周期、目录权限/期限与事务恢复。独立发现空闲连接error事件缺owner，已修复并以实际PG断连验证；另发现数据库目录输出schema错误被归为客户端FILE_INVALID，修复与定向回归见名称专项最终记录；完整外部/review保持INCOMPLETE，没有重跑历史15/15角色审核。

真实飞书/员工/客户资料、生产账号/密钥/装配、真实店铺/来源/负责人与旧目录认领、历史保留期、原工作台统一入口、办公Windows/Linux与人工现场断网/系统窗口仍未验证或未接入。没有push、PR、合并、部署或真实运行激活。源码32MiB预算原有失败继续单列：最终归档检查35.2MiB/32MiB，超出约3.17MiB，根目录规则通过；不删历史或放宽阈值。

## 文档核对

沿用document-release的事实核对方法，更新现有TODO/计划§0.53、合同交接、架构、开发指南和模块README；版本不变，未增加业务TODO。运行接口具备reference和how-to，现有合成教程复用；解释文档明确合成/真实边界。桌面HTML说明同步当前合同已接收状态，仍是仓外可删除文件。外部审查没有新增结论。
