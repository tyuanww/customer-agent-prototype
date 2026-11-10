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
        IntakeCandidateKey: {
            candidateId: string;
            version: components["schemas"]["IntakeVersion"];
            digest: string;
        };
        IntakeVersion: number;
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
        IntakeId: string;
        /** @description SOP rounds carry bounded summaries; exact graph checks and reasons are read through the same quality samples cursor. */
        IntakeQualityRound: {
            /** @enum {string} */
            phase: "initial" | "expanded";
            reviewer: components["schemas"]["IntakeQualityAttribution"];
            checkedCount: number;
            defectCount: number;
            sopChecksSummary?: components["schemas"]["IntakeSopSopQualityCheckSummary"];
        };
        IntakeQualityAttribution: {
            principalId: components["schemas"]["IntakeId"];
            factsVersion: components["schemas"]["IntakeVersion"];
            /** Format: date-time */
            recordedAt: string;
        };
        IntakeSopSopQualityCheckSummary: {
            checkedCount: number;
            defectCount: number;
            checksDigest: components["schemas"]["IntakeSopHash"];
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
        /** @description 原因按 Unicode code point 计数；禁止 NUL 和未配对代理项。缺陷必须有非空白原因；单轮和请求还受字节预算约束。 */
        IntakeQualityCheck: {
            scriptId: string;
            contentHash: string;
            defect: boolean;
            reason: string;
        };
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
        IntakeRollbackImpact: {
            baseReleaseId: string;
            targetReleaseId: string;
            impactDigest: string;
            scopes: components["schemas"]["IntakeSopSourceScope"][];
            requiresCorrectiveCandidate: boolean;
            rollbackPlanId: components["schemas"]["IntakeId"];
            approvalEvidenceVersion: number;
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
        IntakeSourceList: {
            items: components["schemas"]["IntakeSource"][];
            nextCursor: string | null;
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
