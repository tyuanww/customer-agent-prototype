/* GENERATED FILE. DO NOT EDIT. Run `pnpm contracts:generate` from the repository root. */

export interface paths {
    "/v1/sop/query": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 在当前授权范围内查询一条 Menokin SOP 流程
         * @description 独立 SOP 正向查询。认证主体、授权范围、当前 release 和 lease 均由服务端取得或复核；请求体不得携带 userId、token、主体 ID 或任意授权 scope。SOP 不通过 /v1/search 回退；/v1/search 对 SOP 继续 503 fail-closed。 The unified view returns the complete task graph, exact FAQ dependencies, media bindings and entry-level permission facts. Unclassified risk, unresolved source facts or missing required preview bindings yield blocked. Ready permissions cover the exact graph dependencies once. Legacy query view remains bound to its original exact contract ID.
         */
        post: operations["querySop"];
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
        /** @enum {string} */
        IntakeAction: "query" | "content-manage" | "import" | "source-confirm" | "review" | "publish" | "candidate-cancel" | "rollback";
        IntakeAuthorization: {
            factsVersion: components["schemas"]["IntakeVersion"];
            revocationGeneration: number;
            policyVersion: components["schemas"]["IntakeVersion"];
            /** Format: date-time */
            validUntil: string;
            capabilities: {
                scope: components["schemas"]["IntakeScope"];
                actions: components["schemas"]["IntakeAction"][];
                mayAllocate: components["schemas"]["IntakeAction"][];
                mayDelegate: components["schemas"]["IntakeAction"][];
                /** Format: date-time */
                validUntil: string;
            }[];
            nextCursor: string | null;
        };
        IntakeVersion: number;
        /** @description 所有字段必填。shopId=null 只代表品牌通用范围，不覆盖任意店；sourceId=null 显式覆盖该精确范围全部来源。 */
        IntakeScope: {
            tenantId: string;
            appId: string;
            brandId: string;
            shopId: string | null;
            /** @enum {string} */
            domain: "presale" | "campaign" | "aftersale" | "product" | "sop";
            sourceId: string | null;
        };
        IntakeCancel: {
            operationId: string;
            key: components["schemas"]["IntakeCandidateKey"];
        };
        IntakeCandidateKey: {
            candidateId: string;
            version: components["schemas"]["IntakeVersion"];
            digest: string;
        };
        IntakeCandidate: {
            key: components["schemas"]["IntakeCandidateKey"];
            sourceId: string;
            /** @enum {string} */
            state: "awaiting-evidence" | "ready" | "publishing" | "published" | "cancelled" | "invalidated";
            readinessReasons: string[];
            sourceEvidenceVersion: number;
            approvalEvidenceVersion: number;
            revocationGeneration: number;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
            publishedReleaseId: string | null;
            /**
             * @description 服务端冻结的候选发布政策。旧候选不可原地改成直发；须显式修订为新版本。
             * @enum {string}
             */
            publicationPolicy: "approval-v1" | "direct-v1";
        } & unknown;
        IntakeCandidateList: {
            items: components["schemas"]["IntakeCandidate"][];
            nextCursor: string | null;
        };
        /** @description SOP pages carry whole FlowDefinition records and complete differences. Reassemble entries/differences/sopFlows/sopDifferences with identical materialHeader and candidate key, then verify materialDigest. Graph-only pages are valid; reject duplicate IDs, looping cursor, mixed keys and budgets. Header media is repeated unchanged. FAQ pages omit graph collections. */
        IntakeCandidatePage: {
            key: components["schemas"]["IntakeCandidateKey"];
            entries: components["schemas"]["IntakeEntry"][];
            differences: components["schemas"]["IntakeDifference"][];
            nextCursor: string | null;
            materialHeader: components["schemas"]["IntakeMaterialHeader"];
            sopFlows?: components["schemas"]["IntakeSopFlowDefinition"][];
            sopDifferences?: components["schemas"]["IntakeSopFlowDifference"][];
        } & unknown;
        /** @description 完整审核材料。分类用于检索；内部说明不进入坐席正文或复制。风险提示单独展示且不拼入复制文本；附件说明不得用来冒充已解析媒体。P2 非空附件说明阻断导入，规范条目该字段保留为空。复制只含 answerText。 启用条目的商品与场景引用总数最多 100；整页去重词项最多 100，分页不得截断条目。 */
        IntakeEntry: {
            businessEntryId: string;
            scriptVersion: components["schemas"]["IntakeVersion"];
            /** @enum {string} */
            operation: "upsert" | "disable";
            title: string;
            answerText: string;
            questions: components["schemas"]["IntakeQuestion"][];
            productRefs: components["schemas"]["IntakeTermRef"][];
            scenarioRefs: components["schemas"]["IntakeTermRef"][];
            /** Format: date-time */
            effectiveFrom: string;
            /** Format: date-time */
            effectiveTo: string | null;
            applicabilityNote: string;
            familySourceId: string | null;
            familyBusinessEntryId: string | null;
            brandNonOverridable: boolean;
            category: string;
            internalNote: string;
            riskNote: string;
            attachmentNote: string;
        } & unknown;
        IntakeQuestion: {
            id: string;
            version: components["schemas"]["IntakeVersion"];
            text: string;
            active: boolean;
        };
        IntakeTermRef: {
            id: string;
            displayVersion: components["schemas"]["IntakeVersion"];
        };
        IntakeDifference: {
            businessEntryId: string;
            /** @enum {string} */
            change: "add" | "modify" | "disable" | "reenable";
            previousVersion: number | null;
            nextVersion: components["schemas"]["IntakeVersion"];
            beforeDigest: string | null;
            afterDigest: string;
        };
        IntakeMaterialHeader: {
            /** @enum {unknown} */
            canonicalEncodingVersion: "candidate-p1.1" | "candidate-sop-graph-v1" | "candidate-sop-task-graph-v2";
            scope: components["schemas"]["IntakeSopSourceScope"];
            sourceVersion: components["schemas"]["IntakeVersion"];
            sourceClaim: components["schemas"]["IntakeSourceClaim"];
            templateVersion: string;
            ruleVersion: string;
            mappingVersion: string;
            selectedSheets: string[];
            object: components["schemas"]["IntakeObject"];
            contributors: string[];
            risk: components["schemas"]["IntakeRisk"];
            baseReleaseId: string | null;
            media: components["schemas"]["IntakeSopMedia"][];
            mappingDigest?: components["schemas"]["IntakeSopHash"];
        } & ({
            /** @constant */
            templateVersion: "faq-p1.1";
            /** @constant */
            ruleVersion: "intake-p1.1";
            object?: {
                /** @constant */
                mime?: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
            };
            /** @constant */
            selectedSheets: [
                "来源",
                "FAQ",
                "相似问法"
            ];
            /** @constant */
            canonicalEncodingVersion?: "candidate-p1.1";
            media?: {
                objectId: string;
                sha256: string;
                mime: string;
                bytes: components["schemas"]["IntakeVersion"];
                required: boolean;
                alt: string;
            }[];
            scope?: components["schemas"]["IntakeSourceScope"];
        } | {
            /** @constant */
            templateVersion: "faq-csv-v1";
            /** @constant */
            ruleVersion: "intake-csv-v1";
            /** @constant */
            mappingVersion?: "faq-csv-columns-v1";
            object?: {
                /** @constant */
                mime?: "text/csv";
            };
            /** @constant */
            selectedSheets: [
                "CSV"
            ];
            /** @constant */
            canonicalEncodingVersion?: "candidate-p1.1";
            media?: {
                objectId: string;
                sha256: string;
                mime: string;
                bytes: components["schemas"]["IntakeVersion"];
                required: boolean;
                alt: string;
            }[];
            scope?: components["schemas"]["IntakeSourceScope"];
        } | {
            /** @constant */
            canonicalEncodingVersion: "candidate-sop-task-graph-v2";
            /** @constant */
            templateVersion: "sop-manual-authoring-v1.1";
            /** @constant */
            ruleVersion: "sop-task-graph-v2";
            /** @constant */
            mappingVersion: "sop-manual-to-task-graph-v2";
            /** @constant */
            selectedSheets: [
                "场景目录",
                "执行任务",
                "判断分支",
                "客户话术",
                "知识与案例",
                "资源与图片"
            ];
            media: components["schemas"]["IntakeSopMedia"][];
            mappingDigest: components["schemas"]["IntakeSopHash"];
            object?: {
                /** @constant */
                mime?: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
            };
        });
        IntakeSopSourceScope: {
            tenantId: string;
            appId: string;
            brandId: string;
            shopId: string | null;
            /** @enum {string} */
            domain: "presale" | "campaign" | "aftersale" | "product" | "sop";
            sourceId: string;
        };
        IntakeSourceClaim: {
            /** @enum {string} */
            versionKind: "integer" | "opaque" | "unknown";
            versionValue: string | null;
            /** @enum {string} */
            acquisition: "feishu-export" | "controlled-synthetic-export";
            fileSha256: string;
        };
        IntakeObject: {
            objectId: string;
            sha256: string;
            bytes: number;
            /** @enum {string} */
            mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" | "text/csv";
            sourceId: string;
        };
        IntakeRisk: {
            /** @enum {string} */
            policyVersion: "risk-p1.1";
            /** @enum {string} */
            level: "routine" | "critical";
            reasons: string[];
            explicitDisableCount: number;
            sameSourceDisabledLast24Hours: number;
            /** Format: date-time */
            evaluatedAt: string;
        };
        IntakeSopMedia: {
            entry?: components["schemas"]["IntakeSopEntryRef"];
            objectId: components["schemas"]["IntakeSopId"];
            sha256: components["schemas"]["IntakeSopHash"];
            /** @enum {unknown} */
            mime: "image/png" | "image/jpeg" | "image/gif";
            bytes: number;
            ordinal: number;
            alt: string;
            required: boolean;
            flowKey: components["schemas"]["IntakeSopFlowKey"];
            resourceId: components["schemas"]["IntakeSopId"];
            graphTarget?: {
                /** @enum {unknown} */
                kind: "task" | "knowledge";
                id: components["schemas"]["IntakeSopId"];
            };
            /** @enum {unknown} */
            audience: "agent" | "coach" | "customer";
            applicability: components["schemas"]["IntakeSopApplicability"];
        } & ({
            /** @constant */
            audience?: "customer";
        } | {
            /** @enum {unknown} */
            audience?: "agent" | "coach";
        });
        IntakeSopEntryRef: {
            sourceId: components["schemas"]["IntakeSopId"];
            businessEntryId: components["schemas"]["IntakeSopId"];
            scriptVersion: components["schemas"]["IntakeSopVersion"];
        };
        IntakeSopId: string;
        IntakeSopVersion: number;
        IntakeSopHash: string;
        IntakeSopFlowKey: {
            sourceId: components["schemas"]["IntakeSopId"];
            flowId: components["schemas"]["IntakeSopId"];
            flowVersion: components["schemas"]["IntakeSopVersion"];
        };
        IntakeSopApplicability: {
            productRefs: components["schemas"]["IntakeTermRef"][];
            scenarioRefs: components["schemas"]["IntakeTermRef"][];
        };
        IntakeSourceScope: {
            tenantId: string;
            appId: string;
            brandId: string;
            shopId: string | null;
            /** @enum {string} */
            domain: "presale" | "campaign" | "aftersale" | "product";
            sourceId: string;
        };
        IntakeSopFlowDefinition: {
            header: components["schemas"]["IntakeSopFlowHeader"];
            nodes: components["schemas"]["IntakeSopNode"][];
            edges: components["schemas"]["IntakeSopEdge"][];
        } & unknown;
        IntakeSopFlowHeader: {
            key: components["schemas"]["IntakeSopFlowKey"];
            title: string;
            anchorEntry: components["schemas"]["IntakeSopEntryRef"] | null;
            entryTerms: unknown[] & components["schemas"]["IntakeSopTerms"];
            applicability: components["schemas"]["IntakeSopApplicability"];
            startNodeId: components["schemas"]["IntakeSopId"];
            /** @enum {unknown} */
            operation: "upsert" | "disable";
            audience: components["schemas"]["IntakeSopAudience"];
            /** Format: date-time */
            effectiveFrom: string;
            /** Format: date-time */
            effectiveTo: string | null;
        };
        IntakeSopTerms: string[];
        /** @enum {unknown} */
        IntakeSopAudience: "agent" | "coach";
        IntakeSopNode: {
            key: components["schemas"]["IntakeSopFlowKey"];
            id: components["schemas"]["IntakeSopId"];
            body: {
                /** @enum {unknown} */
                kind: "action" | "decision" | "terminal";
                title: string;
                stageLabel: string;
                instruction: string;
                audience: components["schemas"]["IntakeSopAudience"];
                requirements: components["schemas"]["IntakeSopRequirement"][] & (unknown & unknown & unknown & unknown & unknown & unknown & unknown & unknown & unknown & unknown & unknown & unknown & unknown & unknown & unknown & unknown & unknown & unknown & unknown & unknown & unknown & unknown & unknown & unknown & unknown & unknown & unknown & unknown & unknown & unknown & unknown & unknown);
                knowledge: components["schemas"]["IntakeSopKnowledge"][];
                scripts: components["schemas"]["IntakeSopTaskScript"][];
            };
        };
        IntakeSopRequirement: {
            id: components["schemas"]["IntakeSopId"];
            label: string;
            ordinal: number;
        };
        IntakeSopKnowledge: {
            id: components["schemas"]["IntakeSopId"];
            title: string;
            body: string;
            audience: components["schemas"]["IntakeSopAudience"];
            resourceBinding?: {
                resourceId: components["schemas"]["IntakeSopId"];
                /** @enum {unknown} */
                ownerKind: "task" | "knowledge";
                ownerId: components["schemas"]["IntakeSopId"];
            };
        };
        IntakeSopTaskScript: {
            entry: components["schemas"]["IntakeSopEntryRef"];
            /** @enum {unknown} */
            relation: "independent" | "alternative" | "complementary";
            condition: string;
        };
        IntakeSopEdge: {
            key: components["schemas"]["IntakeSopFlowKey"];
            id: components["schemas"]["IntakeSopId"];
            from: components["schemas"]["IntakeSopId"];
            to: components["schemas"]["IntakeSopId"];
            action: {
                /** @constant */
                kind: "next";
            } | {
                /** @constant */
                kind: "choice";
                label: string;
                ordinal: number;
                matchTerms: components["schemas"]["IntakeSopTerms"];
                criterion: string;
                unableToDetermine: boolean;
            };
        };
        IntakeSopFlowDifference: {
            sourceId: components["schemas"]["IntakeSopId"];
            flowId: components["schemas"]["IntakeSopId"];
            /** @enum {unknown} */
            change: "add" | "modify" | "disable" | "reenable";
            previousVersion: components["schemas"]["IntakeSopVersion"] | null;
            nextVersion: components["schemas"]["IntakeSopVersion"];
            beforeDigest: components["schemas"]["IntakeSopHash"] | null;
            afterDigest: components["schemas"]["IntakeSopHash"];
        };
        /** @description 当前上传主体声明整理责任人及全部实际改稿人，纯本人制作也需显式列本人。服务端加入上传主体，按同租户/app已确认身份归一、校验并冻结入 contributors；这些是被声明贡献人，不能代替会话 actor 或赋予权限。声明变更须新候选版本。 */
        IntakeContributorDeclaration: {
            preparerPrincipalId: string;
            editorPrincipalIds: string[];
            /** @enum {boolean} */
            confirmed: true;
        };
        IntakeCoordinate: {
            sheet: string;
            row: number;
            column: number;
        };
        IntakeDigest: string;
        IntakeEntitlement: {
            entitlementId: string;
            releaseId: string;
            shopId: string;
            contextGeneration: components["schemas"]["IntakeVersion"];
            revocationGeneration: number;
            /** Format: date-time */
            validUntil: string;
            scopes: components["schemas"]["IntakeSopSourceScope"][];
        };
        IntakeEntitlementRequest: {
            shopId: string;
            contextGeneration: components["schemas"]["IntakeVersion"];
            releaseId: string | null;
            productIds: components["schemas"]["IntakeSelectionIds"];
            scenarioIds: components["schemas"]["IntakeSelectionIds"];
        };
        /** @description 显式选择；空集合只匹配无该类限制的条目。API 按 C/ASCII 顺序排序后绑定资格，选择不能增加访问范围。 */
        IntakeSelectionIds: components["schemas"]["IntakeId"][];
        IntakeId: string;
        IntakeError: {
            error: components["schemas"]["IntakeFailure"];
        };
        IntakeFailure: {
            /** @enum {string} */
            code: "VALIDATION" | "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "RATE_LIMITED" | "OVERLOADED" | "INTERNAL_ERROR";
            message: string;
            details: {
                /** @enum {string} */
                reason: "ORG_FACTS_UNAVAILABLE" | "PERMISSION_CHANGED" | "SCOPE_DENIED" | "ROLE_CEILING" | "GRANT_AUTHORITY_DENIED" | "SELF_ESCALATION" | "REDELEGATION_DENIED" | "NO_STEWARD" | "SOURCE_MISMATCH" | "SOURCE_ORDER_UNKNOWN" | "FILE_INVALID" | "FILE_LIMIT" | "TEMPLATE_VERSION" | "EMPTY_DATA" | "QUOTA_EXCEEDED" | "AWAITING_APPROVAL" | "APPROVAL_UNAVAILABLE" | "HUMAN_REVIEW_REQUIRED" | "APPROVAL_BINDING" | "ATTACHMENT_UNVERIFIED" | "MATERIAL_CHANGED" | "BASE_CHANGED" | "APPROVAL_CHANGED" | "APPROVAL_REVOKED" | "TICKET_EXPIRED" | "TICKET_CONSUMED" | "IDEMPOTENCY_CONFLICT" | "COMMIT_UNKNOWN" | "ALREADY_PUBLISHED" | "MODE_CONFLICT" | "UPGRADE_REQUIRED" | "VOCABULARY_IN_USE" | "MEANING_CHANGED" | "LEASE_EXPIRED" | "NO_SHOP" | "CHOOSE_SHOP" | "SHOP_DIRECTORY_CURSOR" | "SHOP_DIRECTORY_SESSION" | "SHOP_DISPLAY_MISSING" | "SHOP_DIRECTORY_CHANGED" | "SHOP_DIRECTORY_EXPIRED" | "SHOP_DIRECTORY_UNAVAILABLE" | "SOURCE_FORMAT_MISMATCH" | "SOP_MAPPING_REQUIRED" | "SOP_GRAPH_INVALID" | "SOP_DEPENDENCY_INVALID" | "SOP_RELEASE_CHANGED" | "SOP_SNAPSHOT_INVALID" | "CONTRACT_UPGRADE_REQUIRED" | "SOP_MEDIA_UNAVAILABLE";
                diagnosticId: string;
            };
        };
        IntakeGrant: {
            grantId: string;
            version: components["schemas"]["IntakeVersion"];
            /** @enum {string} */
            kind: "business" | "allocation" | "delegation";
            issuerPrincipalId: string;
            recipientPrincipalId: string;
            action: components["schemas"]["IntakeAction"];
            scope: components["schemas"]["IntakeScope"];
            /** Format: date-time */
            startsAt: string;
            /** Format: date-time */
            expiresAt: string;
            /** Format: date-time */
            revokedAt: string | null;
            stewardPrincipalId: string | null;
            /** @description 初次授予原因，不可改写；后续请求原因写 lastChangeReason 并随版本追加历史。 */
            reason: string;
            /** @enum {boolean} */
            mayRedelegate: false;
            /** @description 版本1为null；后续版本为该次撤权或接管请求的reason，旧版本在grant_history中保留。 */
            lastChangeReason: string | null;
        };
        IntakeGrantBatch: {
            operationId: string;
            issuerFactsVersion: components["schemas"]["IntakeVersion"];
            policyVersion: components["schemas"]["IntakeVersion"];
            items: components["schemas"]["IntakeGrantItem"][];
        };
        IntakeGrantItem: {
            /** @enum {string} */
            kind: "business" | "delegation";
            recipientPrincipalId: string;
            recipientFactsVersion: components["schemas"]["IntakeVersion"];
            action: components["schemas"]["IntakeAction"];
            scope: components["schemas"]["IntakeScope"];
            /** Format: date-time */
            startsAt: string;
            /** Format: date-time */
            expiresAt: string;
            reason: string;
        };
        IntakeGrantChange: {
            operationId: string;
            expectedVersion: components["schemas"]["IntakeVersion"];
            /** @enum {string} */
            change: "revoke" | "takeover";
            stewardPrincipalId: string | null;
            /** @description 本次变更原因；受控事务写入新版本lastChangeReason，保留初次reason及全部历史。 */
            reason: string;
        };
        IntakeGrantList: {
            items: components["schemas"]["IntakeGrant"][];
            nextCursor: string | null;
        };
        IntakeIssue: {
            code: string;
            message: string;
            location: components["schemas"]["IntakeCoordinate"];
        };
        /** @description 服务端已认证主体的已确认 principal 映射。validUntil 不是离线授权；Main 在创建候选前重读并保留原操作的精确输入进行不确定结果恢复。参与人目录复用 IntakePrincipalPage；本对象不包含展示名或整份权限。 */
        IntakeManagementContext: {
            sourceId: components["schemas"]["IntakeId"];
            sourceVersion: components["schemas"]["IntakeVersion"];
            baseReleaseId: components["schemas"]["IntakeId"] | null;
            principalId: components["schemas"]["IntakeId"];
            factsVersion: components["schemas"]["IntakeVersion"];
            /** Format: date-time */
            validUntil: string;
        };
        IntakeMaterial: {
            /** @enum {unknown} */
            canonicalEncodingVersion: "candidate-p1.1" | "candidate-sop-graph-v1" | "candidate-sop-task-graph-v2";
            scope: components["schemas"]["IntakeSopSourceScope"];
            sourceVersion: components["schemas"]["IntakeVersion"];
            sourceClaim: components["schemas"]["IntakeSourceClaim"];
            templateVersion: string;
            ruleVersion: string;
            mappingVersion: string;
            selectedSheets: string[];
            object: components["schemas"]["IntakeObject"];
            entries: components["schemas"]["IntakeEntry"][];
            differences: components["schemas"]["IntakeDifference"][];
            /** @description 上传主体 + 声明的整理责任人 + 全部实际改稿人，经认证身份归一去重。声明源由 IntakeReceive 提供，解析器不能从文件作者或上传者推断。 */
            contributors: string[];
            risk: components["schemas"]["IntakeRisk"];
            baseReleaseId: string | null;
            media: components["schemas"]["IntakeSopMedia"][];
            sopFlows?: components["schemas"]["IntakeSopFlowDefinition"][];
            sopDifferences?: components["schemas"]["IntakeSopFlowDifference"][];
            mappingDigest?: components["schemas"]["IntakeSopHash"];
        } & ({
            /** @constant */
            templateVersion: "faq-p1.1";
            /** @constant */
            ruleVersion: "intake-p1.1";
            object?: {
                /** @constant */
                mime?: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
            };
            /** @constant */
            selectedSheets: [
                "来源",
                "FAQ",
                "相似问法"
            ];
            /** @constant */
            canonicalEncodingVersion?: "candidate-p1.1";
            media?: {
                objectId: string;
                sha256: string;
                mime: string;
                bytes: components["schemas"]["IntakeVersion"];
                required: boolean;
                alt: string;
            }[];
            sopFlows?: unknown;
            sopDifferences?: unknown;
            scope?: components["schemas"]["IntakeSourceScope"];
            entries?: unknown;
        } | {
            /** @constant */
            templateVersion: "faq-csv-v1";
            /** @constant */
            ruleVersion: "intake-csv-v1";
            /** @constant */
            mappingVersion?: "faq-csv-columns-v1";
            object?: {
                /** @constant */
                mime?: "text/csv";
            };
            /** @constant */
            selectedSheets: [
                "CSV"
            ];
            /** @constant */
            canonicalEncodingVersion?: "candidate-p1.1";
            media?: {
                objectId: string;
                sha256: string;
                mime: string;
                bytes: components["schemas"]["IntakeVersion"];
                required: boolean;
                alt: string;
            }[];
            sopFlows?: unknown;
            sopDifferences?: unknown;
            scope?: components["schemas"]["IntakeSourceScope"];
            entries?: unknown;
        } | {
            /** @constant */
            canonicalEncodingVersion: "candidate-sop-task-graph-v2";
            /** @constant */
            templateVersion: "sop-manual-authoring-v1.1";
            /** @constant */
            ruleVersion: "sop-task-graph-v2";
            /** @constant */
            mappingVersion: "sop-manual-to-task-graph-v2";
            /** @constant */
            selectedSheets: [
                "场景目录",
                "执行任务",
                "判断分支",
                "客户话术",
                "知识与案例",
                "资源与图片"
            ];
            sopFlows: components["schemas"]["IntakeSopFlowDefinition"][];
            sopDifferences: components["schemas"]["IntakeSopFlowDifference"][];
            media: components["schemas"]["IntakeSopMedia"][];
            mappingDigest: components["schemas"]["IntakeSopHash"];
            object?: {
                /** @constant */
                mime?: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
            };
            entries?: unknown;
        });
        IntakeOperationReceipt: components["schemas"]["IntakeReceipt"] | components["schemas"]["IntakeRollbackReceipt"];
        IntakeReceipt: {
            operationId: string;
            key: components["schemas"]["IntakeCandidateKey"];
            /** @enum {string} */
            state: "pending" | "unknown" | "published" | "cancelled" | "failed";
            releaseId: string | null;
            announcementId: string | null;
            reason: string | null;
            /** @enum {string} */
            action: "publish" | "cancel";
        };
        IntakeRollbackReceipt: {
            operationId: string;
            /** @enum {string} */
            state: "pending" | "unknown" | "published" | "cancelled" | "failed";
            releaseId: string | null;
            announcementId: string | null;
            reason: string | null;
            rollbackPlanId: components["schemas"]["IntakeId"];
            /** @enum {string} */
            action: "rollback";
        };
        IntakeParseJob: {
            jobId: string;
            generation: components["schemas"]["IntakeVersion"];
            /** @enum {string} */
            state: "reading" | "parsing" | "validated" | "failed" | "cancelled";
            candidateId: string | null;
            candidateVersion: number | null;
            issues: components["schemas"]["IntakeIssue"][];
            totalIssues: number;
            excludedSheetCount: number;
            excludedMediaCount: number;
            reportObjectId: string | null;
        };
        IntakePolicy: {
            /** @enum {string} */
            policyVersion: "intake-p1.1";
            /** @enum {string} */
            templateVersion: "faq-p1.1";
            /** @enum {integer} */
            maxFileBytes: 10485760;
            /** @enum {integer} */
            maxExpandedBytes: 52428800;
            /** @enum {integer} */
            maxZipEntries: 512;
            /** @enum {integer} */
            maxRows: 5000;
            /** @enum {integer} */
            maxColumns: 32;
            /** @enum {integer} */
            maxCells: 200000;
            /** @enum {integer} */
            maxCellCharacters: 32767;
            /** @enum {integer} */
            maxSharedStrings: 100000;
            /** @enum {integer} */
            parseTimeoutMs: 30000;
            /** @enum {integer} */
            maxActiveCandidatesPerActor: 10;
            /** @enum {integer} */
            maxActiveCandidatesPerSource: 100;
            /** @enum {integer} */
            maxTenantStagingBytes: 1073741824;
            /** @enum {integer} */
            orgFactsMaxAgeSeconds: 300;
            /** @enum {integer} */
            approvalFactsMaxAgeSeconds: 300;
            /** @enum {integer} */
            ticketMaxAgeSeconds: 60;
            /**
             * @description 此合同集至少一种输入格式支持选定的嵌入图片；具体格式以 inputFormats 为准，既有 FAQ 和 CSV 行为不变。
             * @constant
             */
            selectedMediaSupported: true;
            inputFormats: [
                {
                    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
                    templateVersion: "faq-p1.1";
                    ruleVersion: "intake-p1.1";
                    selectedSheets: [
                        "来源",
                        "FAQ",
                        "相似问法"
                    ];
                },
                {
                    mime: "text/csv";
                    templateVersion: "faq-csv-v1";
                    ruleVersion: "intake-csv-v1";
                    mappingVersion: "faq-csv-columns-v1";
                    structureDigest: "daaa4126d63194f59949c2b6f464b108ed87a430090e4dfe36e255663ab59165";
                    selectedSheets: [
                        "CSV"
                    ];
                },
                {
                    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
                    templateVersion: "sop-manual-authoring-v1.1";
                    ruleVersion: "sop-task-graph-v2";
                    mappingVersion: "sop-manual-to-task-graph-v2";
                    selectedSheets: [
                        "场景目录",
                        "执行任务",
                        "判断分支",
                        "客户话术",
                        "知识与案例",
                        "资源与图片"
                    ];
                    selectedMediaSupported: true;
                }
            ];
        };
        IntakePrincipalPage: {
            items: {
                principalId: string;
                displayLabel: string;
                factsVersion: components["schemas"]["IntakeVersion"];
                /** Format: date-time */
                validUntil: string;
                enabled: boolean;
            }[];
            nextCursor: string | null;
        };
        IntakePublish: {
            operationId: string;
            key: components["schemas"]["IntakeCandidateKey"];
            baseReleaseId: string | null;
            sourceEvidenceVersion: components["schemas"]["IntakeVersion"];
            title: string;
            summary: string;
            /**
             * @description 明确的本次发布意图；桌面仅在 Main 原生二次确认后设置。不能替代服务端权限/版本/来源/质量复核，也不能证明任意第三方调用者弹过窗。
             * @constant
             */
            confirmed: true;
        };
        /** @description 经当前店铺、词项、时段、显式覆盖和有效使用资格过滤后的坐席投影。内部说明与附件说明不得下发；复制只含 answerText，风险提示单独展示。 启用条目的商品与场景引用总数最多 100；整页去重词项最多 100，分页不得截断条目。 */
        IntakePublishedEntry: {
            businessEntryId: string;
            scriptVersion: components["schemas"]["IntakeVersion"];
            /** @enum {string} */
            operation: "upsert";
            title: string;
            answerText: string;
            questions: components["schemas"]["IntakeQuestion"][];
            productRefs: components["schemas"]["IntakeTermRef"][];
            scenarioRefs: components["schemas"]["IntakeTermRef"][];
            /** Format: date-time */
            effectiveFrom: string;
            /** Format: date-time */
            effectiveTo: string | null;
            applicabilityNote: string;
            familySourceId: string | null;
            familyBusinessEntryId: string | null;
            brandNonOverridable: boolean;
            category: string;
            riskNote: string;
        } & unknown;
        IntakeQualityAttribution: {
            principalId: components["schemas"]["IntakeId"];
            factsVersion: components["schemas"]["IntakeVersion"];
            /** Format: date-time */
            recordedAt: string;
        };
        /** @description 原因按 Unicode code point 计数；禁止 NUL 和未配对代理项。缺陷必须有非空白原因；单轮和请求还受字节预算约束。 */
        IntakeQualityCheck: {
            scriptId: string;
            contentHash: string;
            defect: boolean;
            reason: string;
        };
        IntakeQualityCommand: {
            operationId: components["schemas"]["IntakeId"];
            key: components["schemas"]["IntakeCandidateKey"];
        };
        /** @description SOP requires a bounded sopPlan bound to materialDigest and the exact target set digest; graph targets are read through quality samples. FAQ plans omit sopPlan. */
        IntakeQualityPlan: {
            /** @constant */
            policyVersion: "intake-quality-v1";
            ordinaryCount: number;
            mandatoryCount: number;
            withdrawalCount: number;
            initialTarget: number;
            expandedTarget: number;
            initialCount: number;
            expandedCount: number;
            seedHash: string;
            populationManifestHash: string;
            selectionManifestHash: string;
            sopPlan?: components["schemas"]["IntakeSopSopQualityPlan"];
        };
        IntakeSopSopQualityPlan: {
            /** @constant */
            policyVersion: "sop-task-graph-quality-v2";
            materialDigest: components["schemas"]["IntakeSopHash"];
            targetCount: number;
            targetsDigest: components["schemas"]["IntakeSopHash"];
        };
        /** @description 永久操作的精简历史结果，不含正文、逐条原因、权限或新的使用资格。只有当前有效会话的原主体能恢复；不将历史 state 当成当前状态。 SOP freeze/check receipts include the exact frozen sopPlan; this historical result confers no current authority. */
        IntakeQualityReceipt: {
            operationId: components["schemas"]["IntakeId"];
            /** @enum {string} */
            action: "quality-freeze" | "quality-check";
            key: components["schemas"]["IntakeCandidateKey"];
            /** @enum {string} */
            state: "initial_required" | "expansion_required" | "passed" | "revision_required" | "blocked";
            phase: ("initial" | "expanded") | null;
            sopPlan?: components["schemas"]["IntakeSopSopQualityPlan"];
            /**
             * @description 服务端从相同候选 key 对应的材料取得，不由调用方选择。
             * @enum {unknown}
             */
            canonicalEncodingVersion: "candidate-p1.1" | "candidate-sop-task-graph-v2";
        } & (unknown & unknown);
        /** @description SOP rounds carry bounded summaries; exact graph checks and reasons are read through the same quality samples cursor. */
        IntakeQualityRound: {
            /** @enum {string} */
            phase: "initial" | "expanded";
            reviewer: components["schemas"]["IntakeQualityAttribution"];
            checkedCount: number;
            defectCount: number;
            sopChecksSummary?: components["schemas"]["IntakeSopSopQualityCheckSummary"];
        };
        IntakeSopSopQualityCheckSummary: {
            checkedCount: number;
            defectCount: number;
            checksDigest: components["schemas"]["IntakeSopHash"];
        };
        IntakeQualitySample: {
            scriptId: string;
            contentHash: string;
            mandatory: boolean;
            entry: components["schemas"]["IntakeEntry"] & {
                /** @constant */
                operation?: "upsert";
            };
            check: components["schemas"]["IntakeQualityCheck"] | null;
        };
        /** @description v9 按同一 quality viewHash、phase 和游标分页 FAQ 样本及 SOP 图检查；允许仅含图的非空页。完整记录不拆分，整页 UTF-8 JSON 不超过 1 MiB。 */
        IntakeQualitySamplePage: {
            key: components["schemas"]["IntakeCandidateKey"];
            viewHash: string;
            /** @enum {string} */
            phase: "initial" | "expanded";
            selectionManifestHash: string;
            items: components["schemas"]["IntakeQualitySample"][];
            nextCursor: string | null;
            /**
             * @description 服务端从相同候选 key 对应的材料取得，不由调用方选择。
             * @enum {unknown}
             */
            canonicalEncodingVersion: "candidate-p1.1" | "candidate-sop-task-graph-v2";
            sopItems?: components["schemas"]["IntakeSopSopQualitySample"][];
        } & unknown;
        IntakeSopSopQualitySample: {
            target: components["schemas"]["IntakeSopSopQualityTarget"];
            check: components["schemas"]["IntakeSopFlowCheck"] | null;
        };
        IntakeSopSopQualityTarget: {
            key: components["schemas"]["IntakeSopFlowKey"];
            graphDigest: components["schemas"]["IntakeSopHash"];
        };
        IntakeSopFlowCheck: {
            key: components["schemas"]["IntakeSopFlowKey"];
            graphDigest: components["schemas"]["IntakeSopHash"];
            defect: boolean;
            reason: string;
        };
        /** @description 当前重新授权的有界摘要，not_frozen 的 plan 仅是服务端预览。viewHash 绑定 key/canonicalEncodingVersion/plan/state/frozen/rounds（不含自己）的规范 JSON SHA-256。passed 不是组织审批或发布许可。 */
        IntakeQualityStatus: {
            key: components["schemas"]["IntakeCandidateKey"];
            viewHash: string;
            /** @enum {string} */
            state: "not_frozen" | "initial_required" | "expansion_required" | "passed" | "revision_required" | "blocked";
            plan: components["schemas"]["IntakeQualityPlan"];
            frozen: components["schemas"]["IntakeQualityAttribution"] | null;
            rounds: components["schemas"]["IntakeQualityRound"][] & (unknown & unknown);
            /**
             * @description 服务端从相同候选 key 对应的材料取得，不由调用方选择。
             * @enum {unknown}
             */
            canonicalEncodingVersion: "candidate-p1.1" | "candidate-sop-task-graph-v2";
        } & (unknown & unknown & unknown & unknown & unknown & unknown);
        /** @description 完整阶段一次原子提交，scriptId 唯一且集合精确匹配服务端冻结样本；扩样原结果不可改。空集合仅在服务端阶段样本实际为空时合法。未知字段拒绝；不接受审核人、抽样参数或结论。 SOP requires materialDigest and exact sopChecks for the frozen sopPlan. Any graph defect blocks passing regardless of FAQ sampling threshold. Omission for a SOP candidate is rejected; revisions invalidate all checks. */
        IntakeQualitySubmission: {
            operationId: components["schemas"]["IntakeId"];
            key: components["schemas"]["IntakeCandidateKey"];
            /** @enum {string} */
            phase: "initial" | "expanded";
            checks: components["schemas"]["IntakeQualityCheck"][];
            materialDigest?: components["schemas"]["IntakeSopHash"];
            sopChecks?: components["schemas"]["IntakeSopFlowCheck"][];
        };
        IntakeReceive: {
            operationId: string;
            objectId: string;
            sourceVersion: components["schemas"]["IntakeVersion"];
            baseReleaseId: string | null;
            contributorDeclaration: components["schemas"]["IntakeContributorDeclaration"];
            /** @description 明确 null 为新建独立候选；完整旧键为修订该候选，不得从 source/file 推测。成功解析并复算后在同事务 CAS 旧键和可修订状态，废旧并冻结同 candidateId 的下一版。解析失败保留旧版；publishing/unknown/published/cancelled/invalidated 不允许修订，返回明确冲突。 */
            expectedPriorKey: components["schemas"]["IntakeCandidateKey"] | null;
        };
        IntakeReview: {
            key: components["schemas"]["IntakeCandidateKey"];
            reviewRequestId: string;
            instanceCode: string | null;
            evidenceVersion: number;
            revocationGeneration: number;
            /** @enum {string} */
            state: "creating" | "pending" | "approved" | "rejected" | "revoked" | "unavailable";
            /** Format: date-time */
            checkedAt: string | null;
            /** Format: date-time */
            validUntil: string | null;
            reviewPackageObjectId: string;
            reviewPackageSha256: string;
        };
        IntakeReviewRequest: {
            operationId: string;
            key: components["schemas"]["IntakeCandidateKey"];
            expectedEvidenceVersion: number;
        };
        IntakeRollback: {
            operationId: string;
            baseReleaseId: string;
            targetReleaseId: string;
            impactDigest: string;
            rollbackPlanId: components["schemas"]["IntakeId"];
            /**
             * @description 明确的本次发布意图；桌面仅在 Main 原生二次确认后设置。不能替代服务端权限/版本/来源/质量复核，也不能证明任意第三方调用者弹过窗。
             * @constant
             */
            confirmed: true;
        };
        IntakeRollbackImpact: {
            baseReleaseId: string;
            targetReleaseId: string;
            impactDigest: string;
            scopes: components["schemas"]["IntakeSopSourceScope"][];
            requiresCorrectiveCandidate: boolean;
            rollbackPlanId: components["schemas"]["IntakeId"];
            approvalEvidenceVersion: number;
        };
        IntakeRollbackPreview: {
            baseReleaseId: string;
            targetReleaseId: string;
        };
        /** @description 全目录回退的独立人工审核材料绑定和最长5分钟核验事实。unavailable 不续期，不可仅凭 approved 忽略 validUntil；提交仍由服务端重验。 */
        IntakeRollbackReview: {
            rollbackPlanId: components["schemas"]["IntakeId"];
            reviewRequestId: string;
            evidenceVersion: number;
            /** @enum {string} */
            state: "creating" | "pending" | "approved" | "rejected" | "revoked" | "unavailable";
            instanceCode: string | null;
            revocationGeneration: number;
            /** Format: date-time */
            checkedAt: string | null;
            /** Format: date-time */
            validUntil: string | null;
            reviewPackageObjectId: string;
            reviewPackageSha256: string;
            impactDigest: string;
        };
        IntakeRollbackReviewRequest: {
            operationId: components["schemas"]["IntakeId"];
            impactDigest: components["schemas"]["IntakeDigest"];
            expectedEvidenceVersion: number;
        };
        IntakeShopDirectory: {
            items: components["schemas"]["IntakeShopDisplay"][];
            nextCursor: string | null;
            /**
             * Format: date-time
             * @description 本页与后续同一次目录读取共用的最早截止。它不是新的业务授权。
             */
            validUntil: string;
        };
        IntakeShopDisplay: {
            shopId: components["schemas"]["IntakeId"];
            displayName: string;
            displayVersion: components["schemas"]["IntakeVersion"];
        };
        IntakeSnapshot: {
            releaseId: string;
            entitlementId: string;
            contextGeneration: components["schemas"]["IntakeVersion"];
            faq: {
                sourceId: string;
                entry: components["schemas"]["IntakePublishedEntry"];
            }[];
            sopNodes: components["schemas"]["IntakeSopNode"][];
            sopEdges: components["schemas"]["IntakeSopEdge"][];
            media: components["schemas"]["IntakeSopMedia"][];
            vocabulary: components["schemas"]["IntakeVocabulary"][];
            nextCursor: string | null;
            snapshotDigest: components["schemas"]["IntakeSopHash"];
            pageIndex: number;
            pageCount: number;
            totals: components["schemas"]["IntakeSopTotals"];
            sopFlows: components["schemas"]["IntakeSopPublishedFlow"][];
        };
        IntakeVocabulary: {
            id: string;
            /** @enum {string} */
            kind: "product" | "scenario";
            displayVersion: components["schemas"]["IntakeVersion"];
            displayName: string;
            meaningDigest: string;
            scope: components["schemas"]["IntakeScope"];
            active: boolean;
        };
        IntakeSopTotals: {
            faq: number;
            vocabulary: number;
            sopFlows: number;
            sopNodes: number;
            sopEdges: number;
            media: number;
        };
        IntakeSopPublishedFlow: {
            header: components["schemas"]["IntakeSopFlowHeader"] & {
                /** @constant */
                operation?: "upsert";
            };
            graphDigest: components["schemas"]["IntakeSopHash"];
        };
        IntakeSopActionCheck: {
            entitlementId: components["schemas"]["IntakeSopId"];
            releaseId: components["schemas"]["IntakeSopId"];
            contextGeneration: components["schemas"]["IntakeSopVersion"];
            key: components["schemas"]["IntakeSopFlowKey"];
            graphDigest: components["schemas"]["IntakeSopHash"];
            nodeId: components["schemas"]["IntakeSopId"];
            /** @enum {unknown} */
            action: "open" | "observe" | "next" | "choose" | "back" | "copy";
            edgeId: components["schemas"]["IntakeSopId"] | null;
            entry: components["schemas"]["IntakeSopEntryRef"] | null;
            continuationId: components["schemas"]["IntakeSopContinuationId"];
        } & unknown;
        IntakeSopContinuationId: string;
        IntakeSopCandidateMediaBinding: {
            sourceId: components["schemas"]["IntakeSopId"];
            flowId: components["schemas"]["IntakeSopId"];
            flowVersion: components["schemas"]["IntakeSopVersion"];
            /** @enum {unknown} */
            ownerKind: "entry" | "task" | "knowledge";
            ownerId: components["schemas"]["IntakeSopId"];
            scriptVersion?: components["schemas"]["IntakeSopVersion"];
            resourceId: components["schemas"]["IntakeSopId"];
            objectId: components["schemas"]["IntakeSopId"];
        };
        IntakeSopCandidateMediaPayload: {
            sha256: components["schemas"]["IntakeSopHash"];
            /** @enum {unknown} */
            mime: "image/png" | "image/jpeg" | "image/gif";
            bytes: number;
            base64: string;
            key: components["schemas"]["IntakeCandidateKey"];
            binding: components["schemas"]["IntakeSopCandidateMediaBinding"];
        };
        IntakeSopContinuationClose: {
            continuationId: components["schemas"]["IntakeSopContinuationId"];
        };
        IntakeSopContinuationReceipt: {
            continuationId: components["schemas"]["IntakeSopContinuationId"];
            entitlement: components["schemas"]["IntakeEntitlement"];
        };
        IntakeSopContinuationRenew: {
            continuationId: components["schemas"]["IntakeSopContinuationId"];
            contextGeneration: components["schemas"]["IntakeSopVersion"];
        };
        /** @enum {unknown} */
        IntakeSopErrorReason: "SOP_MAPPING_REQUIRED" | "SOP_GRAPH_INVALID" | "SOP_DEPENDENCY_INVALID" | "SOP_RELEASE_CHANGED" | "SOP_SNAPSHOT_INVALID" | "CONTRACT_UPGRADE_REQUIRED" | "SOP_MEDIA_UNAVAILABLE";
        IntakeSopMaterialDelta: {
            /** @constant */
            canonicalEncodingVersion: "candidate-sop-task-graph-v2";
            /** @constant */
            templateVersion: "sop-manual-authoring-v1.1";
            /** @constant */
            ruleVersion: "sop-task-graph-v2";
            /** @constant */
            mappingVersion: "sop-manual-to-task-graph-v2";
            /** @constant */
            selectedSheets: [
                "场景目录",
                "执行任务",
                "判断分支",
                "客户话术",
                "知识与案例",
                "资源与图片"
            ];
            sopFlows: components["schemas"]["IntakeSopFlowDefinition"][];
            sopDifferences: components["schemas"]["IntakeSopFlowDifference"][];
            media: components["schemas"]["IntakeSopMedia"][];
            mappingDigest: components["schemas"]["IntakeSopHash"];
        };
        IntakeSopMediaPayload: {
            releaseId: components["schemas"]["IntakeSopId"];
            entitlementId: components["schemas"]["IntakeSopId"];
            objectId: components["schemas"]["IntakeSopId"];
            sha256: components["schemas"]["IntakeSopHash"];
            /** @enum {unknown} */
            mime: "image/png" | "image/jpeg" | "image/gif";
            bytes: number;
            base64: string;
        };
        IntakeSopQualityDelta: {
            materialDigest: components["schemas"]["IntakeSopHash"];
            sopChecks: components["schemas"]["IntakeSopFlowCheck"][];
        };
        IntakeSopSnapshotDelta: {
            snapshotDigest: components["schemas"]["IntakeSopHash"];
            pageIndex: number;
            pageCount: number;
            totals: components["schemas"]["IntakeSopTotals"];
            sopFlows: components["schemas"]["IntakeSopPublishedFlow"][];
            sopNodes: components["schemas"]["IntakeSopNode"][];
            sopEdges: components["schemas"]["IntakeSopEdge"][];
            media: components["schemas"]["IntakeSopMedia"][];
        };
        IntakeSource: {
            scope: components["schemas"]["IntakeSopSourceScope"];
            version: components["schemas"]["IntakeVersion"];
            templateVersion: string;
            ruleVersion: string;
            mappingVersion: string;
            structureDigest: string;
            /** @enum {string} */
            contentIntakeMode: "legacy" | "v2-preview" | "v2-active";
            modeVersion: components["schemas"]["IntakeVersion"];
        } & ({
            /** @constant */
            templateVersion: "faq-p1.1";
            /** @constant */
            ruleVersion: "intake-p1.1";
            scope?: components["schemas"]["IntakeSourceScope"];
        } | {
            /** @constant */
            templateVersion: "faq-csv-v1";
            /** @constant */
            ruleVersion: "intake-csv-v1";
            /** @constant */
            mappingVersion?: "faq-csv-columns-v1";
            /** @constant */
            structureDigest?: "daaa4126d63194f59949c2b6f464b108ed87a430090e4dfe36e255663ab59165";
            scope?: components["schemas"]["IntakeSourceScope"];
        } | {
            /** @constant */
            templateVersion: "sop-manual-authoring-v1.1";
            /** @constant */
            ruleVersion: "sop-task-graph-v2";
            /** @constant */
            mappingVersion: "sop-manual-to-task-graph-v2";
        });
        IntakeSourceConfirmation: {
            operationId: string;
            key: components["schemas"]["IntakeCandidateKey"];
            expectedEvidenceVersion: number;
            /** @enum {string} */
            confirmedVersionKind: "integer" | "opaque";
            confirmedVersionValue: string;
            /** @enum {string} */
            acquisition: "feishu-export" | "controlled-synthetic-export";
            objectSha256: string;
            reason: string;
        };
        IntakeSourceList: {
            items: components["schemas"]["IntakeSource"][];
            nextCursor: string | null;
        };
        IntakeSourceWrite: {
            operationId: string;
            expectedVersion: components["schemas"]["IntakeVersion"];
            templateVersion: string;
            ruleVersion: string;
            mappingVersion: string;
            structureDigest: string;
        } & ({
            /** @constant */
            templateVersion: "faq-p1.1";
            /** @constant */
            ruleVersion: "intake-p1.1";
        } | {
            /** @constant */
            templateVersion: "faq-csv-v1";
            /** @constant */
            ruleVersion: "intake-csv-v1";
            /** @constant */
            mappingVersion?: "faq-csv-columns-v1";
            /** @constant */
            structureDigest?: "daaa4126d63194f59949c2b6f464b108ed87a430090e4dfe36e255663ab59165";
        });
        IntakeVocabularyList: {
            items: components["schemas"]["IntakeVocabulary"][];
            nextCursor: string | null;
        };
        IntakeVocabularyWrite: {
            operationId: string;
            /** @enum {string} */
            change: "create" | "rename" | "retire";
            id: string;
            /** @enum {string} */
            kind: "product" | "scenario";
            expectedDisplayVersion: number;
            displayName: string;
            meaningDigest: string;
        };
        MenokinSopQuerySopBlockedResponse: {
            /** @constant */
            status: "blocked";
            /** Format: uuid */
            request_id: string;
            release_id: null;
            lease_expires_at: null;
            result: null;
            reasons: components["schemas"]["MenokinSopQuerySopReason"][];
        };
        MenokinSopQuerySopReason: {
            /** @enum {string} */
            code: "SCOPE_DENIED" | "LEASE_EXPIRED" | "APPROVAL_REVOKED" | "SOURCE_GATE_NOT_READY" | "GRAPH_UNRESOLVED" | "TERMINAL_HAS_OUTGOING_EDGE" | "SAFETY_REVIEW_REQUIRED" | "MEDIA_UNVERIFIED" | "STALE_RELEASE" | "IDEMPOTENCY_CONFLICT";
            source_ref?: string;
        };
        MenokinSopQuerySopEmptyResult: {
            flow: null;
            entries: unknown[];
            media: unknown[];
            permissions: unknown[];
        };
        MenokinSopQuerySopEntryPermission: {
            entry: components["schemas"]["IntakeSopEntryRef"];
            /** @enum {string} */
            risk_level: "low" | "medium" | "high" | "critical";
            copy_allowed: boolean;
            source_ref: string;
        };
        MenokinSopQuerySopErrorEnvelope: {
            /** @enum {string} */
            code: "CONTRACT_UPGRADE_REQUIRED" | "SCOPE_DENIED" | "SOP_BLOCKED" | "SOP_STALE" | "IDEMPOTENCY_CONFLICT" | "SOP_UNAVAILABLE";
            message: string;
            /** Format: uuid */
            request_id?: string;
        };
        MenokinSopQuerySopNoMatchResponse: {
            /** @constant */
            status: "no_match";
            /** Format: uuid */
            request_id: string;
            release_id: string;
            /** Format: date-time */
            lease_expires_at: string;
            result: components["schemas"]["MenokinSopQuerySopEmptyResult"];
            reasons: unknown[];
        };
        MenokinSopQuerySopQueryRequest: {
            /** @enum {string} */
            sop_group: "过敏流程SOP" | "长痘痘SOP" | "品质售后SOP" | "少错破SOP" | "税收相关规则";
            shop_id: string;
            product_context?: null | {
                /** @enum {string} */
                type: "storewide" | "category" | "sku";
                ref: string;
            };
            query_text: string;
            context_generation: string;
            /** Format: uuid */
            request_id: string;
        };
        MenokinSopQuerySopQueryResponse: components["schemas"]["MenokinSopQuerySopReadyResponse"] | components["schemas"]["MenokinSopQuerySopBlockedResponse"] | components["schemas"]["MenokinSopQuerySopStaleResponse"] | components["schemas"]["MenokinSopQuerySopNoMatchResponse"];
        MenokinSopQuerySopReadyResponse: {
            /** @constant */
            status: "ready";
            /** Format: uuid */
            request_id: string;
            release_id: string;
            /** Format: date-time */
            lease_expires_at: string;
            result: components["schemas"]["MenokinSopQuerySopReadyResult"];
            reasons: unknown[];
        };
        MenokinSopQuerySopReadyResult: {
            flow: components["schemas"]["IntakeSopFlowDefinition"];
            entries: {
                sourceId: components["schemas"]["IntakeSopId"];
                entry: components["schemas"]["IntakePublishedEntry"];
            }[];
            media: {
                binding: components["schemas"]["IntakeSopMedia"];
                preview_handle: string;
                /** Format: date-time */
                expires_at: string;
            }[];
            permissions: components["schemas"]["MenokinSopQuerySopEntryPermission"][];
            graph_digest: components["schemas"]["IntakeSopHash"];
        };
        MenokinSopQuerySopStaleResponse: {
            /** @constant */
            status: "stale";
            /** Format: uuid */
            request_id: string;
            release_id: string | null;
            lease_expires_at: null;
            result: null;
            reasons: components["schemas"]["MenokinSopQuerySopReason"][];
        };
        SopCandidateMaterial: {
            candidateId: components["schemas"]["IntakeId"];
            version: components["schemas"]["IntakeVersion"];
            sheets: {
                /** @enum {string} */
                name: "过敏流程SOP" | "少错破SOP" | "品质售后SOP" | "税收相关规则" | "品牌对接资源汇总" | "长痘痘SOP";
                rows: components["schemas"]["SopCandidateRow"][];
            }[];
            contentHash: string;
        };
        SopCandidateRow: {
            rowId: string;
            /** @enum {string} */
            sheetName: "过敏流程SOP" | "少错破SOP" | "品质售后SOP" | "税收相关规则" | "品牌对接资源汇总" | "长痘痘SOP";
            rowNumber: number;
            answer: string;
            media: components["schemas"]["SopMediaObject"][];
        };
        SopMediaObject: {
            mediaObjectId: components["schemas"]["IntakeId"];
            /** @enum {string} */
            sheetName: "过敏流程SOP" | "少错破SOP" | "品质售后SOP" | "税收相关规则" | "品牌对接资源汇总" | "长痘痘SOP";
            rowNumber: number;
            ordinal: number;
            sha256: string;
            /** @enum {string} */
            mime: "image/png" | "image/jpeg" | "image/gif";
            bytes: number;
            preview?: components["schemas"]["SopPreview"];
        };
        /** @description 系统内短期预览引用，不是永久 URL。 */
        SopPreview: {
            previewToken: string;
            /** Format: date-time */
            expiresAt: string;
        };
        SopPublishCommand: {
            operationId: components["schemas"]["IntakeId"];
            contentHash: string;
            /** @constant */
            confirm: true;
        };
        SopPublishReceipt: {
            releaseId: components["schemas"]["IntakeId"];
            contentHash: string;
            /** @constant */
            state: "published";
        };
        SopRollbackCommand: {
            rollbackPlanId: components["schemas"]["IntakeId"];
            operationId: components["schemas"]["IntakeId"];
            /** @constant */
            confirm: true;
        };
        SopRollbackReceipt: {
            releaseId: components["schemas"]["IntakeId"];
            /** @constant */
            state: "rolled_back";
        };
        SopUploadReceipt: {
            operationId: components["schemas"]["IntakeId"];
            candidateId: components["schemas"]["IntakeId"];
            version: components["schemas"]["IntakeVersion"];
            /** @enum {string} */
            state: "staged" | "idempotent";
        };
    };
    responses: {
        /** @description 严格 body/header 校验失败。 */
        MenokinSopQueryValidationError: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["MenokinSopQuerySopErrorEnvelope"];
            };
        };
        /** @description 产品会话无效或缺失。 */
        MenokinSopQueryUnauthorized: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["MenokinSopQuerySopErrorEnvelope"];
            };
        };
        /** @description 当前主体没有该店铺或 SOP 查询资格。 */
        MenokinSopQueryForbidden: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["MenokinSopQuerySopErrorEnvelope"];
            };
        };
        /** @description 合同、release、lease 或幂等键冲突。 */
        MenokinSopQueryConflict: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["MenokinSopQuerySopErrorEnvelope"];
            };
        };
        /** @description 图完整性、安全或媒体条件阻断查询。 */
        MenokinSopQuerySopBlocked: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["MenokinSopQuerySopErrorEnvelope"];
            };
        };
        /** @description 来源门或服务依赖不可用，必须 fail closed。 */
        MenokinSopQueryUnavailable: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["MenokinSopQuerySopErrorEnvelope"];
            };
        };
    };
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    querySop: {
        parameters: {
            query?: never;
            header: {
                /** @description 完整、由部署清单固定的合同集 ID；不得填写业务别名 menokin-sop-query-v1。缺失或不受支持返回 CONTRACT_UPGRADE_REQUIRED。 */
                "X-Intake-Contract-Set": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MenokinSopQuerySopQueryRequest"];
            };
        };
        responses: {
            /** @description 返回 ready、no_match、blocked 或 stale 的显式状态联合体。 */
            200: {
                headers: {
                    "Cache-Control"?: "no-store";
                    "X-Intake-Contract-Set"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MenokinSopQuerySopQueryResponse"];
                };
            };
            400: components["responses"]["MenokinSopQueryValidationError"];
            401: components["responses"]["MenokinSopQueryUnauthorized"];
            403: components["responses"]["MenokinSopQueryForbidden"];
            409: components["responses"]["MenokinSopQueryConflict"];
            422: components["responses"]["MenokinSopQuerySopBlocked"];
            503: components["responses"]["MenokinSopQueryUnavailable"];
        };
    };
}
