# 本机目录与当前发布

工作台有三份可能被叫做「当前」的目录：磁盘上的 hydrate 文件、announce 租约带来的内存 snapshot、以及产品会话是否已登录。三者不一致时，概览和话术库必须写「本机目录」，不能装成坐席正在搜的发布。

操作面见[用一张表替换四库之一](how-to-replace-one-library.md)和[下架一条已发布话术](how-to-retire-a-script.md)。字段合同见[桌面合同](reference-desktop-contracts.md)的 `dashboardWording.list()`。

## The problem

登录后查询胶囊跟 announce 租约走。磁盘 hydrate 却可能更大、更旧，或属于另一次发布：`persistHydrateFromEnv` 在新 snapshot 条数少于磁盘已有文件时会 `kept-larger`，不覆盖那份文件。

若概览只看「hydrate 文件在、releaseId 有值」，就会把本机缓存画成「当前发布」。操作员以为坐席已经在搜这批稿，其实检索租约还没挂上，或挂的是另一份 `rel_N`。

另一条失败是：概览自己再调一次 `announce.current()` 去对 `releaseId`。话术库 `list()` 已经知道条目从哪来，两边各算一次就会短暂分叉。

## The approach

```text
ProductAnnounce.refresh
  └─ 内存 snapshotItems + lease.releaseId
        │
        ├─ 查询胶囊 BM25 / 原文
        ├─ 系统同步四卡条数
        └─ listDashboardWording(liveCatalog)
              matchesLease = true
              dataClass = current-release

磁盘 hydrate / 检索索引（kept-larger 可能留下）
  └─ 仅当没有内存 snapshot 时回退
        matchesLease = false
        ownerRole = 本机话术库
```

`listDashboardWording` 优先用 `productAnnounce.snapshotCatalog()`。只有内存 snapshot 有 `releaseId` 且条目非空时，`matchesLease` 才为 true。否则读磁盘 hydrate，再空才读检索索引，并且 `matchesLease` 固定 false。

概览和话术库**只读** `list().matchesLease`，不再自己对租约：

- 未登录：概览「未接入产品会话」。话术库若 `list()` 仍返回磁盘条目，徽章写「本机目录」；没有任何 catalog 才空态「当前发布未挂载」。
- 已登录但 `matchesLease` 为 false：话术库徽章「本机目录」，kicker「本机目录，不是当前检索租约」。
- 已登录且 `matchesLease` 为 true：徽章「当前发布已挂载」，kicker「坐席现在能搜到的当前发布」。

`PRODUCT_ANNOUNCE_CONTENT_UPDATED` 会打到 fox、query **和** dashboard。话术库 / 概览订阅后立刻 `list()`，跟内存 snapshot 对齐。系统同步四卡仍靠聚焦 / 可见 / 10s poll 重取 `dashboard:announce-current`。查询胶囊登录时 `product:session-changed` 同样扇出到 dashboard，内容管理不必靠窗口失焦才刷新会话。

## Trade-offs

磁盘 hydrate 故意可能比当前租约更大。关机后再打开，未登录的工作台仍能翻本机目录，但必须标明它不是检索租约。换来的成本是：操作员要多看一个徽章，不能把「有数字」当成「坐席已对齐」。

ACK 仍只是内容游标，不是已读。未读紫点走 origin-keyed `last_seen`。把 ACK 当已读会让狐狸紫点和系统同步卡各说各话。

## Alternatives considered

用 `announce.current().releaseId === wording.releaseId` 在 renderer 里重算。失败模式是：`list()` 已经回退磁盘，而 `current()` 仍持有租约，或反过来。真源放进 `list().matchesLease` 后，概览不再二次计算。

发布后立刻覆盖磁盘 hydrate。`kept-larger` 是为了避免一次较小的 snapshot 抹掉本机已有的更大目录。内存 snapshot 承担「坐席现在搜什么」；磁盘承担「这台机器还留着什么」。
