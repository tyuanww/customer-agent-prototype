/* GENERATED FILE. DO NOT EDIT. Run `pnpm contracts:generate` from the repository root. */

export const OPENAPI_RUNTIME_SCHEMA_ID = "urn:customer-agent:openapi:1.11.0:components";
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
  "QuestionSource",
  "Rate",
  "RateLimitedErrorEnvelope",
  "ReadyCheckStatus",
  "ReadyChecks",
  "ReadyResponse",
  "ReviewMode",
  "RiskCategories",
  "RiskCategory",
  "RiskLevel",
  "Role",
  "RollbackRequest",
  "RollbackResponse",
  "SafeSourceRef",
  "ScriptCategory",
  "SearchCandidate",
  "SearchRequest",
  "SearchResponse",
  "SnapshotItem",
  "SnapshotResponse",
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
  "$id": "urn:customer-agent:openapi:1.11.0:components",
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
    "ReviewMode": {
      "type": "string",
      "enum": [
        "single",
        "dual"
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
