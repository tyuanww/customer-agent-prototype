# P7：登录后后台补正文向量

> **状态：** 实现中（`feat/p7-login-embeddings`，叠在 origin 隔离 + 登录写 BM25 之上）。  
> **不包含：** 登录等待 MiniMax、把向量打进包。

## 拍板

1. 查询在 hydrate/BM25 语料上接 `liveDenseQueryRanker`，下一句按 env / origin 路径重读向量文件。
2. 登录分页之后**不等待** MiniMax：有 key 就后台补缺 hash。无 key / 失败保持 BM25。
3. 向量文件走 origin 带后缀路径。
