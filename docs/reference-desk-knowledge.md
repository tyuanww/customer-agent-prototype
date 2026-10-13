# 人设知识库

`contentIntake: "faq-v2"` 的工作台把导航 id `content` 显示为「知识库」。这一页是本机一问一答，不是旧工作台的整库替换，也不是服务器上的 FAQ 候选流。查询浮层仍读原来的目录，不读这张表。

## 存储和通道

文件是 Electron `userData/desk-knowledge.json`，权限 `0o600`。没有文件时从空库开始。文件损坏或读不出来时页面从空库开始，并写「本机知识库读不出来，已从空库开始。」写入失败时知识已在内存更新，文案是「知识已更新，但没能写入本机。」

| 通道 | renderer | 作用 |
| --- | --- | --- |
| `dashboard:desk-current` | `dashboardDesk.current()` | 读取当前视图 |
| `dashboard:desk-command` | `dashboardDesk.command(command)` | 提交一条意图 |

只有 Dashboard 主帧可以调用。角色来自 `session.view()`，renderer 不能自报角色。`agent` 是坐席，`coach` 和 `owner` 是运营。未登录时写操作返回「请先在查询窗口登录。」

## 角色

| 角色 | 可以 | 不可以 |
| --- | --- | --- |
| 运营 | 保存、导入 CSV、改有效期、重试、删除、把隐性知识交给知识库 | 把坐席写成第三种岗位 |
| 坐席 | 切换人设、记下隐性知识 | 保存、导入、改有效期、重试、删除、交给知识库 |

坐席做被拒绝的写操作时，文案固定是「当前账号暂无使用权限，可向主账号发起权限申请。」坐席卡片上没有「保存」。

## 人设、分类、有效期

人设是 `shop` 全店、`presale` 售前客服、`aftersale` 售后客服。运营表格只列出当前人设自己的条目。全店里生效中的知识，售前和售后坐席都会收到。

分类是 `product` 商品介绍、`pairing` 搭配建议、`presale` 售前咨询、`aftersale` 售后服务、`custom` 自定分类。自定分类要 1 到 20 个字。

有效期是 `always` 长期生效、`inactive` 不生效、`scheduled` 定时生效。定时必须是合法 ISO 时间，而且开始不晚于结束。窗口外是「待生效」或「已失效」，不投递给坐席。状态文案由 `statusLabel` 决定：解析失败是「文件无法解析」或「解析服务异常」，其余是「未生效」「待生效」「已失效」「生效中」。

## 命令

`DeskKnowledgeStore.command` 接受这些 `action`：

| action | 谁能用 | 结果 |
| --- | --- | --- |
| `select-persona` | 坐席、运营 | 只改当前人设，不增加版本号 |
| `upload` | 运营 | 一条问答。问题 2 到 80 字，答案 1 到 200000 字 |
| `import-csv` | 运营 | 每条写入后都是未生效 |
| `set-validity` | 运营 | 改为长期生效或不生效；定时须带起止 |
| `retry` | 运营 | 正文为空仍是文件无法解析，否则回到可投递解析状态 |
| `remove` | 运营 | 按 id 删除；找不到则「找不到这条知识。」 |
| `add-tacit` | 坐席、运营 | 只记在隐性知识，不发布 |
| `promote` | 运营 | 交给知识库后新条目未生效，分类显示「隐性知识」 |

CSV 仍走 `parseCoachUploadCsv`。文件选择是 `accept=".csv,text/csv"`，用 `FileReader.readAsText` 读取。表头沿用「问题 / 标准话术」。分类可写售前、售后、产品、活动。xlsx 被拒绝。超过 10MiB 拒绝。成功文案是「已导入 N 条，状态是未生效。」有跳过时再加「跳过 N 条。」填写层里的「长期生效」不作用于这一批导入。

隐性知识 2 到 500 字。经验洞察约 30 天、情境上下文约 14 天只是页面说明，没有定时器，也不会自动发布。同一条交给知识库之后不能再交一次。

## 页面

背景 `#F1F4F8`。内容列最大 1000px，左右 24px，底部 40px。标题的可访问名称是「知识库」，旁边是当前人设条数。主按钮是 `#007AFF`。人设是 32px 分段。运营是两列卡片；点「写下一条」才打开 600px 填写层。删除要再确认。坐席只看已投递卡片。

权限页仍是侧栏「权限」，不进入 `DASHBOARD_MODULE_IDS`。它和知识库共用灰底和蓝色主按钮。刷新、预览、确认保存、撤销和坐席账号命令没有改。

实现在 `apps/desktop/src/shared/desk-knowledge.ts`、`apps/desktop/src/main/desk-knowledge-ipc.ts` 和 `apps/desktop/src/renderer/features/dashboard/DeskKnowledge.tsx`。

## 相关

- [如何记下一条人设知识](how-to-operate-desk-knowledge.md)
- [为什么知识库不读查询目录](explanation-desk-knowledge.md)
- [资料页与权限页](reference-intake-pages.md)
