# 生成单表正式映射工作包

当前来源是 `【SOP】Menokin_SOP(1).xlsx` 的「特殊流程 SOP」单表。使用 `build-sop-formal-mapping-workpack.mjs` 生成只含结构、候选状态和业务缺口的工作包。

```sh
node scripts/build-sop-formal-mapping-workpack.mjs \
  /path/to/split-workbook-review.json \
  /path/to/mapping-progress.json \
  /path/to/formal-mapping-workpack.json
```

脚本检查来源绝对路径、来源 SHA-256、数据行数、候选家族、正式字段和证据门禁。脚本拒绝正文、图片字节、客户数据、内部 URL、凭证和 token。

生成结果固定为 `mappingState: "candidate"`、`status: "needs-business-confirmation"`、`publishable: false` 和 `runtimeEnabled: false`。工作包不能直接生成 graph、写入数据库或接入桌面运行时。

业务审核应按工作包中的 `formalFields`、`structuralFindings` 和 `evidenceGates` 逐项补充声明。声明必须带可回溯证据。没有稳定业务编号时不能使用物理行号代替。
