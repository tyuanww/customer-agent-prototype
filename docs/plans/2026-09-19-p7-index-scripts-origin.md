# P7：bindHydrateCorpus 按 origin 读 BM25 文件

> **状态：** 实现中（`feat/p7-index-scripts-origin`）。  
> **不包含：** 未设 origin 时去读家目录未带后缀文件。

## 拍板

`loadRetrievalPipeline` 已走 `productStackReadPath`，但 `bindHydrateCorpus` 用的 `loadIndexScripts` 仍只看 `CUSTOMER_AGENT_RETRIEVAL_INDEX`。env 未设、origin 已设时，查询语料应读 `retrieval-index.<id>.json`。
