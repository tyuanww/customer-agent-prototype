/* GENERATED FILE. DO NOT EDIT. Run `pnpm contracts:generate` from the repository root. */

export interface paths {
    "/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 进程存活探针
         * @description 不访问 DB 或外部依赖，不返回环境变量或依赖细节。
         */
        get: operations["getHealth"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/ready": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 业务就绪探针
         * @description 检查 DB、schema/migration、生产 auth 配置、import storage 写入/按 key/hash/size
         *     重读完整性与首发内容就绪。
         *     可选 ranker 失败不得拉低 readiness；响应不得含密钥、DSN 或异常文本。
         */
        get: operations["getReadiness"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/auth/mock-login": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 创建非生产 mock 会话
         * @description 仅允许在非生产且 `AUTH_MODE=mock` 时注册。生产环境若仍注册本路由，
         *     进程必须在监听端口前退出。
         */
        post: operations["mockLogin"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/auth/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 获取当前已验签身份 */
        get: operations["getCurrentUser"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/notices/current": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 获取当前明确告知版本与本用户决定
         * @description 返回唯一 `status=current` 的 notice，以及当前 token 用户对该版本的首次决定。
         *     decision 为 null 时，客户端必须展示一次明确告知；不得把页面浏览等同于接受。
         */
        get: operations["getCurrentPrivacyNotice"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/notices/{version}/decision": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 记录当前用户对明确告知版本的首次决定
         * @description 只接受当前 notice version。服务端从 token 写 user_id；同一 user/version 只保留
         *     第一条决定。同幂等键重放首次终态；同版本已存在不同决定返回 409，禁止覆盖审计证据。
         */
        post: operations["recordPrivacyNoticeDecision"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/search": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 在当前 release snapshot 中搜索客服话术
         * @description `query_id` 是本路由的幂等键。相同 user/query_id/body 的终态请求重放首次
         *     响应；同 query_id 异体返回 409。redaction 失败时 fail-closed，不记录原文、
         *     不调用 ranker，并返回 500。`rewrite=false` 时 `answer_text` 必须字节级等于
         *     当前 release item 的正文。`collection_mode=pilot_recorded` 时服务端必须确认当前
         *     notice version 已被当前用户接受；未接受或 notice 校验不可用时 fail-closed。
         *     仅 telemetry 写入故障且 auth、DLP、当前内容与检索仍健康时，可返回
         *     `telemetry_status=collection_disabled` 的无状态结果；该路径不得写 query/impression，
         *     不接受后续 adoption/escalate，并自动排除所有指标。DLP/Auth/content 失败不得降级。
         *     在线召回主路固定为 PostgreSQL 字符 bigram + normalize + exact/ILIKE 回退；候选必须
         *     原样绑定本次 release item 的 release_id/script_id/script_version/content_hash。
         *     `platform_source=native_integration` 是未来保留值；Phase 1 必须返回 403
         *     `POLICY_DENIED` 且不写 query/impression/event。
         *     服务端必须先验证 current release 的四域 source gate；集合缺失、哈希不一致或任一
         *     source 已暂停时返回 503 `SOURCE_GATE_NOT_READY`，且 query/impression/event 零写入。
         *     同时必须调用与 SQL `content_scope_matches` 同义的过滤：平台必须显式命中
         *     `platform_scope`；storewide 内容可在无商品上下文时命中，category/sku 内容必须分别
         *     收到同类型 `product_context_type + product_context_ref` 精确命中。禁止把 category 当 sku 或猜测范围。
         *     handler 必须使用 `SearchResponse`/`SearchCandidate` 白名单显式映射；
         *     禁止 spread DB row 或重用内部审核/来源对象。
         */
        post: operations["searchScripts"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/events/adoption": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 记录当前用户的复制成功或退出结果（adoption 兼容名）
         * @description query 必须属于当前 token 用户。`adopted` 的冻结语义是候选已成功复制，不代表
         *     已发送或正确；历史字段名 `push_method` 保持兼容。adopted 必须引用同一 query
         *     的真实候选，且 push_method 只能是 clipboard 或 autofill；未复制类 outcome
         *     不得携带候选。`collection_disabled` 的无状态搜索没有 query 事件，不得调用本路由。
         *     每个 query 只能写一个 terminal outcome。`timeout` 只能由客户端窗口关闭、切后台或
         *     idle 达到部署配置 `CLIENT_ACTION_TIMEOUT_MS` 后上报，服务端不得凭请求延迟猜测 timeout。
         */
        post: operations["recordAdoption"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/events/escalate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 记录非终态的人工升级辅助动作
         * @description escalation 不结束 query；query 的唯一 terminal 事实仍由 adoption endpoint 写入。
         *     同一 query 可记录不同 action，但 `(query_id, action)` 只允许一条；同幂等键同体重放
         *     首次 200，重复 action 返回同一事实，异体返回 409。动作只证明产品内按钮已执行，
         *     不证明外部人工已接单或问题已解决。
         */
        post: operations["recordEscalation"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/metrics/tool": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 查询根问题与搜索操作双口径的自动事实指标
         * @description 只返回自动记录的搜索、候选、成功复制/退出和辅助升级动作；禁止返回发送、正确性、
         *     满意度或转化率推断。root question 是 original query 及其全部 reselection 后代；
         *     search operation 是每一条 query。两套分母必须同时返回，不得混算。
         *     collection_disabled 无状态搜索没有 query/impression/event 行，必须排除全部分母。
         */
        get: operations["getToolMetrics"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/metrics/stream": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 分页查询搜索、复制 terminal 与升级辅助动作事件流
         * @description coach/owner 可按授权范围读取；agent 只能读取自己的 user_id。cursor 是不透明的
         *     base64url 值，内部编码为 `iso_created_at + "|" + query_id`，客户端不得自行改写。
         */
        get: operations["getMetricsStream"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/metrics/iteration-tasks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 分页查询话术优化待办
         * @description 仅返回由搜索 / 复制兼容信号生成的内部话术优化待办。不得返回业务工单原始明细，
         *     也不得使用 ticket 命名。
         */
        get: operations["listIterationTasks"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/events/iteration-tasks/{task_id}/start": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 开始处理话术优化待办
         * @description 仅允许 open 到 in_progress；expected_version 不匹配返回 409，禁止覆盖并发更新。
         */
        post: operations["startIterationTask"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/events/iteration-tasks/{task_id}/close": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 关闭话术优化待办
         * @description 仅允许 in_progress 到 resolved 或 wont_fix。关闭待办不等于内容已经发布，
         *     且系统不得自动修改 Answer。
         */
        post: operations["closeIterationTask"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/work-orders/imports": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 提交业务工单导出文件分析批次
         * @description 仅接收批准的 CSV/XLSX。受控原稿持久化且 work_order_import_batches 与
         *     work_order_import_validate outbox 同事务提交后才可返回 202。未知列、敏感列、
         *     恶意公式和超限文件必须拒绝；不得连接班牛写接口。
         */
        post: operations["createWorkOrderImport"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/work-orders/imports/{import_batch_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 查询业务工单分析导入批次 */
        get: operations["getWorkOrderImport"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/work-orders/analysis": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 查询业务工单聚合分析
         * @description 时间窗为半开区间且最多 31 天；每个聚合必须返回批次、筛选口径和刷新时间。
         */
        get: operations["getWorkOrderAnalysis"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/work-orders/records": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 分页下钻业务工单标准化明细
         * @description 只返回批准白名单字段、内部 UUID 与安全 hash；不得返回原始客户、订单或工单长编号。
         */
        get: operations["listWorkOrderRecords"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/work-orders/analysis/export": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 导出当前筛选范围的脱敏业务工单分析
         * @description 仅导出批准字段并只追加审计。文件名不得含客户、订单或原始工单编号；
         *     超出同步上限返回 400。不存在任何源系统写回副作用。
         */
        get: operations["exportWorkOrderAnalysis"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/content/import": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 提交异步内容导入批次
         * @description 仅当受控文件已持久化，且 import_batches(validating) 与 import_validate outbox
         *     及 source_bindings 在同一数据库事务提交后，才可返回 202。source_bindings 只接收
         *     已登记的 canonical source_version_id；未知、reference-only、已暂停、域不匹配或
         *     snapshot hash 不匹配均硬拒绝且不得创建 batch/outbox。只进入内存队列不得返回 202。
         *     规范化行必须完成 DEC-042 的 scope/taxonomy/question/review/placeholder/hash 校验。
         *     结构、安全或来源错误使整批 failed 且不持久 staging；只有可安全展示的质量问题可
         *     持久为 `quality_status=quarantined`。发布仅消费 `clean + quality_gate_passed`。
         *     拒绝审计必须在原事务回滚后另开独立事务，仅记录稳定 reason、diagnostic_id 与安全 ID/hash。
         */
        post: operations["createContentImport"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/content/import/{import_batch_id}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @example imp-01J4PF9TQX7G */
                import_batch_id: components["parameters"]["ImportBatchId"];
            };
            cookie?: never;
        };
        /** 查询导入批次状态与预览 */
        get: operations["getContentImport"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/content/import/{import_batch_id}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @example imp-01J4PF9TQX7G */
                import_batch_id: components["parameters"]["ImportBatchId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 取消 validating 或 staged 导入批次
         * @description Owner 可取消任意授权批次；coach 只能取消自己发起的批次。
         */
        post: operations["cancelContentImport"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/content/publish": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 将 staged 批次发布为新的 current release
         * @description 一期仅 Owner。调用受控 publish_content_release 事务并使用全站 try-lock；第二个
         *     并发发布立即返回 409。发布必须 CAS 校验 base_release_id，原子写入四域绑定、内容
         *     快照、current、公告与审计。被本批次绑定的域按全域快照替换，不保留该域旧来源残行。
         *     只发布 `quality_status=clean AND quality_gate_passed=true` 的行，且二次计算
         *     `SHA-256(JCS(normalized governance snapshot))`；quarantined 行保留在导入证据中而不进 release。
         */
        post: operations["publishContent"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/content/rollback": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 把目标快照复制为新的 current release
         * @description 一期仅 Owner。回滚创建新的单调 release_seq，并写 rollback_of_release_id；
         *     禁止原地修改历史 release，也禁止直接把 current 指针改回旧 release。目标 release
         *     的四域绑定也复制到新 release；任一来源已暂停、绑定哈希不一致或任一
         *     DEC-042 治理快照 hash 不一致时硬拒绝。
         */
        post: operations["rollbackContent"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/announce/current": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 获取当前 release 与公告
         * @description 服务端必须以 `read_current_announcement_with_lease` 作为唯一内容读取边界；该
         *     SECURITY DEFINER 函数在同一受控边界内复核 current 与四域 source gate、调用
         *     `issue_snapshot_offline_lease` 并投影最小公告字段。app_runtime 不得直接读取
         *     content_current/content_releases/release_source_bindings/announcements 等 SoR 底表。
         *     集合缺失、哈希不一致、非 canonical 或已暂停时 fail-closed 返回 503 `SOURCE_GATE_NOT_READY`，
         *     不得把故障版本当成当前公告。通过后签发绑定
         *     client/user/release/source_binding_hash 的 60..900 秒短租约。该路由不写
         *     query/impression/event。
         *     只有请求携带的原租约仍有效时才能 304；304 只回显原 token/expires，不续期。
         *     handler 必须通过 `CurrentAnnouncementResponse` 的显式白名单 mapper
         *     构造响应，禁止 spread DB row/内部 announcement 对象。
         */
        get: operations["getCurrentAnnouncement"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/announce/snapshot": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 在固定 release_id 下分页拉取完整快照
         * @description 本路由返回固定 release 的完整、不可变内容快照，包括尚未到
         *     `effective_from` 或已到 `effective_to` 的历史快照项，以保证跨页集合稳定。
         *     服务端不得按请求时间过滤快照项，也不承诺响应中的每项在请求时仍有效。
         *     后续页必须沿用第一页的 release_id；cursor 是上一页最后一个 script_id。服务端每页均
         *     只调用 `read_snapshot_page`；该 SECURITY DEFINER 函数在同一 SQL statement
         *     snapshot 内调用 `validate_snapshot_offline_lease`，复核 client/user/release/
         *     source hash/过期时间与目标 release source gate，再按 script_id 稳定分页并只投影
         *     wire 白名单字段。app_runtime 不得直接读取 release_items 或自行拼接分页 SQL。
         *     已暂停来源返回 403，其余不完整/哈希故障返回 503；任何失败都不得返回剩余域的
         *     部分快照。token 无效、绑定不匹配或过期均返回 403 且不返回部分 items。客户端
         *     每次本地检索都必须以本地 `now` 执行
         *     `effective_from <= now AND (effective_to IS NULL OR now < effective_to)`；
         *     `now == effective_to` 时必须排除。离线租约过期后必须立即停止本地搜索，
         *     在线重新取得 current 租约后才能恢复。handler 必须显式映射
         *     `SnapshotResponse`/`SnapshotItem`/`PublicSnapshotQuestion` 白名单，
         *     禁止 spread DB row 或内部 `ContentQuestion`。
         */
        get: operations["getAnnouncementSnapshot"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/announce/ack": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 确认客户端已完成固定 release 的快照同步
         * @description ACK 只表示客户端内容游标，不表示用户已读。乱序旧 ACK 返回 200，但不得回退
         *     last_seen_release_seq；client_id 被另一用户占用时返回 403。ACK 必须验证当次
         *     token 与 client/user/release/source_binding_hash 及 expires_at，记录 token hash；
         *     路由只调用 `ack_client_release(client_id,user_id,release_id,release_seq,
         *     offline_lease_token)`；不得 UPDATE `snapshot_offline_leases`，不得续期。来源门或
         *     离线租约拒绝必须先回滚 ACK 业务事务，再用独立幂等短事务调用
         *     `record_runtime_source_denial_audit` 并 commit，最后才返回 HTTP denial；ACK 的
         *     其他内容错误只走标准受控 error audit。
         */
        post: operations["acknowledgeAnnouncement"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/policy": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 获取一期策略与只读鉴权模式
         * @description 未知 flag 读取按最严 OFF；auth_mode 只来自部署配置，不属于 policy_flags。
         */
        get: operations["getPolicy"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/policy/flags": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 通过唯一受控入口写策略开关
         * @description 一期仅 Owner，且服务端必须调用 set_policy_flag。rewrite=true 或 auto_send=true
         *     即使带 ADR 也必须返回 403 POLICY_DENIED；mock_auth 与未知 key 返回 400。
         */
        post: operations["setPolicyFlag"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /**
         * @description 只允许来自服务端验签后的会话 claims。
         * @enum {string}
         */
        Role: "agent" | "coach" | "owner";
        /** @enum {string} */
        AuthMode: "mock" | "feishu";
        /** @enum {string} */
        ErrorCode: "UNAUTHORIZED" | "FORBIDDEN" | "VALIDATION" | "NOT_FOUND" | "CONFLICT" | "POLICY_DENIED" | "RATE_LIMITED" | "OVERLOADED" | "INTERNAL";
        /**
         * @description 来源、租约与内容治理的稳定拒绝原因，必须放在 `error.details.reason`；
         *     客户端不得解析 message 文本。只有 `info.x-source-denial-audit.applies-to-reasons`
         *     白名单中的值才能写入 source_denial_audits。
         * @enum {string}
         */
        SourceContractReason: "SOURCE_NOT_REGISTERED" | "SOURCE_NOT_ELIGIBLE" | "SOURCE_SUSPENDED" | "SOURCE_DOMAIN_MISMATCH" | "SOURCE_SNAPSHOT_MISMATCH" | "SOURCE_SET_INCOMPLETE" | "SOURCE_BASE_RELEASE_STALE" | "SOURCE_BINDING_HASH_MISMATCH" | "SOURCE_GATE_NOT_READY" | "SOURCE_HISTORY_IMMUTABLE" | "OFFLINE_LEASE_INVALID" | "OFFLINE_LEASE_EXPIRED" | "OFFLINE_LEASE_BINDING_MISMATCH" | "CONTENT_CONTRACT_INVALID" | "GOVERNANCE_HASH_MISMATCH" | "QUALITY_GATE_NOT_PASSED" | "QUESTION_IDENTITY_CONFLICT" | "PHASE1_HARD_OFF" | "NATIVE_INTEGRATION_DISABLED";
        HealthResponse: {
            /** @constant */
            status: "ok";
            /** @constant */
            service: "cs-ai-api";
            version: string;
        };
        /** @enum {string} */
        ReadyCheckStatus: "ok" | "not_ready";
        ReadyChecks: {
            database: components["schemas"]["ReadyCheckStatus"];
            schema: components["schemas"]["ReadyCheckStatus"];
            auth: components["schemas"]["ReadyCheckStatus"];
            storage: components["schemas"]["ReadyCheckStatus"];
            content: components["schemas"]["ReadyCheckStatus"];
        };
        ReadyResponse: {
            /** @constant */
            status: "ready";
            checks: components["schemas"]["ReadyChecks"] & {
                /** @constant */
                database?: "ok";
                /** @constant */
                schema?: "ok";
                /** @constant */
                auth?: "ok";
                /** @constant */
                storage?: "ok";
                /** @constant */
                content?: "ok";
            };
        };
        NotReadyResponse: {
            /** @constant */
            status: "not_ready";
            checks: components["schemas"]["ReadyChecks"] & ({
                /** @constant */
                database: "not_ready";
            } | {
                /** @constant */
                schema: "not_ready";
            } | {
                /** @constant */
                auth: "not_ready";
            } | {
                /** @constant */
                storage: "not_ready";
            } | {
                /** @constant */
                content: "not_ready";
            });
        };
        ValidationErrorEnvelope: {
            error: {
                code: components["schemas"]["ErrorCode"] & "VALIDATION";
                message: string;
                details?: {
                    [key: string]: unknown;
                };
            };
        };
        UnauthorizedErrorEnvelope: {
            error: {
                code: components["schemas"]["ErrorCode"] & "UNAUTHORIZED";
                message: string;
                details?: {
                    [key: string]: unknown;
                };
            };
        };
        ForbiddenErrorEnvelope: {
            error: {
                code: components["schemas"]["ErrorCode"] & "FORBIDDEN";
                message: string;
                details?: {
                    [key: string]: unknown;
                };
            };
        };
        ForbiddenOrPolicyDeniedErrorEnvelope: {
            error: {
                code: components["schemas"]["ErrorCode"] & ("FORBIDDEN" | "POLICY_DENIED");
                message: string;
                details?: {
                    reason?: components["schemas"]["SourceContractReason"];
                } & {
                    [key: string]: unknown;
                };
            };
        };
        NotFoundErrorEnvelope: {
            error: {
                code: components["schemas"]["ErrorCode"] & "NOT_FOUND";
                message: string;
                details?: {
                    [key: string]: unknown;
                };
            };
        };
        ConflictErrorEnvelope: {
            error: {
                code: components["schemas"]["ErrorCode"] & "CONFLICT";
                message: string;
                details?: {
                    [key: string]: unknown;
                };
            };
        };
        RateLimitedErrorEnvelope: {
            error: {
                code: components["schemas"]["ErrorCode"] & "RATE_LIMITED";
                message: string;
                details?: {
                    [key: string]: unknown;
                };
            };
        };
        OverloadedErrorEnvelope: {
            error: {
                code: components["schemas"]["ErrorCode"] & "OVERLOADED";
                message: string;
                details?: {
                    /** @enum {unknown} */
                    reason?: "DB_POOL_EXHAUSTED" | "CONCURRENCY_LIMIT" | "RATE_LIMIT_STORAGE_UNAVAILABLE" | "STORAGE_UNAVAILABLE" | "SOURCE_GATE_NOT_READY";
                } & {
                    [key: string]: unknown;
                };
            };
        };
        ContentNotReadyErrorEnvelope: {
            error: {
                code: components["schemas"]["ErrorCode"] & "OVERLOADED";
                message: string;
                details: {
                    /** @constant */
                    reason: "CONTENT_NOT_READY";
                } & {
                    [key: string]: unknown;
                };
            };
        };
        InternalErrorEnvelope: {
            error: {
                code: components["schemas"]["ErrorCode"] & "INTERNAL";
                message: string;
                details?: {
                    [key: string]: unknown;
                };
            };
        };
        UserClaims: {
            user_id: string;
            role: components["schemas"]["Role"];
        };
        MockLoginRequest: components["schemas"]["UserClaims"];
        MockLoginResponse: {
            token: string;
            user: components["schemas"]["UserClaims"];
        };
        CurrentUserResponse: components["schemas"]["UserClaims"] & {
            auth_mode: components["schemas"]["AuthMode"];
        };
        /** @enum {string} */
        NoticeDecision: "accepted" | "declined";
        PrivacyNotice: {
            version: string;
            content: string;
            content_hash: components["schemas"]["ContentHash"];
            /** Format: date-time */
            published_at: string;
        };
        CurrentNoticeResponse: {
            notice: components["schemas"]["PrivacyNotice"];
            decision: components["schemas"]["NoticeDecision"] | null;
            /** Format: date-time */
            decided_at: string | null;
        };
        NoticeDecisionRequest: {
            decision: components["schemas"]["NoticeDecision"];
        };
        NoticeDecisionResponse: {
            /** @constant */
            ok: true;
            version: string;
            decision: components["schemas"]["NoticeDecision"];
            /** Format: date-time */
            decided_at: string;
        };
        /**
         * @description 已确认的规范平台；无法确认时显式 unknown 或 null。
         * @enum {string|null}
         */
        Platform: "qianniu" | "douyin" | "unknown" | null;
        /**
         * @description 数据来源授权模式。pilot_recorded 需要服务端验证当前用户已接受 current notice；
         *     该校验依赖服务端状态，不能只靠 JSON Schema。
         * @enum {string}
         */
        CollectionMode: "synthetic" | "approved_redacted" | "pilot_recorded";
        /**
         * @description Phase 1 的 platform 仍必须经用户确认。manual=直接选择或修正；
         *     foreground_process=用户接受本次唤起时的一次性进程提示，此时必须
         *     detected_platform=platform；native_integration 为未来预留，Phase 1 请求该值
         *     必须 403 POLICY_DENIED 且零写入；unknown 时 platform 只能为 unknown/null。
         *     禁止将该字段解释为全局监控、未确认真值或客户端自证的原生来源。
         * @enum {string}
         */
        PlatformSource: "manual" | "foreground_process" | "native_integration" | "unknown";
        /**
         * @description original=一个根问题的首次搜索；reselection=父操作 terminal 后的再次选择/搜索。
         * @enum {string}
         */
        InteractionReason: "original" | "reselection";
        SearchRequest: ({
            /**
             * Format: uuid
             * @description 当前用户在本路由的幂等键。
             */
            query_id: string;
            /**
             * Format: uuid
             * @description reselection 必须引用同一用户、已经写入 terminal adoption outcome 的父 query。
             */
            parent_query_id: string | null;
            interaction_reason: components["schemas"]["InteractionReason"];
            /** @description 原始输入按 Unicode code point 计 1..500；超限返回 400 VALIDATION。 */
            query_text: string;
            collection_mode: components["schemas"]["CollectionMode"];
            detected_platform: components["schemas"]["Platform"];
            platform: components["schemas"]["Platform"];
            platform_source: components["schemas"]["PlatformSource"];
            /**
             * @description 商品上下文类型；不得用 sku 字段代替 category 范围。
             * @enum {string|null}
             */
            product_context_type: "category" | "sku" | null;
            /** @description 对应 category 或 sku 的规范引用；服务端只持久版本化 HMAC，不持久原值。 */
            product_context_ref: string | null;
            /** @default 3 */
            top_k: number;
        } & ({
            product_context_type?: null;
            product_context_ref?: null;
        } | {
            /** @constant */
            product_context_type?: "category";
            product_context_ref?: string;
        } | {
            /** @constant */
            product_context_type?: "sku";
            product_context_ref?: string;
        })) & ({
            /** @constant */
            interaction_reason?: "original";
            parent_query_id?: null;
        } | {
            /** @constant */
            interaction_reason?: "reselection";
            /** Format: uuid */
            parent_query_id?: string;
        });
        /** @enum {string} */
        HitStatus: "hit" | "no_hit";
        /**
         * @description `SHA-256(JCS(normalized governance snapshot))` 的小写十六进制值，不再是 Answer 单字段 hash。
         *     Answer、Question 映射、scope、taxonomy、risk/review、有效期或 placeholder 任一变更均生成
         *     新 script_version 和新 content_hash。
         */
        ContentHash: string;
        /** @description 已登记的不可变权威来源版本 ID；不得放入 URL、token 或路径。 */
        AuthoritativeSourceVersionId: string;
        /** @description 可向客服与审计界面展示的稳定别名，不是内部资源定位符。 */
        SafeSourceRef: string;
        /** @description 按 domain 排序后对 `domain:source_version_id` 四域集合计算的 sha256。 */
        SourceBindingHash: string;
        /**
         * @description 一次性签发的不透明 bearer token；服务端只存 sha256。不得写入日志、
         *     denial audit 或 source_ref，不得作为 URL 参数。
         */
        OfflineSnapshotLeaseToken: string;
        /**
         * @description token、release_id、source_binding_hash、expires_at 必须作为一个原子包保存和校验；
         *     任一字段缺失/不匹配或 `now >= expires_at` 都 fail-closed。
         */
        OfflineSnapshotLease: {
            token: components["schemas"]["OfflineSnapshotLeaseToken"];
            /**
             * Format: date-time
             * @description 签发后 60..900 秒。客户端每次本地检索前都必须检查该时间；
             *     `now >= expires_at` 时必须立即停止本地搜索。
             */
            expires_at: string;
            release_id: string;
            source_binding_hash: components["schemas"]["SourceBindingHash"];
        };
        AuthoritativeSourceBinding: {
            domain: components["schemas"]["ScriptCategory"];
            source_version_id: components["schemas"]["AuthoritativeSourceVersionId"];
        };
        AuthoritativeSourceBindingStatus: {
            domain: components["schemas"]["ScriptCategory"];
            source_version_id: components["schemas"]["AuthoritativeSourceVersionId"];
            source_ref: components["schemas"]["SafeSourceRef"];
        };
        /** @enum {string} */
        ScriptCategory: "presale" | "campaign" | "aftersale" | "product";
        /** @description 必填且非空；两值同时存在表示 both，禁止 null/[] 表示全平台。 */
        PlatformScope: ("qianniu" | "douyin")[];
        /** @enum {string} */
        ProductScopeType: "storewide" | "category" | "sku";
        /** @description storewide 必须为 []；category/sku 必须非空。 */
        ProductScopeRefs: string[];
        IntentTaxonomyVersion: string;
        IntentId: string;
        /** @enum {string} */
        RiskLevel: "low" | "medium" | "high";
        /** @enum {string} */
        RiskCategory: "refund_compensation" | "price_discount" | "campaign_rules" | "efficacy_safety_claim" | "account_privacy" | "complaint_escalation" | "legal_commitment";
        /** @description high 必须至少一类；low/medium 必须为空数组。 */
        RiskCategories: components["schemas"]["RiskCategory"][];
        /** @enum {string} */
        ReviewMode: "single" | "dual";
        /** @enum {string} */
        PlaceholderKey: "order_id" | "date";
        /** @enum {string} */
        QuestionSource: "manual" | "from_log" | "import";
        ContentQuestion: {
            /** @description 上游给定的稳定随机 ID；禁止从行号、排序或数组下标派生。 */
            question_id: string;
            question_version: number;
            question_text: string;
            question_hash: string;
            semantic_family_id: string;
            /** @description 版本化密钥计算的 HMAC 指纹；不是原始客户文本。 */
            origin_fingerprint: string;
            /** @description 计算 origin_fingerprint 的服务端 HMAC 密钥版本；不含密钥材料。 */
            origin_fingerprint_key_version: string;
            source_asset_id: string;
            source: components["schemas"]["QuestionSource"];
            intent_taxonomy_version: components["schemas"]["IntentTaxonomyVersion"];
            intent_id: components["schemas"]["IntentId"];
            source_query_id?: string | null;
            promotion_review_ref?: string | null;
            promoted_by_role?: string | null;
            /** Format: date-time */
            promoted_at?: string | null;
        } & ({
            /** @constant */
            source?: "from_log";
            source_query_id: string;
            promotion_review_ref: string;
            promoted_by_role: string;
            /** Format: date-time */
            promoted_at: string;
        } | {
            /** @enum {unknown} */
            source?: "manual" | "import";
            source_query_id?: null;
            promotion_review_ref?: null;
            promoted_by_role?: null;
            promoted_at?: null;
        });
        /**
         * @description 公开检索候选的封闭白名单投影。handler 必须逐字段构造，禁止
         *     DB row/internal object spread；不含审核证据、负责人或内部来源定位符。
         */
        SearchCandidate: {
            rank: number;
            /** @description 与本候选不可变绑定的 release_items.release_id，必须等于响应顶层 release_id。 */
            release_id: string;
            script_id: string;
            script_version: number;
            content_hash: components["schemas"]["ContentHash"];
            title: string;
            category: components["schemas"]["ScriptCategory"];
            /** @description Phase 1 必须原样来自当前 release_items，不得改写。 */
            answer_text: string;
            platform_scope: components["schemas"]["PlatformScope"];
            product_scope_type: components["schemas"]["ProductScopeType"];
            product_scope_refs: components["schemas"]["ProductScopeRefs"];
            /**
             * Format: date-time
             * @description 包含下界；只有 `effective_from <= now` 才可推荐。
             */
            effective_from: string;
            /**
             * Format: date-time
             * @description 排他上界；只有 `now < effective_to` 才可推荐，`now == effective_to` 必须排除。
             */
            effective_to: string | null;
            intent_taxonomy_version: components["schemas"]["IntentTaxonomyVersion"];
            intent_id: components["schemas"]["IntentId"];
            risk_level: components["schemas"]["RiskLevel"];
            risk_categories: components["schemas"]["RiskCategories"];
            has_conflict: boolean;
            /** @description 仅声明机器键；值与渲染后正文不得进入 API 或事件。 */
            placeholder_keys: components["schemas"]["PlaceholderKey"][];
        } & (({
            /** @constant */
            product_scope_type?: "storewide";
            product_scope_refs?: unknown;
        } | {
            /** @enum {unknown} */
            product_scope_type?: "category" | "sku";
            product_scope_refs?: unknown;
        }) & ({
            /** @enum {unknown} */
            risk_level?: "low" | "medium";
            risk_categories?: unknown;
        } | {
            /** @constant */
            risk_level?: "high";
            risk_categories?: unknown;
        }));
        /**
         * @description collection_disabled 只允许 telemetry 写故障时的无状态检索；不写 query/impression/event，
         *     客户端不得随后提交 adoption/escalate，该次也不进入指标。
         * @enum {string}
         */
        TelemetryStatus: "recorded" | "collection_disabled";
        /** @description 检索 handler 的封闭白名单响应；顶层与每个 candidate 都禁止未声明字段。 */
        SearchResponse: {
            /** Format: uuid */
            query_id: string;
            hit_status: components["schemas"]["HitStatus"];
            release_id: string;
            source_binding_hash: components["schemas"]["SourceBindingHash"];
            telemetry_status: components["schemas"]["TelemetryStatus"];
            candidates: components["schemas"]["SearchCandidate"][];
        } & ({
            /** @constant */
            hit_status?: "hit";
            candidates?: unknown;
        } | {
            /** @constant */
            hit_status?: "no_hit";
            candidates?: unknown;
        });
        /**
         * @description adopted 仅表示候选已成功复制，不表示已发送、正确或客户已接受。timeout 是客户端
         *     生命周期达到 CLIENT_ACTION_TIMEOUT_MS 后上报的 terminal，不由服务端延迟推断。
         * @enum {string}
         */
        AdoptionOutcome: "adopted" | "dismissed" | "no_hit_exit" | "timeout";
        /** @enum {string|null} */
        PushMethod: "clipboard" | "autofill" | "failed" | "pending" | null;
        AdoptionEventRequest: components["schemas"]["AdoptedEventRequest"] | components["schemas"]["NonAdoptedEventRequest"];
        AdoptedEventRequest: {
            /** Format: uuid */
            query_id: string;
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            outcome: "adopted";
            chosen_rank: number;
            chosen_script_id: string;
            /** @enum {string} */
            push_method: "clipboard" | "autofill";
        };
        NonAdoptedEventRequest: {
            /** Format: uuid */
            query_id: string;
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            outcome: "dismissed" | "no_hit_exit" | "timeout";
            chosen_rank: null;
            chosen_script_id: null;
            push_method: components["schemas"]["PushMethod"];
        };
        AdoptionEventResponse: {
            /** @constant */
            ok: true;
            /** Format: uuid */
            query_id: string;
        };
        /** @enum {string} */
        EscalationAction: "open_feishu" | "copy_contact" | "other";
        EscalationRequest: {
            /** Format: uuid */
            query_id: string;
            action: components["schemas"]["EscalationAction"];
        };
        EscalationResponse: {
            escalate_id: string;
            /** Format: uuid */
            query_id: string;
            action: components["schemas"]["EscalationAction"];
        };
        /** Format: double */
        Rate: number;
        ToolMetricsResponse: {
            /** @description interaction_reason=original 的根问题数。 */
            root_question_count: number;
            /** @description 全部 query 操作数；包含 original 与 reselection。 */
            search_operation_count: number;
            /** @description interaction_reason=reselection 的操作数。 */
            reselection_count: number;
            /** @description 任一链上操作成功复制的去重根问题数，不代表已发送或正确。 */
            root_adopted_count: number;
            /** @description outcome=adopted 的搜索操作数，只表示成功复制。 */
            operation_adopted_count: number;
            /** @description root_adopted_count / root_question_count；无分母时返回 0。 */
            root_adoption_rate: components["schemas"]["Rate"];
            /** @description operation_adopted_count / search_operation_count；无分母时返回 0。 */
            operation_adoption_rate: components["schemas"]["Rate"];
            /** @description hit_status=no_hit 的搜索操作数。 */
            operation_no_hit_count: number;
            /** @description operation_no_hit_count / search_operation_count；无分母时返回 0。 */
            operation_no_hit_rate: components["schemas"]["Rate"];
            /** @description chosen_rank=1 的成功复制操作 / operation_adopted_count；无分母时返回 0。 */
            top1_copy_share: components["schemas"]["Rate"];
            /** @description 链内至少有一个辅助升级动作的去重根问题数。 */
            root_escalated_count: number;
            /** @description 全部去重 (query_id, action) 动作数；同一 query 可贡献多个不同 action。 */
            escalate_action_count: number;
            /** @description root_escalated_count / root_question_count；非解决率，无分母时返回 0。 */
            root_escalation_rate: components["schemas"]["Rate"];
            /** @description 有录制查询时返回延迟 P95；空窗口返回 null，不用 0 冒充未知。 */
            p95_latency_ms: number | null;
        };
        /** @description metrics stream 中的候选展示投影，不包含 answer_text。 */
        MetricCandidate: {
            rank: number;
            /** @description 候选不可变快照 release；与同一流项的 release_id 一致。 */
            release_id: string;
            script_id: string;
            script_version: number;
            content_hash: components["schemas"]["ContentHash"];
            source_ref: components["schemas"]["SafeSourceRef"];
            source_version_id: components["schemas"]["AuthoritativeSourceVersionId"];
            /** Format: date-time */
            effective_from: string | null;
            /** Format: date-time */
            effective_to: string | null;
            /** Format: date-time */
            review_due_at: string;
        };
        MetricsStreamItem: {
            /** Format: uuid */
            query_id: string;
            /**
             * Format: uuid
             * @description 沿 parent_query_id 追溯得到的 original query_id。
             */
            root_query_id: string;
            /** Format: uuid */
            parent_query_id: string | null;
            interaction_reason: components["schemas"]["InteractionReason"];
            user_id: string;
            /** @description text_storage_status=suppressed 时必须为 null。 */
            query_text_redacted: string | null;
            /** @enum {string} */
            text_storage_status: "stored" | "suppressed";
            platform: components["schemas"]["Platform"];
            platform_source: components["schemas"]["PlatformSource"];
            hit_status: components["schemas"]["HitStatus"];
            outcome: components["schemas"]["AdoptionOutcome"] | null;
            chosen_rank: number | null;
            push_method: components["schemas"]["PushMethod"] | null;
            release_id: string;
            latency_ms: number | null;
            /** Format: date-time */
            created_at: string;
            /** @description 非终态辅助事实；按 action 去重，不证明外部人工已接单或已解决。 */
            escalate_actions: components["schemas"]["EscalationFact"][];
            candidates: components["schemas"]["MetricCandidate"][];
        };
        EscalationFact: {
            escalate_id: string;
            action: components["schemas"]["EscalationAction"];
            /** Format: date-time */
            created_at: string;
        };
        MetricsStreamResponse: {
            items: components["schemas"]["MetricsStreamItem"][];
            /** @description 不透明 base64url cursor；无更多数据时为 null。 */
            next_cursor: string | null;
        };
        /** @enum {string} */
        IterationTaskStatus: "open" | "in_progress" | "resolved" | "wont_fix";
        /** @enum {string} */
        IterationTaskCause: "content_gap" | "ranking" | "stale" | "mixed";
        IterationTask: {
            task_id: string;
            signal_id: string;
            cluster_key: string;
            sample_query_ids: string[];
            suspected_cause: components["schemas"]["IterationTaskCause"];
            suggested_script_ids: string[];
            status: components["schemas"]["IterationTaskStatus"];
            assignee_role?: string | null;
            /** @enum {string|null} */
            resolution?: "resolved" | "wont_fix" | null;
            resolution_note?: string | null;
            version: number;
            /** Format: date-time */
            created_at: string;
            /** Format: date-time */
            updated_at: string;
            /** Format: date-time */
            resolved_at?: string | null;
        };
        IterationTaskListResponse: {
            items: components["schemas"]["IterationTask"][];
            next_cursor: string | null;
        };
        IterationTaskStartRequest: {
            expected_version: number;
        };
        IterationTaskCloseRequest: {
            expected_version: number;
            /** @enum {string} */
            status: "resolved" | "wont_fix";
            resolution_note: string;
        };
        WorkOrderImportRequest: {
            /**
             * Format: binary
             * @description 批准的 CSV/XLSX；原始文件名不进入业务分析结果或导出文件名。
             */
            file: string;
            /** @example banniu_export */
            source_system: string;
            mapping_version: string;
            /** Format: date-time */
            data_from?: string;
            /** Format: date-time */
            data_to?: string;
        };
        WorkOrderImportAcceptedResponse: {
            import_batch_id: string;
            /** @constant */
            status: "validating";
        };
        /** @enum {string} */
        WorkOrderImportStatus: "received" | "validating" | "ready" | "failed";
        /** @enum {string} */
        WorkOrderImportIssueCode: "MISSING_REQUIRED_FIELD" | "INVALID_FIELD_TYPE" | "INVALID_VALUE" | "DUPLICATE_SOURCE_RECORD" | "UNKNOWN_COLUMN" | "SENSITIVE_COLUMN" | "INVALID_DATE" | "INVALID_DURATION" | "HASH_MISMATCH" | "UNSUPPORTED_FORMAT" | "FORMULA_DETECTED" | "ROW_LIMIT_EXCEEDED" | "FILE_TOO_LARGE";
        WorkOrderImportFailureReport: {
            /** @enum {string} */
            code: "VALIDATION_FAILED" | "SOURCE_UNREADABLE" | "HASH_MISMATCH" | "UNSUPPORTED_FORMAT" | "STORAGE_UNAVAILABLE" | "MAX_ATTEMPTS_EXHAUSTED";
            diagnostic_id: string;
            row?: number;
            column?: number;
            error_count?: number;
            issue_codes?: components["schemas"]["WorkOrderImportIssueCode"][];
        };
        WorkOrderImportStatusResponse: {
            import_batch_id: string;
            status: components["schemas"]["WorkOrderImportStatus"];
            source_system: string;
            mapping_version: string;
            record_count: number;
            accepted_count: number;
            rejected_count: number;
            /** Format: date-time */
            data_from?: string | null;
            /** Format: date-time */
            data_to?: string | null;
            error_report: components["schemas"]["WorkOrderImportFailureReport"] | null;
            /** Format: date-time */
            created_at: string;
            /** Format: date-time */
            completed_at?: string | null;
        };
        WorkOrderAnalysisScope: {
            /** Format: date-time */
            from: string;
            /** Format: date-time */
            to: string;
            import_batch_id?: string | null;
            channel?: string | null;
            category?: string | null;
            issue_type?: string | null;
            status?: string | null;
            error_type?: string | null;
            escalated?: boolean | null;
        };
        WorkOrderAnalysisTotals: {
            record_count: number;
            escalated_count: number;
            error_count: number;
        };
        WorkOrderDimensionBucket: {
            /** @description null 表示未知，不得改写为 0 或“无问题”。 */
            key: string | null;
            count: number;
        };
        WorkOrderHandlingTime: {
            sample_count: number;
            median_seconds: number | null;
            p90_seconds: number | null;
        };
        WorkOrderTrendPoint: {
            /** Format: date-time */
            bucket_start: string;
            count: number;
        };
        WorkOrderAnalysisResponse: {
            scope: components["schemas"]["WorkOrderAnalysisScope"];
            totals: components["schemas"]["WorkOrderAnalysisTotals"];
            by_category: components["schemas"]["WorkOrderDimensionBucket"][];
            by_issue_type: components["schemas"]["WorkOrderDimensionBucket"][];
            by_error_type: components["schemas"]["WorkOrderDimensionBucket"][];
            handling_time: components["schemas"]["WorkOrderHandlingTime"];
            trend: components["schemas"]["WorkOrderTrendPoint"][];
            /** Format: date-time */
            refreshed_at: string;
        };
        /** @description 标准化白名单投影；不含原始客户、订单或工单长编号。 */
        WorkOrderRecord: {
            record_id: string;
            import_batch_id: string;
            source_record_hash: string;
            category?: string | null;
            issue_type?: string | null;
            product_ref_hash?: string | null;
            channel?: string | null;
            status?: string | null;
            /** Format: date-time */
            opened_at?: string | null;
            /** Format: date-time */
            closed_at?: string | null;
            handling_seconds?: number | null;
            error_type?: string | null;
            escalated: boolean;
            quality_tags: string[];
            normalization_version: string;
            /** Format: date-time */
            created_at: string;
        };
        WorkOrderRecordListResponse: {
            items: components["schemas"]["WorkOrderRecord"][];
            next_cursor: string | null;
            scope: components["schemas"]["WorkOrderAnalysisScope"];
        };
        /**
         * @description published 是 batch 终态；后续 rollback 不修改原 batch。取消 validating/staged
         *     批次后也使用 failed，并在 error_report.code 中标记 CANCELLED。rolled_back 仅为
         *     旧数据只读兼容值，新迁移不再写入。
         * @enum {string}
         */
        ImportStatus: "validating" | "failed" | "staged" | "publishing" | "published" | "rolled_back";
        /**
         * @default upsert
         * @enum {string}
         */
        ImportOperation: "upsert" | "withdraw";
        /**
         * @description 文件行由受控 worker 规范化为 ContentImportRowContract。行号不是 question_id 的输入。
         *     文件中不得含 placeholder values 或渲染后 Answer。
         */
        FileImportRequest: {
            /**
             * Format: binary
             * @description 原始 CSV 或 XLSX 文件；文件名和 multipart boundary 不参与 request hash。
             */
            file: string;
            source_bindings: components["schemas"]["AuthoritativeSourceBinding"][];
        };
        /**
         * @description 服务端读取的每行同样必须通过 ContentImportRowContract；结构/安全/来源失败整批失败，
         *     只有质量问题可进 quarantined。
         */
        FeishuImportRequest: {
            /** @constant */
            source_type: "feishu_api";
            /** @description 服务端按登记表解析飞书定位与凭据；客户端不得提交内部 URL 或 token。 */
            source_bindings: components["schemas"]["AuthoritativeSourceBinding"][];
        };
        /** @enum {string} */
        ContentQualityStatus: "clean" | "quarantined";
        /** @enum {string} */
        ContentQualityIssueCode: "UNKNOWN_INTENT" | "INTENT_MAPPING_REQUIRED" | "UNRESOLVED_CONFLICT" | "REVIEW_EVIDENCE_MISSING" | "QUESTION_DUPLICATE" | "QUESTION_HASH_MISMATCH" | "QUESTION_ORIGIN_UNVERIFIED" | "CONTENT_NEEDS_REVIEW";
        ContentImportUpsertRow: {
            staging_id: string;
            script_id: string;
            /** @constant */
            operation: "upsert";
            category: components["schemas"]["ScriptCategory"];
            title: string;
            /** @description 发布模板原文；只可含 placeholder_keys 声明的 `{订单号}`/`{日期}`。 */
            answer_text: string;
            /** @description 引用受限审核服务已经绑定的目标治理快照；worker 不得据此自报审核主体。 */
            content_hash: components["schemas"]["ContentHash"];
            source_version_id: components["schemas"]["AuthoritativeSourceVersionId"];
            owner_role: string;
            /** Format: date-time */
            review_due_at: string;
            platform_scope: components["schemas"]["PlatformScope"];
            product_scope_type: components["schemas"]["ProductScopeType"];
            product_scope_refs: components["schemas"]["ProductScopeRefs"];
            campaign_tag?: string | null;
            /** Format: date-time */
            effective_from: string;
            /**
             * Format: date-time
             * @description 排他上界；effective_to 非空时必须严格晚于 effective_from。
             */
            effective_to: string | null;
            intent_taxonomy_version: components["schemas"]["IntentTaxonomyVersion"];
            intent_id: components["schemas"]["IntentId"];
            risk_level: components["schemas"]["RiskLevel"];
            risk_categories: components["schemas"]["RiskCategories"];
            has_conflict: boolean;
            placeholder_keys: components["schemas"]["PlaceholderKey"][];
            questions_json: components["schemas"]["ContentQuestion"][];
            questions_grams_text: string;
            title_grams_text: string;
            answer_grams_text: string;
            search_fallback_text: string;
            quality_status: components["schemas"]["ContentQualityStatus"];
            quality_issue_codes: components["schemas"]["ContentQualityIssueCode"][];
        } & (({
            /** @constant */
            product_scope_type?: "storewide";
            product_scope_refs?: unknown;
        } | {
            /** @enum {unknown} */
            product_scope_type?: "category" | "sku";
            product_scope_refs?: unknown;
        }) & ({
            /** @enum {unknown} */
            risk_level?: "low" | "medium";
            risk_categories?: unknown;
        } | {
            /** @constant */
            risk_level?: "high";
            risk_categories?: unknown;
        }) & ({
            /** @constant */
            quality_status?: "clean";
            quality_issue_codes?: unknown;
        } | {
            /** @constant */
            quality_status?: "quarantined";
            quality_issue_codes?: unknown;
        }));
        ContentImportWithdrawRow: {
            staging_id: string;
            script_id: string;
            /** @constant */
            operation: "withdraw";
            category: components["schemas"]["ScriptCategory"];
            source_version_id: components["schemas"]["AuthoritativeSourceVersionId"];
            /** @constant */
            quality_status: "clean";
            quality_issue_codes: unknown[];
        };
        /**
         * @description 这是受控 worker 到 SQL finalizer 的规范化行合同，不是新 HTTP route。placeholder values、
         *     渲染后 Answer、原始客户文本和内部飞书 token 均不在该 schema，因而不可入库。审核
         *     主体、审核 EVD、审核模式和 quality_gate_passed 也不在本合同；finalizer 只能从
         *     content_review_decisions 与受限质量 evidence 派生这些结论。
         */
        ContentImportRowContract: components["schemas"]["ContentImportUpsertRow"] | components["schemas"]["ContentImportWithdrawRow"];
        ImportAcceptedResponse: {
            import_batch_id: string;
            /** @constant */
            status: "validating";
            source_binding_hash: components["schemas"]["SourceBindingHash"];
        };
        ImportErrorReport: components["schemas"]["ImportFailureReport"] | null;
        ImportFailureReport: {
            /** @constant */
            code: "CANCELLED";
            diagnostic_id: components["schemas"]["ImportDiagnosticId"];
        } | {
            /** @constant */
            code: "MAX_ATTEMPTS_EXHAUSTED";
            diagnostic_id: components["schemas"]["ImportDiagnosticId"];
            attempts: number;
            max_attempts: number;
        } | {
            /** @enum {unknown} */
            code: "VALIDATION_FAILED" | "SOURCE_UNREADABLE" | "HASH_MISMATCH" | "UNSUPPORTED_FORMAT" | "STORAGE_UNAVAILABLE" | "SOURCE_NOT_ELIGIBLE" | "SOURCE_SUSPENDED" | "SOURCE_DOMAIN_MISMATCH" | "SOURCE_SNAPSHOT_MISMATCH" | "SOURCE_SET_INCOMPLETE" | "CONTENT_CONTRACT_INVALID" | "GOVERNANCE_HASH_MISMATCH";
            diagnostic_id: components["schemas"]["ImportDiagnosticId"];
            row?: number;
            column?: number;
            error_count?: number;
            issue_codes?: components["schemas"]["ImportIssueCode"][];
        };
        /** @description 由数据库随机 UUID 生成，仅用于运维关联受限诊断；不得由 worker、文件内容、路径或异常文本派生。 */
        ImportDiagnosticId: string;
        /** @enum {string} */
        ImportIssueCode: "MISSING_REQUIRED_FIELD" | "INVALID_FIELD_TYPE" | "INVALID_VALUE" | "DUPLICATE_SCRIPT_ID" | "UNKNOWN_SCRIPT_ID" | "INVALID_EFFECTIVE_WINDOW" | "MISSING_EFFECTIVE_WINDOW" | "HASH_MISMATCH" | "UNSUPPORTED_FORMAT" | "MACRO_DETECTED" | "EXTERNAL_LINK_DETECTED" | "ROW_LIMIT_EXCEEDED" | "CONTENT_TOO_LARGE" | "SOURCE_NOT_REGISTERED" | "SOURCE_NOT_CANONICAL" | "SOURCE_SUSPENDED" | "SOURCE_DOMAIN_MISMATCH" | "SOURCE_SNAPSHOT_MISMATCH" | "SOURCE_SET_INCOMPLETE" | "MISSING_PLATFORM_SCOPE" | "INVALID_PRODUCT_SCOPE" | "INVALID_TAXONOMY_REF" | "INVALID_QUESTION_IDENTITY" | "INVALID_REVIEW_EVIDENCE" | "INVALID_PLACEHOLDER_TEMPLATE" | "GOVERNANCE_HASH_MISMATCH";
        ImportPreviewItem: {
            script_id: string;
            operation: components["schemas"]["ImportOperation"];
            category: components["schemas"]["ScriptCategory"];
            source_version_id: components["schemas"]["AuthoritativeSourceVersionId"];
            source_ref: components["schemas"]["SafeSourceRef"];
            title?: string | null;
            answer_text?: string | null;
            content_hash?: components["schemas"]["ContentHash"] | null;
            platform_scope?: components["schemas"]["PlatformScope"] | null;
            product_scope_type?: components["schemas"]["ProductScopeType"] | null;
            product_scope_refs?: components["schemas"]["ProductScopeRefs"] | null;
            /** Format: date-time */
            effective_from?: string | null;
            /** Format: date-time */
            effective_to?: string | null;
            intent_taxonomy_version?: components["schemas"]["IntentTaxonomyVersion"] | null;
            intent_id?: components["schemas"]["IntentId"] | null;
            risk_level?: components["schemas"]["RiskLevel"] | null;
            risk_categories?: components["schemas"]["RiskCategories"] | null;
            has_conflict?: boolean | null;
            review_mode?: components["schemas"]["ReviewMode"] | null;
            primary_review_evd?: string | null;
            secondary_review_evd?: string | null;
            placeholder_keys?: components["schemas"]["PlaceholderKey"][] | null;
            questions?: components["schemas"]["ContentQuestion"][] | null;
            quality_status: components["schemas"]["ContentQualityStatus"];
            quality_issue_codes: components["schemas"]["ContentQualityIssueCode"][];
            quality_gate_passed: boolean;
        };
        /**
         * @description 服务端受限证据投影；不是上传文件或普通 worker 可写字段。high/conflict 行计入
         *     mandatory_full_review_count 并 100% 复核。
         */
        ContentQualityReviewSummary: {
            plan_id: string;
            sampling_policy_version: string;
            /** Format: date-time */
            cutoff_at: string;
            clean_population_count: number;
            ordinary_population_count: number;
            mandatory_full_review_count: number;
            initial_sample_target: number;
            expanded_sample_target: number;
            initial_sample_reviewed_count: number;
            initial_defect_count: number;
            expanded_sample_reviewed_count: number | null;
            expanded_defect_count: number | null;
            mandatory_reviewed_count: number;
            mandatory_defect_count: number;
            publishable_clean_count: number;
            review_quarantined_count: number;
            /** @enum {string} */
            conclusion: "passed" | "blocked";
            evidence_ref: string;
        };
        ImportStatusResponseBase: {
            import_batch_id: string;
            status: components["schemas"]["ImportStatus"];
            /** @description enqueue 时锁定的 current release；首次发布前为 null。 */
            base_release_id: string | null;
            source_binding_hash: components["schemas"]["SourceBindingHash"];
            source_bindings: components["schemas"]["AuthoritativeSourceBindingStatus"][];
            error_report: components["schemas"]["ImportErrorReport"];
            staged_count: number;
            clean_count: number;
            quarantined_count: number;
            /** @description 至少一条 clean 行通过批次抽检门；不代表 quarantined 行可发布。 */
            quality_gate_passed: boolean;
            /** @description validating/failed 尚无完整证据时可为 null；进入 staged 前必须已通过。 */
            quality_review: components["schemas"]["ContentQualityReviewSummary"] | null;
            preview: components["schemas"]["ImportPreviewItem"][];
        };
        ImportStatusResponse: (components["schemas"]["ImportStatusResponseBase"] & {
            /** @constant */
            status?: "failed";
            error_report?: components["schemas"]["ImportFailureReport"];
        }) | (components["schemas"]["ImportStatusResponseBase"] & {
            /** @enum {unknown} */
            status?: "validating" | "staged" | "publishing" | "published" | "rolled_back";
            error_report?: null;
        });
        CancelImportRequest: {
            reason: string | null;
        };
        CancelImportResponse: {
            /** @constant */
            ok: true;
            import_batch_id: string;
            /** @constant */
            status: "failed";
        };
        PublishRequest: {
            import_batch_id: string;
            title: string;
            summary: string | null;
        };
        PublishResponse: {
            release_id: string;
            release_seq: number;
            announcement_id: string;
            source_binding_hash: components["schemas"]["SourceBindingHash"];
        };
        RollbackRequest: {
            target_release_id: string;
            title: string | null;
            summary: string | null;
        };
        RollbackResponse: components["schemas"]["PublishResponse"] & {
            rollback_of_release_id: string;
        };
        /** @description 公开公告的封闭白名单投影；不得透传创建主体或内部定位字段。 */
        Announcement: {
            title: string;
            summary: string | null;
            /** Format: date-time */
            created_at: string;
        };
        /** @description handler 必须显式映射顶层、offline_lease 与 announcement 白名单。 */
        CurrentAnnouncementResponse: {
            current_release_id: string;
            release_seq: number;
            source_binding_hash: components["schemas"]["SourceBindingHash"];
            offline_lease: components["schemas"]["OfflineSnapshotLease"];
            announcement: components["schemas"]["Announcement"] | null;
        };
        /**
         * @description 离线检索所需的最小 Question 投影。禁止暴露 origin HMAC/密钥版本、
         *     source_query_id、source_asset_id、promotion review、role 或时间字段。
         */
        PublicSnapshotQuestion: {
            question_id: string;
            question_version: number;
            question_text: string;
            question_hash: string;
            semantic_family_id: string;
        };
        /**
         * @description 固定 release 中的不可变、封闭公开投影。响应中出现不代表该项当前有效；
         *     客户端每次检索都必须自行执行有效期过滤。禁止 DB row/internal object spread。
         */
        SnapshotItem: {
            script_id: string;
            script_version: number;
            content_hash: components["schemas"]["ContentHash"];
            title: string;
            category: components["schemas"]["ScriptCategory"];
            answer_text: string;
            platform_scope: components["schemas"]["PlatformScope"];
            product_scope_type: components["schemas"]["ProductScopeType"];
            product_scope_refs: components["schemas"]["ProductScopeRefs"];
            /**
             * Format: date-time
             * @description 包含下界。完整 release snapshot 可包含未到生效时间的项；
             *     客户端只能在 `effective_from <= now` 时将其纳入本地检索。
             */
            effective_from: string;
            /**
             * Format: date-time
             * @description 排他上界。完整 release snapshot 可包含已过期项，服务端不按当前时间过滤；
             *     客户端只能在 `effective_to IS NULL OR now < effective_to` 时纳入本地检索，
             *     `now == effective_to` 必须排除。
             */
            effective_to: string | null;
            intent_taxonomy_version: components["schemas"]["IntentTaxonomyVersion"];
            intent_id: components["schemas"]["IntentId"];
            risk_level: components["schemas"]["RiskLevel"];
            risk_categories: components["schemas"]["RiskCategories"];
            has_conflict: boolean;
            placeholder_keys: components["schemas"]["PlaceholderKey"][];
            questions: components["schemas"]["PublicSnapshotQuestion"][];
        } & (({
            /** @constant */
            product_scope_type?: "storewide";
            product_scope_refs?: unknown;
        } | {
            /** @enum {unknown} */
            product_scope_type?: "category" | "sku";
            product_scope_refs?: unknown;
        }) & ({
            /** @enum {unknown} */
            risk_level?: "low" | "medium";
            risk_categories?: unknown;
        } | {
            /** @constant */
            risk_level?: "high";
            risk_categories?: unknown;
        }));
        /**
         * @description 固定 release 的完整、不可变分页快照响应。页集合不按生效时间改变；
         *     租约有效时，客户端每次本地检索必须再执行每项的时间窗口过滤。
         */
        SnapshotResponse: {
            release_id: string;
            release_seq: number;
            source_binding_hash: components["schemas"]["SourceBindingHash"];
            offline_lease: components["schemas"]["OfflineSnapshotLease"];
            /** @description 当页完整快照项；不是“当前有效项”的服务端过滤结果。 */
            items: components["schemas"]["SnapshotItem"][];
            /** @description 本页最后一个 script_id；无更多时为 null。 */
            next_cursor: string | null;
        };
        AnnouncementAckRequest: {
            client_id: string;
            release_id: string;
            release_seq: number;
            offline_lease_token: components["schemas"]["OfflineSnapshotLeaseToken"];
        };
        OkResponse: {
            /** @constant */
            ok: true;
        };
        /** @enum {string} */
        PolicyFlagKey: "rewrite" | "auto_send" | "autofill_adapter" | "llm_ranker" | "metrics_experimental_kpi";
        /** @enum {string} */
        MutablePolicyFlagKey: "autofill_adapter" | "llm_ranker" | "metrics_experimental_kpi";
        /** @enum {string} */
        Phase1HardOffPolicyFlagKey: "rewrite" | "auto_send";
        PolicyResponse: {
            /**
             * @description Phase 1 hard-off。
             * @constant
             */
            rewrite: false;
            /**
             * @description Phase 1 hard-off；启用需独立立项与 /v2。
             * @constant
             */
            auto_send: false;
            autofill_adapter: boolean;
            llm_ranker: boolean;
            metrics_experimental_kpi: boolean;
            auth_mode: components["schemas"]["AuthMode"];
        };
        /**
         * @description hard-off 分支允许表达 flag_value=true 请求，以便合同明确该请求的 403
         *     POLICY_DENIED 响应；允许通过语法校验不代表允许持久化。
         */
        PolicyFlagUpdateRequest: components["schemas"]["MutablePolicyFlagUpdateRequest"] | components["schemas"]["HardOffPolicyFlagUpdateRequest"];
        MutablePolicyFlagUpdateRequest: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            flag_key: "autofill_adapter" | "llm_ranker" | "metrics_experimental_kpi";
            flag_value: boolean;
            adr_id: string | null;
        };
        HardOffPolicyFlagUpdateRequest: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            flag_key: "rewrite" | "auto_send";
            /** @description false 可保持 hard-off；true 必须返回 403，且不得写库。 */
            flag_value: boolean;
            adr_id: string | null;
        };
        PolicyFlagUpdateResponse: {
            /** @constant */
            ok: true;
            flag_key: components["schemas"]["PolicyFlagKey"];
            flag_value: boolean;
        };
    };
    responses: {
        /** @description 请求结构、字段或业务对应关系无效 */
        ValidationError: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ValidationErrorEnvelope"];
            };
        };
        /** @description 缺少或无法验证会话 */
        Unauthorized: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["UnauthorizedErrorEnvelope"];
            };
        };
        /** @description 当前已验签身份无权访问该资源或动作 */
        Forbidden: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ForbiddenErrorEnvelope"];
            };
        };
        /** @description 当前身份越权，或动作违反一期策略 */
        ForbiddenOrPolicyDenied: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ForbiddenOrPolicyDeniedErrorEnvelope"];
            };
        };
        /** @description 指定资源不存在 */
        NotFound: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["NotFoundErrorEnvelope"];
            };
        };
        /** @description 幂等键、状态机、发布锁或资源当前状态发生冲突 */
        Conflict: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ConflictErrorEnvelope"];
            };
        };
        /** @description 令牌桶拒绝当前请求 */
        TooManyRequests: {
            headers: {
                "Retry-After": components["headers"]["RetryAfter"];
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["RateLimitedErrorEnvelope"];
            };
        };
        /** @description 连接池、并发槽或依赖存储暂时过载；生产限流存储故障也 fail-closed 到此响应 */
        Overloaded: {
            headers: {
                "Retry-After": components["headers"]["RetryAfter"];
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["OverloadedErrorEnvelope"];
            };
        };
        /** @description 路由或依赖过载，或 Owner 尚未完成首次内容发布 */
        ServiceUnavailable: {
            headers: {
                "Retry-After": components["headers"]["RetryAfter"];
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["OverloadedErrorEnvelope"] | components["schemas"]["ContentNotReadyErrorEnvelope"];
            };
        };
        /** @description 未归类的服务端错误；不得泄露原始查询或内部堆栈 */
        InternalError: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["InternalErrorEnvelope"];
            };
        };
    };
    parameters: {
        /**
         * @description 同 scope/key/body 重放首次终态响应；同键异体或处理中返回 409。建议 UUID。
         *     终态 TTL 至少 24 小时。
         * @example 5a5d8ff9-a23e-4c04-b902-64d0e33502cf
         */
        RequiredIdempotencyKey: string;
        /**
         * @description 提供时按共用幂等状态机处理；本路由在 39 合同中未列为强制携带。
         * @example 68cc44fb-3d14-4860-a765-e882754d66d7
         */
        OptionalIdempotencyKey: string;
        /** @example imp-01J4PF9TQX7G */
        ImportBatchId: string;
        /**
         * @description 内部话术优化待办 ID；不得填业务工单 ID。
         * @example itask-01J4PF9TQX7G
         */
        IterationTaskId: string;
        IterationTaskStatusFilter: components["schemas"]["IterationTaskStatus"];
        IterationTaskSignalFilter: string;
        IterationTaskAssigneeFilter: string;
        /**
         * @description 业务工单分析导入批次 ID。
         * @example woimp-01J4PF9TQX7G
         */
        WorkOrderImportBatchId: string;
        /**
         * @description 业务记录时间窗起点；与 to 构成半开区间，最大 31 天。
         * @example 2026-07-01T00:00:00Z
         */
        WorkOrderFrom: string;
        /**
         * @description 业务记录时间窗终点；必须晚于 from，差值不超过 31 天。
         * @example 2026-08-01T00:00:00Z
         */
        WorkOrderTo: string;
        WorkOrderImportBatchFilter: string;
        WorkOrderChannelFilter: string;
        WorkOrderCategoryFilter: string;
        WorkOrderIssueTypeFilter: string;
        WorkOrderStatusFilter: string;
        WorkOrderErrorTypeFilter: string;
        WorkOrderEscalatedFilter: boolean;
        WorkOrderLimit: number;
        /** @description 不透明、稳定倒序的业务工单明细游标。 */
        WorkOrderCursor: string;
        /**
         * @description 查询窗起点，ISO-8601 UTC；必须满足 to > from 且 to - from 不超过 7 天，否则返回 400 VALIDATION。
         * @example 2026-07-31T00:00:00Z
         */
        MetricsFrom: string;
        /**
         * @description 查询窗终点，ISO-8601 UTC；必须晚于 from，且与 from 的差不超过 7 天，否则返回 400 VALIDATION。
         * @example 2026-08-06T23:59:59Z
         */
        MetricsTo: string;
        /**
         * @description 可选的用户过滤条件，仍受调用者授权范围约束。
         * @example u-agent-001
         */
        MetricsUserId: string;
        /** @description 按用户已确认的 canonical 平台过滤。 */
        MetricsPlatform: "qianniu" | "douyin" | "unknown";
        MetricsHitStatus: components["schemas"]["HitStatus"];
        /** @description 按成功复制的候选位次过滤。 */
        MetricsChosenRank: number;
        /** @description 按搜索当时的不可变内容 release 过滤。 */
        MetricsReleaseId: string;
        /**
         * @description 每页条目数。
         * @example 50
         */
        StreamLimit: number;
        /**
         * @description 不透明 base64url cursor；内部为 created_at 与 query_id 的稳定倒序游标。
         * @example MjAyNi0wOC0wNlQwMzoxNDoxNVp8NGQ2OTBlZjctYTk4ZC00YTU2LWE5YzQtOTJhZTRjNTIxNjhm
         */
        MetricsCursor: string;
        /**
         * @description 上次 current 响应的弱 ETag；命中时返回 304。
         * @example W/"13"
         */
        IfNoneMatch: string;
        /**
         * @description 当前客户端稳定 ID；租约同时绑定验签用户，不得跨客户端复用。
         * @example mac-cs-001
         */
        SnapshotClientId: string;
        /**
         * @description 只用于 current 条件请求；仅当该 token 未过期且绑定同一 release/source hash
         *     时才允许 304，否则必须返回 200 并签发新短租约。
         */
        OptionalSnapshotLeaseToken: components["schemas"]["OfflineSnapshotLeaseToken"];
        /** @description current 签发的不透明短租约；每一页都必须重新验证绑定与过期时间。 */
        RequiredSnapshotLeaseToken: components["schemas"]["OfflineSnapshotLeaseToken"];
        /**
         * @description 从 current 响应复制；同一次分页全过程不得省略或切换。
         * @example rel-20260806-0013
         */
        ReleaseIdQuery: string;
        /**
         * @description 每页话术数。
         * @example 200
         */
        SnapshotLimit: number;
        /**
         * @description 上一页最后一个 script_id；服务端按 script_id 升序继续。
         * @example shipping-001
         */
        SnapshotCursor: string;
    };
    requestBodies: never;
    headers: {
        /**
         * @description 客户端重试前至少等待的秒数，最少为 1。
         * @example 1
         */
        RetryAfter: number;
        /**
         * @description 由 release_seq 构成的弱 ETag。
         * @example W/"13"
         */
        ETag: string;
        /**
         * @description current 可缓存不超过 10 秒。
         * @example max-age=10
         */
        CacheControl: string;
        /** @description 304 仅回显请求中仍有效的原租约，不签发、不续期。 */
        SnapshotLease: components["schemas"]["OfflineSnapshotLeaseToken"];
        /** @description 原租约的固定过期时间；304 不得延长。 */
        SnapshotLeaseExpires: string;
    };
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    getHealth: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 进程 event loop 可响应 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HealthResponse"];
                };
            };
            400: components["responses"]["ValidationError"];
            500: components["responses"]["InternalError"];
        };
    };
    getReadiness: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 所有必要检查已就绪 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ReadyResponse"];
                };
            };
            400: components["responses"]["ValidationError"];
            /** @description 至少一项必要检查未就绪 */
            503: {
                headers: {
                    "Retry-After": components["headers"]["RetryAfter"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NotReadyResponse"];
                };
            };
        };
    };
    mockLogin: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MockLoginRequest"];
            };
        };
        responses: {
            /** @description Mock 会话已创建 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MockLoginResponse"];
                };
            };
            400: components["responses"]["ValidationError"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Overloaded"];
        };
    };
    getCurrentUser: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 当前用户与鉴权模式 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CurrentUserResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Overloaded"];
        };
    };
    getCurrentPrivacyNotice: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 当前告知版本与用户决定 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CurrentNoticeResponse"];
                };
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Overloaded"];
        };
    };
    recordPrivacyNoticeDecision: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description 同 scope/key/body 重放首次终态响应；同键异体或处理中返回 409。建议 UUID。
                 *     终态 TTL 至少 24 小时。
                 * @example 5a5d8ff9-a23e-4c04-b902-64d0e33502cf
                 */
                "Idempotency-Key": components["parameters"]["RequiredIdempotencyKey"];
            };
            path: {
                version: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["NoticeDecisionRequest"];
            };
        };
        responses: {
            /** @description 决定已记录或幂等重放 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NoticeDecisionResponse"];
                };
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["ForbiddenOrPolicyDenied"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Overloaded"];
        };
    };
    searchScripts: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SearchRequest"];
            };
        };
        responses: {
            /** @description 搜索完成；无候选时 candidates 为空数组 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SearchResponse"];
                };
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["ForbiddenOrPolicyDenied"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    recordAdoption: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description 同 scope/key/body 重放首次终态响应；同键异体或处理中返回 409。建议 UUID。
                 *     终态 TTL 至少 24 小时。
                 * @example 5a5d8ff9-a23e-4c04-b902-64d0e33502cf
                 */
                "Idempotency-Key": components["parameters"]["RequiredIdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdoptionEventRequest"];
            };
        };
        responses: {
            /** @description 事件已记录，或重放同幂等键的首次终态结果 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdoptionEventResponse"];
                };
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["ForbiddenOrPolicyDenied"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Overloaded"];
        };
    };
    recordEscalation: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description 同 scope/key/body 重放首次终态响应；同键异体或处理中返回 409。建议 UUID。
                 *     终态 TTL 至少 24 小时。
                 * @example 5a5d8ff9-a23e-4c04-b902-64d0e33502cf
                 */
                "Idempotency-Key": components["parameters"]["RequiredIdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["EscalationRequest"];
            };
        };
        responses: {
            /** @description 升级动作已记录 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EscalationResponse"];
                };
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Overloaded"];
        };
    };
    getToolMetrics: {
        parameters: {
            query: {
                /**
                 * @description 查询窗起点，ISO-8601 UTC；必须满足 to > from 且 to - from 不超过 7 天，否则返回 400 VALIDATION。
                 * @example 2026-07-31T00:00:00Z
                 */
                from: components["parameters"]["MetricsFrom"];
                /**
                 * @description 查询窗终点，ISO-8601 UTC；必须晚于 from，且与 from 的差不超过 7 天，否则返回 400 VALIDATION。
                 * @example 2026-08-06T23:59:59Z
                 */
                to: components["parameters"]["MetricsTo"];
                /**
                 * @description 可选的用户过滤条件，仍受调用者授权范围约束。
                 * @example u-agent-001
                 */
                user_id?: components["parameters"]["MetricsUserId"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 指定时间窗内的工具指标 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ToolMetricsResponse"];
                };
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Overloaded"];
        };
    };
    getMetricsStream: {
        parameters: {
            query: {
                /**
                 * @description 查询窗起点，ISO-8601 UTC；必须满足 to > from 且 to - from 不超过 7 天，否则返回 400 VALIDATION。
                 * @example 2026-07-31T00:00:00Z
                 */
                from: components["parameters"]["MetricsFrom"];
                /**
                 * @description 查询窗终点，ISO-8601 UTC；必须晚于 from，且与 from 的差不超过 7 天，否则返回 400 VALIDATION。
                 * @example 2026-08-06T23:59:59Z
                 */
                to: components["parameters"]["MetricsTo"];
                /**
                 * @description 可选的用户过滤条件，仍受调用者授权范围约束。
                 * @example u-agent-001
                 */
                user_id?: components["parameters"]["MetricsUserId"];
                /** @description 按用户已确认的 canonical 平台过滤。 */
                platform?: components["parameters"]["MetricsPlatform"];
                hit_status?: components["parameters"]["MetricsHitStatus"];
                /** @description 按成功复制的候选位次过滤。 */
                chosen_rank?: components["parameters"]["MetricsChosenRank"];
                /** @description 按搜索当时的不可变内容 release 过滤。 */
                release_id?: components["parameters"]["MetricsReleaseId"];
                /**
                 * @description 每页条目数。
                 * @example 50
                 */
                limit?: components["parameters"]["StreamLimit"];
                /**
                 * @description 不透明 base64url cursor；内部为 created_at 与 query_id 的稳定倒序游标。
                 * @example MjAyNi0wOC0wNlQwMzoxNDoxNVp8NGQ2OTBlZjctYTk4ZC00YTU2LWE5YzQtOTJhZTRjNTIxNjhm
                 */
                cursor?: components["parameters"]["MetricsCursor"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 倒序事件页 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MetricsStreamResponse"];
                };
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Overloaded"];
        };
    };
    listIterationTasks: {
        parameters: {
            query?: {
                status?: components["parameters"]["IterationTaskStatusFilter"];
                signal_id?: components["parameters"]["IterationTaskSignalFilter"];
                assignee_role?: components["parameters"]["IterationTaskAssigneeFilter"];
                /**
                 * @description 每页条目数。
                 * @example 50
                 */
                limit?: components["parameters"]["StreamLimit"];
                /**
                 * @description 不透明 base64url cursor；内部为 created_at 与 query_id 的稳定倒序游标。
                 * @example MjAyNi0wOC0wNlQwMzoxNDoxNVp8NGQ2OTBlZjctYTk4ZC00YTU2LWE5YzQtOTJhZTRjNTIxNjhm
                 */
                cursor?: components["parameters"]["MetricsCursor"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 话术优化待办页 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IterationTaskListResponse"];
                };
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Overloaded"];
        };
    };
    startIterationTask: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description 同 scope/key/body 重放首次终态响应；同键异体或处理中返回 409。建议 UUID。
                 *     终态 TTL 至少 24 小时。
                 * @example 5a5d8ff9-a23e-4c04-b902-64d0e33502cf
                 */
                "Idempotency-Key": components["parameters"]["RequiredIdempotencyKey"];
            };
            path: {
                /**
                 * @description 内部话术优化待办 ID；不得填业务工单 ID。
                 * @example itask-01J4PF9TQX7G
                 */
                task_id: components["parameters"]["IterationTaskId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["IterationTaskStartRequest"];
            };
        };
        responses: {
            /** @description 已进入处理中 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IterationTask"];
                };
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Overloaded"];
        };
    };
    closeIterationTask: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description 同 scope/key/body 重放首次终态响应；同键异体或处理中返回 409。建议 UUID。
                 *     终态 TTL 至少 24 小时。
                 * @example 5a5d8ff9-a23e-4c04-b902-64d0e33502cf
                 */
                "Idempotency-Key": components["parameters"]["RequiredIdempotencyKey"];
            };
            path: {
                /**
                 * @description 内部话术优化待办 ID；不得填业务工单 ID。
                 * @example itask-01J4PF9TQX7G
                 */
                task_id: components["parameters"]["IterationTaskId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["IterationTaskCloseRequest"];
            };
        };
        responses: {
            /** @description 待办已进入终态 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IterationTask"];
                };
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Overloaded"];
        };
    };
    createWorkOrderImport: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description 同 scope/key/body 重放首次终态响应；同键异体或处理中返回 409。建议 UUID。
                 *     终态 TTL 至少 24 小时。
                 * @example 5a5d8ff9-a23e-4c04-b902-64d0e33502cf
                 */
                "Idempotency-Key": components["parameters"]["RequiredIdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["WorkOrderImportRequest"];
            };
        };
        responses: {
            /** @description 文件已持久受理并进入校验 */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WorkOrderImportAcceptedResponse"];
                };
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Overloaded"];
        };
    };
    getWorkOrderImport: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description 业务工单分析导入批次 ID。
                 * @example woimp-01J4PF9TQX7G
                 */
                import_batch_id: components["parameters"]["WorkOrderImportBatchId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 批次状态与安全计数 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WorkOrderImportStatusResponse"];
                };
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Overloaded"];
        };
    };
    getWorkOrderAnalysis: {
        parameters: {
            query: {
                /**
                 * @description 业务记录时间窗起点；与 to 构成半开区间，最大 31 天。
                 * @example 2026-07-01T00:00:00Z
                 */
                from: components["parameters"]["WorkOrderFrom"];
                /**
                 * @description 业务记录时间窗终点；必须晚于 from，差值不超过 31 天。
                 * @example 2026-08-01T00:00:00Z
                 */
                to: components["parameters"]["WorkOrderTo"];
                import_batch_id?: components["parameters"]["WorkOrderImportBatchFilter"];
                channel?: components["parameters"]["WorkOrderChannelFilter"];
                category?: components["parameters"]["WorkOrderCategoryFilter"];
                issue_type?: components["parameters"]["WorkOrderIssueTypeFilter"];
                status?: components["parameters"]["WorkOrderStatusFilter"];
                error_type?: components["parameters"]["WorkOrderErrorTypeFilter"];
                escalated?: components["parameters"]["WorkOrderEscalatedFilter"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 授权范围内的聚合分析 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WorkOrderAnalysisResponse"];
                };
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Overloaded"];
        };
    };
    listWorkOrderRecords: {
        parameters: {
            query: {
                /**
                 * @description 业务记录时间窗起点；与 to 构成半开区间，最大 31 天。
                 * @example 2026-07-01T00:00:00Z
                 */
                from: components["parameters"]["WorkOrderFrom"];
                /**
                 * @description 业务记录时间窗终点；必须晚于 from，差值不超过 31 天。
                 * @example 2026-08-01T00:00:00Z
                 */
                to: components["parameters"]["WorkOrderTo"];
                import_batch_id?: components["parameters"]["WorkOrderImportBatchFilter"];
                channel?: components["parameters"]["WorkOrderChannelFilter"];
                category?: components["parameters"]["WorkOrderCategoryFilter"];
                issue_type?: components["parameters"]["WorkOrderIssueTypeFilter"];
                status?: components["parameters"]["WorkOrderStatusFilter"];
                error_type?: components["parameters"]["WorkOrderErrorTypeFilter"];
                escalated?: components["parameters"]["WorkOrderEscalatedFilter"];
                limit?: components["parameters"]["WorkOrderLimit"];
                /** @description 不透明、稳定倒序的业务工单明细游标。 */
                cursor?: components["parameters"]["WorkOrderCursor"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 标准化明细页 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WorkOrderRecordListResponse"];
                };
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Overloaded"];
        };
    };
    exportWorkOrderAnalysis: {
        parameters: {
            query: {
                /**
                 * @description 业务记录时间窗起点；与 to 构成半开区间，最大 31 天。
                 * @example 2026-07-01T00:00:00Z
                 */
                from: components["parameters"]["WorkOrderFrom"];
                /**
                 * @description 业务记录时间窗终点；必须晚于 from，差值不超过 31 天。
                 * @example 2026-08-01T00:00:00Z
                 */
                to: components["parameters"]["WorkOrderTo"];
                import_batch_id?: components["parameters"]["WorkOrderImportBatchFilter"];
                channel?: components["parameters"]["WorkOrderChannelFilter"];
                category?: components["parameters"]["WorkOrderCategoryFilter"];
                issue_type?: components["parameters"]["WorkOrderIssueTypeFilter"];
                status?: components["parameters"]["WorkOrderStatusFilter"];
                error_type?: components["parameters"]["WorkOrderErrorTypeFilter"];
                escalated?: components["parameters"]["WorkOrderEscalatedFilter"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description UTF-8 CSV 脱敏导出 */
            200: {
                headers: {
                    /** @description 仅含生成时间与批次短标识的安全文件名 */
                    "Content-Disposition"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "text/csv": string;
                };
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Overloaded"];
        };
    };
    createContentImport: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description 同 scope/key/body 重放首次终态响应；同键异体或处理中返回 409。建议 UUID。
                 *     终态 TTL 至少 24 小时。
                 * @example 5a5d8ff9-a23e-4c04-b902-64d0e33502cf
                 */
                "Idempotency-Key": components["parameters"]["RequiredIdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["FileImportRequest"];
                "application/json": components["schemas"]["FeishuImportRequest"];
            };
        };
        responses: {
            /** @description 导入批次及持久 outbox 已原子提交 */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ImportAcceptedResponse"];
                };
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["ForbiddenOrPolicyDenied"];
            409: components["responses"]["Conflict"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Overloaded"];
        };
    };
    getContentImport: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @example imp-01J4PF9TQX7G */
                import_batch_id: components["parameters"]["ImportBatchId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 导入批次当前状态 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ImportStatusResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Overloaded"];
        };
    };
    cancelContentImport: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description 同 scope/key/body 重放首次终态响应；同键异体或处理中返回 409。建议 UUID。
                 *     终态 TTL 至少 24 小时。
                 * @example 5a5d8ff9-a23e-4c04-b902-64d0e33502cf
                 */
                "Idempotency-Key": components["parameters"]["RequiredIdempotencyKey"];
            };
            path: {
                /** @example imp-01J4PF9TQX7G */
                import_batch_id: components["parameters"]["ImportBatchId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CancelImportRequest"];
            };
        };
        responses: {
            /** @description 批次已标记 failed，未完成 outbox 已 fenced 为 dead */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CancelImportResponse"];
                };
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Overloaded"];
        };
    };
    publishContent: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description 同 scope/key/body 重放首次终态响应；同键异体或处理中返回 409。建议 UUID。
                 *     终态 TTL 至少 24 小时。
                 * @example 5a5d8ff9-a23e-4c04-b902-64d0e33502cf
                 */
                "Idempotency-Key": components["parameters"]["RequiredIdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PublishRequest"];
            };
        };
        responses: {
            /** @description 新 release 已发布并成为 current */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublishResponse"];
                };
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["ForbiddenOrPolicyDenied"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Overloaded"];
        };
    };
    rollbackContent: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description 同 scope/key/body 重放首次终态响应；同键异体或处理中返回 409。建议 UUID。
                 *     终态 TTL 至少 24 小时。
                 * @example 5a5d8ff9-a23e-4c04-b902-64d0e33502cf
                 */
                "Idempotency-Key": components["parameters"]["RequiredIdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RollbackRequest"];
            };
        };
        responses: {
            /** @description 目标快照已复制为新 release 并成为 current */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RollbackResponse"];
                };
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["ForbiddenOrPolicyDenied"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Overloaded"];
        };
    };
    getCurrentAnnouncement: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description 上次 current 响应的弱 ETag；命中时返回 304。
                 * @example W/"13"
                 */
                "If-None-Match"?: components["parameters"]["IfNoneMatch"];
                /**
                 * @description 当前客户端稳定 ID；租约同时绑定验签用户，不得跨客户端复用。
                 * @example mac-cs-001
                 */
                "X-Client-Id": components["parameters"]["SnapshotClientId"];
                /**
                 * @description 只用于 current 条件请求；仅当该 token 未过期且绑定同一 release/source hash
                 *     时才允许 304，否则必须返回 200 并签发新短租约。
                 */
                "X-Snapshot-Lease"?: components["parameters"]["OptionalSnapshotLeaseToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 当前 release 与可选公告 */
            200: {
                headers: {
                    ETag: components["headers"]["ETag"];
                    "Cache-Control": components["headers"]["CacheControl"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CurrentAnnouncementResponse"];
                };
            };
            /** @description If-None-Match 命中当前弱 ETag；无响应体 */
            304: {
                headers: {
                    ETag: components["headers"]["ETag"];
                    "Cache-Control": components["headers"]["CacheControl"];
                    "X-Snapshot-Lease": components["headers"]["SnapshotLease"];
                    "X-Snapshot-Lease-Expires": components["headers"]["SnapshotLeaseExpires"];
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getAnnouncementSnapshot: {
        parameters: {
            query: {
                /**
                 * @description 从 current 响应复制；同一次分页全过程不得省略或切换。
                 * @example rel-20260806-0013
                 */
                release_id: components["parameters"]["ReleaseIdQuery"];
                /**
                 * @description 每页话术数。
                 * @example 200
                 */
                limit?: components["parameters"]["SnapshotLimit"];
                /**
                 * @description 上一页最后一个 script_id；服务端按 script_id 升序继续。
                 * @example shipping-001
                 */
                cursor?: components["parameters"]["SnapshotCursor"];
            };
            header: {
                /**
                 * @description 当前客户端稳定 ID；租约同时绑定验签用户，不得跨客户端复用。
                 * @example mac-cs-001
                 */
                "X-Client-Id": components["parameters"]["SnapshotClientId"];
                /** @description current 签发的不透明短租约；每一页都必须重新验证绑定与过期时间。 */
                "X-Snapshot-Lease": components["parameters"]["RequiredSnapshotLeaseToken"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 固定 release 的一页话术快照 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SnapshotResponse"];
                };
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["ForbiddenOrPolicyDenied"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Overloaded"];
        };
    };
    acknowledgeAnnouncement: {
        parameters: {
            query?: never;
            header?: {
                /**
                 * @description 提供时按共用幂等状态机处理；本路由在 39 合同中未列为强制携带。
                 * @example 68cc44fb-3d14-4860-a765-e882754d66d7
                 */
                "Idempotency-Key"?: components["parameters"]["OptionalIdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AnnouncementAckRequest"];
            };
        };
        responses: {
            /** @description 同步游标已写入，或旧 ACK 被安全忽略 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OkResponse"];
                };
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["ForbiddenOrPolicyDenied"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Overloaded"];
        };
    };
    getPolicy: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 当前策略；一期 rewrite 与 auto_send 恒为 false */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PolicyResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Overloaded"];
        };
    };
    setPolicyFlag: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description 同 scope/key/body 重放首次终态响应；同键异体或处理中返回 409。建议 UUID。
                 *     终态 TTL 至少 24 小时。
                 * @example 5a5d8ff9-a23e-4c04-b902-64d0e33502cf
                 */
                "Idempotency-Key": components["parameters"]["RequiredIdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PolicyFlagUpdateRequest"];
            };
        };
        responses: {
            /** @description 可写策略已更新，或 hard-off 开关保持 false */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PolicyFlagUpdateResponse"];
                };
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["ForbiddenOrPolicyDenied"];
            409: components["responses"]["Conflict"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["Overloaded"];
        };
    };
}
