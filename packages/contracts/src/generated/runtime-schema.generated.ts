/* GENERATED FILE. DO NOT EDIT. Run `pnpm contracts:generate` from the repository root. */

export const OPENAPI_RUNTIME_SCHEMA_ID = "urn:customer-agent:openapi:1.21.0:components";
export const COMPONENT_SCHEMA_NAMES = [
  "AdoptedEventRequest",
  "AdoptionEventRequest",
  "AdoptionEventResponse",
  "AdoptionOutcome",
  "Announcement",
  "AnnouncementAckRequest",
  "AuthMode",
  "AuthoritativeSourceBinding",
  "AuthoritativeSourceBindingStatus",
  "AuthoritativeSourceVersionId",
  "CancelImportRequest",
  "CancelImportResponse",
  "CandidateError",
  "CollectionMode",
  "ConflictErrorEnvelope",
  "ContentHash",
  "ContentImportRowContract",
  "ContentImportUpsertRow",
  "ContentImportWithdrawRow",
  "ContentNotReadyErrorEnvelope",
  "ContentQualityIssueCode",
  "ContentQualityReviewSummary",
  "ContentQualityStatus",
  "ContentQuestion",
  "CurrentAnnouncementResponse",
  "CurrentNoticeResponse",
  "CurrentUserResponse",
  "ErrorCode",
  "EscalationAction",
  "EscalationFact",
  "EscalationRequest",
  "EscalationResponse",
  "FeishuImportRequest",
  "FileImportRequest",
  "ForbiddenErrorEnvelope",
  "ForbiddenOrPolicyDeniedErrorEnvelope",
  "HardOffPolicyFlagUpdateRequest",
  "HealthResponse",
  "HitStatus",
  "ImportAcceptedResponse",
  "ImportDiagnosticId",
  "ImportErrorReport",
  "ImportFailureReport",
  "ImportIssueCode",
  "ImportOperation",
  "ImportPreviewItem",
  "ImportStatus",
  "ImportStatusResponse",
  "ImportStatusResponseBase",
  "InaccuracyReportRequest",
  "InaccuracyReportResponse",
  "IntakeAction",
  "IntakeAuthorization",
  "IntakeCancel",
  "IntakeCandidate",
  "IntakeCandidateKey",
  "IntakeCandidateList",
  "IntakeCandidatePage",
  "IntakeContributorDeclaration",
  "IntakeCoordinate",
  "IntakeDifference",
  "IntakeDigest",
  "IntakeEntitlement",
  "IntakeEntitlementRequest",
  "IntakeEntry",
  "IntakeError",
  "IntakeFailure",
  "IntakeGrant",
  "IntakeGrantBatch",
  "IntakeGrantChange",
  "IntakeGrantItem",
  "IntakeGrantList",
  "IntakeId",
  "IntakeIssue",
  "IntakeManagementContext",
  "IntakeMaterial",
  "IntakeMaterialHeader",
  "IntakeObject",
  "IntakeOperationReceipt",
  "IntakeParseJob",
  "IntakePolicy",
  "IntakePrincipalPage",
  "IntakePublish",
  "IntakePublishedEntry",
  "IntakeQualityAttribution",
  "IntakeQualityCheck",
  "IntakeQualityCommand",
  "IntakeQualityPlan",
  "IntakeQualityReceipt",
  "IntakeQualityRound",
  "IntakeQualitySample",
  "IntakeQualitySamplePage",
  "IntakeQualityStatus",
  "IntakeQualitySubmission",
  "IntakeQuestion",
  "IntakeReceipt",
  "IntakeReceive",
  "IntakeReview",
  "IntakeReviewRequest",
  "IntakeRisk",
  "IntakeRollback",
  "IntakeRollbackImpact",
  "IntakeRollbackPreview",
  "IntakeRollbackReceipt",
  "IntakeRollbackReview",
  "IntakeRollbackReviewRequest",
  "IntakeScope",
  "IntakeSelectionIds",
  "IntakeShopDirectory",
  "IntakeShopDisplay",
  "IntakeSnapshot",
  "IntakeSource",
  "IntakeSourceClaim",
  "IntakeSourceConfirmation",
  "IntakeSourceList",
  "IntakeSourceScope",
  "IntakeSourceWrite",
  "IntakeTermRef",
  "IntakeVersion",
  "IntakeVocabulary",
  "IntakeVocabularyList",
  "IntakeVocabularyWrite",
  "IntentId",
  "IntentTaxonomyVersion",
  "InteractionReason",
  "InternalErrorEnvelope",
  "IterationTask",
  "IterationTaskCause",
  "IterationTaskCloseRequest",
  "IterationTaskListResponse",
  "IterationTaskStartRequest",
  "IterationTaskStatus",
  "LoginCreate",
  "LoginCreated",
  "LoginExchange",
  "LoginPending",
  "LoginSession",
  "MetricCandidate",
  "MetricsStreamItem",
  "MetricsStreamResponse",
  "MockLoginRequest",
  "MockLoginResponse",
  "MutablePolicyFlagKey",
  "MutablePolicyFlagUpdateRequest",
  "NonAdoptedEventRequest",
  "NotFoundErrorEnvelope",
  "NotReadyResponse",
  "NoticeDecision",
  "NoticeDecisionRequest",
  "NoticeDecisionResponse",
  "OfflineSnapshotLease",
  "OfflineSnapshotLeaseToken",
  "OkResponse",
  "OverloadedErrorEnvelope",
  "OwnerAcceptanceRecord",
  "Phase1HardOffPolicyFlagKey",
  "PlaceholderKey",
  "Platform",
  "PlatformScope",
  "PlatformSource",
  "PolicyFlagKey",
  "PolicyFlagUpdateRequest",
  "PolicyFlagUpdateResponse",
  "PolicyResponse",
  "PrivacyNotice",
  "ProductScopeRefs",
  "ProductScopeType",
  "PublicSnapshotQuestion",
  "PublishRequest",
  "PublishResponse",
  "PushMethod",
  "QualityEvidence",
  "QualityItem",
  "QualityReceipt",
  "QuestionSource",
  "Rate",
  "RateLimitedErrorEnvelope",
  "ReadyCheckStatus",
  "ReadyChecks",
  "ReadyResponse",
  "RetrievalMetrics",
  "RetrievalWindow",
  "ReviewDecision",
  "ReviewList",
  "ReviewMode",
  "ReviewPage",
  "ReviewPageItem",
  "ReviewReceipt",
  "ReviewResume",
  "ReviewResumed",
  "ReviewSummary",
  "RiskCategories",
  "RiskCategory",
  "RiskLevel",
  "Role",
  "RollbackRequest",
  "RollbackResponse",
  "SafeSourceRef",
  "ScriptCategory",
  "ScriptDeleteRequest",
  "ScriptMutationResponse",
  "ScriptPatchRequest",
  "SearchCandidate",
  "SearchRequest",
  "SearchResponse",
  "SnapshotItem",
  "SnapshotResponse",
  "SoftwareRelease",
  "SoftwareReleaseList",
  "SopCatalogResponse",
  "SopImportAccepted",
  "SopImportRequest",
  "SopNode",
  "SopNodeDelete",
  "SopNodePatch",
  "SourceBindingHash",
  "SourceContractReason",
  "TelemetryStatus",
  "ToolMetricsResponse",
  "UnauthorizedErrorEnvelope",
  "UserClaims",
  "ValidationErrorEnvelope",
  "WorkOrderAnalysisResponse",
  "WorkOrderAnalysisScope",
  "WorkOrderAnalysisTotals",
  "WorkOrderDimensionBucket",
  "WorkOrderHandlingTime",
  "WorkOrderImportAcceptedResponse",
  "WorkOrderImportFailureReport",
  "WorkOrderImportIssueCode",
  "WorkOrderImportRequest",
  "WorkOrderImportStatus",
  "WorkOrderImportStatusResponse",
  "WorkOrderRecord",
  "WorkOrderRecordListResponse",
  "WorkOrderTrendPoint"
] as const;
export type GeneratedComponentSchemaName = (typeof COMPONENT_SCHEMA_NAMES)[number];
export const OPENAPI_RUNTIME_SCHEMA_DOCUMENT: Readonly<Record<string, unknown>> =
  {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "urn:customer-agent:openapi:1.21.0:components",
  "$defs": {
    "AdoptedEventRequest": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "query_id",
        "outcome",
        "chosen_rank",
        "chosen_script_id",
        "push_method"
      ],
      "properties": {
        "query_id": {
          "type": "string",
          "format": "uuid"
        },
        "outcome": {
          "const": "adopted"
        },
        "chosen_rank": {
          "type": "integer",
          "minimum": 1,
          "maximum": 3
        },
        "chosen_script_id": {
          "type": "string",
          "minLength": 1
        },
        "push_method": {
          "type": "string",
          "enum": [
            "clipboard",
            "autofill"
          ]
        }
      }
    },
    "AdoptionEventRequest": {
      "oneOf": [
        {
          "$ref": "#/$defs/AdoptedEventRequest"
        },
        {
          "$ref": "#/$defs/NonAdoptedEventRequest"
        }
      ]
    },
    "AdoptionEventResponse": {
      "type": "object",
      "required": [
        "ok",
        "query_id"
      ],
      "properties": {
        "ok": {
          "const": true
        },
        "query_id": {
          "type": "string",
          "format": "uuid"
        }
      }
    },
    "AdoptionOutcome": {
      "type": "string",
      "enum": [
        "adopted",
        "dismissed",
        "no_hit_exit",
        "timeout"
      ]
    },
    "Announcement": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "title",
        "summary",
        "created_at"
      ],
      "properties": {
        "title": {
          "type": "string"
        },
        "summary": {
          "type": [
            "string",
            "null"
          ]
        },
        "created_at": {
          "type": "string",
          "format": "date-time"
        }
      }
    },
    "AnnouncementAckRequest": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "client_id",
        "release_id",
        "release_seq",
        "offline_lease_token"
      ],
      "properties": {
        "client_id": {
          "type": "string",
          "minLength": 1
        },
        "release_id": {
          "type": "string",
          "minLength": 1
        },
        "release_seq": {
          "type": "integer",
          "minimum": 1
        },
        "offline_lease_token": {
          "$ref": "#/$defs/OfflineSnapshotLeaseToken"
        }
      }
    },
    "AuthMode": {
      "type": "string",
      "enum": [
        "mock",
        "feishu"
      ]
    },
    "AuthoritativeSourceBinding": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "domain",
        "source_version_id"
      ],
      "properties": {
        "domain": {
          "$ref": "#/$defs/ScriptCategory"
        },
        "source_version_id": {
          "$ref": "#/$defs/AuthoritativeSourceVersionId"
        }
      }
    },
    "AuthoritativeSourceBindingStatus": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "domain",
        "source_version_id",
        "source_ref"
      ],
      "properties": {
        "domain": {
          "$ref": "#/$defs/ScriptCategory"
        },
        "source_version_id": {
          "$ref": "#/$defs/AuthoritativeSourceVersionId"
        },
        "source_ref": {
          "$ref": "#/$defs/SafeSourceRef"
        }
      }
    },
    "AuthoritativeSourceVersionId": {
      "type": "string",
      "pattern": "^srcv_[A-Za-z0-9][A-Za-z0-9._-]{0,126}$"
    },
    "CancelImportRequest": {
      "type": "object",
      "required": [
        "reason"
      ],
      "properties": {
        "reason": {
          "type": [
            "string",
            "null"
          ]
        }
      }
    },
    "CancelImportResponse": {
      "type": "object",
      "required": [
        "ok",
        "import_batch_id",
        "status"
      ],
      "properties": {
        "ok": {
          "const": true
        },
        "import_batch_id": {
          "type": "string",
          "minLength": 1
        },
        "status": {
          "const": "failed"
        }
      }
    },
    "CandidateError": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "error"
      ],
      "properties": {
        "error": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "code",
            "message",
            "details"
          ],
          "properties": {
            "code": {
              "enum": [
                "VALIDATION",
                "UNAUTHORIZED",
                "FORBIDDEN",
                "CONFLICT",
                "NOT_FOUND",
                "RATE_LIMITED",
                "OVERLOADED",
                "GONE"
              ]
            },
            "message": {
              "type": "string",
              "minLength": 1,
              "maxLength": 256
            },
            "details": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "reason"
              ],
              "properties": {
                "reason": {
                  "enum": [
                    "LOGIN_INVALID",
                    "LOGIN_EXPIRED",
                    "LOGIN_CONSUMED",
                    "SESSION_INVALID",
                    "CAPABILITY_DENIED",
                    "REVIEW_STALE",
                    "IDEMPOTENCY_CONFLICT",
                    "REQUEST_INVALID",
                    "DEPENDENCY_UNAVAILABLE",
                    "RATE_LIMITED",
                    "REVIEW_EVIDENCE_MISSING",
                    "QUALITY_GATE_NOT_PASSED",
                    "QUALITY_SAMPLE_MISMATCH",
                    "QUALITY_EVIDENCE_INVALID",
                    "QUALITY_INITIAL_REQUIRED",
                    "QUALITY_EXPANSION_DENIED",
                    "OUTBOX_LEASE_LOST",
                    "QUALITY_POPULATION_MISMATCH",
                    "DUPLICATE_SCRIPT",
                    "DUPLICATE_CHECK",
                    "REVIEW_EVIDENCE_TRUST_BOUNDARY",
                    "READ_COMMITTED_REQUIRED",
                    "REVIEW_CANCELLED",
                    "QUALITY_EVIDENCE_IMMUTABLE"
                  ]
                }
              }
            }
          }
        }
      }
    },
    "CollectionMode": {
      "type": "string",
      "enum": [
        "synthetic",
        "approved_redacted",
        "pilot_recorded"
      ]
    },
    "ConflictErrorEnvelope": {
      "type": "object",
      "required": [
        "error"
      ],
      "properties": {
        "error": {
          "type": "object",
          "required": [
            "code",
            "message"
          ],
          "properties": {
            "code": {
              "allOf": [
                {
                  "$ref": "#/$defs/ErrorCode"
                },
                {
                  "const": "CONFLICT"
                }
              ]
            },
            "message": {
              "type": "string",
              "minLength": 1
            },
            "details": {
              "type": "object",
              "additionalProperties": true
            }
          }
        }
      }
    },
    "ContentHash": {
      "type": "string",
      "pattern": "^[0-9a-f]{64}$"
    },
    "ContentImportRowContract": {
      "oneOf": [
        {
          "$ref": "#/$defs/ContentImportUpsertRow"
        },
        {
          "$ref": "#/$defs/ContentImportWithdrawRow"
        }
      ]
    },
    "ContentImportUpsertRow": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "staging_id",
        "script_id",
        "operation",
        "category",
        "title",
        "answer_text",
        "content_hash",
        "source_version_id",
        "owner_role",
        "review_due_at",
        "platform_scope",
        "product_scope_type",
        "product_scope_refs",
        "effective_from",
        "effective_to",
        "intent_taxonomy_version",
        "intent_id",
        "risk_level",
        "risk_categories",
        "has_conflict",
        "placeholder_keys",
        "questions_json",
        "questions_grams_text",
        "title_grams_text",
        "answer_grams_text",
        "search_fallback_text",
        "quality_status",
        "quality_issue_codes"
      ],
      "properties": {
        "staging_id": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "script_id": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "operation": {
          "const": "upsert"
        },
        "category": {
          "$ref": "#/$defs/ScriptCategory"
        },
        "title": {
          "type": "string",
          "minLength": 1,
          "maxLength": 500
        },
        "answer_text": {
          "type": "string",
          "minLength": 1,
          "maxLength": 10000
        },
        "content_hash": {
          "$ref": "#/$defs/ContentHash"
        },
        "source_version_id": {
          "$ref": "#/$defs/AuthoritativeSourceVersionId"
        },
        "owner_role": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "review_due_at": {
          "type": "string",
          "format": "date-time"
        },
        "platform_scope": {
          "$ref": "#/$defs/PlatformScope"
        },
        "product_scope_type": {
          "$ref": "#/$defs/ProductScopeType"
        },
        "product_scope_refs": {
          "$ref": "#/$defs/ProductScopeRefs"
        },
        "campaign_tag": {
          "type": [
            "string",
            "null"
          ],
          "minLength": 1,
          "maxLength": 128
        },
        "effective_from": {
          "type": "string",
          "format": "date-time"
        },
        "effective_to": {
          "type": [
            "string",
            "null"
          ],
          "format": "date-time"
        },
        "intent_taxonomy_version": {
          "$ref": "#/$defs/IntentTaxonomyVersion"
        },
        "intent_id": {
          "$ref": "#/$defs/IntentId"
        },
        "risk_level": {
          "$ref": "#/$defs/RiskLevel"
        },
        "risk_categories": {
          "$ref": "#/$defs/RiskCategories"
        },
        "has_conflict": {
          "type": "boolean"
        },
        "placeholder_keys": {
          "type": "array",
          "uniqueItems": true,
          "maxItems": 2,
          "items": {
            "$ref": "#/$defs/PlaceholderKey"
          }
        },
        "questions_json": {
          "type": "array",
          "minItems": 1,
          "maxItems": 1000,
          "items": {
            "$ref": "#/$defs/ContentQuestion"
          }
        },
        "questions_grams_text": {
          "type": "string",
          "minLength": 1,
          "maxLength": 200000
        },
        "title_grams_text": {
          "type": "string",
          "minLength": 1,
          "maxLength": 20000
        },
        "answer_grams_text": {
          "type": "string",
          "minLength": 1,
          "maxLength": 200000
        },
        "search_fallback_text": {
          "type": "string",
          "minLength": 1,
          "maxLength": 20000
        },
        "quality_status": {
          "$ref": "#/$defs/ContentQualityStatus"
        },
        "quality_issue_codes": {
          "type": "array",
          "uniqueItems": true,
          "maxItems": 8,
          "items": {
            "$ref": "#/$defs/ContentQualityIssueCode"
          }
        }
      },
      "allOf": [
        {
          "oneOf": [
            {
              "properties": {
                "product_scope_type": {
                  "const": "storewide"
                },
                "product_scope_refs": {
                  "maxItems": 0
                }
              },
              "type": "object"
            },
            {
              "properties": {
                "product_scope_type": {
                  "enum": [
                    "category",
                    "sku"
                  ]
                },
                "product_scope_refs": {
                  "minItems": 1
                }
              },
              "type": "object"
            }
          ]
        },
        {
          "oneOf": [
            {
              "properties": {
                "risk_level": {
                  "enum": [
                    "low",
                    "medium"
                  ]
                },
                "risk_categories": {
                  "maxItems": 0
                }
              },
              "type": "object"
            },
            {
              "properties": {
                "risk_level": {
                  "const": "high"
                },
                "risk_categories": {
                  "minItems": 1
                }
              },
              "type": "object"
            }
          ]
        },
        {
          "oneOf": [
            {
              "properties": {
                "quality_status": {
                  "const": "clean"
                },
                "quality_issue_codes": {
                  "maxItems": 0
                }
              },
              "type": "object"
            },
            {
              "properties": {
                "quality_status": {
                  "const": "quarantined"
                },
                "quality_issue_codes": {
                  "minItems": 1
                }
              },
              "type": "object"
            }
          ]
        }
      ]
    },
    "ContentImportWithdrawRow": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "staging_id",
        "script_id",
        "operation",
        "category",
        "source_version_id",
        "quality_status",
        "quality_issue_codes"
      ],
      "properties": {
        "staging_id": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "script_id": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "operation": {
          "const": "withdraw"
        },
        "category": {
          "$ref": "#/$defs/ScriptCategory"
        },
        "source_version_id": {
          "$ref": "#/$defs/AuthoritativeSourceVersionId"
        },
        "quality_status": {
          "const": "clean"
        },
        "quality_issue_codes": {
          "type": "array",
          "maxItems": 0
        }
      }
    },
    "ContentNotReadyErrorEnvelope": {
      "type": "object",
      "required": [
        "error"
      ],
      "properties": {
        "error": {
          "type": "object",
          "required": [
            "code",
            "message",
            "details"
          ],
          "properties": {
            "code": {
              "allOf": [
                {
                  "$ref": "#/$defs/ErrorCode"
                },
                {
                  "const": "OVERLOADED"
                }
              ]
            },
            "message": {
              "type": "string",
              "minLength": 1
            },
            "details": {
              "type": "object",
              "required": [
                "reason"
              ],
              "properties": {
                "reason": {
                  "const": "CONTENT_NOT_READY"
                }
              },
              "additionalProperties": true
            }
          }
        }
      }
    },
    "ContentQualityIssueCode": {
      "type": "string",
      "enum": [
        "UNKNOWN_INTENT",
        "INTENT_MAPPING_REQUIRED",
        "UNRESOLVED_CONFLICT",
        "REVIEW_EVIDENCE_MISSING",
        "QUESTION_DUPLICATE",
        "QUESTION_HASH_MISMATCH",
        "QUESTION_ORIGIN_UNVERIFIED",
        "CONTENT_NEEDS_REVIEW"
      ]
    },
    "ContentQualityReviewSummary": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "plan_id",
        "sampling_policy_version",
        "cutoff_at",
        "clean_population_count",
        "ordinary_population_count",
        "mandatory_full_review_count",
        "initial_sample_target",
        "expanded_sample_target",
        "initial_sample_reviewed_count",
        "initial_defect_count",
        "expanded_sample_reviewed_count",
        "expanded_defect_count",
        "mandatory_reviewed_count",
        "mandatory_defect_count",
        "publishable_clean_count",
        "review_quarantined_count",
        "conclusion",
        "evidence_ref"
      ],
      "properties": {
        "plan_id": {
          "type": "string",
          "pattern": "^qplan_[A-Za-z0-9][A-Za-z0-9._-]{0,126}$"
        },
        "sampling_policy_version": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "cutoff_at": {
          "type": "string",
          "format": "date-time"
        },
        "clean_population_count": {
          "type": "integer",
          "minimum": 0,
          "maximum": 5000
        },
        "ordinary_population_count": {
          "type": "integer",
          "minimum": 0,
          "maximum": 5000
        },
        "mandatory_full_review_count": {
          "type": "integer",
          "minimum": 0,
          "maximum": 5000
        },
        "initial_sample_target": {
          "type": "integer",
          "minimum": 0,
          "maximum": 5000
        },
        "expanded_sample_target": {
          "type": "integer",
          "minimum": 0,
          "maximum": 5000
        },
        "initial_sample_reviewed_count": {
          "type": "integer",
          "minimum": 0,
          "maximum": 5000
        },
        "initial_defect_count": {
          "type": "integer",
          "minimum": 0,
          "maximum": 5000
        },
        "expanded_sample_reviewed_count": {
          "type": [
            "integer",
            "null"
          ],
          "minimum": 0,
          "maximum": 5000
        },
        "expanded_defect_count": {
          "type": [
            "integer",
            "null"
          ],
          "minimum": 0,
          "maximum": 5000
        },
        "mandatory_reviewed_count": {
          "type": "integer",
          "minimum": 0,
          "maximum": 5000
        },
        "mandatory_defect_count": {
          "type": "integer",
          "minimum": 0,
          "maximum": 5000
        },
        "publishable_clean_count": {
          "type": "integer",
          "minimum": 0,
          "maximum": 5000
        },
        "review_quarantined_count": {
          "type": "integer",
          "minimum": 0,
          "maximum": 5000
        },
        "conclusion": {
          "type": "string",
          "enum": [
            "passed",
            "blocked"
          ]
        },
        "evidence_ref": {
          "type": "string",
          "minLength": 1,
          "maxLength": 256
        }
      }
    },
    "ContentQualityStatus": {
      "type": "string",
      "enum": [
        "clean",
        "quarantined"
      ]
    },
    "ContentQuestion": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "question_id",
        "question_version",
        "question_text",
        "question_hash",
        "semantic_family_id",
        "origin_fingerprint",
        "origin_fingerprint_key_version",
        "source_asset_id",
        "source",
        "intent_taxonomy_version",
        "intent_id"
      ],
      "properties": {
        "question_id": {
          "type": "string",
          "pattern": "^q_[A-Za-z0-9][A-Za-z0-9_-]{7,126}$"
        },
        "question_version": {
          "type": "integer",
          "minimum": 1
        },
        "question_text": {
          "type": "string",
          "minLength": 1,
          "maxLength": 500
        },
        "question_hash": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$"
        },
        "semantic_family_id": {
          "type": "string",
          "pattern": "^sf_[A-Za-z0-9][A-Za-z0-9._-]{0,126}$"
        },
        "origin_fingerprint": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$"
        },
        "origin_fingerprint_key_version": {
          "type": "string",
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$"
        },
        "source_asset_id": {
          "type": "string",
          "pattern": "^sa_[A-Za-z0-9][A-Za-z0-9._-]{0,126}$"
        },
        "source": {
          "$ref": "#/$defs/QuestionSource"
        },
        "intent_taxonomy_version": {
          "$ref": "#/$defs/IntentTaxonomyVersion"
        },
        "intent_id": {
          "$ref": "#/$defs/IntentId"
        },
        "source_query_id": {
          "type": [
            "string",
            "null"
          ],
          "minLength": 1
        },
        "promotion_review_ref": {
          "type": [
            "string",
            "null"
          ],
          "minLength": 1
        },
        "promoted_by_role": {
          "type": [
            "string",
            "null"
          ],
          "minLength": 1
        },
        "promoted_at": {
          "type": [
            "string",
            "null"
          ],
          "format": "date-time"
        }
      },
      "oneOf": [
        {
          "title": "from_log 获批晋级",
          "properties": {
            "source": {
              "const": "from_log"
            },
            "source_query_id": {
              "type": "string",
              "minLength": 1
            },
            "promotion_review_ref": {
              "type": "string",
              "minLength": 1
            },
            "promoted_by_role": {
              "type": "string",
              "minLength": 1
            },
            "promoted_at": {
              "type": "string",
              "format": "date-time",
              "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]{1,6})?Z$"
            }
          },
          "required": [
            "source_query_id",
            "promotion_review_ref",
            "promoted_by_role",
            "promoted_at"
          ],
          "type": "object"
        },
        {
          "title": "manual 或 import 原生语义资产",
          "properties": {
            "source": {
              "enum": [
                "manual",
                "import"
              ]
            },
            "source_query_id": {
              "type": "null"
            },
            "promotion_review_ref": {
              "type": "null"
            },
            "promoted_by_role": {
              "type": "null"
            },
            "promoted_at": {
              "type": "null"
            }
          },
          "type": "object"
        }
      ]
    },
    "CurrentAnnouncementResponse": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "current_release_id",
        "release_seq",
        "source_binding_hash",
        "offline_lease",
        "announcement"
      ],
      "properties": {
        "current_release_id": {
          "type": "string",
          "minLength": 1
        },
        "release_seq": {
          "type": "integer",
          "minimum": 1
        },
        "source_binding_hash": {
          "$ref": "#/$defs/SourceBindingHash"
        },
        "offline_lease": {
          "$ref": "#/$defs/OfflineSnapshotLease"
        },
        "announcement": {
          "oneOf": [
            {
              "$ref": "#/$defs/Announcement"
            },
            {
              "type": "null"
            }
          ]
        }
      }
    },
    "CurrentNoticeResponse": {
      "type": "object",
      "required": [
        "notice",
        "decision",
        "decided_at"
      ],
      "properties": {
        "notice": {
          "$ref": "#/$defs/PrivacyNotice"
        },
        "decision": {
          "oneOf": [
            {
              "$ref": "#/$defs/NoticeDecision"
            },
            {
              "type": "null"
            }
          ]
        },
        "decided_at": {
          "type": [
            "string",
            "null"
          ],
          "format": "date-time"
        }
      }
    },
    "CurrentUserResponse": {
      "allOf": [
        {
          "$ref": "#/$defs/UserClaims"
        },
        {
          "type": "object",
          "required": [
            "auth_mode"
          ],
          "properties": {
            "auth_mode": {
              "$ref": "#/$defs/AuthMode"
            }
          }
        }
      ]
    },
    "ErrorCode": {
      "type": "string",
      "enum": [
        "UNAUTHORIZED",
        "FORBIDDEN",
        "VALIDATION",
        "NOT_FOUND",
        "CONFLICT",
        "POLICY_DENIED",
        "RATE_LIMITED",
        "OVERLOADED",
        "INTERNAL"
      ]
    },
    "EscalationAction": {
      "type": "string",
      "enum": [
        "open_feishu",
        "copy_contact",
        "other"
      ]
    },
    "EscalationFact": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "escalate_id",
        "action",
        "created_at"
      ],
      "properties": {
        "escalate_id": {
          "type": "string",
          "minLength": 1
        },
        "action": {
          "$ref": "#/$defs/EscalationAction"
        },
        "created_at": {
          "type": "string",
          "format": "date-time"
        }
      }
    },
    "EscalationRequest": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "query_id",
        "action"
      ],
      "properties": {
        "query_id": {
          "type": "string",
          "format": "uuid"
        },
        "action": {
          "$ref": "#/$defs/EscalationAction"
        }
      }
    },
    "EscalationResponse": {
      "type": "object",
      "required": [
        "escalate_id",
        "query_id",
        "action"
      ],
      "properties": {
        "escalate_id": {
          "type": "string",
          "minLength": 1
        },
        "query_id": {
          "type": "string",
          "format": "uuid"
        },
        "action": {
          "$ref": "#/$defs/EscalationAction"
        }
      }
    },
    "FeishuImportRequest": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "source_type",
        "source_bindings"
      ],
      "properties": {
        "source_type": {
          "const": "feishu_api"
        },
        "source_bindings": {
          "type": "array",
          "minItems": 1,
          "maxItems": 4,
          "uniqueItems": true,
          "x-unique-by": "domain",
          "items": {
            "$ref": "#/$defs/AuthoritativeSourceBinding"
          }
        }
      }
    },
    "FileImportRequest": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "file",
        "source_bindings"
      ],
      "properties": {
        "file": {
          "type": "string",
          "format": "binary"
        },
        "source_bindings": {
          "type": "array",
          "minItems": 1,
          "maxItems": 4,
          "uniqueItems": true,
          "x-unique-by": "domain",
          "items": {
            "$ref": "#/$defs/AuthoritativeSourceBinding"
          }
        }
      }
    },
    "ForbiddenErrorEnvelope": {
      "type": "object",
      "required": [
        "error"
      ],
      "properties": {
        "error": {
          "type": "object",
          "required": [
            "code",
            "message"
          ],
          "properties": {
            "code": {
              "allOf": [
                {
                  "$ref": "#/$defs/ErrorCode"
                },
                {
                  "const": "FORBIDDEN"
                }
              ]
            },
            "message": {
              "type": "string",
              "minLength": 1
            },
            "details": {
              "type": "object",
              "additionalProperties": true
            }
          }
        }
      }
    },
    "ForbiddenOrPolicyDeniedErrorEnvelope": {
      "type": "object",
      "required": [
        "error"
      ],
      "properties": {
        "error": {
          "type": "object",
          "required": [
            "code",
            "message"
          ],
          "properties": {
            "code": {
              "allOf": [
                {
                  "$ref": "#/$defs/ErrorCode"
                },
                {
                  "enum": [
                    "FORBIDDEN",
                    "POLICY_DENIED"
                  ]
                }
              ]
            },
            "message": {
              "type": "string",
              "minLength": 1
            },
            "details": {
              "type": "object",
              "properties": {
                "reason": {
                  "$ref": "#/$defs/SourceContractReason"
                }
              },
              "additionalProperties": true
            }
          }
        }
      }
    },
    "HardOffPolicyFlagUpdateRequest": {
      "type": "object",
      "required": [
        "flag_key",
        "flag_value",
        "adr_id"
      ],
      "properties": {
        "flag_key": {
          "$ref": "#/$defs/Phase1HardOffPolicyFlagKey"
        },
        "flag_value": {
          "type": "boolean"
        },
        "adr_id": {
          "type": [
            "string",
            "null"
          ],
          "pattern": "^ADR-[A-Za-z0-9._-]+$"
        }
      }
    },
    "HealthResponse": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "status",
        "service",
        "version"
      ],
      "properties": {
        "status": {
          "const": "ok"
        },
        "service": {
          "const": "cs-ai-api"
        },
        "version": {
          "type": "string",
          "minLength": 1
        }
      }
    },
    "HitStatus": {
      "type": "string",
      "enum": [
        "hit",
        "no_hit"
      ]
    },
    "ImportAcceptedResponse": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "import_batch_id",
        "status",
        "source_binding_hash"
      ],
      "properties": {
        "import_batch_id": {
          "type": "string",
          "minLength": 1
        },
        "status": {
          "const": "validating"
        },
        "source_binding_hash": {
          "$ref": "#/$defs/SourceBindingHash"
        }
      }
    },
    "ImportDiagnosticId": {
      "type": "string",
      "pattern": "^diag_[0-9a-f]{32}$"
    },
    "ImportErrorReport": {
      "oneOf": [
        {
          "$ref": "#/$defs/ImportFailureReport"
        },
        {
          "type": "null"
        }
      ]
    },
    "ImportFailureReport": {
      "oneOf": [
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "code",
            "diagnostic_id"
          ],
          "properties": {
            "code": {
              "const": "CANCELLED"
            },
            "diagnostic_id": {
              "$ref": "#/$defs/ImportDiagnosticId"
            }
          }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "code",
            "diagnostic_id",
            "attempts",
            "max_attempts"
          ],
          "properties": {
            "code": {
              "const": "MAX_ATTEMPTS_EXHAUSTED"
            },
            "diagnostic_id": {
              "$ref": "#/$defs/ImportDiagnosticId"
            },
            "attempts": {
              "type": "integer",
              "minimum": 1
            },
            "max_attempts": {
              "type": "integer",
              "minimum": 1
            }
          }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "code",
            "diagnostic_id"
          ],
          "properties": {
            "code": {
              "enum": [
                "VALIDATION_FAILED",
                "SOURCE_UNREADABLE",
                "HASH_MISMATCH",
                "UNSUPPORTED_FORMAT",
                "STORAGE_UNAVAILABLE",
                "SOURCE_NOT_ELIGIBLE",
                "SOURCE_SUSPENDED",
                "SOURCE_DOMAIN_MISMATCH",
                "SOURCE_SNAPSHOT_MISMATCH",
                "SOURCE_SET_INCOMPLETE",
                "CONTENT_CONTRACT_INVALID",
                "GOVERNANCE_HASH_MISMATCH"
              ]
            },
            "diagnostic_id": {
              "$ref": "#/$defs/ImportDiagnosticId"
            },
            "row": {
              "type": "integer",
              "minimum": 1
            },
            "column": {
              "type": "integer",
              "minimum": 1
            },
            "error_count": {
              "type": "integer",
              "minimum": 1
            },
            "issue_codes": {
              "type": "array",
              "maxItems": 26,
              "uniqueItems": true,
              "items": {
                "$ref": "#/$defs/ImportIssueCode"
              }
            }
          }
        }
      ]
    },
    "ImportIssueCode": {
      "type": "string",
      "enum": [
        "MISSING_REQUIRED_FIELD",
        "INVALID_FIELD_TYPE",
        "INVALID_VALUE",
        "DUPLICATE_SCRIPT_ID",
        "UNKNOWN_SCRIPT_ID",
        "INVALID_EFFECTIVE_WINDOW",
        "MISSING_EFFECTIVE_WINDOW",
        "HASH_MISMATCH",
        "UNSUPPORTED_FORMAT",
        "MACRO_DETECTED",
        "EXTERNAL_LINK_DETECTED",
        "ROW_LIMIT_EXCEEDED",
        "CONTENT_TOO_LARGE",
        "SOURCE_NOT_REGISTERED",
        "SOURCE_NOT_CANONICAL",
        "SOURCE_SUSPENDED",
        "SOURCE_DOMAIN_MISMATCH",
        "SOURCE_SNAPSHOT_MISMATCH",
        "SOURCE_SET_INCOMPLETE",
        "MISSING_PLATFORM_SCOPE",
        "INVALID_PRODUCT_SCOPE",
        "INVALID_TAXONOMY_REF",
        "INVALID_QUESTION_IDENTITY",
        "INVALID_REVIEW_EVIDENCE",
        "INVALID_PLACEHOLDER_TEMPLATE",
        "GOVERNANCE_HASH_MISMATCH"
      ]
    },
    "ImportOperation": {
      "type": "string",
      "enum": [
        "upsert",
        "withdraw"
      ],
      "default": "upsert"
    },
    "ImportPreviewItem": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "script_id",
        "operation",
        "category",
        "source_version_id",
        "source_ref",
        "quality_status",
        "quality_issue_codes",
        "quality_gate_passed"
      ],
      "properties": {
        "script_id": {
          "type": "string",
          "minLength": 1
        },
        "operation": {
          "$ref": "#/$defs/ImportOperation"
        },
        "category": {
          "$ref": "#/$defs/ScriptCategory"
        },
        "source_version_id": {
          "$ref": "#/$defs/AuthoritativeSourceVersionId"
        },
        "source_ref": {
          "$ref": "#/$defs/SafeSourceRef"
        },
        "title": {
          "type": [
            "string",
            "null"
          ]
        },
        "answer_text": {
          "type": [
            "string",
            "null"
          ]
        },
        "content_hash": {
          "oneOf": [
            {
              "$ref": "#/$defs/ContentHash"
            },
            {
              "type": "null"
            }
          ]
        },
        "platform_scope": {
          "oneOf": [
            {
              "$ref": "#/$defs/PlatformScope"
            },
            {
              "type": "null"
            }
          ]
        },
        "product_scope_type": {
          "oneOf": [
            {
              "$ref": "#/$defs/ProductScopeType"
            },
            {
              "type": "null"
            }
          ]
        },
        "product_scope_refs": {
          "oneOf": [
            {
              "$ref": "#/$defs/ProductScopeRefs"
            },
            {
              "type": "null"
            }
          ]
        },
        "effective_from": {
          "type": [
            "string",
            "null"
          ],
          "format": "date-time"
        },
        "effective_to": {
          "type": [
            "string",
            "null"
          ],
          "format": "date-time"
        },
        "intent_taxonomy_version": {
          "oneOf": [
            {
              "$ref": "#/$defs/IntentTaxonomyVersion"
            },
            {
              "type": "null"
            }
          ]
        },
        "intent_id": {
          "oneOf": [
            {
              "$ref": "#/$defs/IntentId"
            },
            {
              "type": "null"
            }
          ]
        },
        "risk_level": {
          "oneOf": [
            {
              "$ref": "#/$defs/RiskLevel"
            },
            {
              "type": "null"
            }
          ]
        },
        "risk_categories": {
          "oneOf": [
            {
              "$ref": "#/$defs/RiskCategories"
            },
            {
              "type": "null"
            }
          ]
        },
        "has_conflict": {
          "type": [
            "boolean",
            "null"
          ]
        },
        "review_mode": {
          "oneOf": [
            {
              "$ref": "#/$defs/ReviewMode"
            },
            {
              "type": "null"
            }
          ]
        },
        "primary_review_evd": {
          "type": [
            "string",
            "null"
          ],
          "minLength": 1,
          "maxLength": 256
        },
        "secondary_review_evd": {
          "type": [
            "string",
            "null"
          ],
          "minLength": 1,
          "maxLength": 256
        },
        "placeholder_keys": {
          "type": [
            "array",
            "null"
          ],
          "uniqueItems": true,
          "maxItems": 2,
          "items": {
            "$ref": "#/$defs/PlaceholderKey"
          }
        },
        "questions": {
          "type": [
            "array",
            "null"
          ],
          "items": {
            "$ref": "#/$defs/ContentQuestion"
          }
        },
        "quality_status": {
          "$ref": "#/$defs/ContentQualityStatus"
        },
        "quality_issue_codes": {
          "type": "array",
          "uniqueItems": true,
          "maxItems": 8,
          "items": {
            "$ref": "#/$defs/ContentQualityIssueCode"
          }
        },
        "quality_gate_passed": {
          "type": "boolean"
        }
      }
    },
    "ImportStatus": {
      "type": "string",
      "enum": [
        "validating",
        "failed",
        "staged",
        "publishing",
        "published",
        "rolled_back"
      ]
    },
    "ImportStatusResponse": {
      "oneOf": [
        {
          "allOf": [
            {
              "$ref": "#/$defs/ImportStatusResponseBase"
            },
            {
              "type": "object",
              "properties": {
                "status": {
                  "const": "failed"
                },
                "error_report": {
                  "$ref": "#/$defs/ImportFailureReport"
                }
              }
            }
          ]
        },
        {
          "allOf": [
            {
              "$ref": "#/$defs/ImportStatusResponseBase"
            },
            {
              "type": "object",
              "properties": {
                "status": {
                  "enum": [
                    "validating",
                    "staged",
                    "publishing",
                    "published",
                    "rolled_back"
                  ]
                },
                "error_report": {
                  "type": "null"
                }
              }
            }
          ]
        }
      ]
    },
    "ImportStatusResponseBase": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "import_batch_id",
        "status",
        "base_release_id",
        "source_binding_hash",
        "source_bindings",
        "error_report",
        "staged_count",
        "clean_count",
        "quarantined_count",
        "quality_gate_passed",
        "quality_review",
        "preview"
      ],
      "properties": {
        "import_batch_id": {
          "type": "string",
          "minLength": 1
        },
        "status": {
          "$ref": "#/$defs/ImportStatus"
        },
        "base_release_id": {
          "type": [
            "string",
            "null"
          ]
        },
        "source_binding_hash": {
          "$ref": "#/$defs/SourceBindingHash"
        },
        "source_bindings": {
          "type": "array",
          "minItems": 1,
          "maxItems": 4,
          "uniqueItems": true,
          "x-unique-by": "domain",
          "items": {
            "$ref": "#/$defs/AuthoritativeSourceBindingStatus"
          }
        },
        "error_report": {
          "$ref": "#/$defs/ImportErrorReport"
        },
        "staged_count": {
          "type": "integer",
          "minimum": 0
        },
        "clean_count": {
          "type": "integer",
          "minimum": 0
        },
        "quarantined_count": {
          "type": "integer",
          "minimum": 0
        },
        "quality_gate_passed": {
          "type": "boolean"
        },
        "quality_review": {
          "oneOf": [
            {
              "$ref": "#/$defs/ContentQualityReviewSummary"
            },
            {
              "type": "null"
            }
          ]
        },
        "preview": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/ImportPreviewItem"
          }
        }
      }
    },
    "InaccuracyReportRequest": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "query_id",
        "script_id"
      ],
      "properties": {
        "query_id": {
          "type": "string",
          "format": "uuid"
        },
        "script_id": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "script_version": {
          "type": "integer",
          "minimum": 1
        },
        "rank": {
          "type": "integer",
          "minimum": 1,
          "maximum": 3
        },
        "content_hash": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$"
        }
      }
    },
    "InaccuracyReportResponse": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "ok",
        "query_id",
        "script_id"
      ],
      "properties": {
        "ok": {
          "const": true
        },
        "query_id": {
          "type": "string",
          "format": "uuid"
        },
        "script_id": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        }
      }
    },
    "IntakeAction": {
      "type": "string",
      "enum": [
        "query",
        "content-manage",
        "import",
        "source-confirm",
        "review",
        "publish",
        "candidate-cancel",
        "rollback"
      ]
    },
    "IntakeAuthorization": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "factsVersion",
        "revocationGeneration",
        "policyVersion",
        "validUntil",
        "capabilities",
        "nextCursor"
      ],
      "properties": {
        "factsVersion": {
          "$ref": "#/$defs/IntakeVersion"
        },
        "revocationGeneration": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "policyVersion": {
          "$ref": "#/$defs/IntakeVersion"
        },
        "validUntil": {
          "type": "string",
          "format": "date-time",
          "maxLength": 35
        },
        "capabilities": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "scope",
              "actions",
              "mayAllocate",
              "mayDelegate",
              "validUntil"
            ],
            "properties": {
              "scope": {
                "$ref": "#/$defs/IntakeScope"
              },
              "actions": {
                "type": "array",
                "items": {
                  "$ref": "#/$defs/IntakeAction"
                },
                "minItems": 0,
                "maxItems": 8,
                "uniqueItems": true
              },
              "mayAllocate": {
                "type": "array",
                "items": {
                  "$ref": "#/$defs/IntakeAction"
                },
                "minItems": 0,
                "maxItems": 8,
                "uniqueItems": true
              },
              "mayDelegate": {
                "type": "array",
                "items": {
                  "$ref": "#/$defs/IntakeAction"
                },
                "minItems": 0,
                "maxItems": 8,
                "uniqueItems": true
              },
              "validUntil": {
                "type": "string",
                "format": "date-time",
                "maxLength": 35
              }
            }
          },
          "minItems": 0,
          "maxItems": 100
        },
        "nextCursor": {
          "type": [
            "string",
            "null"
          ],
          "minLength": 1,
          "maxLength": 512
        }
      }
    },
    "IntakeCancel": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "operationId",
        "key"
      ],
      "properties": {
        "operationId": {
          "type": "string",
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        },
        "key": {
          "$ref": "#/$defs/IntakeCandidateKey"
        }
      }
    },
    "IntakeCandidate": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "key",
        "sourceId",
        "state",
        "readinessReasons",
        "sourceEvidenceVersion",
        "approvalEvidenceVersion",
        "revocationGeneration",
        "createdAt",
        "updatedAt",
        "publishedReleaseId",
        "publicationPolicy"
      ],
      "properties": {
        "key": {
          "$ref": "#/$defs/IntakeCandidateKey"
        },
        "sourceId": {
          "type": "string",
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        },
        "state": {
          "type": "string",
          "enum": [
            "awaiting-evidence",
            "ready",
            "publishing",
            "published",
            "cancelled",
            "invalidated"
          ]
        },
        "readinessReasons": {
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 64
          },
          "minItems": 0,
          "maxItems": 32
        },
        "sourceEvidenceVersion": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "approvalEvidenceVersion": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "revocationGeneration": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "createdAt": {
          "type": "string",
          "format": "date-time",
          "maxLength": 35
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time",
          "maxLength": 35
        },
        "publishedReleaseId": {
          "type": [
            "string",
            "null"
          ],
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        },
        "publicationPolicy": {
          "type": "string",
          "enum": [
            "approval-v1",
            "direct-v1"
          ]
        }
      },
      "allOf": [
        {
          "if": {
            "properties": {
              "publicationPolicy": {
                "const": "direct-v1"
              }
            },
            "required": [
              "publicationPolicy"
            ],
            "type": "object"
          },
          "then": {
            "properties": {
              "approvalEvidenceVersion": {
                "const": 0
              }
            },
            "type": "object"
          }
        }
      ]
    },
    "IntakeCandidateKey": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "candidateId",
        "version",
        "digest"
      ],
      "properties": {
        "candidateId": {
          "type": "string",
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        },
        "version": {
          "$ref": "#/$defs/IntakeVersion"
        },
        "digest": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$",
          "minLength": 64,
          "maxLength": 64
        }
      }
    },
    "IntakeCandidateList": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "items",
        "nextCursor"
      ],
      "properties": {
        "items": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/IntakeCandidate"
          },
          "minItems": 0,
          "maxItems": 100
        },
        "nextCursor": {
          "type": [
            "string",
            "null"
          ],
          "minLength": 1,
          "maxLength": 512
        }
      }
    },
    "IntakeCandidatePage": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "key",
        "entries",
        "differences",
        "nextCursor",
        "materialHeader"
      ],
      "properties": {
        "key": {
          "$ref": "#/$defs/IntakeCandidateKey"
        },
        "entries": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/IntakeEntry"
          },
          "minItems": 0,
          "maxItems": 100
        },
        "differences": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/IntakeDifference"
          },
          "minItems": 0,
          "maxItems": 100
        },
        "nextCursor": {
          "type": [
            "string",
            "null"
          ],
          "minLength": 1,
          "maxLength": 512
        },
        "materialHeader": {
          "$ref": "#/$defs/IntakeMaterialHeader"
        }
      }
    },
    "IntakeContributorDeclaration": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "preparerPrincipalId",
        "editorPrincipalIds",
        "confirmed"
      ],
      "properties": {
        "preparerPrincipalId": {
          "type": "string",
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        },
        "editorPrincipalIds": {
          "type": "array",
          "items": {
            "type": "string",
            "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
            "minLength": 1,
            "maxLength": 128
          },
          "minItems": 1,
          "maxItems": 98,
          "uniqueItems": true
        },
        "confirmed": {
          "type": "boolean",
          "enum": [
            true
          ]
        }
      }
    },
    "IntakeCoordinate": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "sheet",
        "row",
        "column"
      ],
      "properties": {
        "sheet": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64
        },
        "row": {
          "type": "integer",
          "minimum": 1,
          "maximum": 5002
        },
        "column": {
          "type": "integer",
          "minimum": 1,
          "maximum": 32
        }
      }
    },
    "IntakeDifference": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "businessEntryId",
        "change",
        "previousVersion",
        "nextVersion",
        "beforeDigest",
        "afterDigest"
      ],
      "properties": {
        "businessEntryId": {
          "type": "string",
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        },
        "change": {
          "type": "string",
          "enum": [
            "add",
            "modify",
            "disable",
            "reenable"
          ]
        },
        "previousVersion": {
          "type": [
            "integer",
            "null"
          ],
          "minimum": 1,
          "maximum": 9007199254740991
        },
        "nextVersion": {
          "$ref": "#/$defs/IntakeVersion"
        },
        "beforeDigest": {
          "type": [
            "string",
            "null"
          ],
          "pattern": "^[0-9a-f]{64}$",
          "minLength": 64,
          "maxLength": 64
        },
        "afterDigest": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$",
          "minLength": 64,
          "maxLength": 64
        }
      }
    },
    "IntakeDigest": {
      "type": "string",
      "pattern": "^[0-9a-f]{64}$",
      "minLength": 64,
      "maxLength": 64
    },
    "IntakeEntitlement": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "entitlementId",
        "releaseId",
        "shopId",
        "contextGeneration",
        "revocationGeneration",
        "validUntil",
        "scopes"
      ],
      "properties": {
        "entitlementId": {
          "type": "string",
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        },
        "releaseId": {
          "type": "string",
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        },
        "shopId": {
          "type": "string",
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        },
        "contextGeneration": {
          "$ref": "#/$defs/IntakeVersion"
        },
        "revocationGeneration": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "validUntil": {
          "type": "string",
          "format": "date-time",
          "maxLength": 35
        },
        "scopes": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/IntakeSourceScope"
          },
          "minItems": 0,
          "maxItems": 1000
        }
      }
    },
    "IntakeEntitlementRequest": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "shopId",
        "contextGeneration",
        "releaseId",
        "productIds",
        "scenarioIds"
      ],
      "properties": {
        "shopId": {
          "type": "string",
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        },
        "contextGeneration": {
          "$ref": "#/$defs/IntakeVersion"
        },
        "releaseId": {
          "type": [
            "string",
            "null"
          ],
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        },
        "productIds": {
          "$ref": "#/$defs/IntakeSelectionIds"
        },
        "scenarioIds": {
          "$ref": "#/$defs/IntakeSelectionIds"
        }
      }
    },
    "IntakeEntry": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "businessEntryId",
        "scriptVersion",
        "operation",
        "title",
        "answerText",
        "questions",
        "productRefs",
        "scenarioRefs",
        "effectiveFrom",
        "effectiveTo",
        "applicabilityNote",
        "familySourceId",
        "familyBusinessEntryId",
        "brandNonOverridable",
        "category",
        "internalNote",
        "riskNote",
        "attachmentNote"
      ],
      "properties": {
        "businessEntryId": {
          "type": "string",
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        },
        "scriptVersion": {
          "$ref": "#/$defs/IntakeVersion"
        },
        "operation": {
          "type": "string",
          "enum": [
            "upsert",
            "disable"
          ]
        },
        "title": {
          "type": "string",
          "minLength": 1,
          "maxLength": 512
        },
        "answerText": {
          "type": "string",
          "minLength": 1,
          "maxLength": 32767
        },
        "questions": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/IntakeQuestion"
          },
          "minItems": 0,
          "maxItems": 100
        },
        "productRefs": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/IntakeTermRef"
          },
          "minItems": 0,
          "maxItems": 100
        },
        "scenarioRefs": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/IntakeTermRef"
          },
          "minItems": 0,
          "maxItems": 100
        },
        "effectiveFrom": {
          "type": "string",
          "format": "date-time",
          "maxLength": 35
        },
        "effectiveTo": {
          "type": [
            "string",
            "null"
          ],
          "format": "date-time",
          "maxLength": 35
        },
        "applicabilityNote": {
          "type": "string",
          "maxLength": 4096
        },
        "familySourceId": {
          "type": [
            "string",
            "null"
          ],
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        },
        "familyBusinessEntryId": {
          "type": [
            "string",
            "null"
          ],
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        },
        "brandNonOverridable": {
          "type": "boolean"
        },
        "category": {
          "type": "string",
          "maxLength": 32767
        },
        "internalNote": {
          "type": "string",
          "maxLength": 32767
        },
        "riskNote": {
          "type": "string",
          "maxLength": 32767
        },
        "attachmentNote": {
          "type": "string",
          "maxLength": 0
        }
      },
      "if": {
        "properties": {
          "familySourceId": {
            "type": "null"
          }
        },
        "type": "object"
      },
      "then": {
        "properties": {
          "familyBusinessEntryId": {
            "type": "null"
          }
        },
        "type": "object"
      },
      "else": {
        "properties": {
          "familyBusinessEntryId": {
            "type": "string"
          }
        },
        "type": "object"
      },
      "allOf": [
        {
          "if": {
            "properties": {
              "operation": {
                "const": "upsert"
              }
            },
            "type": "object"
          },
          "then": {
            "allOf": [
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 1
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 99
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 2
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 98
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 3
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 97
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 4
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 96
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 5
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 95
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 6
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 94
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 7
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 93
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 8
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 92
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 9
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 91
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 10
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 90
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 11
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 89
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 12
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 88
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 13
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 87
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 14
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 86
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 15
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 85
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 16
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 84
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 17
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 83
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 18
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 82
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 19
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 81
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 20
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 80
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 21
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 79
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 22
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 78
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 23
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 77
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 24
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 76
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 25
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 75
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 26
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 74
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 27
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 73
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 28
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 72
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 29
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 71
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 30
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 70
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 31
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 69
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 32
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 68
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 33
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 67
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 34
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 66
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 35
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 65
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 36
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 64
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 37
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 63
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 38
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 62
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 39
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 61
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 40
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 60
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 41
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 59
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 42
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 58
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 43
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 57
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 44
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 56
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 45
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 55
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 46
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 54
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 47
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 53
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 48
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 52
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 49
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 51
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 50
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 50
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 51
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 49
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 52
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 48
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 53
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 47
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 54
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 46
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 55
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 45
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 56
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 44
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 57
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 43
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 58
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 42
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 59
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 41
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 60
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 40
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 61
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 39
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 62
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 38
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 63
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 37
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 64
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 36
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 65
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 35
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 66
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 34
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 67
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 33
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 68
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 32
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 69
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 31
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 70
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 30
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 71
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 29
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 72
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 28
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 73
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 27
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 74
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 26
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 75
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 25
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 76
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 24
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 77
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 23
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 78
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 22
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 79
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 21
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 80
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 20
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 81
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 19
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 82
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 18
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 83
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 17
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 84
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 16
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 85
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 15
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 86
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 14
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 87
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 13
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 88
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 12
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 89
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 11
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 90
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 10
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 91
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 9
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 92
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 8
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 93
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 7
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 94
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 6
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 95
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 5
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 96
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 4
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 97
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 3
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 98
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 2
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 99
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 1
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 100
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 0
                    }
                  },
                  "type": "object"
                }
              }
            ]
          }
        }
      ]
    },
    "IntakeError": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "error"
      ],
      "properties": {
        "error": {
          "$ref": "#/$defs/IntakeFailure"
        }
      }
    },
    "IntakeFailure": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "code",
        "message",
        "details"
      ],
      "properties": {
        "code": {
          "type": "string",
          "enum": [
            "VALIDATION",
            "UNAUTHORIZED",
            "FORBIDDEN",
            "NOT_FOUND",
            "CONFLICT",
            "RATE_LIMITED",
            "OVERLOADED",
            "INTERNAL_ERROR"
          ]
        },
        "message": {
          "type": "string",
          "minLength": 1,
          "maxLength": 512
        },
        "details": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "reason",
            "diagnosticId"
          ],
          "properties": {
            "reason": {
              "type": "string",
              "enum": [
                "ORG_FACTS_UNAVAILABLE",
                "PERMISSION_CHANGED",
                "SCOPE_DENIED",
                "ROLE_CEILING",
                "GRANT_AUTHORITY_DENIED",
                "SELF_ESCALATION",
                "REDELEGATION_DENIED",
                "NO_STEWARD",
                "SOURCE_MISMATCH",
                "SOURCE_ORDER_UNKNOWN",
                "FILE_INVALID",
                "FILE_LIMIT",
                "TEMPLATE_VERSION",
                "EMPTY_DATA",
                "QUOTA_EXCEEDED",
                "AWAITING_APPROVAL",
                "APPROVAL_UNAVAILABLE",
                "HUMAN_REVIEW_REQUIRED",
                "APPROVAL_BINDING",
                "ATTACHMENT_UNVERIFIED",
                "MATERIAL_CHANGED",
                "BASE_CHANGED",
                "APPROVAL_CHANGED",
                "APPROVAL_REVOKED",
                "TICKET_EXPIRED",
                "TICKET_CONSUMED",
                "IDEMPOTENCY_CONFLICT",
                "COMMIT_UNKNOWN",
                "ALREADY_PUBLISHED",
                "MODE_CONFLICT",
                "UPGRADE_REQUIRED",
                "VOCABULARY_IN_USE",
                "MEANING_CHANGED",
                "LEASE_EXPIRED",
                "NO_SHOP",
                "CHOOSE_SHOP",
                "SHOP_DIRECTORY_CURSOR",
                "SHOP_DIRECTORY_SESSION",
                "SHOP_DISPLAY_MISSING",
                "SHOP_DIRECTORY_CHANGED",
                "SHOP_DIRECTORY_EXPIRED",
                "SHOP_DIRECTORY_UNAVAILABLE"
              ]
            },
            "diagnosticId": {
              "type": "string",
              "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
              "minLength": 1,
              "maxLength": 128
            }
          }
        }
      }
    },
    "IntakeGrant": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "grantId",
        "version",
        "kind",
        "issuerPrincipalId",
        "recipientPrincipalId",
        "action",
        "scope",
        "startsAt",
        "expiresAt",
        "revokedAt",
        "stewardPrincipalId",
        "reason",
        "mayRedelegate",
        "lastChangeReason"
      ],
      "properties": {
        "grantId": {
          "type": "string",
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        },
        "version": {
          "$ref": "#/$defs/IntakeVersion"
        },
        "kind": {
          "type": "string",
          "enum": [
            "business",
            "allocation",
            "delegation"
          ]
        },
        "issuerPrincipalId": {
          "type": "string",
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        },
        "recipientPrincipalId": {
          "type": "string",
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        },
        "action": {
          "$ref": "#/$defs/IntakeAction"
        },
        "scope": {
          "$ref": "#/$defs/IntakeScope"
        },
        "startsAt": {
          "type": "string",
          "format": "date-time",
          "maxLength": 35
        },
        "expiresAt": {
          "type": "string",
          "format": "date-time",
          "maxLength": 35
        },
        "revokedAt": {
          "type": [
            "string",
            "null"
          ],
          "format": "date-time",
          "maxLength": 35
        },
        "stewardPrincipalId": {
          "type": [
            "string",
            "null"
          ],
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        },
        "reason": {
          "type": "string",
          "minLength": 1,
          "maxLength": 512,
          "pattern": "\\S"
        },
        "mayRedelegate": {
          "type": "boolean",
          "enum": [
            false
          ]
        },
        "lastChangeReason": {
          "type": [
            "string",
            "null"
          ],
          "minLength": 1,
          "maxLength": 512,
          "pattern": "\\S"
        }
      },
      "if": {
        "properties": {
          "version": {
            "const": 1
          }
        },
        "required": [
          "version"
        ],
        "type": "object"
      },
      "then": {
        "properties": {
          "lastChangeReason": {
            "type": "null"
          }
        },
        "type": "object"
      },
      "else": {
        "properties": {
          "lastChangeReason": {
            "type": "string"
          }
        },
        "type": "object"
      }
    },
    "IntakeGrantBatch": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "operationId",
        "issuerFactsVersion",
        "policyVersion",
        "items"
      ],
      "properties": {
        "operationId": {
          "type": "string",
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        },
        "issuerFactsVersion": {
          "$ref": "#/$defs/IntakeVersion"
        },
        "policyVersion": {
          "$ref": "#/$defs/IntakeVersion"
        },
        "items": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/IntakeGrantItem"
          },
          "minItems": 1,
          "maxItems": 64
        }
      }
    },
    "IntakeGrantChange": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "operationId",
        "expectedVersion",
        "change",
        "stewardPrincipalId",
        "reason"
      ],
      "properties": {
        "operationId": {
          "type": "string",
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        },
        "expectedVersion": {
          "$ref": "#/$defs/IntakeVersion"
        },
        "change": {
          "type": "string",
          "enum": [
            "revoke",
            "takeover"
          ]
        },
        "stewardPrincipalId": {
          "type": [
            "string",
            "null"
          ],
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        },
        "reason": {
          "type": "string",
          "minLength": 1,
          "maxLength": 512,
          "pattern": "\\S"
        }
      }
    },
    "IntakeGrantItem": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "kind",
        "recipientPrincipalId",
        "recipientFactsVersion",
        "action",
        "scope",
        "startsAt",
        "expiresAt",
        "reason"
      ],
      "properties": {
        "kind": {
          "type": "string",
          "enum": [
            "business",
            "delegation"
          ]
        },
        "recipientPrincipalId": {
          "type": "string",
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        },
        "recipientFactsVersion": {
          "$ref": "#/$defs/IntakeVersion"
        },
        "action": {
          "$ref": "#/$defs/IntakeAction"
        },
        "scope": {
          "$ref": "#/$defs/IntakeScope"
        },
        "startsAt": {
          "type": "string",
          "format": "date-time",
          "maxLength": 35
        },
        "expiresAt": {
          "type": "string",
          "format": "date-time",
          "maxLength": 35
        },
        "reason": {
          "type": "string",
          "minLength": 1,
          "maxLength": 512
        }
      }
    },
    "IntakeGrantList": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "items",
        "nextCursor"
      ],
      "properties": {
        "items": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/IntakeGrant"
          },
          "minItems": 0,
          "maxItems": 100
        },
        "nextCursor": {
          "type": [
            "string",
            "null"
          ],
          "minLength": 1,
          "maxLength": 512
        }
      }
    },
    "IntakeId": {
      "type": "string",
      "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
      "minLength": 1,
      "maxLength": 128
    },
    "IntakeIssue": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "code",
        "message",
        "location"
      ],
      "properties": {
        "code": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64
        },
        "message": {
          "type": "string",
          "minLength": 1,
          "maxLength": 512
        },
        "location": {
          "$ref": "#/$defs/IntakeCoordinate"
        }
      }
    },
    "IntakeManagementContext": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "sourceId",
        "sourceVersion",
        "baseReleaseId",
        "principalId",
        "factsVersion",
        "validUntil"
      ],
      "properties": {
        "sourceId": {
          "$ref": "#/$defs/IntakeId"
        },
        "sourceVersion": {
          "$ref": "#/$defs/IntakeVersion"
        },
        "baseReleaseId": {
          "oneOf": [
            {
              "$ref": "#/$defs/IntakeId"
            },
            {
              "type": "null"
            }
          ]
        },
        "principalId": {
          "$ref": "#/$defs/IntakeId"
        },
        "factsVersion": {
          "$ref": "#/$defs/IntakeVersion"
        },
        "validUntil": {
          "type": "string",
          "format": "date-time",
          "maxLength": 35
        }
      }
    },
    "IntakeMaterial": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "canonicalEncodingVersion",
        "scope",
        "sourceVersion",
        "sourceClaim",
        "templateVersion",
        "ruleVersion",
        "mappingVersion",
        "selectedSheets",
        "object",
        "entries",
        "differences",
        "contributors",
        "risk",
        "baseReleaseId",
        "media"
      ],
      "properties": {
        "canonicalEncodingVersion": {
          "type": "string",
          "enum": [
            "candidate-p1.1"
          ]
        },
        "scope": {
          "$ref": "#/$defs/IntakeSourceScope"
        },
        "sourceVersion": {
          "$ref": "#/$defs/IntakeVersion"
        },
        "sourceClaim": {
          "$ref": "#/$defs/IntakeSourceClaim"
        },
        "templateVersion": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64
        },
        "ruleVersion": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64
        },
        "mappingVersion": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64
        },
        "selectedSheets": {
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 64
          },
          "minItems": 1,
          "maxItems": 16
        },
        "object": {
          "$ref": "#/$defs/IntakeObject"
        },
        "entries": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/IntakeEntry"
          },
          "minItems": 1,
          "maxItems": 5000
        },
        "differences": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/IntakeDifference"
          },
          "minItems": 0,
          "maxItems": 5000
        },
        "contributors": {
          "type": "array",
          "items": {
            "type": "string",
            "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
            "minLength": 1,
            "maxLength": 128
          },
          "minItems": 1,
          "maxItems": 100,
          "uniqueItems": true
        },
        "risk": {
          "$ref": "#/$defs/IntakeRisk"
        },
        "baseReleaseId": {
          "type": [
            "string",
            "null"
          ],
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        },
        "media": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "objectId",
              "sha256",
              "mime",
              "bytes",
              "required",
              "alt"
            ],
            "properties": {
              "objectId": {
                "type": "string",
                "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
                "minLength": 1,
                "maxLength": 128
              },
              "sha256": {
                "type": "string",
                "pattern": "^[0-9a-f]{64}$",
                "minLength": 64,
                "maxLength": 64
              },
              "mime": {
                "type": "string",
                "minLength": 1,
                "maxLength": 128
              },
              "bytes": {
                "$ref": "#/$defs/IntakeVersion"
              },
              "required": {
                "type": "boolean"
              },
              "alt": {
                "type": "string",
                "minLength": 1,
                "maxLength": 1024
              }
            }
          },
          "minItems": 0,
          "maxItems": 0
        }
      }
    },
    "IntakeMaterialHeader": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "canonicalEncodingVersion",
        "scope",
        "sourceVersion",
        "sourceClaim",
        "templateVersion",
        "ruleVersion",
        "mappingVersion",
        "selectedSheets",
        "object",
        "contributors",
        "risk",
        "baseReleaseId",
        "media"
      ],
      "properties": {
        "canonicalEncodingVersion": {
          "type": "string",
          "enum": [
            "candidate-p1.1"
          ]
        },
        "scope": {
          "$ref": "#/$defs/IntakeSourceScope"
        },
        "sourceVersion": {
          "$ref": "#/$defs/IntakeVersion"
        },
        "sourceClaim": {
          "$ref": "#/$defs/IntakeSourceClaim"
        },
        "templateVersion": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64
        },
        "ruleVersion": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64
        },
        "mappingVersion": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64
        },
        "selectedSheets": {
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 64
          },
          "minItems": 1,
          "maxItems": 16
        },
        "object": {
          "$ref": "#/$defs/IntakeObject"
        },
        "contributors": {
          "type": "array",
          "items": {
            "type": "string",
            "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
            "minLength": 1,
            "maxLength": 128
          },
          "minItems": 1,
          "maxItems": 100
        },
        "risk": {
          "$ref": "#/$defs/IntakeRisk"
        },
        "baseReleaseId": {
          "type": [
            "string",
            "null"
          ],
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        },
        "media": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "objectId",
              "sha256",
              "mime",
              "bytes",
              "required",
              "alt"
            ],
            "properties": {
              "objectId": {
                "type": "string",
                "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
                "minLength": 1,
                "maxLength": 128
              },
              "sha256": {
                "type": "string",
                "pattern": "^[0-9a-f]{64}$",
                "minLength": 64,
                "maxLength": 64
              },
              "mime": {
                "type": "string",
                "minLength": 1,
                "maxLength": 128
              },
              "bytes": {
                "$ref": "#/$defs/IntakeVersion"
              },
              "required": {
                "type": "boolean"
              },
              "alt": {
                "type": "string",
                "minLength": 1,
                "maxLength": 1024
              }
            }
          },
          "minItems": 0,
          "maxItems": 0
        }
      }
    },
    "IntakeObject": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "objectId",
        "sha256",
        "bytes",
        "mime",
        "sourceId"
      ],
      "properties": {
        "objectId": {
          "type": "string",
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        },
        "sha256": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$",
          "minLength": 64,
          "maxLength": 64
        },
        "bytes": {
          "type": "integer",
          "minimum": 1,
          "maximum": 10485760
        },
        "mime": {
          "type": "string",
          "enum": [
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          ]
        },
        "sourceId": {
          "type": "string",
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        }
      }
    },
    "IntakeOperationReceipt": {
      "oneOf": [
        {
          "$ref": "#/$defs/IntakeReceipt"
        },
        {
          "$ref": "#/$defs/IntakeRollbackReceipt"
        }
      ]
    },
    "IntakeParseJob": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "jobId",
        "generation",
        "state",
        "candidateId",
        "candidateVersion",
        "issues",
        "totalIssues",
        "excludedSheetCount",
        "excludedMediaCount",
        "reportObjectId"
      ],
      "properties": {
        "jobId": {
          "type": "string",
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        },
        "generation": {
          "$ref": "#/$defs/IntakeVersion"
        },
        "state": {
          "type": "string",
          "enum": [
            "reading",
            "parsing",
            "validated",
            "failed",
            "cancelled"
          ]
        },
        "candidateId": {
          "type": [
            "string",
            "null"
          ],
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        },
        "candidateVersion": {
          "type": [
            "integer",
            "null"
          ],
          "minimum": 1,
          "maximum": 9007199254740991
        },
        "issues": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/IntakeIssue"
          },
          "minItems": 0,
          "maxItems": 100
        },
        "totalIssues": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "excludedSheetCount": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "excludedMediaCount": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "reportObjectId": {
          "type": [
            "string",
            "null"
          ],
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        }
      }
    },
    "IntakePolicy": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "policyVersion",
        "templateVersion",
        "maxFileBytes",
        "maxExpandedBytes",
        "maxZipEntries",
        "maxRows",
        "maxColumns",
        "maxCells",
        "maxCellCharacters",
        "maxSharedStrings",
        "parseTimeoutMs",
        "maxActiveCandidatesPerActor",
        "maxActiveCandidatesPerSource",
        "maxTenantStagingBytes",
        "orgFactsMaxAgeSeconds",
        "approvalFactsMaxAgeSeconds",
        "ticketMaxAgeSeconds",
        "selectedMediaSupported"
      ],
      "properties": {
        "policyVersion": {
          "type": "string",
          "enum": [
            "intake-p1.1"
          ]
        },
        "templateVersion": {
          "type": "string",
          "enum": [
            "faq-p1.1"
          ]
        },
        "maxFileBytes": {
          "type": "integer",
          "enum": [
            10485760
          ]
        },
        "maxExpandedBytes": {
          "type": "integer",
          "enum": [
            52428800
          ]
        },
        "maxZipEntries": {
          "type": "integer",
          "enum": [
            512
          ]
        },
        "maxRows": {
          "type": "integer",
          "enum": [
            5000
          ]
        },
        "maxColumns": {
          "type": "integer",
          "enum": [
            32
          ]
        },
        "maxCells": {
          "type": "integer",
          "enum": [
            200000
          ]
        },
        "maxCellCharacters": {
          "type": "integer",
          "enum": [
            32767
          ]
        },
        "maxSharedStrings": {
          "type": "integer",
          "enum": [
            100000
          ]
        },
        "parseTimeoutMs": {
          "type": "integer",
          "enum": [
            30000
          ]
        },
        "maxActiveCandidatesPerActor": {
          "type": "integer",
          "enum": [
            10
          ]
        },
        "maxActiveCandidatesPerSource": {
          "type": "integer",
          "enum": [
            100
          ]
        },
        "maxTenantStagingBytes": {
          "type": "integer",
          "enum": [
            1073741824
          ]
        },
        "orgFactsMaxAgeSeconds": {
          "type": "integer",
          "enum": [
            300
          ]
        },
        "approvalFactsMaxAgeSeconds": {
          "type": "integer",
          "enum": [
            300
          ]
        },
        "ticketMaxAgeSeconds": {
          "type": "integer",
          "enum": [
            60
          ]
        },
        "selectedMediaSupported": {
          "type": "boolean",
          "enum": [
            false
          ]
        }
      }
    },
    "IntakePrincipalPage": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "items",
        "nextCursor"
      ],
      "properties": {
        "items": {
          "type": "array",
          "maxItems": 100,
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "principalId",
              "displayLabel",
              "factsVersion",
              "validUntil",
              "enabled"
            ],
            "properties": {
              "principalId": {
                "type": "string",
                "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
                "minLength": 1,
                "maxLength": 128
              },
              "displayLabel": {
                "type": "string",
                "minLength": 1,
                "maxLength": 256
              },
              "factsVersion": {
                "$ref": "#/$defs/IntakeVersion"
              },
              "validUntil": {
                "type": "string",
                "format": "date-time",
                "maxLength": 35
              },
              "enabled": {
                "type": "boolean"
              }
            }
          }
        },
        "nextCursor": {
          "type": [
            "string",
            "null"
          ],
          "minLength": 1,
          "maxLength": 512
        }
      }
    },
    "IntakePublish": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "operationId",
        "key",
        "baseReleaseId",
        "sourceEvidenceVersion",
        "title",
        "summary",
        "confirmed"
      ],
      "properties": {
        "operationId": {
          "type": "string",
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        },
        "key": {
          "$ref": "#/$defs/IntakeCandidateKey"
        },
        "baseReleaseId": {
          "type": [
            "string",
            "null"
          ],
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        },
        "sourceEvidenceVersion": {
          "$ref": "#/$defs/IntakeVersion"
        },
        "title": {
          "type": "string",
          "minLength": 1,
          "maxLength": 256
        },
        "summary": {
          "type": "string",
          "minLength": 1,
          "maxLength": 2048
        },
        "confirmed": {
          "type": "boolean",
          "const": true
        }
      }
    },
    "IntakePublishedEntry": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "businessEntryId",
        "scriptVersion",
        "operation",
        "title",
        "answerText",
        "questions",
        "productRefs",
        "scenarioRefs",
        "effectiveFrom",
        "effectiveTo",
        "applicabilityNote",
        "familySourceId",
        "familyBusinessEntryId",
        "brandNonOverridable",
        "category",
        "riskNote"
      ],
      "properties": {
        "businessEntryId": {
          "type": "string",
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        },
        "scriptVersion": {
          "$ref": "#/$defs/IntakeVersion"
        },
        "operation": {
          "type": "string",
          "enum": [
            "upsert"
          ]
        },
        "title": {
          "type": "string",
          "minLength": 1,
          "maxLength": 512
        },
        "answerText": {
          "type": "string",
          "minLength": 1,
          "maxLength": 32767
        },
        "questions": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/IntakeQuestion"
          },
          "minItems": 0,
          "maxItems": 100
        },
        "productRefs": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/IntakeTermRef"
          },
          "minItems": 0,
          "maxItems": 100
        },
        "scenarioRefs": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/IntakeTermRef"
          },
          "minItems": 0,
          "maxItems": 100
        },
        "effectiveFrom": {
          "type": "string",
          "format": "date-time",
          "maxLength": 35
        },
        "effectiveTo": {
          "type": [
            "string",
            "null"
          ],
          "format": "date-time",
          "maxLength": 35
        },
        "applicabilityNote": {
          "type": "string",
          "maxLength": 4096
        },
        "familySourceId": {
          "type": [
            "string",
            "null"
          ],
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        },
        "familyBusinessEntryId": {
          "type": [
            "string",
            "null"
          ],
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        },
        "brandNonOverridable": {
          "type": "boolean"
        },
        "category": {
          "type": "string",
          "maxLength": 32767
        },
        "riskNote": {
          "type": "string",
          "maxLength": 32767
        }
      },
      "if": {
        "properties": {
          "familySourceId": {
            "type": "null"
          }
        },
        "type": "object"
      },
      "then": {
        "properties": {
          "familyBusinessEntryId": {
            "type": "null"
          }
        },
        "type": "object"
      },
      "else": {
        "properties": {
          "familyBusinessEntryId": {
            "type": "string"
          }
        },
        "type": "object"
      },
      "allOf": [
        {
          "if": {
            "properties": {
              "operation": {
                "const": "upsert"
              }
            },
            "type": "object"
          },
          "then": {
            "allOf": [
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 1
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 99
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 2
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 98
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 3
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 97
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 4
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 96
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 5
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 95
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 6
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 94
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 7
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 93
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 8
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 92
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 9
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 91
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 10
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 90
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 11
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 89
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 12
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 88
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 13
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 87
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 14
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 86
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 15
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 85
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 16
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 84
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 17
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 83
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 18
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 82
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 19
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 81
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 20
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 80
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 21
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 79
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 22
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 78
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 23
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 77
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 24
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 76
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 25
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 75
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 26
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 74
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 27
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 73
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 28
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 72
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 29
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 71
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 30
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 70
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 31
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 69
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 32
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 68
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 33
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 67
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 34
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 66
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 35
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 65
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 36
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 64
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 37
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 63
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 38
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 62
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 39
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 61
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 40
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 60
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 41
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 59
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 42
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 58
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 43
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 57
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 44
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 56
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 45
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 55
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 46
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 54
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 47
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 53
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 48
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 52
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 49
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 51
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 50
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 50
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 51
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 49
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 52
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 48
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 53
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 47
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 54
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 46
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 55
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 45
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 56
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 44
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 57
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 43
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 58
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 42
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 59
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 41
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 60
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 40
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 61
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 39
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 62
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 38
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 63
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 37
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 64
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 36
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 65
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 35
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 66
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 34
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 67
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 33
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 68
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 32
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 69
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 31
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 70
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 30
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 71
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 29
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 72
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 28
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 73
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 27
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 74
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 26
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 75
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 25
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 76
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 24
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 77
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 23
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 78
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 22
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 79
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 21
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 80
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 20
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 81
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 19
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 82
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 18
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 83
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 17
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 84
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 16
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 85
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 15
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 86
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 14
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 87
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 13
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 88
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 12
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 89
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 11
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 90
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 10
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 91
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 9
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 92
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 8
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 93
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 7
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 94
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 6
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 95
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 5
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 96
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 4
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 97
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 3
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 98
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 2
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 99
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 1
                    }
                  },
                  "type": "object"
                }
              },
              {
                "if": {
                  "properties": {
                    "productRefs": {
                      "type": "array",
                      "minItems": 100
                    }
                  },
                  "type": "object"
                },
                "then": {
                  "properties": {
                    "scenarioRefs": {
                      "type": "array",
                      "maxItems": 0
                    }
                  },
                  "type": "object"
                }
              }
            ]
          }
        }
      ]
    },
    "IntakeQualityAttribution": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "principalId",
        "factsVersion",
        "recordedAt"
      ],
      "properties": {
        "principalId": {
          "$ref": "#/$defs/IntakeId"
        },
        "factsVersion": {
          "$ref": "#/$defs/IntakeVersion"
        },
        "recordedAt": {
          "type": "string",
          "format": "date-time",
          "maxLength": 35
        }
      }
    },
    "IntakeQualityCheck": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "scriptId",
        "contentHash",
        "defect",
        "reason"
      ],
      "properties": {
        "scriptId": {
          "type": "string",
          "pattern": "^intake_[0-9a-f]{64}$",
          "minLength": 71,
          "maxLength": 71
        },
        "contentHash": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$",
          "minLength": 64,
          "maxLength": 64
        },
        "defect": {
          "type": "boolean"
        },
        "reason": {
          "type": "string",
          "maxLength": 1000,
          "pattern": "^[^\\u0000\\uD800-\\uDFFF]*$"
        }
      },
      "if": {
        "properties": {
          "defect": {
            "const": true
          }
        },
        "type": "object"
      },
      "then": {
        "properties": {
          "reason": {
            "type": "string",
            "pattern": "\\S"
          }
        },
        "type": "object"
      }
    },
    "IntakeQualityCommand": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "operationId",
        "key"
      ],
      "properties": {
        "operationId": {
          "$ref": "#/$defs/IntakeId"
        },
        "key": {
          "$ref": "#/$defs/IntakeCandidateKey"
        }
      }
    },
    "IntakeQualityPlan": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "policyVersion",
        "ordinaryCount",
        "mandatoryCount",
        "withdrawalCount",
        "initialTarget",
        "expandedTarget",
        "initialCount",
        "expandedCount",
        "seedHash",
        "populationManifestHash",
        "selectionManifestHash"
      ],
      "properties": {
        "policyVersion": {
          "type": "string",
          "const": "intake-quality-v1"
        },
        "ordinaryCount": {
          "type": "integer",
          "minimum": 0,
          "maximum": 5000
        },
        "mandatoryCount": {
          "type": "integer",
          "minimum": 0,
          "maximum": 5000
        },
        "withdrawalCount": {
          "type": "integer",
          "minimum": 0,
          "maximum": 5000
        },
        "initialTarget": {
          "type": "integer",
          "minimum": 0,
          "maximum": 5000
        },
        "expandedTarget": {
          "type": "integer",
          "minimum": 0,
          "maximum": 5000
        },
        "initialCount": {
          "type": "integer",
          "minimum": 0,
          "maximum": 5000
        },
        "expandedCount": {
          "type": "integer",
          "minimum": 0,
          "maximum": 5000
        },
        "seedHash": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$",
          "minLength": 64,
          "maxLength": 64
        },
        "populationManifestHash": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$",
          "minLength": 64,
          "maxLength": 64
        },
        "selectionManifestHash": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$",
          "minLength": 64,
          "maxLength": 64
        }
      }
    },
    "IntakeQualityReceipt": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "operationId",
        "action",
        "key",
        "state",
        "phase"
      ],
      "properties": {
        "operationId": {
          "$ref": "#/$defs/IntakeId"
        },
        "action": {
          "type": "string",
          "enum": [
            "quality-freeze",
            "quality-check"
          ]
        },
        "key": {
          "$ref": "#/$defs/IntakeCandidateKey"
        },
        "state": {
          "type": "string",
          "enum": [
            "initial_required",
            "expansion_required",
            "passed",
            "revision_required",
            "blocked"
          ]
        },
        "phase": {
          "oneOf": [
            {
              "type": "string",
              "enum": [
                "initial",
                "expanded"
              ]
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "if": {
        "properties": {
          "action": {
            "const": "quality-freeze"
          }
        },
        "type": "object"
      },
      "then": {
        "properties": {
          "phase": {
            "type": "null"
          }
        },
        "type": "object"
      },
      "else": {
        "properties": {
          "phase": {
            "type": "string",
            "enum": [
              "initial",
              "expanded"
            ]
          },
          "state": {
            "type": "string",
            "enum": [
              "expansion_required",
              "passed",
              "revision_required",
              "blocked"
            ]
          }
        },
        "type": "object"
      },
      "allOf": [
        {
          "if": {
            "properties": {
              "phase": {
                "const": "expanded"
              }
            },
            "type": "object"
          },
          "then": {
            "properties": {
              "state": {
                "type": "string",
                "enum": [
                  "passed",
                  "revision_required",
                  "blocked"
                ]
              }
            },
            "type": "object"
          }
        }
      ]
    },
    "IntakeQualityRound": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "phase",
        "reviewer",
        "checkedCount",
        "defectCount"
      ],
      "properties": {
        "phase": {
          "type": "string",
          "enum": [
            "initial",
            "expanded"
          ]
        },
        "reviewer": {
          "$ref": "#/$defs/IntakeQualityAttribution"
        },
        "checkedCount": {
          "type": "integer",
          "minimum": 0,
          "maximum": 5000
        },
        "defectCount": {
          "type": "integer",
          "minimum": 0,
          "maximum": 5000
        }
      }
    },
    "IntakeQualitySample": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "scriptId",
        "contentHash",
        "mandatory",
        "entry",
        "check"
      ],
      "properties": {
        "scriptId": {
          "type": "string",
          "pattern": "^intake_[0-9a-f]{64}$",
          "minLength": 71,
          "maxLength": 71
        },
        "contentHash": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$",
          "minLength": 64,
          "maxLength": 64
        },
        "mandatory": {
          "type": "boolean"
        },
        "entry": {
          "allOf": [
            {
              "$ref": "#/$defs/IntakeEntry"
            },
            {
              "type": "object",
              "properties": {
                "operation": {
                  "const": "upsert"
                }
              }
            }
          ]
        },
        "check": {
          "oneOf": [
            {
              "$ref": "#/$defs/IntakeQualityCheck"
            },
            {
              "type": "null"
            }
          ]
        }
      }
    },
    "IntakeQualitySamplePage": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "key",
        "viewHash",
        "phase",
        "selectionManifestHash",
        "items",
        "nextCursor"
      ],
      "properties": {
        "key": {
          "$ref": "#/$defs/IntakeCandidateKey"
        },
        "viewHash": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$",
          "minLength": 64,
          "maxLength": 64
        },
        "phase": {
          "type": "string",
          "enum": [
            "initial",
            "expanded"
          ]
        },
        "selectionManifestHash": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$",
          "minLength": 64,
          "maxLength": 64
        },
        "items": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/IntakeQualitySample"
          },
          "minItems": 0,
          "maxItems": 100
        },
        "nextCursor": {
          "type": [
            "string",
            "null"
          ],
          "minLength": 1,
          "maxLength": 512
        }
      },
      "if": {
        "properties": {
          "nextCursor": {
            "type": "string"
          }
        },
        "type": "object"
      },
      "then": {
        "properties": {
          "items": {
            "type": "array",
            "minItems": 1
          }
        },
        "type": "object"
      }
    },
    "IntakeQualityStatus": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "key",
        "viewHash",
        "state",
        "plan",
        "frozen",
        "rounds"
      ],
      "properties": {
        "key": {
          "$ref": "#/$defs/IntakeCandidateKey"
        },
        "viewHash": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$",
          "minLength": 64,
          "maxLength": 64
        },
        "state": {
          "type": "string",
          "enum": [
            "not_frozen",
            "initial_required",
            "expansion_required",
            "passed",
            "revision_required",
            "blocked"
          ]
        },
        "plan": {
          "$ref": "#/$defs/IntakeQualityPlan"
        },
        "frozen": {
          "oneOf": [
            {
              "$ref": "#/$defs/IntakeQualityAttribution"
            },
            {
              "type": "null"
            }
          ]
        },
        "rounds": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/IntakeQualityRound"
          },
          "minItems": 0,
          "maxItems": 2,
          "allOf": [
            {
              "contains": {
                "type": "object",
                "properties": {
                  "phase": {
                    "const": "initial"
                  }
                },
                "required": [
                  "phase"
                ]
              },
              "minContains": 0,
              "maxContains": 1
            },
            {
              "contains": {
                "type": "object",
                "properties": {
                  "phase": {
                    "const": "expanded"
                  }
                },
                "required": [
                  "phase"
                ]
              },
              "minContains": 0,
              "maxContains": 1
            }
          ]
        }
      },
      "if": {
        "properties": {
          "state": {
            "const": "not_frozen"
          }
        },
        "type": "object"
      },
      "then": {
        "properties": {
          "frozen": {
            "type": "null"
          },
          "rounds": {
            "type": "array",
            "maxItems": 0
          }
        },
        "type": "object"
      },
      "else": {
        "properties": {
          "frozen": {
            "type": "object"
          }
        },
        "type": "object"
      },
      "allOf": [
        {
          "if": {
            "properties": {
              "state": {
                "enum": [
                  "initial_required"
                ]
              }
            },
            "type": "object"
          },
          "then": {
            "properties": {
              "rounds": {
                "type": "array",
                "maxItems": 0
              }
            },
            "type": "object"
          }
        },
        {
          "if": {
            "properties": {
              "state": {
                "enum": [
                  "expansion_required"
                ]
              }
            },
            "type": "object"
          },
          "then": {
            "properties": {
              "rounds": {
                "type": "array",
                "minItems": 1,
                "maxItems": 1,
                "contains": {
                  "type": "object",
                  "properties": {
                    "phase": {
                      "const": "initial"
                    }
                  },
                  "required": [
                    "phase"
                  ]
                }
              }
            },
            "type": "object"
          }
        },
        {
          "if": {
            "properties": {
              "state": {
                "enum": [
                  "passed",
                  "revision_required",
                  "blocked"
                ]
              }
            },
            "type": "object"
          },
          "then": {
            "properties": {
              "rounds": {
                "type": "array",
                "minItems": 1,
                "contains": {
                  "type": "object",
                  "properties": {
                    "phase": {
                      "const": "initial"
                    }
                  },
                  "required": [
                    "phase"
                  ]
                }
              }
            },
            "type": "object"
          }
        }
      ]
    },
    "IntakeQualitySubmission": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "operationId",
        "key",
        "phase",
        "checks"
      ],
      "properties": {
        "operationId": {
          "$ref": "#/$defs/IntakeId"
        },
        "key": {
          "$ref": "#/$defs/IntakeCandidateKey"
        },
        "phase": {
          "type": "string",
          "enum": [
            "initial",
            "expanded"
          ]
        },
        "checks": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/IntakeQualityCheck"
          },
          "minItems": 0,
          "maxItems": 5000
        }
      }
    },
    "IntakeQuestion": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "id",
        "version",
        "text",
        "active"
      ],
      "properties": {
        "id": {
          "type": "string",
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        },
        "version": {
          "$ref": "#/$defs/IntakeVersion"
        },
        "text": {
          "type": "string",
          "minLength": 1,
          "maxLength": 4096
        },
        "active": {
          "type": "boolean"
        }
      }
    },
    "IntakeReceipt": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "operationId",
        "key",
        "state",
        "releaseId",
        "announcementId",
        "reason",
        "action"
      ],
      "properties": {
        "operationId": {
          "type": "string",
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        },
        "key": {
          "$ref": "#/$defs/IntakeCandidateKey"
        },
        "state": {
          "type": "string",
          "enum": [
            "pending",
            "unknown",
            "published",
            "cancelled",
            "failed"
          ]
        },
        "releaseId": {
          "type": [
            "string",
            "null"
          ],
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        },
        "announcementId": {
          "type": [
            "string",
            "null"
          ],
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        },
        "reason": {
          "type": [
            "string",
            "null"
          ],
          "minLength": 1,
          "maxLength": 64
        },
        "action": {
          "type": "string",
          "enum": [
            "publish",
            "cancel"
          ]
        }
      }
    },
    "IntakeReceive": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "operationId",
        "objectId",
        "sourceVersion",
        "baseReleaseId",
        "contributorDeclaration",
        "expectedPriorKey"
      ],
      "properties": {
        "operationId": {
          "type": "string",
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        },
        "objectId": {
          "type": "string",
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        },
        "sourceVersion": {
          "$ref": "#/$defs/IntakeVersion"
        },
        "baseReleaseId": {
          "type": [
            "string",
            "null"
          ],
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        },
        "contributorDeclaration": {
          "$ref": "#/$defs/IntakeContributorDeclaration"
        },
        "expectedPriorKey": {
          "oneOf": [
            {
              "$ref": "#/$defs/IntakeCandidateKey"
            },
            {
              "type": "null"
            }
          ]
        }
      }
    },
    "IntakeReview": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "key",
        "reviewRequestId",
        "instanceCode",
        "evidenceVersion",
        "revocationGeneration",
        "state",
        "checkedAt",
        "validUntil",
        "reviewPackageObjectId",
        "reviewPackageSha256"
      ],
      "properties": {
        "key": {
          "$ref": "#/$defs/IntakeCandidateKey"
        },
        "reviewRequestId": {
          "type": "string",
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        },
        "instanceCode": {
          "type": [
            "string",
            "null"
          ],
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        },
        "evidenceVersion": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "revocationGeneration": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "state": {
          "type": "string",
          "enum": [
            "creating",
            "pending",
            "approved",
            "rejected",
            "revoked",
            "unavailable"
          ]
        },
        "checkedAt": {
          "type": [
            "string",
            "null"
          ],
          "format": "date-time",
          "maxLength": 35
        },
        "validUntil": {
          "type": [
            "string",
            "null"
          ],
          "format": "date-time",
          "maxLength": 35
        },
        "reviewPackageObjectId": {
          "type": "string",
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        },
        "reviewPackageSha256": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$",
          "minLength": 64,
          "maxLength": 64
        }
      },
      "if": {
        "properties": {
          "state": {
            "const": "approved"
          }
        },
        "type": "object"
      },
      "then": {
        "properties": {
          "checkedAt": {
            "type": "string"
          },
          "validUntil": {
            "type": "string"
          },
          "instanceCode": {
            "type": "string"
          },
          "evidenceVersion": {
            "minimum": 1,
            "type": "integer"
          }
        },
        "type": "object"
      }
    },
    "IntakeReviewRequest": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "operationId",
        "key",
        "expectedEvidenceVersion"
      ],
      "properties": {
        "operationId": {
          "type": "string",
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        },
        "key": {
          "$ref": "#/$defs/IntakeCandidateKey"
        },
        "expectedEvidenceVersion": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        }
      }
    },
    "IntakeRisk": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "policyVersion",
        "level",
        "reasons",
        "explicitDisableCount",
        "sameSourceDisabledLast24Hours",
        "evaluatedAt"
      ],
      "properties": {
        "policyVersion": {
          "type": "string",
          "enum": [
            "risk-p1.1"
          ]
        },
        "level": {
          "type": "string",
          "enum": [
            "routine",
            "critical"
          ]
        },
        "reasons": {
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 64
          },
          "minItems": 0,
          "maxItems": 32
        },
        "explicitDisableCount": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "sameSourceDisabledLast24Hours": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "evaluatedAt": {
          "type": "string",
          "format": "date-time",
          "maxLength": 35
        }
      }
    },
    "IntakeRollback": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "operationId",
        "baseReleaseId",
        "targetReleaseId",
        "impactDigest",
        "rollbackPlanId",
        "confirmed"
      ],
      "properties": {
        "operationId": {
          "type": "string",
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        },
        "baseReleaseId": {
          "type": "string",
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        },
        "targetReleaseId": {
          "type": "string",
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        },
        "impactDigest": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$",
          "minLength": 64,
          "maxLength": 64
        },
        "rollbackPlanId": {
          "$ref": "#/$defs/IntakeId"
        },
        "confirmed": {
          "type": "boolean",
          "const": true
        }
      }
    },
    "IntakeRollbackImpact": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "baseReleaseId",
        "targetReleaseId",
        "impactDigest",
        "scopes",
        "requiresCorrectiveCandidate",
        "rollbackPlanId",
        "approvalEvidenceVersion"
      ],
      "properties": {
        "baseReleaseId": {
          "type": "string",
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        },
        "targetReleaseId": {
          "type": "string",
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        },
        "impactDigest": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$",
          "minLength": 64,
          "maxLength": 64
        },
        "scopes": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/IntakeSourceScope"
          },
          "minItems": 0,
          "maxItems": 1000
        },
        "requiresCorrectiveCandidate": {
          "type": "boolean"
        },
        "rollbackPlanId": {
          "$ref": "#/$defs/IntakeId"
        },
        "approvalEvidenceVersion": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        }
      }
    },
    "IntakeRollbackPreview": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "baseReleaseId",
        "targetReleaseId"
      ],
      "properties": {
        "baseReleaseId": {
          "type": "string",
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        },
        "targetReleaseId": {
          "type": "string",
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        }
      }
    },
    "IntakeRollbackReceipt": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "operationId",
        "rollbackPlanId",
        "state",
        "releaseId",
        "announcementId",
        "reason",
        "action"
      ],
      "properties": {
        "operationId": {
          "type": "string",
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        },
        "state": {
          "type": "string",
          "enum": [
            "pending",
            "unknown",
            "published",
            "cancelled",
            "failed"
          ]
        },
        "releaseId": {
          "type": [
            "string",
            "null"
          ],
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        },
        "announcementId": {
          "type": [
            "string",
            "null"
          ],
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        },
        "reason": {
          "type": [
            "string",
            "null"
          ],
          "minLength": 1,
          "maxLength": 64
        },
        "rollbackPlanId": {
          "$ref": "#/$defs/IntakeId"
        },
        "action": {
          "type": "string",
          "enum": [
            "rollback"
          ]
        }
      }
    },
    "IntakeRollbackReview": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "rollbackPlanId",
        "reviewRequestId",
        "evidenceVersion",
        "state",
        "instanceCode",
        "revocationGeneration",
        "checkedAt",
        "validUntil",
        "reviewPackageObjectId",
        "reviewPackageSha256",
        "impactDigest"
      ],
      "properties": {
        "rollbackPlanId": {
          "$ref": "#/$defs/IntakeId"
        },
        "reviewRequestId": {
          "type": "string",
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        },
        "evidenceVersion": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "state": {
          "type": "string",
          "enum": [
            "creating",
            "pending",
            "approved",
            "rejected",
            "revoked",
            "unavailable"
          ]
        },
        "instanceCode": {
          "type": [
            "string",
            "null"
          ],
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        },
        "revocationGeneration": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "checkedAt": {
          "type": [
            "string",
            "null"
          ],
          "format": "date-time",
          "maxLength": 35
        },
        "validUntil": {
          "type": [
            "string",
            "null"
          ],
          "format": "date-time",
          "maxLength": 35
        },
        "reviewPackageObjectId": {
          "type": "string",
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        },
        "reviewPackageSha256": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$",
          "minLength": 64,
          "maxLength": 64
        },
        "impactDigest": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$",
          "minLength": 64,
          "maxLength": 64
        }
      },
      "if": {
        "properties": {
          "state": {
            "const": "approved"
          }
        },
        "type": "object"
      },
      "then": {
        "properties": {
          "checkedAt": {
            "type": "string"
          },
          "validUntil": {
            "type": "string"
          },
          "instanceCode": {
            "type": "string"
          },
          "evidenceVersion": {
            "minimum": 1,
            "type": "integer"
          }
        },
        "type": "object"
      }
    },
    "IntakeRollbackReviewRequest": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "operationId",
        "impactDigest",
        "expectedEvidenceVersion"
      ],
      "properties": {
        "operationId": {
          "$ref": "#/$defs/IntakeId"
        },
        "impactDigest": {
          "$ref": "#/$defs/IntakeDigest"
        },
        "expectedEvidenceVersion": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        }
      }
    },
    "IntakeScope": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "tenantId",
        "appId",
        "brandId",
        "shopId",
        "domain",
        "sourceId"
      ],
      "properties": {
        "tenantId": {
          "type": "string",
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        },
        "appId": {
          "type": "string",
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        },
        "brandId": {
          "type": "string",
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        },
        "shopId": {
          "type": [
            "string",
            "null"
          ],
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        },
        "domain": {
          "type": "string",
          "enum": [
            "presale",
            "campaign",
            "aftersale",
            "product"
          ]
        },
        "sourceId": {
          "type": [
            "string",
            "null"
          ],
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        }
      }
    },
    "IntakeSelectionIds": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/IntakeId"
      },
      "minItems": 0,
      "maxItems": 100,
      "uniqueItems": true
    },
    "IntakeShopDirectory": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "items",
        "nextCursor",
        "validUntil"
      ],
      "properties": {
        "items": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/IntakeShopDisplay"
          },
          "minItems": 0,
          "maxItems": 100
        },
        "nextCursor": {
          "type": [
            "string",
            "null"
          ],
          "minLength": 1,
          "maxLength": 512
        },
        "validUntil": {
          "type": "string",
          "format": "date-time",
          "maxLength": 35
        }
      }
    },
    "IntakeShopDisplay": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "shopId",
        "displayName",
        "displayVersion"
      ],
      "properties": {
        "shopId": {
          "$ref": "#/$defs/IntakeId"
        },
        "displayName": {
          "type": "string",
          "minLength": 1,
          "maxLength": 256,
          "pattern": "^[^\\s\\u0000-\\u001f\\u007f\\u2028\\u2029](?:[^\\u0000-\\u001f\\u007f\\u2028\\u2029]*[^\\s\\u0000-\\u001f\\u007f\\u2028\\u2029])?$"
        },
        "displayVersion": {
          "$ref": "#/$defs/IntakeVersion"
        }
      }
    },
    "IntakeSnapshot": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "releaseId",
        "entitlementId",
        "contextGeneration",
        "faq",
        "sopNodes",
        "sopEdges",
        "media",
        "vocabulary",
        "nextCursor"
      ],
      "properties": {
        "releaseId": {
          "type": "string",
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        },
        "entitlementId": {
          "type": "string",
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        },
        "contextGeneration": {
          "$ref": "#/$defs/IntakeVersion"
        },
        "faq": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "sourceId",
              "entry"
            ],
            "properties": {
              "sourceId": {
                "type": "string",
                "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
                "minLength": 1,
                "maxLength": 128
              },
              "entry": {
                "$ref": "#/$defs/IntakePublishedEntry"
              }
            }
          },
          "minItems": 0,
          "maxItems": 100
        },
        "sopNodes": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "id"
            ],
            "properties": {
              "id": {
                "type": "string",
                "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
                "minLength": 1,
                "maxLength": 128
              }
            }
          },
          "minItems": 0,
          "maxItems": 0
        },
        "sopEdges": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "from",
              "to"
            ],
            "properties": {
              "from": {
                "type": "string",
                "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
                "minLength": 1,
                "maxLength": 128
              },
              "to": {
                "type": "string",
                "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
                "minLength": 1,
                "maxLength": 128
              }
            }
          },
          "minItems": 0,
          "maxItems": 0
        },
        "media": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "objectId",
              "sha256"
            ],
            "properties": {
              "objectId": {
                "type": "string",
                "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
                "minLength": 1,
                "maxLength": 128
              },
              "sha256": {
                "type": "string",
                "pattern": "^[0-9a-f]{64}$",
                "minLength": 64,
                "maxLength": 64
              }
            }
          },
          "minItems": 0,
          "maxItems": 0
        },
        "vocabulary": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/IntakeVocabulary"
          },
          "minItems": 0,
          "maxItems": 100
        },
        "nextCursor": {
          "type": [
            "string",
            "null"
          ],
          "minLength": 1,
          "maxLength": 512
        }
      }
    },
    "IntakeSource": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "scope",
        "version",
        "templateVersion",
        "ruleVersion",
        "mappingVersion",
        "structureDigest",
        "contentIntakeMode",
        "modeVersion"
      ],
      "properties": {
        "scope": {
          "$ref": "#/$defs/IntakeSourceScope"
        },
        "version": {
          "$ref": "#/$defs/IntakeVersion"
        },
        "templateVersion": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64
        },
        "ruleVersion": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64
        },
        "mappingVersion": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64
        },
        "structureDigest": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$",
          "minLength": 64,
          "maxLength": 64
        },
        "contentIntakeMode": {
          "type": "string",
          "enum": [
            "legacy",
            "v2-preview",
            "v2-active"
          ]
        },
        "modeVersion": {
          "$ref": "#/$defs/IntakeVersion"
        }
      }
    },
    "IntakeSourceClaim": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "versionKind",
        "versionValue",
        "acquisition",
        "fileSha256"
      ],
      "properties": {
        "versionKind": {
          "type": "string",
          "enum": [
            "integer",
            "opaque",
            "unknown"
          ]
        },
        "versionValue": {
          "type": [
            "string",
            "null"
          ],
          "minLength": 1,
          "maxLength": 128
        },
        "acquisition": {
          "type": "string",
          "enum": [
            "feishu-export",
            "controlled-synthetic-export"
          ]
        },
        "fileSha256": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$",
          "minLength": 64,
          "maxLength": 64
        }
      }
    },
    "IntakeSourceConfirmation": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "operationId",
        "key",
        "expectedEvidenceVersion",
        "confirmedVersionKind",
        "confirmedVersionValue",
        "acquisition",
        "objectSha256",
        "reason"
      ],
      "properties": {
        "operationId": {
          "type": "string",
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        },
        "key": {
          "$ref": "#/$defs/IntakeCandidateKey"
        },
        "expectedEvidenceVersion": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "confirmedVersionKind": {
          "type": "string",
          "enum": [
            "integer",
            "opaque"
          ]
        },
        "confirmedVersionValue": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "acquisition": {
          "type": "string",
          "enum": [
            "feishu-export",
            "controlled-synthetic-export"
          ]
        },
        "objectSha256": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$",
          "minLength": 64,
          "maxLength": 64
        },
        "reason": {
          "type": "string",
          "minLength": 1,
          "maxLength": 512
        }
      }
    },
    "IntakeSourceList": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "items",
        "nextCursor"
      ],
      "properties": {
        "items": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/IntakeSource"
          },
          "minItems": 0,
          "maxItems": 100
        },
        "nextCursor": {
          "type": [
            "string",
            "null"
          ],
          "minLength": 1,
          "maxLength": 512
        }
      }
    },
    "IntakeSourceScope": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "tenantId",
        "appId",
        "brandId",
        "shopId",
        "domain",
        "sourceId"
      ],
      "properties": {
        "tenantId": {
          "type": "string",
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        },
        "appId": {
          "type": "string",
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        },
        "brandId": {
          "type": "string",
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        },
        "shopId": {
          "type": [
            "string",
            "null"
          ],
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        },
        "domain": {
          "type": "string",
          "enum": [
            "presale",
            "campaign",
            "aftersale",
            "product"
          ]
        },
        "sourceId": {
          "type": "string",
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        }
      }
    },
    "IntakeSourceWrite": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "operationId",
        "expectedVersion",
        "templateVersion",
        "ruleVersion",
        "mappingVersion",
        "structureDigest"
      ],
      "properties": {
        "operationId": {
          "type": "string",
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        },
        "expectedVersion": {
          "$ref": "#/$defs/IntakeVersion"
        },
        "templateVersion": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64
        },
        "ruleVersion": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64
        },
        "mappingVersion": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64
        },
        "structureDigest": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$",
          "minLength": 64,
          "maxLength": 64
        }
      }
    },
    "IntakeTermRef": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "id",
        "displayVersion"
      ],
      "properties": {
        "id": {
          "type": "string",
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        },
        "displayVersion": {
          "$ref": "#/$defs/IntakeVersion"
        }
      }
    },
    "IntakeVersion": {
      "type": "integer",
      "minimum": 1,
      "maximum": 9007199254740991
    },
    "IntakeVocabulary": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "id",
        "kind",
        "displayVersion",
        "displayName",
        "meaningDigest",
        "scope",
        "active"
      ],
      "properties": {
        "id": {
          "type": "string",
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        },
        "kind": {
          "type": "string",
          "enum": [
            "product",
            "scenario"
          ]
        },
        "displayVersion": {
          "$ref": "#/$defs/IntakeVersion"
        },
        "displayName": {
          "type": "string",
          "minLength": 1,
          "maxLength": 256
        },
        "meaningDigest": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$",
          "minLength": 64,
          "maxLength": 64
        },
        "scope": {
          "$ref": "#/$defs/IntakeScope"
        },
        "active": {
          "type": "boolean"
        }
      }
    },
    "IntakeVocabularyList": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "items",
        "nextCursor"
      ],
      "properties": {
        "items": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/IntakeVocabulary"
          },
          "minItems": 0,
          "maxItems": 100
        },
        "nextCursor": {
          "type": [
            "string",
            "null"
          ],
          "minLength": 1,
          "maxLength": 512
        }
      }
    },
    "IntakeVocabularyWrite": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "operationId",
        "change",
        "id",
        "kind",
        "expectedDisplayVersion",
        "displayName",
        "meaningDigest"
      ],
      "properties": {
        "operationId": {
          "type": "string",
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        },
        "change": {
          "type": "string",
          "enum": [
            "create",
            "rename",
            "retire"
          ]
        },
        "id": {
          "type": "string",
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "minLength": 1,
          "maxLength": 128
        },
        "kind": {
          "type": "string",
          "enum": [
            "product",
            "scenario"
          ]
        },
        "expectedDisplayVersion": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "displayName": {
          "type": "string",
          "minLength": 1,
          "maxLength": 256
        },
        "meaningDigest": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$",
          "minLength": 64,
          "maxLength": 64
        }
      }
    },
    "IntentId": {
      "type": "string",
      "pattern": "^intent_[A-Za-z0-9][A-Za-z0-9._-]{0,126}$"
    },
    "IntentTaxonomyVersion": {
      "type": "string",
      "pattern": "^itax_[A-Za-z0-9][A-Za-z0-9._-]{0,126}$"
    },
    "InteractionReason": {
      "type": "string",
      "enum": [
        "original",
        "reselection"
      ]
    },
    "InternalErrorEnvelope": {
      "type": "object",
      "required": [
        "error"
      ],
      "properties": {
        "error": {
          "type": "object",
          "required": [
            "code",
            "message"
          ],
          "properties": {
            "code": {
              "allOf": [
                {
                  "$ref": "#/$defs/ErrorCode"
                },
                {
                  "const": "INTERNAL"
                }
              ]
            },
            "message": {
              "type": "string",
              "minLength": 1
            },
            "details": {
              "type": "object",
              "additionalProperties": true
            }
          }
        }
      }
    },
    "IterationTask": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "task_id",
        "signal_id",
        "cluster_key",
        "sample_query_ids",
        "suspected_cause",
        "suggested_script_ids",
        "status",
        "version",
        "created_at",
        "updated_at"
      ],
      "properties": {
        "task_id": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "signal_id": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "cluster_key": {
          "type": "string",
          "minLength": 1,
          "maxLength": 512
        },
        "sample_query_ids": {
          "type": "array",
          "maxItems": 50,
          "uniqueItems": true,
          "items": {
            "type": "string",
            "minLength": 1
          }
        },
        "suspected_cause": {
          "$ref": "#/$defs/IterationTaskCause"
        },
        "suggested_script_ids": {
          "type": "array",
          "maxItems": 50,
          "uniqueItems": true,
          "items": {
            "type": "string",
            "minLength": 1
          }
        },
        "status": {
          "$ref": "#/$defs/IterationTaskStatus"
        },
        "assignee_role": {
          "type": [
            "string",
            "null"
          ],
          "maxLength": 128
        },
        "resolution": {
          "type": [
            "string",
            "null"
          ],
          "enum": [
            "resolved",
            "wont_fix",
            null
          ]
        },
        "resolution_note": {
          "type": [
            "string",
            "null"
          ],
          "maxLength": 2000
        },
        "version": {
          "type": "integer",
          "minimum": 1
        },
        "created_at": {
          "type": "string",
          "format": "date-time"
        },
        "updated_at": {
          "type": "string",
          "format": "date-time"
        },
        "resolved_at": {
          "type": [
            "string",
            "null"
          ],
          "format": "date-time"
        }
      }
    },
    "IterationTaskCause": {
      "type": "string",
      "enum": [
        "content_gap",
        "ranking",
        "stale",
        "mixed"
      ]
    },
    "IterationTaskCloseRequest": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "expected_version",
        "status",
        "resolution_note"
      ],
      "properties": {
        "expected_version": {
          "type": "integer",
          "minimum": 1
        },
        "status": {
          "type": "string",
          "enum": [
            "resolved",
            "wont_fix"
          ]
        },
        "resolution_note": {
          "type": "string",
          "minLength": 1,
          "maxLength": 2000
        }
      }
    },
    "IterationTaskListResponse": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "items",
        "next_cursor"
      ],
      "properties": {
        "items": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/IterationTask"
          }
        },
        "next_cursor": {
          "type": [
            "string",
            "null"
          ]
        }
      }
    },
    "IterationTaskStartRequest": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "expected_version"
      ],
      "properties": {
        "expected_version": {
          "type": "integer",
          "minimum": 1
        }
      }
    },
    "IterationTaskStatus": {
      "type": "string",
      "enum": [
        "open",
        "in_progress",
        "resolved",
        "wont_fix"
      ]
    },
    "LoginCreate": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "client_challenge": {
          "type": "string",
          "pattern": "^[A-Za-z0-9_-]{43}$"
        },
        "challenge_method": {
          "const": "S256"
        }
      },
      "required": [
        "client_challenge",
        "challenge_method"
      ]
    },
    "LoginCreated": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "login_id": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "authorize_url": {
          "type": "string",
          "format": "uri",
          "maxLength": 2048
        },
        "expires_at": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "login_id",
        "authorize_url",
        "expires_at"
      ]
    },
    "LoginExchange": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "client_verifier": {
          "type": "string",
          "pattern": "^[A-Za-z0-9._~-]{43,128}$"
        }
      },
      "required": [
        "client_verifier"
      ]
    },
    "LoginPending": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "status": {
          "const": "pending"
        },
        "retry_after_seconds": {
          "const": 2
        }
      },
      "required": [
        "status",
        "retry_after_seconds"
      ]
    },
    "LoginSession": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "access_token": {
          "type": "string",
          "pattern": "^[A-Za-z0-9_-]{43}$"
        },
        "token_type": {
          "const": "Bearer"
        },
        "expires_at": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "access_token",
        "token_type",
        "expires_at"
      ]
    },
    "MetricCandidate": {
      "type": "object",
      "required": [
        "rank",
        "release_id",
        "script_id",
        "script_version",
        "content_hash",
        "source_version_id",
        "source_ref",
        "effective_from",
        "effective_to",
        "review_due_at"
      ],
      "properties": {
        "rank": {
          "type": "integer",
          "minimum": 1,
          "maximum": 3
        },
        "release_id": {
          "type": "string",
          "minLength": 1
        },
        "script_id": {
          "type": "string",
          "minLength": 1
        },
        "script_version": {
          "type": "integer",
          "minimum": 1
        },
        "content_hash": {
          "$ref": "#/$defs/ContentHash"
        },
        "source_ref": {
          "$ref": "#/$defs/SafeSourceRef"
        },
        "source_version_id": {
          "$ref": "#/$defs/AuthoritativeSourceVersionId"
        },
        "effective_from": {
          "type": [
            "string",
            "null"
          ],
          "format": "date-time"
        },
        "effective_to": {
          "type": [
            "string",
            "null"
          ],
          "format": "date-time"
        },
        "review_due_at": {
          "type": "string",
          "format": "date-time"
        }
      }
    },
    "MetricsStreamItem": {
      "type": "object",
      "required": [
        "query_id",
        "root_query_id",
        "parent_query_id",
        "interaction_reason",
        "user_id",
        "query_text_redacted",
        "text_storage_status",
        "platform",
        "platform_source",
        "hit_status",
        "outcome",
        "chosen_rank",
        "push_method",
        "release_id",
        "latency_ms",
        "created_at",
        "escalate_actions",
        "candidates"
      ],
      "properties": {
        "query_id": {
          "type": "string",
          "format": "uuid"
        },
        "root_query_id": {
          "type": "string",
          "format": "uuid"
        },
        "parent_query_id": {
          "type": [
            "string",
            "null"
          ],
          "format": "uuid"
        },
        "interaction_reason": {
          "$ref": "#/$defs/InteractionReason"
        },
        "user_id": {
          "type": "string",
          "minLength": 1
        },
        "query_text_redacted": {
          "type": [
            "string",
            "null"
          ]
        },
        "text_storage_status": {
          "type": "string",
          "enum": [
            "stored",
            "suppressed"
          ]
        },
        "platform": {
          "$ref": "#/$defs/Platform"
        },
        "platform_source": {
          "$ref": "#/$defs/PlatformSource"
        },
        "hit_status": {
          "$ref": "#/$defs/HitStatus"
        },
        "outcome": {
          "oneOf": [
            {
              "$ref": "#/$defs/AdoptionOutcome"
            },
            {
              "type": "null"
            }
          ]
        },
        "chosen_rank": {
          "type": [
            "integer",
            "null"
          ],
          "minimum": 1,
          "maximum": 3
        },
        "push_method": {
          "oneOf": [
            {
              "$ref": "#/$defs/PushMethod"
            },
            {
              "type": "null"
            }
          ]
        },
        "release_id": {
          "type": "string",
          "minLength": 1
        },
        "latency_ms": {
          "type": [
            "integer",
            "null"
          ],
          "minimum": 0
        },
        "created_at": {
          "type": "string",
          "format": "date-time"
        },
        "escalate_actions": {
          "type": "array",
          "maxItems": 3,
          "items": {
            "$ref": "#/$defs/EscalationFact"
          }
        },
        "candidates": {
          "type": "array",
          "maxItems": 3,
          "items": {
            "$ref": "#/$defs/MetricCandidate"
          }
        }
      }
    },
    "MetricsStreamResponse": {
      "type": "object",
      "required": [
        "items",
        "next_cursor"
      ],
      "properties": {
        "items": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/MetricsStreamItem"
          }
        },
        "next_cursor": {
          "type": [
            "string",
            "null"
          ]
        }
      }
    },
    "MockLoginRequest": {
      "allOf": [
        {
          "$ref": "#/$defs/UserClaims"
        }
      ]
    },
    "MockLoginResponse": {
      "type": "object",
      "required": [
        "token",
        "user"
      ],
      "properties": {
        "token": {
          "type": "string",
          "minLength": 1
        },
        "user": {
          "$ref": "#/$defs/UserClaims"
        }
      }
    },
    "MutablePolicyFlagKey": {
      "type": "string",
      "enum": [
        "autofill_adapter",
        "llm_ranker",
        "metrics_experimental_kpi"
      ]
    },
    "MutablePolicyFlagUpdateRequest": {
      "type": "object",
      "required": [
        "flag_key",
        "flag_value",
        "adr_id"
      ],
      "properties": {
        "flag_key": {
          "$ref": "#/$defs/MutablePolicyFlagKey"
        },
        "flag_value": {
          "type": "boolean"
        },
        "adr_id": {
          "type": [
            "string",
            "null"
          ],
          "pattern": "^ADR-[A-Za-z0-9._-]+$"
        }
      }
    },
    "NonAdoptedEventRequest": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "query_id",
        "outcome",
        "chosen_rank",
        "chosen_script_id",
        "push_method"
      ],
      "properties": {
        "query_id": {
          "type": "string",
          "format": "uuid"
        },
        "outcome": {
          "type": "string",
          "enum": [
            "dismissed",
            "no_hit_exit",
            "timeout"
          ]
        },
        "chosen_rank": {
          "type": "null"
        },
        "chosen_script_id": {
          "type": "null"
        },
        "push_method": {
          "$ref": "#/$defs/PushMethod"
        }
      }
    },
    "NotFoundErrorEnvelope": {
      "type": "object",
      "required": [
        "error"
      ],
      "properties": {
        "error": {
          "type": "object",
          "required": [
            "code",
            "message"
          ],
          "properties": {
            "code": {
              "allOf": [
                {
                  "$ref": "#/$defs/ErrorCode"
                },
                {
                  "const": "NOT_FOUND"
                }
              ]
            },
            "message": {
              "type": "string",
              "minLength": 1
            },
            "details": {
              "type": "object",
              "additionalProperties": true
            }
          }
        }
      }
    },
    "NotReadyResponse": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "status",
        "checks"
      ],
      "properties": {
        "status": {
          "const": "not_ready"
        },
        "checks": {
          "allOf": [
            {
              "$ref": "#/$defs/ReadyChecks"
            },
            {
              "anyOf": [
                {
                  "properties": {
                    "database": {
                      "const": "not_ready"
                    }
                  },
                  "required": [
                    "database"
                  ],
                  "type": "object"
                },
                {
                  "properties": {
                    "schema": {
                      "const": "not_ready"
                    }
                  },
                  "required": [
                    "schema"
                  ],
                  "type": "object"
                },
                {
                  "properties": {
                    "auth": {
                      "const": "not_ready"
                    }
                  },
                  "required": [
                    "auth"
                  ],
                  "type": "object"
                },
                {
                  "properties": {
                    "storage": {
                      "const": "not_ready"
                    }
                  },
                  "required": [
                    "storage"
                  ],
                  "type": "object"
                },
                {
                  "properties": {
                    "content": {
                      "const": "not_ready"
                    }
                  },
                  "required": [
                    "content"
                  ],
                  "type": "object"
                }
              ]
            }
          ]
        }
      }
    },
    "NoticeDecision": {
      "type": "string",
      "enum": [
        "accepted",
        "declined"
      ]
    },
    "NoticeDecisionRequest": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "decision"
      ],
      "properties": {
        "decision": {
          "$ref": "#/$defs/NoticeDecision"
        }
      }
    },
    "NoticeDecisionResponse": {
      "type": "object",
      "required": [
        "ok",
        "version",
        "decision",
        "decided_at"
      ],
      "properties": {
        "ok": {
          "const": true
        },
        "version": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "decision": {
          "$ref": "#/$defs/NoticeDecision"
        },
        "decided_at": {
          "type": "string",
          "format": "date-time"
        }
      }
    },
    "OfflineSnapshotLease": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "token",
        "expires_at",
        "release_id",
        "source_binding_hash"
      ],
      "properties": {
        "token": {
          "$ref": "#/$defs/OfflineSnapshotLeaseToken"
        },
        "expires_at": {
          "type": "string",
          "format": "date-time"
        },
        "release_id": {
          "type": "string",
          "minLength": 1
        },
        "source_binding_hash": {
          "$ref": "#/$defs/SourceBindingHash"
        }
      }
    },
    "OfflineSnapshotLeaseToken": {
      "type": "string",
      "pattern": "^osl_[0-9a-f]{64}$"
    },
    "OkResponse": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "ok"
      ],
      "properties": {
        "ok": {
          "const": true
        }
      }
    },
    "OverloadedErrorEnvelope": {
      "type": "object",
      "required": [
        "error"
      ],
      "properties": {
        "error": {
          "type": "object",
          "required": [
            "code",
            "message"
          ],
          "properties": {
            "code": {
              "allOf": [
                {
                  "$ref": "#/$defs/ErrorCode"
                },
                {
                  "const": "OVERLOADED"
                }
              ]
            },
            "message": {
              "type": "string",
              "minLength": 1
            },
            "details": {
              "type": "object",
              "properties": {
                "reason": {
                  "enum": [
                    "DB_POOL_EXHAUSTED",
                    "CONCURRENCY_LIMIT",
                    "RATE_LIMIT_STORAGE_UNAVAILABLE",
                    "STORAGE_UNAVAILABLE",
                    "SOURCE_GATE_NOT_READY"
                  ]
                }
              },
              "additionalProperties": true
            }
          }
        }
      }
    },
    "OwnerAcceptanceRecord": {
      "title": "G1a bounded owner acceptance metadata (not runtime authorization)",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "schema",
        "review_mode",
        "purpose",
        "owner_subject_hash",
        "approval_evidence_id",
        "accepted_at",
        "expires_at",
        "scope"
      ],
      "properties": {
        "schema": {
          "const": "customer-agent/owner-acceptance/v1"
        },
        "review_mode": {
          "const": "owner_acceptance"
        },
        "purpose": {
          "const": "g1a_offline_only"
        },
        "owner_subject_hash": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$"
        },
        "approval_evidence_id": {
          "type": "string",
          "pattern": "^EVD-[A-Z0-9-]{6,127}$"
        },
        "accepted_at": {
          "type": "string",
          "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$"
        },
        "expires_at": {
          "type": "string",
          "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$"
        },
        "scope": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "source_bindings",
            "items"
          ],
          "properties": {
            "source_bindings": {
              "type": "array",
              "minItems": 4,
              "maxItems": 4,
              "items": {
                "type": "object",
                "additionalProperties": false,
                "required": [
                  "domain",
                  "source_version_id",
                  "snapshot_sha256",
                  "review_due_at"
                ],
                "properties": {
                  "domain": {
                    "enum": [
                      "aftersale",
                      "campaign",
                      "presale",
                      "product"
                    ]
                  },
                  "source_version_id": {
                    "type": "string",
                    "pattern": "^srcv_[A-Za-z0-9][A-Za-z0-9._-]{7,126}$"
                  },
                  "snapshot_sha256": {
                    "type": "string",
                    "pattern": "^[0-9a-f]{64}$"
                  },
                  "review_due_at": {
                    "type": "string",
                    "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$"
                  }
                }
              }
            },
            "items": {
              "type": "array",
              "minItems": 1,
              "maxItems": 5000,
              "items": {
                "type": "object",
                "additionalProperties": false,
                "required": [
                  "script_id",
                  "script_version",
                  "domain",
                  "source_version_id",
                  "review_input_sha256",
                  "risk_level",
                  "risk_categories",
                  "has_conflict"
                ],
                "properties": {
                  "script_id": {
                    "type": "string",
                    "pattern": "^[a-z][a-z0-9_-]{7,127}$"
                  },
                  "script_version": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 2147483647
                  },
                  "domain": {
                    "enum": [
                      "aftersale",
                      "campaign",
                      "presale",
                      "product"
                    ]
                  },
                  "source_version_id": {
                    "type": "string",
                    "pattern": "^srcv_[A-Za-z0-9][A-Za-z0-9._-]{7,126}$"
                  },
                  "review_input_sha256": {
                    "type": "string",
                    "pattern": "^[0-9a-f]{64}$"
                  },
                  "risk_level": {
                    "enum": [
                      "low",
                      "medium",
                      "high"
                    ]
                  },
                  "risk_categories": {
                    "type": "array",
                    "maxItems": 7,
                    "uniqueItems": true,
                    "items": {
                      "enum": [
                        "refund_compensation",
                        "price_discount",
                        "campaign_rules",
                        "efficacy_safety_claim",
                        "account_privacy",
                        "complaint_escalation",
                        "legal_commitment"
                      ]
                    }
                  },
                  "has_conflict": {
                    "const": false
                  }
                }
              }
            }
          }
        }
      }
    },
    "Phase1HardOffPolicyFlagKey": {
      "type": "string",
      "enum": [
        "rewrite",
        "auto_send"
      ]
    },
    "PlaceholderKey": {
      "type": "string",
      "enum": [
        "order_id",
        "date"
      ]
    },
    "Platform": {
      "type": [
        "string",
        "null"
      ],
      "enum": [
        "qianniu",
        "douyin",
        "unknown",
        null
      ]
    },
    "PlatformScope": {
      "type": "array",
      "minItems": 1,
      "maxItems": 2,
      "uniqueItems": true,
      "items": {
        "type": "string",
        "enum": [
          "qianniu",
          "douyin"
        ]
      }
    },
    "PlatformSource": {
      "type": "string",
      "enum": [
        "manual",
        "foreground_process",
        "native_integration",
        "unknown"
      ]
    },
    "PolicyFlagKey": {
      "type": "string",
      "enum": [
        "rewrite",
        "auto_send",
        "autofill_adapter",
        "llm_ranker",
        "metrics_experimental_kpi"
      ]
    },
    "PolicyFlagUpdateRequest": {
      "oneOf": [
        {
          "$ref": "#/$defs/MutablePolicyFlagUpdateRequest"
        },
        {
          "$ref": "#/$defs/HardOffPolicyFlagUpdateRequest"
        }
      ]
    },
    "PolicyFlagUpdateResponse": {
      "type": "object",
      "required": [
        "ok",
        "flag_key",
        "flag_value"
      ],
      "properties": {
        "ok": {
          "const": true
        },
        "flag_key": {
          "$ref": "#/$defs/PolicyFlagKey"
        },
        "flag_value": {
          "type": "boolean"
        }
      }
    },
    "PolicyResponse": {
      "type": "object",
      "required": [
        "rewrite",
        "auto_send",
        "autofill_adapter",
        "llm_ranker",
        "metrics_experimental_kpi",
        "auth_mode"
      ],
      "properties": {
        "rewrite": {
          "const": false
        },
        "auto_send": {
          "const": false
        },
        "autofill_adapter": {
          "type": "boolean"
        },
        "llm_ranker": {
          "type": "boolean"
        },
        "metrics_experimental_kpi": {
          "type": "boolean"
        },
        "auth_mode": {
          "$ref": "#/$defs/AuthMode"
        }
      }
    },
    "PrivacyNotice": {
      "type": "object",
      "required": [
        "version",
        "content",
        "content_hash",
        "published_at"
      ],
      "properties": {
        "version": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "content": {
          "type": "string",
          "minLength": 1,
          "maxLength": 10000
        },
        "content_hash": {
          "$ref": "#/$defs/ContentHash"
        },
        "published_at": {
          "type": "string",
          "format": "date-time"
        }
      }
    },
    "ProductScopeRefs": {
      "type": "array",
      "uniqueItems": true,
      "maxItems": 1000,
      "items": {
        "type": "string",
        "minLength": 1,
        "maxLength": 128
      }
    },
    "ProductScopeType": {
      "type": "string",
      "enum": [
        "storewide",
        "category",
        "sku"
      ]
    },
    "PublicSnapshotQuestion": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "question_id",
        "question_version",
        "question_text",
        "question_hash",
        "semantic_family_id"
      ],
      "properties": {
        "question_id": {
          "type": "string",
          "pattern": "^q_[A-Za-z0-9][A-Za-z0-9_-]{7,126}$"
        },
        "question_version": {
          "type": "integer",
          "minimum": 1
        },
        "question_text": {
          "type": "string",
          "minLength": 1,
          "maxLength": 500
        },
        "question_hash": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$"
        },
        "semantic_family_id": {
          "type": "string",
          "pattern": "^sf_[A-Za-z0-9][A-Za-z0-9._-]{0,126}$"
        }
      }
    },
    "PublishRequest": {
      "type": "object",
      "required": [
        "import_batch_id",
        "title",
        "summary"
      ],
      "properties": {
        "import_batch_id": {
          "type": "string",
          "minLength": 1
        },
        "title": {
          "type": "string",
          "minLength": 1
        },
        "summary": {
          "type": [
            "string",
            "null"
          ]
        }
      }
    },
    "PublishResponse": {
      "type": "object",
      "required": [
        "release_id",
        "release_seq",
        "announcement_id",
        "source_binding_hash"
      ],
      "properties": {
        "release_id": {
          "type": "string",
          "minLength": 1
        },
        "release_seq": {
          "type": "integer",
          "minimum": 1
        },
        "announcement_id": {
          "type": "string",
          "minLength": 1
        },
        "source_binding_hash": {
          "$ref": "#/$defs/SourceBindingHash"
        }
      }
    },
    "PushMethod": {
      "type": [
        "string",
        "null"
      ],
      "enum": [
        "clipboard",
        "autofill",
        "failed",
        "pending",
        null
      ]
    },
    "QualityEvidence": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "review_revision": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$"
        },
        "phase": {
          "enum": [
            "initial",
            "expanded"
          ]
        },
        "checks": {
          "type": "array",
          "minItems": 1,
          "maxItems": 5000,
          "items": {
            "$ref": "#/$defs/QualityItem"
          },
          "x-unique-by": [
            "script_id",
            "content_hash"
          ]
        },
        "evidence_id": {
          "type": "string",
          "pattern": "^EVD-[A-Z0-9-]{6,127}$"
        }
      },
      "required": [
        "review_revision",
        "phase",
        "checks",
        "evidence_id"
      ]
    },
    "QualityItem": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "script_id": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "content_hash": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$"
        },
        "defect": {
          "type": "boolean"
        }
      },
      "required": [
        "script_id",
        "content_hash",
        "defect"
      ]
    },
    "QualityReceipt": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "receipt_id": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "batch_id": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "review_revision": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$"
        },
        "recorded_at": {
          "type": "string",
          "format": "date-time"
        },
        "quality_state": {
          "enum": [
            "passed",
            "blocked",
            "expansion_required",
            "revision_required"
          ]
        }
      },
      "required": [
        "receipt_id",
        "batch_id",
        "review_revision",
        "recorded_at",
        "quality_state"
      ]
    },
    "QuestionSource": {
      "type": "string",
      "enum": [
        "manual",
        "from_log",
        "import"
      ]
    },
    "Rate": {
      "type": "number",
      "format": "double",
      "minimum": 0,
      "maximum": 1
    },
    "RateLimitedErrorEnvelope": {
      "type": "object",
      "required": [
        "error"
      ],
      "properties": {
        "error": {
          "type": "object",
          "required": [
            "code",
            "message"
          ],
          "properties": {
            "code": {
              "allOf": [
                {
                  "$ref": "#/$defs/ErrorCode"
                },
                {
                  "const": "RATE_LIMITED"
                }
              ]
            },
            "message": {
              "type": "string",
              "minLength": 1
            },
            "details": {
              "type": "object",
              "additionalProperties": true
            }
          }
        }
      }
    },
    "ReadyCheckStatus": {
      "type": "string",
      "enum": [
        "ok",
        "not_ready"
      ]
    },
    "ReadyChecks": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "database",
        "schema",
        "auth",
        "storage",
        "content"
      ],
      "properties": {
        "database": {
          "$ref": "#/$defs/ReadyCheckStatus"
        },
        "schema": {
          "$ref": "#/$defs/ReadyCheckStatus"
        },
        "auth": {
          "$ref": "#/$defs/ReadyCheckStatus"
        },
        "storage": {
          "$ref": "#/$defs/ReadyCheckStatus"
        },
        "content": {
          "$ref": "#/$defs/ReadyCheckStatus"
        }
      }
    },
    "ReadyResponse": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "status",
        "checks"
      ],
      "properties": {
        "status": {
          "const": "ready"
        },
        "checks": {
          "allOf": [
            {
              "$ref": "#/$defs/ReadyChecks"
            },
            {
              "properties": {
                "database": {
                  "const": "ok"
                },
                "schema": {
                  "const": "ok"
                },
                "auth": {
                  "const": "ok"
                },
                "storage": {
                  "const": "ok"
                },
                "content": {
                  "const": "ok"
                }
              },
              "type": "object"
            }
          ]
        }
      }
    },
    "RetrievalMetrics": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "no_hit_rate",
        "copy_complete_rate",
        "open_task_count",
        "current_release_script_count",
        "window",
        "release_id"
      ],
      "properties": {
        "no_hit_rate": {
          "type": "number",
          "minimum": 0,
          "maximum": 1
        },
        "copy_complete_rate": {
          "type": "number",
          "minimum": 0,
          "maximum": 1
        },
        "open_task_count": {
          "type": "integer",
          "minimum": 0
        },
        "current_release_script_count": {
          "type": "integer",
          "minimum": 0
        },
        "window": {
          "$ref": "#/$defs/RetrievalWindow"
        },
        "release_id": {
          "type": [
            "string",
            "null"
          ],
          "minLength": 1,
          "maxLength": 128
        }
      }
    },
    "RetrievalWindow": {
      "type": "string",
      "enum": [
        "current_release",
        "last_7d"
      ]
    },
    "ReviewDecision": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "review_revision": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$"
        },
        "script_id": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "content_hash": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$"
        },
        "decision": {
          "enum": [
            "approved",
            "rejected"
          ]
        },
        "evidence_id": {
          "type": "string",
          "pattern": "^EVD-[A-Z0-9-]{6,127}$"
        }
      },
      "required": [
        "review_revision",
        "script_id",
        "content_hash",
        "decision",
        "evidence_id"
      ]
    },
    "ReviewList": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "items": {
          "type": "array",
          "maxItems": 100,
          "items": {
            "$ref": "#/$defs/ReviewSummary"
          }
        },
        "next_cursor": {
          "type": [
            "string",
            "null"
          ],
          "maxLength": 512
        }
      },
      "required": [
        "items",
        "next_cursor"
      ]
    },
    "ReviewMode": {
      "type": "string",
      "enum": [
        "single",
        "dual",
        "owner_acceptance"
      ]
    },
    "ReviewPage": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "batch_id",
        "review_revision",
        "items",
        "next_after",
        "total"
      ],
      "properties": {
        "batch_id": {
          "type": "string",
          "maxLength": 128,
          "minLength": 1
        },
        "review_revision": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$"
        },
        "items": {
          "type": "array",
          "maxItems": 100,
          "items": {
            "$ref": "#/$defs/ReviewPageItem"
          }
        },
        "next_after": {
          "type": [
            "integer",
            "null"
          ],
          "minimum": 0
        },
        "total": {
          "type": "integer",
          "minimum": 0,
          "maximum": 5000
        }
      }
    },
    "ReviewPageItem": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "script_id",
        "content_hash",
        "title",
        "answer_text",
        "category",
        "product_scope_type",
        "effective_from",
        "effective_to",
        "risk_level",
        "quality_status",
        "position",
        "operation",
        "has_conflict",
        "platform_scope",
        "product_scope_refs",
        "placeholder_keys",
        "risk_categories",
        "initial_sample",
        "expanded_sample",
        "source_version_id",
        "owner_role",
        "review_due_at",
        "intent_id",
        "intent_taxonomy_version",
        "questions"
      ],
      "properties": {
        "script_id": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "content_hash": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$"
        },
        "title": {
          "type": [
            "string",
            "null"
          ],
          "maxLength": 10000
        },
        "answer_text": {
          "type": [
            "string",
            "null"
          ],
          "maxLength": 10000
        },
        "category": {
          "type": [
            "string",
            "null"
          ],
          "maxLength": 10000
        },
        "product_scope_type": {
          "type": [
            "string",
            "null"
          ],
          "maxLength": 10000
        },
        "effective_from": {
          "type": [
            "string",
            "null"
          ],
          "maxLength": 10000
        },
        "effective_to": {
          "type": [
            "string",
            "null"
          ],
          "maxLength": 10000
        },
        "risk_level": {
          "type": [
            "string",
            "null"
          ],
          "maxLength": 10000
        },
        "quality_status": {
          "type": [
            "string",
            "null"
          ],
          "maxLength": 10000
        },
        "position": {
          "type": "integer",
          "minimum": 1
        },
        "operation": {
          "enum": [
            "upsert",
            "withdraw"
          ]
        },
        "has_conflict": {
          "type": [
            "boolean",
            "null"
          ]
        },
        "platform_scope": {
          "type": [
            "array",
            "null"
          ],
          "items": {
            "type": "string",
            "maxLength": 10000
          },
          "maxItems": 1000
        },
        "product_scope_refs": {
          "type": [
            "array",
            "null"
          ],
          "items": {
            "type": "string",
            "maxLength": 10000
          },
          "maxItems": 1000
        },
        "placeholder_keys": {
          "type": [
            "array",
            "null"
          ],
          "items": {
            "type": "string",
            "maxLength": 10000
          },
          "maxItems": 1000
        },
        "risk_categories": {
          "type": [
            "array",
            "null"
          ],
          "items": {
            "type": "string",
            "maxLength": 10000
          },
          "maxItems": 1000
        },
        "initial_sample": {
          "type": "boolean"
        },
        "expanded_sample": {
          "type": "boolean"
        },
        "source_version_id": {
          "type": [
            "string",
            "null"
          ],
          "maxLength": 128
        },
        "owner_role": {
          "type": [
            "string",
            "null"
          ],
          "maxLength": 128
        },
        "review_due_at": {
          "type": [
            "string",
            "null"
          ],
          "maxLength": 128
        },
        "intent_id": {
          "type": [
            "string",
            "null"
          ],
          "maxLength": 128
        },
        "intent_taxonomy_version": {
          "type": [
            "string",
            "null"
          ],
          "maxLength": 128
        },
        "questions": {
          "type": "array",
          "maxItems": 1000,
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "question_id",
              "question_version",
              "question_text",
              "question_hash",
              "semantic_family_id"
            ],
            "properties": {
              "question_id": {
                "type": [
                  "string",
                  "null"
                ],
                "maxLength": 500
              },
              "question_version": {
                "type": [
                  "integer",
                  "null"
                ]
              },
              "question_text": {
                "type": [
                  "string",
                  "null"
                ],
                "maxLength": 500
              },
              "question_hash": {
                "type": [
                  "string",
                  "null"
                ],
                "maxLength": 500
              },
              "semantic_family_id": {
                "type": [
                  "string",
                  "null"
                ],
                "maxLength": 500
              }
            }
          }
        }
      }
    },
    "ReviewReceipt": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "receipt_id": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "batch_id": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "review_revision": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$"
        },
        "recorded_at": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "receipt_id",
        "batch_id",
        "review_revision",
        "recorded_at"
      ]
    },
    "ReviewResume": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "review_revision"
      ],
      "properties": {
        "review_revision": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$"
        }
      }
    },
    "ReviewResumed": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "job_id"
      ],
      "properties": {
        "job_id": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        }
      }
    },
    "ReviewSummary": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "batch_id": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "review_revision": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$"
        },
        "state": {
          "enum": [
            "waiting",
            "resumed",
            "cancelled"
          ]
        },
        "candidate_count": {
          "type": "integer",
          "minimum": 0,
          "maximum": 5000
        }
      },
      "required": [
        "batch_id",
        "review_revision",
        "state",
        "candidate_count"
      ]
    },
    "RiskCategories": {
      "type": "array",
      "uniqueItems": true,
      "maxItems": 7,
      "items": {
        "$ref": "#/$defs/RiskCategory"
      }
    },
    "RiskCategory": {
      "type": "string",
      "enum": [
        "refund_compensation",
        "price_discount",
        "campaign_rules",
        "efficacy_safety_claim",
        "account_privacy",
        "complaint_escalation",
        "legal_commitment"
      ]
    },
    "RiskLevel": {
      "type": "string",
      "enum": [
        "low",
        "medium",
        "high"
      ]
    },
    "Role": {
      "type": "string",
      "enum": [
        "agent",
        "coach",
        "owner"
      ]
    },
    "RollbackRequest": {
      "type": "object",
      "required": [
        "target_release_id",
        "title",
        "summary"
      ],
      "properties": {
        "target_release_id": {
          "type": "string",
          "minLength": 1
        },
        "title": {
          "type": [
            "string",
            "null"
          ]
        },
        "summary": {
          "type": [
            "string",
            "null"
          ]
        }
      }
    },
    "RollbackResponse": {
      "allOf": [
        {
          "$ref": "#/$defs/PublishResponse"
        },
        {
          "type": "object",
          "required": [
            "rollback_of_release_id"
          ],
          "properties": {
            "rollback_of_release_id": {
              "type": "string",
              "minLength": 1
            }
          }
        }
      ]
    },
    "SafeSourceRef": {
      "type": "string",
      "pattern": "^SRC-[A-Z0-9][A-Z0-9._-]{0,126}$"
    },
    "ScriptCategory": {
      "type": "string",
      "enum": [
        "presale",
        "campaign",
        "aftersale",
        "product"
      ]
    },
    "ScriptDeleteRequest": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "expected_version"
      ],
      "properties": {
        "expected_version": {
          "type": "integer",
          "minimum": 1
        }
      }
    },
    "ScriptMutationResponse": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "ok",
        "script_id",
        "mutation_id",
        "review_status"
      ],
      "properties": {
        "ok": {
          "const": true
        },
        "script_id": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "mutation_id": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "review_status": {
          "const": "pending_review"
        }
      }
    },
    "ScriptPatchRequest": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "expected_version",
        "title",
        "answer_text",
        "effective_from"
      ],
      "properties": {
        "expected_version": {
          "type": "integer",
          "minimum": 1
        },
        "title": {
          "type": "string",
          "minLength": 1,
          "maxLength": 256
        },
        "answer_text": {
          "type": "string",
          "minLength": 1,
          "maxLength": 20000
        },
        "effective_from": {
          "type": "string",
          "format": "date-time"
        },
        "effective_to": {
          "type": [
            "string",
            "null"
          ],
          "format": "date-time"
        }
      }
    },
    "SearchCandidate": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "rank",
        "release_id",
        "script_id",
        "script_version",
        "content_hash",
        "title",
        "category",
        "answer_text",
        "platform_scope",
        "product_scope_type",
        "product_scope_refs",
        "effective_from",
        "effective_to",
        "intent_taxonomy_version",
        "intent_id",
        "risk_level",
        "risk_categories",
        "has_conflict",
        "placeholder_keys"
      ],
      "properties": {
        "rank": {
          "type": "integer",
          "minimum": 1,
          "maximum": 3
        },
        "release_id": {
          "type": "string",
          "minLength": 1
        },
        "script_id": {
          "type": "string",
          "minLength": 1
        },
        "script_version": {
          "type": "integer",
          "minimum": 1
        },
        "content_hash": {
          "$ref": "#/$defs/ContentHash"
        },
        "title": {
          "type": "string",
          "minLength": 1
        },
        "category": {
          "$ref": "#/$defs/ScriptCategory"
        },
        "answer_text": {
          "type": "string",
          "minLength": 1
        },
        "platform_scope": {
          "$ref": "#/$defs/PlatformScope"
        },
        "product_scope_type": {
          "$ref": "#/$defs/ProductScopeType"
        },
        "product_scope_refs": {
          "$ref": "#/$defs/ProductScopeRefs"
        },
        "effective_from": {
          "type": "string",
          "format": "date-time"
        },
        "effective_to": {
          "type": [
            "string",
            "null"
          ],
          "format": "date-time"
        },
        "intent_taxonomy_version": {
          "$ref": "#/$defs/IntentTaxonomyVersion"
        },
        "intent_id": {
          "$ref": "#/$defs/IntentId"
        },
        "risk_level": {
          "$ref": "#/$defs/RiskLevel"
        },
        "risk_categories": {
          "$ref": "#/$defs/RiskCategories"
        },
        "has_conflict": {
          "type": "boolean"
        },
        "placeholder_keys": {
          "type": "array",
          "uniqueItems": true,
          "maxItems": 2,
          "items": {
            "$ref": "#/$defs/PlaceholderKey"
          }
        }
      },
      "allOf": [
        {
          "oneOf": [
            {
              "properties": {
                "product_scope_type": {
                  "const": "storewide"
                },
                "product_scope_refs": {
                  "maxItems": 0
                }
              },
              "type": "object"
            },
            {
              "properties": {
                "product_scope_type": {
                  "enum": [
                    "category",
                    "sku"
                  ]
                },
                "product_scope_refs": {
                  "minItems": 1
                }
              },
              "type": "object"
            }
          ]
        },
        {
          "oneOf": [
            {
              "properties": {
                "risk_level": {
                  "enum": [
                    "low",
                    "medium"
                  ]
                },
                "risk_categories": {
                  "maxItems": 0
                }
              },
              "type": "object"
            },
            {
              "properties": {
                "risk_level": {
                  "const": "high"
                },
                "risk_categories": {
                  "minItems": 1
                }
              },
              "type": "object"
            }
          ]
        }
      ]
    },
    "SearchRequest": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "query_id",
        "parent_query_id",
        "interaction_reason",
        "query_text",
        "collection_mode",
        "detected_platform",
        "platform",
        "platform_source",
        "product_context_type",
        "product_context_ref",
        "top_k"
      ],
      "properties": {
        "query_id": {
          "type": "string",
          "format": "uuid"
        },
        "parent_query_id": {
          "type": [
            "string",
            "null"
          ],
          "format": "uuid"
        },
        "interaction_reason": {
          "$ref": "#/$defs/InteractionReason"
        },
        "query_text": {
          "type": "string",
          "minLength": 1,
          "maxLength": 500
        },
        "collection_mode": {
          "$ref": "#/$defs/CollectionMode"
        },
        "detected_platform": {
          "$ref": "#/$defs/Platform"
        },
        "platform": {
          "$ref": "#/$defs/Platform"
        },
        "platform_source": {
          "$ref": "#/$defs/PlatformSource"
        },
        "product_context_type": {
          "type": [
            "string",
            "null"
          ],
          "enum": [
            "category",
            "sku",
            null
          ]
        },
        "product_context_ref": {
          "type": [
            "string",
            "null"
          ],
          "minLength": 1,
          "maxLength": 128
        },
        "top_k": {
          "type": "integer",
          "minimum": 1,
          "maximum": 3,
          "default": 3
        }
      },
      "oneOf": [
        {
          "title": "original 根问题",
          "properties": {
            "interaction_reason": {
              "const": "original"
            },
            "parent_query_id": {
              "type": "null"
            }
          },
          "type": "object"
        },
        {
          "title": "reselection 后续操作",
          "properties": {
            "interaction_reason": {
              "const": "reselection"
            },
            "parent_query_id": {
              "type": "string",
              "format": "uuid"
            }
          },
          "type": "object"
        }
      ],
      "allOf": [
        {
          "oneOf": [
            {
              "title": "storewide 检索无商品上下文",
              "properties": {
                "product_context_type": {
                  "type": "null"
                },
                "product_context_ref": {
                  "type": "null"
                }
              },
              "type": "object"
            },
            {
              "title": "category 精确上下文",
              "properties": {
                "product_context_type": {
                  "const": "category"
                },
                "product_context_ref": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 128
                }
              },
              "type": "object"
            },
            {
              "title": "sku 精确上下文",
              "properties": {
                "product_context_type": {
                  "const": "sku"
                },
                "product_context_ref": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 128
                }
              },
              "type": "object"
            }
          ]
        }
      ]
    },
    "SearchResponse": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "query_id",
        "hit_status",
        "release_id",
        "source_binding_hash",
        "telemetry_status",
        "candidates"
      ],
      "properties": {
        "query_id": {
          "type": "string",
          "format": "uuid"
        },
        "hit_status": {
          "$ref": "#/$defs/HitStatus"
        },
        "release_id": {
          "type": "string",
          "minLength": 1
        },
        "source_binding_hash": {
          "$ref": "#/$defs/SourceBindingHash"
        },
        "telemetry_status": {
          "$ref": "#/$defs/TelemetryStatus"
        },
        "candidates": {
          "type": "array",
          "maxItems": 3,
          "items": {
            "$ref": "#/$defs/SearchCandidate"
          }
        }
      },
      "oneOf": [
        {
          "title": "hit 必须返回 1 至 3 条候选",
          "properties": {
            "hit_status": {
              "const": "hit"
            },
            "candidates": {
              "minItems": 1,
              "maxItems": 3
            }
          },
          "type": "object"
        },
        {
          "title": "no_hit 必须返回空候选",
          "properties": {
            "hit_status": {
              "const": "no_hit"
            },
            "candidates": {
              "maxItems": 0
            }
          },
          "type": "object"
        }
      ]
    },
    "SnapshotItem": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "script_id",
        "script_version",
        "content_hash",
        "title",
        "category",
        "answer_text",
        "platform_scope",
        "product_scope_type",
        "product_scope_refs",
        "effective_from",
        "effective_to",
        "intent_taxonomy_version",
        "intent_id",
        "risk_level",
        "risk_categories",
        "has_conflict",
        "placeholder_keys",
        "questions"
      ],
      "properties": {
        "script_id": {
          "type": "string",
          "minLength": 1
        },
        "script_version": {
          "type": "integer",
          "minimum": 1
        },
        "content_hash": {
          "$ref": "#/$defs/ContentHash"
        },
        "title": {
          "type": "string",
          "minLength": 1
        },
        "category": {
          "$ref": "#/$defs/ScriptCategory"
        },
        "answer_text": {
          "type": "string",
          "minLength": 1
        },
        "platform_scope": {
          "$ref": "#/$defs/PlatformScope"
        },
        "product_scope_type": {
          "$ref": "#/$defs/ProductScopeType"
        },
        "product_scope_refs": {
          "$ref": "#/$defs/ProductScopeRefs"
        },
        "effective_from": {
          "type": "string",
          "format": "date-time"
        },
        "effective_to": {
          "type": [
            "string",
            "null"
          ],
          "format": "date-time"
        },
        "intent_taxonomy_version": {
          "$ref": "#/$defs/IntentTaxonomyVersion"
        },
        "intent_id": {
          "$ref": "#/$defs/IntentId"
        },
        "risk_level": {
          "$ref": "#/$defs/RiskLevel"
        },
        "risk_categories": {
          "$ref": "#/$defs/RiskCategories"
        },
        "has_conflict": {
          "type": "boolean"
        },
        "placeholder_keys": {
          "type": "array",
          "uniqueItems": true,
          "maxItems": 2,
          "items": {
            "$ref": "#/$defs/PlaceholderKey"
          }
        },
        "questions": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/PublicSnapshotQuestion"
          }
        }
      },
      "allOf": [
        {
          "oneOf": [
            {
              "properties": {
                "product_scope_type": {
                  "const": "storewide"
                },
                "product_scope_refs": {
                  "maxItems": 0
                }
              },
              "type": "object"
            },
            {
              "properties": {
                "product_scope_type": {
                  "enum": [
                    "category",
                    "sku"
                  ]
                },
                "product_scope_refs": {
                  "minItems": 1
                }
              },
              "type": "object"
            }
          ]
        },
        {
          "oneOf": [
            {
              "properties": {
                "risk_level": {
                  "enum": [
                    "low",
                    "medium"
                  ]
                },
                "risk_categories": {
                  "maxItems": 0
                }
              },
              "type": "object"
            },
            {
              "properties": {
                "risk_level": {
                  "const": "high"
                },
                "risk_categories": {
                  "minItems": 1
                }
              },
              "type": "object"
            }
          ]
        }
      ]
    },
    "SnapshotResponse": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "release_id",
        "release_seq",
        "source_binding_hash",
        "offline_lease",
        "items",
        "next_cursor"
      ],
      "properties": {
        "release_id": {
          "type": "string",
          "minLength": 1
        },
        "release_seq": {
          "type": "integer",
          "minimum": 1
        },
        "source_binding_hash": {
          "$ref": "#/$defs/SourceBindingHash"
        },
        "offline_lease": {
          "$ref": "#/$defs/OfflineSnapshotLease"
        },
        "items": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/SnapshotItem"
          }
        },
        "next_cursor": {
          "type": [
            "string",
            "null"
          ]
        }
      }
    },
    "SoftwareRelease": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "version",
        "platform",
        "sha256",
        "download_url",
        "created_at",
        "signed"
      ],
      "properties": {
        "version": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64
        },
        "platform": {
          "type": "string",
          "enum": [
            "mac-universal",
            "win-x64",
            "linux-x64"
          ]
        },
        "sha256": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$"
        },
        "download_url": {
          "type": "string",
          "pattern": "^https://"
        },
        "created_at": {
          "type": "string",
          "format": "date-time"
        },
        "signed": {
          "type": "boolean"
        }
      }
    },
    "SoftwareReleaseList": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "items"
      ],
      "properties": {
        "items": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/SoftwareRelease"
          }
        }
      }
    },
    "SopCatalogResponse": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "product_session_id",
        "items"
      ],
      "properties": {
        "product_session_id": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "items": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/SopNode"
          }
        }
      }
    },
    "SopImportAccepted": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "ok",
        "product_session_id",
        "node_count"
      ],
      "properties": {
        "ok": {
          "const": true
        },
        "product_session_id": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "node_count": {
          "type": "integer",
          "minimum": 0
        }
      }
    },
    "SopImportRequest": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "file"
      ],
      "properties": {
        "file": {
          "type": "string",
          "format": "binary"
        }
      }
    },
    "SopNode": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "node_id",
        "parent_node_id",
        "title",
        "body",
        "sort_key",
        "version",
        "lifecycle"
      ],
      "properties": {
        "node_id": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "parent_node_id": {
          "type": [
            "string",
            "null"
          ],
          "maxLength": 128
        },
        "title": {
          "type": "string",
          "minLength": 1,
          "maxLength": 256
        },
        "body": {
          "type": "string",
          "minLength": 1,
          "maxLength": 20000
        },
        "sort_key": {
          "type": "integer"
        },
        "version": {
          "type": "integer",
          "minimum": 1
        },
        "lifecycle": {
          "type": "string",
          "enum": [
            "active",
            "deleted"
          ]
        }
      }
    },
    "SopNodeDelete": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "expected_version"
      ],
      "properties": {
        "expected_version": {
          "type": "integer",
          "minimum": 1
        }
      }
    },
    "SopNodePatch": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "expected_version"
      ],
      "properties": {
        "expected_version": {
          "type": "integer",
          "minimum": 1
        },
        "title": {
          "type": "string",
          "minLength": 1,
          "maxLength": 256
        },
        "body": {
          "type": "string",
          "minLength": 1,
          "maxLength": 20000
        },
        "sort_key": {
          "type": "integer"
        }
      }
    },
    "SourceBindingHash": {
      "type": "string",
      "pattern": "^[0-9a-f]{64}$"
    },
    "SourceContractReason": {
      "type": "string",
      "enum": [
        "SOURCE_NOT_REGISTERED",
        "SOURCE_NOT_ELIGIBLE",
        "SOURCE_SUSPENDED",
        "SOURCE_DOMAIN_MISMATCH",
        "SOURCE_SNAPSHOT_MISMATCH",
        "SOURCE_SET_INCOMPLETE",
        "SOURCE_BASE_RELEASE_STALE",
        "SOURCE_BINDING_HASH_MISMATCH",
        "SOURCE_GATE_NOT_READY",
        "SOURCE_HISTORY_IMMUTABLE",
        "OFFLINE_LEASE_INVALID",
        "OFFLINE_LEASE_EXPIRED",
        "OFFLINE_LEASE_BINDING_MISMATCH",
        "CONTENT_CONTRACT_INVALID",
        "GOVERNANCE_HASH_MISMATCH",
        "QUALITY_GATE_NOT_PASSED",
        "QUESTION_IDENTITY_CONFLICT",
        "PHASE1_HARD_OFF",
        "NATIVE_INTEGRATION_DISABLED"
      ]
    },
    "TelemetryStatus": {
      "type": "string",
      "enum": [
        "recorded",
        "collection_disabled"
      ]
    },
    "ToolMetricsResponse": {
      "type": "object",
      "required": [
        "root_question_count",
        "search_operation_count",
        "reselection_count",
        "root_adopted_count",
        "operation_adopted_count",
        "root_adoption_rate",
        "operation_adoption_rate",
        "operation_no_hit_count",
        "operation_no_hit_rate",
        "top1_copy_share",
        "root_escalated_count",
        "escalate_action_count",
        "root_escalation_rate",
        "p95_latency_ms"
      ],
      "properties": {
        "root_question_count": {
          "type": "integer",
          "minimum": 0
        },
        "search_operation_count": {
          "type": "integer",
          "minimum": 0
        },
        "reselection_count": {
          "type": "integer",
          "minimum": 0
        },
        "root_adopted_count": {
          "type": "integer",
          "minimum": 0
        },
        "operation_adopted_count": {
          "type": "integer",
          "minimum": 0
        },
        "root_adoption_rate": {
          "$ref": "#/$defs/Rate"
        },
        "operation_adoption_rate": {
          "$ref": "#/$defs/Rate"
        },
        "operation_no_hit_count": {
          "type": "integer",
          "minimum": 0
        },
        "operation_no_hit_rate": {
          "$ref": "#/$defs/Rate"
        },
        "top1_copy_share": {
          "$ref": "#/$defs/Rate"
        },
        "root_escalated_count": {
          "type": "integer",
          "minimum": 0
        },
        "escalate_action_count": {
          "type": "integer",
          "minimum": 0
        },
        "root_escalation_rate": {
          "$ref": "#/$defs/Rate"
        },
        "p95_latency_ms": {
          "type": [
            "integer",
            "null"
          ],
          "minimum": 0
        }
      }
    },
    "UnauthorizedErrorEnvelope": {
      "type": "object",
      "required": [
        "error"
      ],
      "properties": {
        "error": {
          "type": "object",
          "required": [
            "code",
            "message"
          ],
          "properties": {
            "code": {
              "allOf": [
                {
                  "$ref": "#/$defs/ErrorCode"
                },
                {
                  "const": "UNAUTHORIZED"
                }
              ]
            },
            "message": {
              "type": "string",
              "minLength": 1
            },
            "details": {
              "type": "object",
              "additionalProperties": true
            }
          }
        }
      }
    },
    "UserClaims": {
      "type": "object",
      "required": [
        "user_id",
        "role"
      ],
      "properties": {
        "user_id": {
          "type": "string",
          "minLength": 1
        },
        "role": {
          "$ref": "#/$defs/Role"
        }
      }
    },
    "ValidationErrorEnvelope": {
      "type": "object",
      "required": [
        "error"
      ],
      "properties": {
        "error": {
          "type": "object",
          "required": [
            "code",
            "message"
          ],
          "properties": {
            "code": {
              "allOf": [
                {
                  "$ref": "#/$defs/ErrorCode"
                },
                {
                  "const": "VALIDATION"
                }
              ]
            },
            "message": {
              "type": "string",
              "minLength": 1
            },
            "details": {
              "type": "object",
              "additionalProperties": true
            }
          }
        }
      }
    },
    "WorkOrderAnalysisResponse": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "scope",
        "totals",
        "by_category",
        "by_issue_type",
        "by_error_type",
        "handling_time",
        "trend",
        "refreshed_at"
      ],
      "properties": {
        "scope": {
          "$ref": "#/$defs/WorkOrderAnalysisScope"
        },
        "totals": {
          "$ref": "#/$defs/WorkOrderAnalysisTotals"
        },
        "by_category": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/WorkOrderDimensionBucket"
          }
        },
        "by_issue_type": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/WorkOrderDimensionBucket"
          }
        },
        "by_error_type": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/WorkOrderDimensionBucket"
          }
        },
        "handling_time": {
          "$ref": "#/$defs/WorkOrderHandlingTime"
        },
        "trend": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/WorkOrderTrendPoint"
          }
        },
        "refreshed_at": {
          "type": "string",
          "format": "date-time"
        }
      }
    },
    "WorkOrderAnalysisScope": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "from",
        "to"
      ],
      "properties": {
        "from": {
          "type": "string",
          "format": "date-time"
        },
        "to": {
          "type": "string",
          "format": "date-time"
        },
        "import_batch_id": {
          "type": [
            "string",
            "null"
          ]
        },
        "channel": {
          "type": [
            "string",
            "null"
          ]
        },
        "category": {
          "type": [
            "string",
            "null"
          ]
        },
        "issue_type": {
          "type": [
            "string",
            "null"
          ]
        },
        "status": {
          "type": [
            "string",
            "null"
          ]
        },
        "error_type": {
          "type": [
            "string",
            "null"
          ]
        },
        "escalated": {
          "type": [
            "boolean",
            "null"
          ]
        }
      }
    },
    "WorkOrderAnalysisTotals": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "record_count",
        "escalated_count",
        "error_count"
      ],
      "properties": {
        "record_count": {
          "type": "integer",
          "minimum": 0
        },
        "escalated_count": {
          "type": "integer",
          "minimum": 0
        },
        "error_count": {
          "type": "integer",
          "minimum": 0
        }
      }
    },
    "WorkOrderDimensionBucket": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "key",
        "count"
      ],
      "properties": {
        "key": {
          "type": [
            "string",
            "null"
          ]
        },
        "count": {
          "type": "integer",
          "minimum": 0
        }
      }
    },
    "WorkOrderHandlingTime": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "sample_count",
        "median_seconds",
        "p90_seconds"
      ],
      "properties": {
        "sample_count": {
          "type": "integer",
          "minimum": 0
        },
        "median_seconds": {
          "type": [
            "number",
            "null"
          ],
          "minimum": 0
        },
        "p90_seconds": {
          "type": [
            "number",
            "null"
          ],
          "minimum": 0
        }
      }
    },
    "WorkOrderImportAcceptedResponse": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "import_batch_id",
        "status"
      ],
      "properties": {
        "import_batch_id": {
          "type": "string",
          "minLength": 1
        },
        "status": {
          "const": "validating"
        }
      }
    },
    "WorkOrderImportFailureReport": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "code",
        "diagnostic_id"
      ],
      "properties": {
        "code": {
          "type": "string",
          "enum": [
            "VALIDATION_FAILED",
            "SOURCE_UNREADABLE",
            "HASH_MISMATCH",
            "UNSUPPORTED_FORMAT",
            "STORAGE_UNAVAILABLE",
            "MAX_ATTEMPTS_EXHAUSTED"
          ]
        },
        "diagnostic_id": {
          "type": "string",
          "pattern": "^diag_[0-9a-f]{32}$"
        },
        "row": {
          "type": "integer",
          "minimum": 1
        },
        "column": {
          "type": "integer",
          "minimum": 1
        },
        "error_count": {
          "type": "integer",
          "minimum": 1
        },
        "issue_codes": {
          "type": "array",
          "maxItems": 13,
          "uniqueItems": true,
          "items": {
            "$ref": "#/$defs/WorkOrderImportIssueCode"
          }
        }
      }
    },
    "WorkOrderImportIssueCode": {
      "type": "string",
      "enum": [
        "MISSING_REQUIRED_FIELD",
        "INVALID_FIELD_TYPE",
        "INVALID_VALUE",
        "DUPLICATE_SOURCE_RECORD",
        "UNKNOWN_COLUMN",
        "SENSITIVE_COLUMN",
        "INVALID_DATE",
        "INVALID_DURATION",
        "HASH_MISMATCH",
        "UNSUPPORTED_FORMAT",
        "FORMULA_DETECTED",
        "ROW_LIMIT_EXCEEDED",
        "FILE_TOO_LARGE"
      ]
    },
    "WorkOrderImportRequest": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "file",
        "source_system",
        "mapping_version"
      ],
      "properties": {
        "file": {
          "type": "string",
          "format": "binary"
        },
        "source_system": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "mapping_version": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "data_from": {
          "type": "string",
          "format": "date-time"
        },
        "data_to": {
          "type": "string",
          "format": "date-time"
        }
      }
    },
    "WorkOrderImportStatus": {
      "type": "string",
      "enum": [
        "received",
        "validating",
        "ready",
        "failed"
      ]
    },
    "WorkOrderImportStatusResponse": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "import_batch_id",
        "status",
        "source_system",
        "mapping_version",
        "record_count",
        "accepted_count",
        "rejected_count",
        "error_report",
        "created_at"
      ],
      "properties": {
        "import_batch_id": {
          "type": "string",
          "minLength": 1
        },
        "status": {
          "$ref": "#/$defs/WorkOrderImportStatus"
        },
        "source_system": {
          "type": "string",
          "minLength": 1
        },
        "mapping_version": {
          "type": "string",
          "minLength": 1
        },
        "record_count": {
          "type": "integer",
          "minimum": 0
        },
        "accepted_count": {
          "type": "integer",
          "minimum": 0
        },
        "rejected_count": {
          "type": "integer",
          "minimum": 0
        },
        "data_from": {
          "type": [
            "string",
            "null"
          ],
          "format": "date-time"
        },
        "data_to": {
          "type": [
            "string",
            "null"
          ],
          "format": "date-time"
        },
        "error_report": {
          "oneOf": [
            {
              "$ref": "#/$defs/WorkOrderImportFailureReport"
            },
            {
              "type": "null"
            }
          ]
        },
        "created_at": {
          "type": "string",
          "format": "date-time"
        },
        "completed_at": {
          "type": [
            "string",
            "null"
          ],
          "format": "date-time"
        }
      }
    },
    "WorkOrderRecord": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "record_id",
        "import_batch_id",
        "source_record_hash",
        "escalated",
        "quality_tags",
        "normalization_version",
        "created_at"
      ],
      "properties": {
        "record_id": {
          "type": "string",
          "minLength": 1
        },
        "import_batch_id": {
          "type": "string",
          "minLength": 1
        },
        "source_record_hash": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$"
        },
        "category": {
          "type": [
            "string",
            "null"
          ]
        },
        "issue_type": {
          "type": [
            "string",
            "null"
          ]
        },
        "product_ref_hash": {
          "type": [
            "string",
            "null"
          ],
          "pattern": "^[0-9a-f]{64}$"
        },
        "channel": {
          "type": [
            "string",
            "null"
          ]
        },
        "status": {
          "type": [
            "string",
            "null"
          ]
        },
        "opened_at": {
          "type": [
            "string",
            "null"
          ],
          "format": "date-time"
        },
        "closed_at": {
          "type": [
            "string",
            "null"
          ],
          "format": "date-time"
        },
        "handling_seconds": {
          "type": [
            "integer",
            "null"
          ],
          "minimum": 0
        },
        "error_type": {
          "type": [
            "string",
            "null"
          ]
        },
        "escalated": {
          "type": "boolean"
        },
        "quality_tags": {
          "type": "array",
          "uniqueItems": true,
          "items": {
            "type": "string"
          }
        },
        "normalization_version": {
          "type": "string",
          "minLength": 1
        },
        "created_at": {
          "type": "string",
          "format": "date-time"
        }
      }
    },
    "WorkOrderRecordListResponse": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "items",
        "next_cursor",
        "scope"
      ],
      "properties": {
        "items": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/WorkOrderRecord"
          }
        },
        "next_cursor": {
          "type": [
            "string",
            "null"
          ]
        },
        "scope": {
          "$ref": "#/$defs/WorkOrderAnalysisScope"
        }
      }
    },
    "WorkOrderTrendPoint": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "bucket_start",
        "count"
      ],
      "properties": {
        "bucket_start": {
          "type": "string",
          "format": "date-time"
        },
        "count": {
          "type": "integer",
          "minimum": 0
        }
      }
    }
  }
};
