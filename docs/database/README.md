# 数据库文档

`dictionary/` 是生成物，`README.md`（本文件）是手写说明。

## 字典怎么重跑

```bash
# 生产（默认读 /srv/customer-agent/stack 的 socket 与 content.env 里的 DATABASE_NAME）
pnpm --filter @customer-agent/database dictionary

# 只检查、不写（CI 或提交前）
pnpm --filter @customer-agent/database dictionary:check

# 其它库
CUSTOMER_AGENT_DICTIONARY_HOST=/path/to/socket \
CUSTOMER_AGENT_DICTIONARY_PORT=43199 \
CUSTOMER_AGENT_DICTIONARY_USER=stack_owner \
CUSTOMER_AGENT_DICTIONARY_DATABASE=customer_agent_formal \
pnpm --filter @customer-agent/database dictionary
```

脚本只读 catalog（`pg_namespace`、`pg_class`、`pg_attribute`、`pg_constraint`、`pg_indexes`、`pg_proc`、`pg_trigger`），在一个 `REPEATABLE READ READ ONLY` 事务里读一遍，不读任何业务行，也不写数据库。

## 输出为什么可以提交

- 每条列表都按稳定键排序：schema 名、表名、约束名、索引名、函数名加参数、触发器名；列按声明位置。
- 不输出时间戳、耗时或会变的行数。
- 因此同一套迁移重跑两次是逐字节相同的，`--check` 才有意义。

`schema_migrations` 的版本号是唯一会随时间变化的内容，而它本身也是一张表，只导出结构，不导出数据。

## 它不回答什么

- 不看数据、不统计行数、不做脱敏判断。敏感级别与保留期属于 C2。
- 不判断谁能写哪张表。ACL 在 `pg_class.relacl` / `pg_default_acl`，需要时另查。
- 不追踪跨表血缘。那是 C2 与 C3。
