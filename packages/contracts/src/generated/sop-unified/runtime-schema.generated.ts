/* GENERATED FILE. DO NOT EDIT. Run `pnpm contracts:generate` from the repository root. */

export const OPENAPI_RUNTIME_SCHEMA_ID = "urn:customer-agent:openapi:1.29.1:sop-unified";
export const COMPONENT_SCHEMA_NAMES = [
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
  "IntakeSopActionCheck",
  "IntakeSopApplicability",
  "IntakeSopAudience",
  "IntakeSopCandidateMediaBinding",
  "IntakeSopCandidateMediaPayload",
  "IntakeSopContinuationClose",
  "IntakeSopContinuationId",
  "IntakeSopContinuationReceipt",
  "IntakeSopContinuationRenew",
  "IntakeSopEdge",
  "IntakeSopEntryRef",
  "IntakeSopErrorReason",
  "IntakeSopFlowCheck",
  "IntakeSopFlowDefinition",
  "IntakeSopFlowDifference",
  "IntakeSopFlowHeader",
  "IntakeSopFlowKey",
  "IntakeSopHash",
  "IntakeSopId",
  "IntakeSopKnowledge",
  "IntakeSopMaterialDelta",
  "IntakeSopMedia",
  "IntakeSopMediaPayload",
  "IntakeSopNode",
  "IntakeSopPublishedFlow",
  "IntakeSopQualityDelta",
  "IntakeSopRequirement",
  "IntakeSopSnapshotDelta",
  "IntakeSopSopQualityCheckSummary",
  "IntakeSopSopQualityPlan",
  "IntakeSopSopQualitySample",
  "IntakeSopSopQualityTarget",
  "IntakeSopSourceScope",
  "IntakeSopTaskScript",
  "IntakeSopTerms",
  "IntakeSopTotals",
  "IntakeSopVersion",
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
  "MenokinSopQuerySopBlockedResponse",
  "MenokinSopQuerySopEmptyResult",
  "MenokinSopQuerySopEntryPermission",
  "MenokinSopQuerySopErrorEnvelope",
  "MenokinSopQuerySopNoMatchResponse",
  "MenokinSopQuerySopQueryRequest",
  "MenokinSopQuerySopQueryResponse",
  "MenokinSopQuerySopReadyResponse",
  "MenokinSopQuerySopReadyResult",
  "MenokinSopQuerySopReason",
  "MenokinSopQuerySopStaleResponse",
  "SopCandidateMaterial",
  "SopCandidateRow",
  "SopMediaObject",
  "SopPreview",
  "SopPublishCommand",
  "SopPublishReceipt",
  "SopRollbackCommand",
  "SopRollbackReceipt",
  "SopUploadReceipt"
] as const;
export type GeneratedComponentSchemaName = (typeof COMPONENT_SCHEMA_NAMES)[number];
export const OPENAPI_RUNTIME_SCHEMA_DOCUMENT: Readonly<Record<string, unknown>> =
  {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "urn:customer-agent:openapi:1.29.1:sop-unified",
  "$defs": {
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
        },
        "sopFlows": {
          "type": "array",
          "minItems": 0,
          "maxItems": 100,
          "items": {
            "$ref": "#/$defs/IntakeSopFlowDefinition"
          }
        },
        "sopDifferences": {
          "type": "array",
          "minItems": 0,
          "maxItems": 100,
          "items": {
            "$ref": "#/$defs/IntakeSopFlowDifference"
          }
        }
      },
      "allOf": [
        {
          "if": {
            "required": [
              "materialHeader"
            ],
            "properties": {
              "materialHeader": {
                "required": [
                  "templateVersion"
                ],
                "properties": {
                  "templateVersion": {
                    "const": "sop-manual-authoring-v1.1"
                  }
                },
                "type": "object"
              }
            },
            "type": "object"
          },
          "then": {
            "required": [
              "sopFlows",
              "sopDifferences"
            ],
            "properties": {
              "sopFlows": {},
              "sopDifferences": {}
            },
            "type": "object"
          },
          "else": {
            "properties": {
              "sopFlows": {
                "maxItems": 0
              },
              "sopDifferences": {
                "maxItems": 0
              }
            },
            "type": "object"
          }
        }
      ]
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
            "$ref": "#/$defs/IntakeSopSourceScope"
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
                "SHOP_DIRECTORY_UNAVAILABLE",
                "SOURCE_FORMAT_MISMATCH",
                "SOP_MAPPING_REQUIRED",
                "SOP_GRAPH_INVALID",
                "SOP_DEPENDENCY_INVALID",
                "SOP_RELEASE_CHANGED",
                "SOP_SNAPSHOT_INVALID",
                "CONTRACT_UPGRADE_REQUIRED",
                "SOP_MEDIA_UNAVAILABLE"
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
          "enum": [
            "candidate-p1.1",
            "candidate-sop-graph-v1",
            "candidate-sop-task-graph-v2"
          ]
        },
        "scope": {
          "$ref": "#/$defs/IntakeSopSourceScope"
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
          "minItems": 0,
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
          "minItems": 0,
          "maxItems": 500,
          "items": {
            "$ref": "#/$defs/IntakeSopMedia"
          }
        },
        "sopFlows": {
          "type": "array",
          "minItems": 1,
          "maxItems": 100,
          "items": {
            "$ref": "#/$defs/IntakeSopFlowDefinition"
          }
        },
        "sopDifferences": {
          "type": "array",
          "minItems": 0,
          "maxItems": 100,
          "items": {
            "$ref": "#/$defs/IntakeSopFlowDifference"
          }
        },
        "mappingDigest": {
          "$ref": "#/$defs/IntakeSopHash"
        }
      },
      "oneOf": [
        {
          "required": [
            "templateVersion",
            "ruleVersion",
            "selectedSheets"
          ],
          "properties": {
            "templateVersion": {
              "const": "faq-p1.1"
            },
            "ruleVersion": {
              "const": "intake-p1.1"
            },
            "object": {
              "type": "object",
              "properties": {
                "mime": {
                  "const": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                }
              }
            },
            "selectedSheets": {
              "const": [
                "来源",
                "FAQ",
                "相似问法"
              ]
            },
            "canonicalEncodingVersion": {
              "const": "candidate-p1.1"
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
            },
            "sopFlows": {
              "maxItems": 0
            },
            "sopDifferences": {
              "maxItems": 0
            },
            "scope": {
              "$ref": "#/$defs/IntakeSourceScope"
            },
            "entries": {
              "minItems": 1
            }
          },
          "not": {
            "properties": {
              "mappingDigest": {}
            },
            "required": [
              "mappingDigest"
            ],
            "type": "object"
          },
          "type": "object"
        },
        {
          "required": [
            "templateVersion",
            "ruleVersion",
            "selectedSheets"
          ],
          "properties": {
            "templateVersion": {
              "const": "faq-csv-v1"
            },
            "ruleVersion": {
              "const": "intake-csv-v1"
            },
            "mappingVersion": {
              "const": "faq-csv-columns-v1"
            },
            "object": {
              "type": "object",
              "properties": {
                "mime": {
                  "const": "text/csv"
                }
              }
            },
            "selectedSheets": {
              "const": [
                "CSV"
              ]
            },
            "canonicalEncodingVersion": {
              "const": "candidate-p1.1"
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
            },
            "sopFlows": {
              "maxItems": 0
            },
            "sopDifferences": {
              "maxItems": 0
            },
            "scope": {
              "$ref": "#/$defs/IntakeSourceScope"
            },
            "entries": {
              "minItems": 1
            }
          },
          "not": {
            "properties": {
              "mappingDigest": {}
            },
            "required": [
              "mappingDigest"
            ],
            "type": "object"
          },
          "type": "object"
        },
        {
          "required": [
            "canonicalEncodingVersion",
            "templateVersion",
            "ruleVersion",
            "mappingVersion",
            "selectedSheets",
            "sopFlows",
            "sopDifferences",
            "media",
            "mappingDigest"
          ],
          "properties": {
            "canonicalEncodingVersion": {
              "const": "candidate-sop-task-graph-v2"
            },
            "templateVersion": {
              "const": "sop-manual-authoring-v1.1"
            },
            "ruleVersion": {
              "const": "sop-task-graph-v2"
            },
            "mappingVersion": {
              "const": "sop-manual-to-task-graph-v2"
            },
            "selectedSheets": {
              "const": [
                "场景目录",
                "执行任务",
                "判断分支",
                "客户话术",
                "知识与案例",
                "资源与图片"
              ]
            },
            "sopFlows": {
              "type": "array",
              "minItems": 1,
              "maxItems": 100,
              "items": {
                "$ref": "#/$defs/IntakeSopFlowDefinition"
              }
            },
            "sopDifferences": {
              "type": "array",
              "minItems": 0,
              "maxItems": 100,
              "items": {
                "$ref": "#/$defs/IntakeSopFlowDifference"
              }
            },
            "media": {
              "type": "array",
              "minItems": 0,
              "maxItems": 500,
              "items": {
                "$ref": "#/$defs/IntakeSopMedia"
              }
            },
            "mappingDigest": {
              "$ref": "#/$defs/IntakeSopHash"
            },
            "object": {
              "type": "object",
              "properties": {
                "mime": {
                  "const": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                }
              }
            },
            "entries": {
              "minItems": 0
            }
          },
          "type": "object"
        }
      ]
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
          "enum": [
            "candidate-p1.1",
            "candidate-sop-graph-v1",
            "candidate-sop-task-graph-v2"
          ]
        },
        "scope": {
          "$ref": "#/$defs/IntakeSopSourceScope"
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
          "minItems": 0,
          "maxItems": 500,
          "items": {
            "$ref": "#/$defs/IntakeSopMedia"
          }
        },
        "mappingDigest": {
          "$ref": "#/$defs/IntakeSopHash"
        }
      },
      "oneOf": [
        {
          "required": [
            "templateVersion",
            "ruleVersion",
            "selectedSheets"
          ],
          "properties": {
            "templateVersion": {
              "const": "faq-p1.1"
            },
            "ruleVersion": {
              "const": "intake-p1.1"
            },
            "object": {
              "type": "object",
              "properties": {
                "mime": {
                  "const": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                }
              }
            },
            "selectedSheets": {
              "const": [
                "来源",
                "FAQ",
                "相似问法"
              ]
            },
            "canonicalEncodingVersion": {
              "const": "candidate-p1.1"
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
            },
            "scope": {
              "$ref": "#/$defs/IntakeSourceScope"
            }
          },
          "not": {
            "properties": {
              "mappingDigest": {}
            },
            "required": [
              "mappingDigest"
            ],
            "type": "object"
          },
          "type": "object"
        },
        {
          "required": [
            "templateVersion",
            "ruleVersion",
            "selectedSheets"
          ],
          "properties": {
            "templateVersion": {
              "const": "faq-csv-v1"
            },
            "ruleVersion": {
              "const": "intake-csv-v1"
            },
            "mappingVersion": {
              "const": "faq-csv-columns-v1"
            },
            "object": {
              "type": "object",
              "properties": {
                "mime": {
                  "const": "text/csv"
                }
              }
            },
            "selectedSheets": {
              "const": [
                "CSV"
              ]
            },
            "canonicalEncodingVersion": {
              "const": "candidate-p1.1"
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
            },
            "scope": {
              "$ref": "#/$defs/IntakeSourceScope"
            }
          },
          "not": {
            "properties": {
              "mappingDigest": {}
            },
            "required": [
              "mappingDigest"
            ],
            "type": "object"
          },
          "type": "object"
        },
        {
          "required": [
            "canonicalEncodingVersion",
            "templateVersion",
            "ruleVersion",
            "mappingVersion",
            "selectedSheets",
            "media",
            "mappingDigest"
          ],
          "properties": {
            "canonicalEncodingVersion": {
              "const": "candidate-sop-task-graph-v2"
            },
            "templateVersion": {
              "const": "sop-manual-authoring-v1.1"
            },
            "ruleVersion": {
              "const": "sop-task-graph-v2"
            },
            "mappingVersion": {
              "const": "sop-manual-to-task-graph-v2"
            },
            "selectedSheets": {
              "const": [
                "场景目录",
                "执行任务",
                "判断分支",
                "客户话术",
                "知识与案例",
                "资源与图片"
              ]
            },
            "media": {
              "type": "array",
              "minItems": 0,
              "maxItems": 500,
              "items": {
                "$ref": "#/$defs/IntakeSopMedia"
              }
            },
            "mappingDigest": {
              "$ref": "#/$defs/IntakeSopHash"
            },
            "object": {
              "type": "object",
              "properties": {
                "mime": {
                  "const": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                }
              }
            }
          },
          "type": "object"
        }
      ]
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
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "text/csv"
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
        "selectedMediaSupported",
        "inputFormats"
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
          "const": true
        },
        "inputFormats": {
          "type": "array",
          "minItems": 3,
          "maxItems": 3,
          "prefixItems": [
            {
              "const": {
                "mime": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "templateVersion": "faq-p1.1",
                "ruleVersion": "intake-p1.1",
                "selectedSheets": [
                  "来源",
                  "FAQ",
                  "相似问法"
                ]
              }
            },
            {
              "const": {
                "mime": "text/csv",
                "templateVersion": "faq-csv-v1",
                "ruleVersion": "intake-csv-v1",
                "mappingVersion": "faq-csv-columns-v1",
                "structureDigest": "daaa4126d63194f59949c2b6f464b108ed87a430090e4dfe36e255663ab59165",
                "selectedSheets": [
                  "CSV"
                ]
              }
            },
            {
              "const": {
                "mime": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "templateVersion": "sop-manual-authoring-v1.1",
                "ruleVersion": "sop-task-graph-v2",
                "mappingVersion": "sop-manual-to-task-graph-v2",
                "selectedSheets": [
                  "场景目录",
                  "执行任务",
                  "判断分支",
                  "客户话术",
                  "知识与案例",
                  "资源与图片"
                ],
                "selectedMediaSupported": true
              }
            }
          ],
          "items": false
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
        },
        "sopPlan": {
          "$ref": "#/$defs/IntakeSopSopQualityPlan"
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
        "phase",
        "canonicalEncodingVersion"
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
        },
        "sopPlan": {
          "$ref": "#/$defs/IntakeSopSopQualityPlan"
        },
        "canonicalEncodingVersion": {
          "enum": [
            "candidate-p1.1",
            "candidate-sop-task-graph-v2"
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
        },
        {
          "if": {
            "required": [
              "canonicalEncodingVersion"
            ],
            "properties": {
              "canonicalEncodingVersion": {
                "const": "candidate-sop-task-graph-v2"
              }
            },
            "type": "object"
          },
          "then": {
            "properties": {
              "sopPlan": {}
            },
            "required": [
              "sopPlan"
            ],
            "type": "object"
          },
          "else": {
            "not": {
              "properties": {
                "sopPlan": {}
              },
              "required": [
                "sopPlan"
              ],
              "type": "object"
            }
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
        },
        "sopChecksSummary": {
          "$ref": "#/$defs/IntakeSopSopQualityCheckSummary"
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
        "nextCursor",
        "canonicalEncodingVersion"
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
        },
        "canonicalEncodingVersion": {
          "enum": [
            "candidate-p1.1",
            "candidate-sop-task-graph-v2"
          ]
        },
        "sopItems": {
          "type": "array",
          "minItems": 0,
          "maxItems": 100,
          "items": {
            "$ref": "#/$defs/IntakeSopSopQualitySample"
          }
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
        "anyOf": [
          {
            "properties": {
              "items": {
                "minItems": 1
              }
            },
            "type": "object"
          },
          {
            "required": [
              "sopItems"
            ],
            "properties": {
              "sopItems": {
                "minItems": 1
              }
            },
            "type": "object"
          }
        ]
      },
      "allOf": [
        {
          "if": {
            "required": [
              "canonicalEncodingVersion"
            ],
            "properties": {
              "canonicalEncodingVersion": {
                "const": "candidate-sop-task-graph-v2"
              }
            },
            "type": "object"
          },
          "then": {
            "properties": {
              "sopItems": {}
            },
            "required": [
              "sopItems"
            ],
            "type": "object"
          },
          "else": {
            "properties": {
              "sopItems": {
                "maxItems": 0
              }
            },
            "type": "object"
          }
        }
      ]
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
        "rounds",
        "canonicalEncodingVersion"
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
        },
        "canonicalEncodingVersion": {
          "enum": [
            "candidate-p1.1",
            "candidate-sop-task-graph-v2"
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
        },
        {
          "if": {
            "required": [
              "canonicalEncodingVersion"
            ],
            "properties": {
              "canonicalEncodingVersion": {
                "const": "candidate-sop-task-graph-v2"
              }
            },
            "type": "object"
          },
          "then": {
            "properties": {
              "plan": {
                "properties": {
                  "sopPlan": {}
                },
                "required": [
                  "sopPlan"
                ],
                "type": "object"
              },
              "rounds": {
                "items": {
                  "properties": {
                    "sopChecksSummary": {}
                  },
                  "required": [
                    "sopChecksSummary"
                  ],
                  "type": "object"
                }
              }
            },
            "type": "object"
          },
          "else": {
            "properties": {
              "plan": {
                "not": {
                  "properties": {
                    "sopPlan": {}
                  },
                  "required": [
                    "sopPlan"
                  ],
                  "type": "object"
                }
              },
              "rounds": {
                "items": {
                  "not": {
                    "properties": {
                      "sopChecksSummary": {}
                    },
                    "required": [
                      "sopChecksSummary"
                    ],
                    "type": "object"
                  }
                }
              }
            },
            "type": "object"
          }
        },
        {
          "if": {
            "required": [
              "canonicalEncodingVersion",
              "state"
            ],
            "properties": {
              "canonicalEncodingVersion": {
                "const": "candidate-sop-task-graph-v2"
              },
              "state": {
                "const": "passed"
              }
            },
            "type": "object"
          },
          "then": {
            "properties": {
              "rounds": {
                "items": {
                  "properties": {
                    "sopChecksSummary": {
                      "properties": {
                        "defectCount": {
                          "const": 0
                        }
                      },
                      "type": "object"
                    }
                  },
                  "type": "object"
                }
              }
            },
            "type": "object"
          }
        },
        {
          "if": {
            "required": [
              "canonicalEncodingVersion",
              "state",
              "plan"
            ],
            "properties": {
              "canonicalEncodingVersion": {
                "const": "candidate-sop-task-graph-v2"
              },
              "state": {
                "const": "passed"
              },
              "plan": {
                "required": [
                  "sopPlan"
                ],
                "properties": {
                  "sopPlan": {
                    "properties": {
                      "targetCount": {
                        "minimum": 1
                      }
                    },
                    "type": "object"
                  }
                },
                "type": "object"
              }
            },
            "type": "object"
          },
          "then": {
            "properties": {
              "rounds": {
                "contains": {
                  "required": [
                    "sopChecksSummary"
                  ],
                  "properties": {
                    "sopChecksSummary": {
                      "properties": {
                        "checkedCount": {
                          "minimum": 1
                        }
                      },
                      "type": "object"
                    }
                  },
                  "type": "object"
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
        },
        "materialDigest": {
          "$ref": "#/$defs/IntakeSopHash"
        },
        "sopChecks": {
          "type": "array",
          "minItems": 0,
          "maxItems": 100,
          "items": {
            "$ref": "#/$defs/IntakeSopFlowCheck"
          }
        }
      },
      "dependentRequired": {
        "materialDigest": [
          "sopChecks"
        ],
        "sopChecks": [
          "materialDigest"
        ]
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
            "$ref": "#/$defs/IntakeSopSourceScope"
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
            "product",
            "sop"
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
        "nextCursor",
        "snapshotDigest",
        "pageIndex",
        "pageCount",
        "totals",
        "sopFlows"
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
          "minItems": 0,
          "maxItems": 100,
          "items": {
            "$ref": "#/$defs/IntakeSopNode"
          }
        },
        "sopEdges": {
          "type": "array",
          "minItems": 0,
          "maxItems": 100,
          "items": {
            "$ref": "#/$defs/IntakeSopEdge"
          }
        },
        "media": {
          "type": "array",
          "minItems": 0,
          "maxItems": 100,
          "items": {
            "$ref": "#/$defs/IntakeSopMedia"
          }
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
        },
        "snapshotDigest": {
          "$ref": "#/$defs/IntakeSopHash"
        },
        "pageIndex": {
          "type": "integer",
          "minimum": 0,
          "maximum": 1023
        },
        "pageCount": {
          "type": "integer",
          "minimum": 1,
          "maximum": 1024
        },
        "totals": {
          "$ref": "#/$defs/IntakeSopTotals"
        },
        "sopFlows": {
          "type": "array",
          "minItems": 0,
          "maxItems": 100,
          "items": {
            "$ref": "#/$defs/IntakeSopPublishedFlow"
          }
        }
      }
    },
    "IntakeSopActionCheck": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "entitlementId",
        "releaseId",
        "contextGeneration",
        "key",
        "graphDigest",
        "nodeId",
        "action",
        "edgeId",
        "entry",
        "continuationId"
      ],
      "properties": {
        "entitlementId": {
          "$ref": "#/$defs/IntakeSopId"
        },
        "releaseId": {
          "$ref": "#/$defs/IntakeSopId"
        },
        "contextGeneration": {
          "$ref": "#/$defs/IntakeSopVersion"
        },
        "key": {
          "$ref": "#/$defs/IntakeSopFlowKey"
        },
        "graphDigest": {
          "$ref": "#/$defs/IntakeSopHash"
        },
        "nodeId": {
          "$ref": "#/$defs/IntakeSopId"
        },
        "action": {
          "enum": [
            "open",
            "observe",
            "next",
            "choose",
            "back",
            "copy"
          ]
        },
        "edgeId": {
          "anyOf": [
            {
              "$ref": "#/$defs/IntakeSopId"
            },
            {
              "type": "null"
            }
          ]
        },
        "entry": {
          "anyOf": [
            {
              "$ref": "#/$defs/IntakeSopEntryRef"
            },
            {
              "type": "null"
            }
          ]
        },
        "continuationId": {
          "$ref": "#/$defs/IntakeSopContinuationId"
        }
      },
      "if": {
        "properties": {
          "action": {
            "enum": [
              "next",
              "choose"
            ]
          }
        },
        "required": [
          "action"
        ],
        "type": "object"
      },
      "then": {
        "properties": {
          "edgeId": {
            "$ref": "#/$defs/IntakeSopId"
          }
        },
        "type": "object"
      },
      "else": {
        "properties": {
          "edgeId": {
            "type": "null"
          }
        },
        "type": "object"
      },
      "allOf": [
        {
          "if": {
            "properties": {
              "action": {
                "const": "copy"
              }
            },
            "type": "object"
          },
          "then": {
            "properties": {
              "entry": {
                "$ref": "#/$defs/IntakeSopEntryRef"
              }
            },
            "type": "object"
          },
          "else": {
            "properties": {
              "entry": {
                "type": "null"
              }
            },
            "type": "object"
          }
        }
      ]
    },
    "IntakeSopApplicability": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "productRefs",
        "scenarioRefs"
      ],
      "properties": {
        "productRefs": {
          "type": "array",
          "minItems": 0,
          "maxItems": 100,
          "items": {
            "$ref": "#/$defs/IntakeTermRef"
          }
        },
        "scenarioRefs": {
          "type": "array",
          "minItems": 0,
          "maxItems": 100,
          "items": {
            "$ref": "#/$defs/IntakeTermRef"
          }
        }
      }
    },
    "IntakeSopAudience": {
      "enum": [
        "agent",
        "coach"
      ]
    },
    "IntakeSopCandidateMediaBinding": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "sourceId",
        "flowId",
        "flowVersion",
        "ownerKind",
        "ownerId",
        "resourceId",
        "objectId"
      ],
      "properties": {
        "sourceId": {
          "$ref": "#/$defs/IntakeSopId"
        },
        "flowId": {
          "$ref": "#/$defs/IntakeSopId"
        },
        "flowVersion": {
          "$ref": "#/$defs/IntakeSopVersion"
        },
        "ownerKind": {
          "enum": [
            "entry",
            "task",
            "knowledge"
          ]
        },
        "ownerId": {
          "$ref": "#/$defs/IntakeSopId"
        },
        "scriptVersion": {
          "$ref": "#/$defs/IntakeSopVersion"
        },
        "resourceId": {
          "$ref": "#/$defs/IntakeSopId"
        },
        "objectId": {
          "$ref": "#/$defs/IntakeSopId"
        }
      },
      "if": {
        "required": [
          "ownerKind"
        ],
        "properties": {
          "ownerKind": {
            "const": "entry"
          }
        },
        "type": "object"
      },
      "then": {
        "properties": {
          "scriptVersion": {}
        },
        "required": [
          "scriptVersion"
        ],
        "type": "object"
      },
      "else": {
        "not": {
          "properties": {
            "scriptVersion": {}
          },
          "required": [
            "scriptVersion"
          ],
          "type": "object"
        }
      }
    },
    "IntakeSopCandidateMediaPayload": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "sha256",
        "mime",
        "bytes",
        "base64",
        "key",
        "binding"
      ],
      "properties": {
        "sha256": {
          "$ref": "#/$defs/IntakeSopHash"
        },
        "mime": {
          "enum": [
            "image/png",
            "image/jpeg",
            "image/gif"
          ]
        },
        "bytes": {
          "type": "integer",
          "minimum": 1,
          "maximum": 5242880
        },
        "base64": {
          "type": "string",
          "minLength": 4,
          "maxLength": 6990508,
          "pattern": "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$"
        },
        "key": {
          "$ref": "#/$defs/IntakeCandidateKey"
        },
        "binding": {
          "$ref": "#/$defs/IntakeSopCandidateMediaBinding"
        }
      }
    },
    "IntakeSopContinuationClose": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "continuationId"
      ],
      "properties": {
        "continuationId": {
          "$ref": "#/$defs/IntakeSopContinuationId"
        }
      }
    },
    "IntakeSopContinuationId": {
      "type": "string",
      "pattern": "^sct_[0-9a-f]{64}$",
      "minLength": 68,
      "maxLength": 68
    },
    "IntakeSopContinuationReceipt": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "continuationId",
        "entitlement"
      ],
      "properties": {
        "continuationId": {
          "$ref": "#/$defs/IntakeSopContinuationId"
        },
        "entitlement": {
          "$ref": "#/$defs/IntakeEntitlement"
        }
      }
    },
    "IntakeSopContinuationRenew": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "continuationId",
        "contextGeneration"
      ],
      "properties": {
        "continuationId": {
          "$ref": "#/$defs/IntakeSopContinuationId"
        },
        "contextGeneration": {
          "$ref": "#/$defs/IntakeSopVersion"
        }
      }
    },
    "IntakeSopEdge": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "key",
        "id",
        "from",
        "to",
        "action"
      ],
      "properties": {
        "key": {
          "$ref": "#/$defs/IntakeSopFlowKey"
        },
        "id": {
          "$ref": "#/$defs/IntakeSopId"
        },
        "from": {
          "$ref": "#/$defs/IntakeSopId"
        },
        "to": {
          "$ref": "#/$defs/IntakeSopId"
        },
        "action": {
          "oneOf": [
            {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "kind"
              ],
              "properties": {
                "kind": {
                  "const": "next"
                }
              }
            },
            {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "kind",
                "label",
                "ordinal",
                "matchTerms",
                "criterion",
                "unableToDetermine"
              ],
              "properties": {
                "kind": {
                  "const": "choice"
                },
                "label": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 512,
                  "pattern": "\\S"
                },
                "ordinal": {
                  "type": "integer",
                  "minimum": 1,
                  "maximum": 4
                },
                "matchTerms": {
                  "$ref": "#/$defs/IntakeSopTerms"
                },
                "criterion": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 2048,
                  "pattern": "\\S"
                },
                "unableToDetermine": {
                  "type": "boolean"
                }
              }
            }
          ]
        }
      }
    },
    "IntakeSopEntryRef": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "sourceId",
        "businessEntryId",
        "scriptVersion"
      ],
      "properties": {
        "sourceId": {
          "$ref": "#/$defs/IntakeSopId"
        },
        "businessEntryId": {
          "$ref": "#/$defs/IntakeSopId"
        },
        "scriptVersion": {
          "$ref": "#/$defs/IntakeSopVersion"
        }
      }
    },
    "IntakeSopErrorReason": {
      "enum": [
        "SOP_MAPPING_REQUIRED",
        "SOP_GRAPH_INVALID",
        "SOP_DEPENDENCY_INVALID",
        "SOP_RELEASE_CHANGED",
        "SOP_SNAPSHOT_INVALID",
        "CONTRACT_UPGRADE_REQUIRED",
        "SOP_MEDIA_UNAVAILABLE"
      ]
    },
    "IntakeSopFlowCheck": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "key",
        "graphDigest",
        "defect",
        "reason"
      ],
      "properties": {
        "key": {
          "$ref": "#/$defs/IntakeSopFlowKey"
        },
        "graphDigest": {
          "$ref": "#/$defs/IntakeSopHash"
        },
        "defect": {
          "type": "boolean"
        },
        "reason": {
          "type": "string",
          "maxLength": 2000
        }
      },
      "if": {
        "properties": {
          "defect": {
            "const": true
          }
        },
        "required": [
          "defect"
        ],
        "type": "object"
      },
      "then": {
        "properties": {
          "reason": {
            "type": "string",
            "minLength": 1,
            "pattern": "\\S"
          }
        },
        "type": "object"
      }
    },
    "IntakeSopFlowDefinition": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "header",
        "nodes",
        "edges"
      ],
      "properties": {
        "header": {
          "$ref": "#/$defs/IntakeSopFlowHeader"
        },
        "nodes": {
          "type": "array",
          "minItems": 1,
          "maxItems": 128,
          "items": {
            "$ref": "#/$defs/IntakeSopNode"
          }
        },
        "edges": {
          "type": "array",
          "minItems": 0,
          "maxItems": 512,
          "items": {
            "$ref": "#/$defs/IntakeSopEdge"
          }
        }
      },
      "allOf": [
        {
          "if": {
            "properties": {
              "header": {
                "properties": {
                  "audience": {
                    "const": "agent"
                  }
                },
                "required": [
                  "audience"
                ],
                "type": "object"
              }
            },
            "type": "object"
          },
          "then": {
            "properties": {
              "nodes": {
                "items": {
                  "properties": {
                    "body": {
                      "properties": {
                        "audience": {
                          "const": "agent"
                        },
                        "knowledge": {
                          "items": {
                            "properties": {
                              "audience": {
                                "const": "agent"
                              }
                            },
                            "type": "object"
                          }
                        }
                      },
                      "type": "object"
                    }
                  },
                  "type": "object"
                }
              }
            },
            "type": "object"
          }
        }
      ]
    },
    "IntakeSopFlowDifference": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "sourceId",
        "flowId",
        "change",
        "previousVersion",
        "nextVersion",
        "beforeDigest",
        "afterDigest"
      ],
      "properties": {
        "sourceId": {
          "$ref": "#/$defs/IntakeSopId"
        },
        "flowId": {
          "$ref": "#/$defs/IntakeSopId"
        },
        "change": {
          "enum": [
            "add",
            "modify",
            "disable",
            "reenable"
          ]
        },
        "previousVersion": {
          "anyOf": [
            {
              "$ref": "#/$defs/IntakeSopVersion"
            },
            {
              "type": "null"
            }
          ]
        },
        "nextVersion": {
          "$ref": "#/$defs/IntakeSopVersion"
        },
        "beforeDigest": {
          "anyOf": [
            {
              "$ref": "#/$defs/IntakeSopHash"
            },
            {
              "type": "null"
            }
          ]
        },
        "afterDigest": {
          "$ref": "#/$defs/IntakeSopHash"
        }
      }
    },
    "IntakeSopFlowHeader": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "key",
        "title",
        "anchorEntry",
        "entryTerms",
        "applicability",
        "startNodeId",
        "operation",
        "audience",
        "effectiveFrom",
        "effectiveTo"
      ],
      "properties": {
        "key": {
          "$ref": "#/$defs/IntakeSopFlowKey"
        },
        "title": {
          "type": "string",
          "minLength": 1,
          "maxLength": 512,
          "pattern": "\\S"
        },
        "anchorEntry": {
          "anyOf": [
            {
              "$ref": "#/$defs/IntakeSopEntryRef"
            },
            {
              "type": "null"
            }
          ]
        },
        "entryTerms": {
          "type": "array",
          "allOf": [
            {
              "$ref": "#/$defs/IntakeSopTerms"
            }
          ],
          "minItems": 1
        },
        "applicability": {
          "$ref": "#/$defs/IntakeSopApplicability"
        },
        "startNodeId": {
          "$ref": "#/$defs/IntakeSopId"
        },
        "operation": {
          "enum": [
            "upsert",
            "disable"
          ]
        },
        "audience": {
          "$ref": "#/$defs/IntakeSopAudience"
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
        }
      }
    },
    "IntakeSopFlowKey": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "sourceId",
        "flowId",
        "flowVersion"
      ],
      "properties": {
        "sourceId": {
          "$ref": "#/$defs/IntakeSopId"
        },
        "flowId": {
          "$ref": "#/$defs/IntakeSopId"
        },
        "flowVersion": {
          "$ref": "#/$defs/IntakeSopVersion"
        }
      }
    },
    "IntakeSopHash": {
      "type": "string",
      "pattern": "^[0-9a-f]{64}$"
    },
    "IntakeSopId": {
      "type": "string",
      "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"
    },
    "IntakeSopKnowledge": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "id",
        "title",
        "body",
        "audience"
      ],
      "properties": {
        "id": {
          "$ref": "#/$defs/IntakeSopId"
        },
        "title": {
          "type": "string",
          "minLength": 1,
          "maxLength": 512,
          "pattern": "\\S"
        },
        "body": {
          "type": "string",
          "minLength": 1,
          "maxLength": 8192,
          "pattern": "\\S"
        },
        "audience": {
          "$ref": "#/$defs/IntakeSopAudience"
        },
        "resourceBinding": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "resourceId",
            "ownerKind",
            "ownerId"
          ],
          "properties": {
            "resourceId": {
              "$ref": "#/$defs/IntakeSopId"
            },
            "ownerKind": {
              "enum": [
                "task",
                "knowledge"
              ]
            },
            "ownerId": {
              "$ref": "#/$defs/IntakeSopId"
            }
          }
        }
      }
    },
    "IntakeSopMaterialDelta": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "canonicalEncodingVersion",
        "templateVersion",
        "ruleVersion",
        "mappingVersion",
        "selectedSheets",
        "sopFlows",
        "sopDifferences",
        "media",
        "mappingDigest"
      ],
      "properties": {
        "canonicalEncodingVersion": {
          "const": "candidate-sop-task-graph-v2"
        },
        "templateVersion": {
          "const": "sop-manual-authoring-v1.1"
        },
        "ruleVersion": {
          "const": "sop-task-graph-v2"
        },
        "mappingVersion": {
          "const": "sop-manual-to-task-graph-v2"
        },
        "selectedSheets": {
          "const": [
            "场景目录",
            "执行任务",
            "判断分支",
            "客户话术",
            "知识与案例",
            "资源与图片"
          ]
        },
        "sopFlows": {
          "type": "array",
          "minItems": 1,
          "maxItems": 100,
          "items": {
            "$ref": "#/$defs/IntakeSopFlowDefinition"
          }
        },
        "sopDifferences": {
          "type": "array",
          "minItems": 0,
          "maxItems": 100,
          "items": {
            "$ref": "#/$defs/IntakeSopFlowDifference"
          }
        },
        "media": {
          "type": "array",
          "minItems": 0,
          "maxItems": 500,
          "items": {
            "$ref": "#/$defs/IntakeSopMedia"
          }
        },
        "mappingDigest": {
          "$ref": "#/$defs/IntakeSopHash"
        }
      }
    },
    "IntakeSopMedia": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "objectId",
        "sha256",
        "mime",
        "bytes",
        "ordinal",
        "alt",
        "required",
        "flowKey",
        "resourceId",
        "audience",
        "applicability"
      ],
      "properties": {
        "entry": {
          "$ref": "#/$defs/IntakeSopEntryRef"
        },
        "objectId": {
          "$ref": "#/$defs/IntakeSopId"
        },
        "sha256": {
          "$ref": "#/$defs/IntakeSopHash"
        },
        "mime": {
          "enum": [
            "image/png",
            "image/jpeg",
            "image/gif"
          ]
        },
        "bytes": {
          "type": "integer",
          "minimum": 1,
          "maximum": 5242880
        },
        "ordinal": {
          "type": "integer",
          "minimum": 1,
          "maximum": 100
        },
        "alt": {
          "type": "string",
          "minLength": 1,
          "maxLength": 1024,
          "pattern": "\\S"
        },
        "required": {
          "type": "boolean"
        },
        "flowKey": {
          "$ref": "#/$defs/IntakeSopFlowKey"
        },
        "resourceId": {
          "$ref": "#/$defs/IntakeSopId"
        },
        "graphTarget": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "kind",
            "id"
          ],
          "properties": {
            "kind": {
              "enum": [
                "task",
                "knowledge"
              ]
            },
            "id": {
              "$ref": "#/$defs/IntakeSopId"
            }
          }
        },
        "audience": {
          "enum": [
            "agent",
            "coach",
            "customer"
          ]
        },
        "applicability": {
          "$ref": "#/$defs/IntakeSopApplicability"
        }
      },
      "oneOf": [
        {
          "required": [
            "entry"
          ],
          "not": {
            "required": [
              "graphTarget"
            ],
            "properties": {
              "graphTarget": {}
            },
            "type": "object"
          },
          "properties": {
            "audience": {
              "const": "customer"
            }
          },
          "type": "object"
        },
        {
          "required": [
            "graphTarget"
          ],
          "not": {
            "required": [
              "entry"
            ],
            "properties": {
              "entry": {}
            },
            "type": "object"
          },
          "properties": {
            "audience": {
              "enum": [
                "agent",
                "coach"
              ]
            }
          },
          "type": "object"
        }
      ]
    },
    "IntakeSopMediaPayload": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "releaseId",
        "entitlementId",
        "objectId",
        "sha256",
        "mime",
        "bytes",
        "base64"
      ],
      "properties": {
        "releaseId": {
          "$ref": "#/$defs/IntakeSopId"
        },
        "entitlementId": {
          "$ref": "#/$defs/IntakeSopId"
        },
        "objectId": {
          "$ref": "#/$defs/IntakeSopId"
        },
        "sha256": {
          "$ref": "#/$defs/IntakeSopHash"
        },
        "mime": {
          "enum": [
            "image/png",
            "image/jpeg",
            "image/gif"
          ]
        },
        "bytes": {
          "type": "integer",
          "minimum": 1,
          "maximum": 5242880
        },
        "base64": {
          "type": "string",
          "minLength": 4,
          "maxLength": 6990508,
          "pattern": "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$"
        }
      }
    },
    "IntakeSopNode": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "key",
        "id",
        "body"
      ],
      "properties": {
        "key": {
          "$ref": "#/$defs/IntakeSopFlowKey"
        },
        "id": {
          "$ref": "#/$defs/IntakeSopId"
        },
        "body": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "kind",
            "title",
            "stageLabel",
            "instruction",
            "audience",
            "requirements",
            "knowledge",
            "scripts"
          ],
          "properties": {
            "kind": {
              "enum": [
                "action",
                "decision",
                "terminal"
              ]
            },
            "title": {
              "type": "string",
              "minLength": 1,
              "maxLength": 512,
              "pattern": "\\S"
            },
            "stageLabel": {
              "type": "string",
              "minLength": 1,
              "maxLength": 512,
              "pattern": "\\S"
            },
            "instruction": {
              "type": "string",
              "minLength": 1,
              "maxLength": 4096,
              "pattern": "\\S"
            },
            "audience": {
              "$ref": "#/$defs/IntakeSopAudience"
            },
            "requirements": {
              "type": "array",
              "minItems": 0,
              "maxItems": 32,
              "items": {
                "$ref": "#/$defs/IntakeSopRequirement"
              },
              "allOf": [
                {
                  "contains": {
                    "required": [
                      "ordinal"
                    ],
                    "properties": {
                      "ordinal": {
                        "const": 1
                      }
                    },
                    "type": "object"
                  },
                  "minContains": 0,
                  "maxContains": 1
                },
                {
                  "contains": {
                    "required": [
                      "ordinal"
                    ],
                    "properties": {
                      "ordinal": {
                        "const": 2
                      }
                    },
                    "type": "object"
                  },
                  "minContains": 0,
                  "maxContains": 1,
                  "if": {
                    "contains": {
                      "required": [
                        "ordinal"
                      ],
                      "properties": {
                        "ordinal": {
                          "const": 2
                        }
                      },
                      "type": "object"
                    }
                  },
                  "then": {
                    "contains": {
                      "required": [
                        "ordinal"
                      ],
                      "properties": {
                        "ordinal": {
                          "const": 1
                        }
                      },
                      "type": "object"
                    }
                  }
                },
                {
                  "contains": {
                    "required": [
                      "ordinal"
                    ],
                    "properties": {
                      "ordinal": {
                        "const": 3
                      }
                    },
                    "type": "object"
                  },
                  "minContains": 0,
                  "maxContains": 1,
                  "if": {
                    "contains": {
                      "required": [
                        "ordinal"
                      ],
                      "properties": {
                        "ordinal": {
                          "const": 3
                        }
                      },
                      "type": "object"
                    }
                  },
                  "then": {
                    "contains": {
                      "required": [
                        "ordinal"
                      ],
                      "properties": {
                        "ordinal": {
                          "const": 2
                        }
                      },
                      "type": "object"
                    }
                  }
                },
                {
                  "contains": {
                    "required": [
                      "ordinal"
                    ],
                    "properties": {
                      "ordinal": {
                        "const": 4
                      }
                    },
                    "type": "object"
                  },
                  "minContains": 0,
                  "maxContains": 1,
                  "if": {
                    "contains": {
                      "required": [
                        "ordinal"
                      ],
                      "properties": {
                        "ordinal": {
                          "const": 4
                        }
                      },
                      "type": "object"
                    }
                  },
                  "then": {
                    "contains": {
                      "required": [
                        "ordinal"
                      ],
                      "properties": {
                        "ordinal": {
                          "const": 3
                        }
                      },
                      "type": "object"
                    }
                  }
                },
                {
                  "contains": {
                    "required": [
                      "ordinal"
                    ],
                    "properties": {
                      "ordinal": {
                        "const": 5
                      }
                    },
                    "type": "object"
                  },
                  "minContains": 0,
                  "maxContains": 1,
                  "if": {
                    "contains": {
                      "required": [
                        "ordinal"
                      ],
                      "properties": {
                        "ordinal": {
                          "const": 5
                        }
                      },
                      "type": "object"
                    }
                  },
                  "then": {
                    "contains": {
                      "required": [
                        "ordinal"
                      ],
                      "properties": {
                        "ordinal": {
                          "const": 4
                        }
                      },
                      "type": "object"
                    }
                  }
                },
                {
                  "contains": {
                    "required": [
                      "ordinal"
                    ],
                    "properties": {
                      "ordinal": {
                        "const": 6
                      }
                    },
                    "type": "object"
                  },
                  "minContains": 0,
                  "maxContains": 1,
                  "if": {
                    "contains": {
                      "required": [
                        "ordinal"
                      ],
                      "properties": {
                        "ordinal": {
                          "const": 6
                        }
                      },
                      "type": "object"
                    }
                  },
                  "then": {
                    "contains": {
                      "required": [
                        "ordinal"
                      ],
                      "properties": {
                        "ordinal": {
                          "const": 5
                        }
                      },
                      "type": "object"
                    }
                  }
                },
                {
                  "contains": {
                    "required": [
                      "ordinal"
                    ],
                    "properties": {
                      "ordinal": {
                        "const": 7
                      }
                    },
                    "type": "object"
                  },
                  "minContains": 0,
                  "maxContains": 1,
                  "if": {
                    "contains": {
                      "required": [
                        "ordinal"
                      ],
                      "properties": {
                        "ordinal": {
                          "const": 7
                        }
                      },
                      "type": "object"
                    }
                  },
                  "then": {
                    "contains": {
                      "required": [
                        "ordinal"
                      ],
                      "properties": {
                        "ordinal": {
                          "const": 6
                        }
                      },
                      "type": "object"
                    }
                  }
                },
                {
                  "contains": {
                    "required": [
                      "ordinal"
                    ],
                    "properties": {
                      "ordinal": {
                        "const": 8
                      }
                    },
                    "type": "object"
                  },
                  "minContains": 0,
                  "maxContains": 1,
                  "if": {
                    "contains": {
                      "required": [
                        "ordinal"
                      ],
                      "properties": {
                        "ordinal": {
                          "const": 8
                        }
                      },
                      "type": "object"
                    }
                  },
                  "then": {
                    "contains": {
                      "required": [
                        "ordinal"
                      ],
                      "properties": {
                        "ordinal": {
                          "const": 7
                        }
                      },
                      "type": "object"
                    }
                  }
                },
                {
                  "contains": {
                    "required": [
                      "ordinal"
                    ],
                    "properties": {
                      "ordinal": {
                        "const": 9
                      }
                    },
                    "type": "object"
                  },
                  "minContains": 0,
                  "maxContains": 1,
                  "if": {
                    "contains": {
                      "required": [
                        "ordinal"
                      ],
                      "properties": {
                        "ordinal": {
                          "const": 9
                        }
                      },
                      "type": "object"
                    }
                  },
                  "then": {
                    "contains": {
                      "required": [
                        "ordinal"
                      ],
                      "properties": {
                        "ordinal": {
                          "const": 8
                        }
                      },
                      "type": "object"
                    }
                  }
                },
                {
                  "contains": {
                    "required": [
                      "ordinal"
                    ],
                    "properties": {
                      "ordinal": {
                        "const": 10
                      }
                    },
                    "type": "object"
                  },
                  "minContains": 0,
                  "maxContains": 1,
                  "if": {
                    "contains": {
                      "required": [
                        "ordinal"
                      ],
                      "properties": {
                        "ordinal": {
                          "const": 10
                        }
                      },
                      "type": "object"
                    }
                  },
                  "then": {
                    "contains": {
                      "required": [
                        "ordinal"
                      ],
                      "properties": {
                        "ordinal": {
                          "const": 9
                        }
                      },
                      "type": "object"
                    }
                  }
                },
                {
                  "contains": {
                    "required": [
                      "ordinal"
                    ],
                    "properties": {
                      "ordinal": {
                        "const": 11
                      }
                    },
                    "type": "object"
                  },
                  "minContains": 0,
                  "maxContains": 1,
                  "if": {
                    "contains": {
                      "required": [
                        "ordinal"
                      ],
                      "properties": {
                        "ordinal": {
                          "const": 11
                        }
                      },
                      "type": "object"
                    }
                  },
                  "then": {
                    "contains": {
                      "required": [
                        "ordinal"
                      ],
                      "properties": {
                        "ordinal": {
                          "const": 10
                        }
                      },
                      "type": "object"
                    }
                  }
                },
                {
                  "contains": {
                    "required": [
                      "ordinal"
                    ],
                    "properties": {
                      "ordinal": {
                        "const": 12
                      }
                    },
                    "type": "object"
                  },
                  "minContains": 0,
                  "maxContains": 1,
                  "if": {
                    "contains": {
                      "required": [
                        "ordinal"
                      ],
                      "properties": {
                        "ordinal": {
                          "const": 12
                        }
                      },
                      "type": "object"
                    }
                  },
                  "then": {
                    "contains": {
                      "required": [
                        "ordinal"
                      ],
                      "properties": {
                        "ordinal": {
                          "const": 11
                        }
                      },
                      "type": "object"
                    }
                  }
                },
                {
                  "contains": {
                    "required": [
                      "ordinal"
                    ],
                    "properties": {
                      "ordinal": {
                        "const": 13
                      }
                    },
                    "type": "object"
                  },
                  "minContains": 0,
                  "maxContains": 1,
                  "if": {
                    "contains": {
                      "required": [
                        "ordinal"
                      ],
                      "properties": {
                        "ordinal": {
                          "const": 13
                        }
                      },
                      "type": "object"
                    }
                  },
                  "then": {
                    "contains": {
                      "required": [
                        "ordinal"
                      ],
                      "properties": {
                        "ordinal": {
                          "const": 12
                        }
                      },
                      "type": "object"
                    }
                  }
                },
                {
                  "contains": {
                    "required": [
                      "ordinal"
                    ],
                    "properties": {
                      "ordinal": {
                        "const": 14
                      }
                    },
                    "type": "object"
                  },
                  "minContains": 0,
                  "maxContains": 1,
                  "if": {
                    "contains": {
                      "required": [
                        "ordinal"
                      ],
                      "properties": {
                        "ordinal": {
                          "const": 14
                        }
                      },
                      "type": "object"
                    }
                  },
                  "then": {
                    "contains": {
                      "required": [
                        "ordinal"
                      ],
                      "properties": {
                        "ordinal": {
                          "const": 13
                        }
                      },
                      "type": "object"
                    }
                  }
                },
                {
                  "contains": {
                    "required": [
                      "ordinal"
                    ],
                    "properties": {
                      "ordinal": {
                        "const": 15
                      }
                    },
                    "type": "object"
                  },
                  "minContains": 0,
                  "maxContains": 1,
                  "if": {
                    "contains": {
                      "required": [
                        "ordinal"
                      ],
                      "properties": {
                        "ordinal": {
                          "const": 15
                        }
                      },
                      "type": "object"
                    }
                  },
                  "then": {
                    "contains": {
                      "required": [
                        "ordinal"
                      ],
                      "properties": {
                        "ordinal": {
                          "const": 14
                        }
                      },
                      "type": "object"
                    }
                  }
                },
                {
                  "contains": {
                    "required": [
                      "ordinal"
                    ],
                    "properties": {
                      "ordinal": {
                        "const": 16
                      }
                    },
                    "type": "object"
                  },
                  "minContains": 0,
                  "maxContains": 1,
                  "if": {
                    "contains": {
                      "required": [
                        "ordinal"
                      ],
                      "properties": {
                        "ordinal": {
                          "const": 16
                        }
                      },
                      "type": "object"
                    }
                  },
                  "then": {
                    "contains": {
                      "required": [
                        "ordinal"
                      ],
                      "properties": {
                        "ordinal": {
                          "const": 15
                        }
                      },
                      "type": "object"
                    }
                  }
                },
                {
                  "contains": {
                    "required": [
                      "ordinal"
                    ],
                    "properties": {
                      "ordinal": {
                        "const": 17
                      }
                    },
                    "type": "object"
                  },
                  "minContains": 0,
                  "maxContains": 1,
                  "if": {
                    "contains": {
                      "required": [
                        "ordinal"
                      ],
                      "properties": {
                        "ordinal": {
                          "const": 17
                        }
                      },
                      "type": "object"
                    }
                  },
                  "then": {
                    "contains": {
                      "required": [
                        "ordinal"
                      ],
                      "properties": {
                        "ordinal": {
                          "const": 16
                        }
                      },
                      "type": "object"
                    }
                  }
                },
                {
                  "contains": {
                    "required": [
                      "ordinal"
                    ],
                    "properties": {
                      "ordinal": {
                        "const": 18
                      }
                    },
                    "type": "object"
                  },
                  "minContains": 0,
                  "maxContains": 1,
                  "if": {
                    "contains": {
                      "required": [
                        "ordinal"
                      ],
                      "properties": {
                        "ordinal": {
                          "const": 18
                        }
                      },
                      "type": "object"
                    }
                  },
                  "then": {
                    "contains": {
                      "required": [
                        "ordinal"
                      ],
                      "properties": {
                        "ordinal": {
                          "const": 17
                        }
                      },
                      "type": "object"
                    }
                  }
                },
                {
                  "contains": {
                    "required": [
                      "ordinal"
                    ],
                    "properties": {
                      "ordinal": {
                        "const": 19
                      }
                    },
                    "type": "object"
                  },
                  "minContains": 0,
                  "maxContains": 1,
                  "if": {
                    "contains": {
                      "required": [
                        "ordinal"
                      ],
                      "properties": {
                        "ordinal": {
                          "const": 19
                        }
                      },
                      "type": "object"
                    }
                  },
                  "then": {
                    "contains": {
                      "required": [
                        "ordinal"
                      ],
                      "properties": {
                        "ordinal": {
                          "const": 18
                        }
                      },
                      "type": "object"
                    }
                  }
                },
                {
                  "contains": {
                    "required": [
                      "ordinal"
                    ],
                    "properties": {
                      "ordinal": {
                        "const": 20
                      }
                    },
                    "type": "object"
                  },
                  "minContains": 0,
                  "maxContains": 1,
                  "if": {
                    "contains": {
                      "required": [
                        "ordinal"
                      ],
                      "properties": {
                        "ordinal": {
                          "const": 20
                        }
                      },
                      "type": "object"
                    }
                  },
                  "then": {
                    "contains": {
                      "required": [
                        "ordinal"
                      ],
                      "properties": {
                        "ordinal": {
                          "const": 19
                        }
                      },
                      "type": "object"
                    }
                  }
                },
                {
                  "contains": {
                    "required": [
                      "ordinal"
                    ],
                    "properties": {
                      "ordinal": {
                        "const": 21
                      }
                    },
                    "type": "object"
                  },
                  "minContains": 0,
                  "maxContains": 1,
                  "if": {
                    "contains": {
                      "required": [
                        "ordinal"
                      ],
                      "properties": {
                        "ordinal": {
                          "const": 21
                        }
                      },
                      "type": "object"
                    }
                  },
                  "then": {
                    "contains": {
                      "required": [
                        "ordinal"
                      ],
                      "properties": {
                        "ordinal": {
                          "const": 20
                        }
                      },
                      "type": "object"
                    }
                  }
                },
                {
                  "contains": {
                    "required": [
                      "ordinal"
                    ],
                    "properties": {
                      "ordinal": {
                        "const": 22
                      }
                    },
                    "type": "object"
                  },
                  "minContains": 0,
                  "maxContains": 1,
                  "if": {
                    "contains": {
                      "required": [
                        "ordinal"
                      ],
                      "properties": {
                        "ordinal": {
                          "const": 22
                        }
                      },
                      "type": "object"
                    }
                  },
                  "then": {
                    "contains": {
                      "required": [
                        "ordinal"
                      ],
                      "properties": {
                        "ordinal": {
                          "const": 21
                        }
                      },
                      "type": "object"
                    }
                  }
                },
                {
                  "contains": {
                    "required": [
                      "ordinal"
                    ],
                    "properties": {
                      "ordinal": {
                        "const": 23
                      }
                    },
                    "type": "object"
                  },
                  "minContains": 0,
                  "maxContains": 1,
                  "if": {
                    "contains": {
                      "required": [
                        "ordinal"
                      ],
                      "properties": {
                        "ordinal": {
                          "const": 23
                        }
                      },
                      "type": "object"
                    }
                  },
                  "then": {
                    "contains": {
                      "required": [
                        "ordinal"
                      ],
                      "properties": {
                        "ordinal": {
                          "const": 22
                        }
                      },
                      "type": "object"
                    }
                  }
                },
                {
                  "contains": {
                    "required": [
                      "ordinal"
                    ],
                    "properties": {
                      "ordinal": {
                        "const": 24
                      }
                    },
                    "type": "object"
                  },
                  "minContains": 0,
                  "maxContains": 1,
                  "if": {
                    "contains": {
                      "required": [
                        "ordinal"
                      ],
                      "properties": {
                        "ordinal": {
                          "const": 24
                        }
                      },
                      "type": "object"
                    }
                  },
                  "then": {
                    "contains": {
                      "required": [
                        "ordinal"
                      ],
                      "properties": {
                        "ordinal": {
                          "const": 23
                        }
                      },
                      "type": "object"
                    }
                  }
                },
                {
                  "contains": {
                    "required": [
                      "ordinal"
                    ],
                    "properties": {
                      "ordinal": {
                        "const": 25
                      }
                    },
                    "type": "object"
                  },
                  "minContains": 0,
                  "maxContains": 1,
                  "if": {
                    "contains": {
                      "required": [
                        "ordinal"
                      ],
                      "properties": {
                        "ordinal": {
                          "const": 25
                        }
                      },
                      "type": "object"
                    }
                  },
                  "then": {
                    "contains": {
                      "required": [
                        "ordinal"
                      ],
                      "properties": {
                        "ordinal": {
                          "const": 24
                        }
                      },
                      "type": "object"
                    }
                  }
                },
                {
                  "contains": {
                    "required": [
                      "ordinal"
                    ],
                    "properties": {
                      "ordinal": {
                        "const": 26
                      }
                    },
                    "type": "object"
                  },
                  "minContains": 0,
                  "maxContains": 1,
                  "if": {
                    "contains": {
                      "required": [
                        "ordinal"
                      ],
                      "properties": {
                        "ordinal": {
                          "const": 26
                        }
                      },
                      "type": "object"
                    }
                  },
                  "then": {
                    "contains": {
                      "required": [
                        "ordinal"
                      ],
                      "properties": {
                        "ordinal": {
                          "const": 25
                        }
                      },
                      "type": "object"
                    }
                  }
                },
                {
                  "contains": {
                    "required": [
                      "ordinal"
                    ],
                    "properties": {
                      "ordinal": {
                        "const": 27
                      }
                    },
                    "type": "object"
                  },
                  "minContains": 0,
                  "maxContains": 1,
                  "if": {
                    "contains": {
                      "required": [
                        "ordinal"
                      ],
                      "properties": {
                        "ordinal": {
                          "const": 27
                        }
                      },
                      "type": "object"
                    }
                  },
                  "then": {
                    "contains": {
                      "required": [
                        "ordinal"
                      ],
                      "properties": {
                        "ordinal": {
                          "const": 26
                        }
                      },
                      "type": "object"
                    }
                  }
                },
                {
                  "contains": {
                    "required": [
                      "ordinal"
                    ],
                    "properties": {
                      "ordinal": {
                        "const": 28
                      }
                    },
                    "type": "object"
                  },
                  "minContains": 0,
                  "maxContains": 1,
                  "if": {
                    "contains": {
                      "required": [
                        "ordinal"
                      ],
                      "properties": {
                        "ordinal": {
                          "const": 28
                        }
                      },
                      "type": "object"
                    }
                  },
                  "then": {
                    "contains": {
                      "required": [
                        "ordinal"
                      ],
                      "properties": {
                        "ordinal": {
                          "const": 27
                        }
                      },
                      "type": "object"
                    }
                  }
                },
                {
                  "contains": {
                    "required": [
                      "ordinal"
                    ],
                    "properties": {
                      "ordinal": {
                        "const": 29
                      }
                    },
                    "type": "object"
                  },
                  "minContains": 0,
                  "maxContains": 1,
                  "if": {
                    "contains": {
                      "required": [
                        "ordinal"
                      ],
                      "properties": {
                        "ordinal": {
                          "const": 29
                        }
                      },
                      "type": "object"
                    }
                  },
                  "then": {
                    "contains": {
                      "required": [
                        "ordinal"
                      ],
                      "properties": {
                        "ordinal": {
                          "const": 28
                        }
                      },
                      "type": "object"
                    }
                  }
                },
                {
                  "contains": {
                    "required": [
                      "ordinal"
                    ],
                    "properties": {
                      "ordinal": {
                        "const": 30
                      }
                    },
                    "type": "object"
                  },
                  "minContains": 0,
                  "maxContains": 1,
                  "if": {
                    "contains": {
                      "required": [
                        "ordinal"
                      ],
                      "properties": {
                        "ordinal": {
                          "const": 30
                        }
                      },
                      "type": "object"
                    }
                  },
                  "then": {
                    "contains": {
                      "required": [
                        "ordinal"
                      ],
                      "properties": {
                        "ordinal": {
                          "const": 29
                        }
                      },
                      "type": "object"
                    }
                  }
                },
                {
                  "contains": {
                    "required": [
                      "ordinal"
                    ],
                    "properties": {
                      "ordinal": {
                        "const": 31
                      }
                    },
                    "type": "object"
                  },
                  "minContains": 0,
                  "maxContains": 1,
                  "if": {
                    "contains": {
                      "required": [
                        "ordinal"
                      ],
                      "properties": {
                        "ordinal": {
                          "const": 31
                        }
                      },
                      "type": "object"
                    }
                  },
                  "then": {
                    "contains": {
                      "required": [
                        "ordinal"
                      ],
                      "properties": {
                        "ordinal": {
                          "const": 30
                        }
                      },
                      "type": "object"
                    }
                  }
                },
                {
                  "contains": {
                    "required": [
                      "ordinal"
                    ],
                    "properties": {
                      "ordinal": {
                        "const": 32
                      }
                    },
                    "type": "object"
                  },
                  "minContains": 0,
                  "maxContains": 1,
                  "if": {
                    "contains": {
                      "required": [
                        "ordinal"
                      ],
                      "properties": {
                        "ordinal": {
                          "const": 32
                        }
                      },
                      "type": "object"
                    }
                  },
                  "then": {
                    "contains": {
                      "required": [
                        "ordinal"
                      ],
                      "properties": {
                        "ordinal": {
                          "const": 31
                        }
                      },
                      "type": "object"
                    }
                  }
                }
              ]
            },
            "knowledge": {
              "type": "array",
              "minItems": 0,
              "maxItems": 32,
              "items": {
                "$ref": "#/$defs/IntakeSopKnowledge"
              }
            },
            "scripts": {
              "type": "array",
              "minItems": 0,
              "maxItems": 32,
              "items": {
                "$ref": "#/$defs/IntakeSopTaskScript"
              }
            }
          }
        }
      }
    },
    "IntakeSopPublishedFlow": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "header",
        "graphDigest"
      ],
      "properties": {
        "header": {
          "allOf": [
            {
              "$ref": "#/$defs/IntakeSopFlowHeader"
            },
            {
              "properties": {
                "operation": {
                  "const": "upsert"
                }
              },
              "type": "object"
            }
          ]
        },
        "graphDigest": {
          "$ref": "#/$defs/IntakeSopHash"
        }
      }
    },
    "IntakeSopQualityDelta": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "materialDigest",
        "sopChecks"
      ],
      "properties": {
        "materialDigest": {
          "$ref": "#/$defs/IntakeSopHash"
        },
        "sopChecks": {
          "type": "array",
          "minItems": 0,
          "maxItems": 100,
          "items": {
            "$ref": "#/$defs/IntakeSopFlowCheck"
          }
        }
      }
    },
    "IntakeSopRequirement": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "id",
        "label",
        "ordinal"
      ],
      "properties": {
        "id": {
          "$ref": "#/$defs/IntakeSopId"
        },
        "label": {
          "type": "string",
          "minLength": 1,
          "maxLength": 1024,
          "pattern": "\\S"
        },
        "ordinal": {
          "type": "integer",
          "minimum": 1,
          "maximum": 32
        }
      }
    },
    "IntakeSopSnapshotDelta": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "snapshotDigest",
        "pageIndex",
        "pageCount",
        "totals",
        "sopFlows",
        "sopNodes",
        "sopEdges",
        "media"
      ],
      "properties": {
        "snapshotDigest": {
          "$ref": "#/$defs/IntakeSopHash"
        },
        "pageIndex": {
          "type": "integer",
          "minimum": 0,
          "maximum": 1023
        },
        "pageCount": {
          "type": "integer",
          "minimum": 1,
          "maximum": 1024
        },
        "totals": {
          "$ref": "#/$defs/IntakeSopTotals"
        },
        "sopFlows": {
          "type": "array",
          "minItems": 0,
          "maxItems": 100,
          "items": {
            "$ref": "#/$defs/IntakeSopPublishedFlow"
          }
        },
        "sopNodes": {
          "type": "array",
          "minItems": 0,
          "maxItems": 100,
          "items": {
            "$ref": "#/$defs/IntakeSopNode"
          }
        },
        "sopEdges": {
          "type": "array",
          "minItems": 0,
          "maxItems": 100,
          "items": {
            "$ref": "#/$defs/IntakeSopEdge"
          }
        },
        "media": {
          "type": "array",
          "minItems": 0,
          "maxItems": 100,
          "items": {
            "$ref": "#/$defs/IntakeSopMedia"
          }
        }
      }
    },
    "IntakeSopSopQualityCheckSummary": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "checkedCount",
        "defectCount",
        "checksDigest"
      ],
      "properties": {
        "checkedCount": {
          "type": "integer",
          "minimum": 0,
          "maximum": 100
        },
        "defectCount": {
          "type": "integer",
          "minimum": 0,
          "maximum": 100
        },
        "checksDigest": {
          "$ref": "#/$defs/IntakeSopHash"
        }
      }
    },
    "IntakeSopSopQualityPlan": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "policyVersion",
        "materialDigest",
        "targetCount",
        "targetsDigest"
      ],
      "properties": {
        "policyVersion": {
          "const": "sop-task-graph-quality-v2"
        },
        "materialDigest": {
          "$ref": "#/$defs/IntakeSopHash"
        },
        "targetCount": {
          "type": "integer",
          "minimum": 0,
          "maximum": 100
        },
        "targetsDigest": {
          "$ref": "#/$defs/IntakeSopHash"
        }
      }
    },
    "IntakeSopSopQualitySample": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "target",
        "check"
      ],
      "properties": {
        "target": {
          "$ref": "#/$defs/IntakeSopSopQualityTarget"
        },
        "check": {
          "anyOf": [
            {
              "$ref": "#/$defs/IntakeSopFlowCheck"
            },
            {
              "type": "null"
            }
          ]
        }
      }
    },
    "IntakeSopSopQualityTarget": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "key",
        "graphDigest"
      ],
      "properties": {
        "key": {
          "$ref": "#/$defs/IntakeSopFlowKey"
        },
        "graphDigest": {
          "$ref": "#/$defs/IntakeSopHash"
        }
      }
    },
    "IntakeSopSourceScope": {
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
            "product",
            "sop"
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
    "IntakeSopTaskScript": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "entry",
        "relation",
        "condition"
      ],
      "properties": {
        "entry": {
          "$ref": "#/$defs/IntakeSopEntryRef"
        },
        "relation": {
          "enum": [
            "independent",
            "alternative",
            "complementary"
          ]
        },
        "condition": {
          "type": "string",
          "minLength": 1,
          "maxLength": 1024,
          "pattern": "\\S"
        }
      }
    },
    "IntakeSopTerms": {
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1,
        "maxLength": 128,
        "pattern": "\\S"
      },
      "minItems": 0,
      "maxItems": 32,
      "uniqueItems": true
    },
    "IntakeSopTotals": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "faq",
        "vocabulary",
        "sopFlows",
        "sopNodes",
        "sopEdges",
        "media"
      ],
      "properties": {
        "faq": {
          "type": "integer",
          "minimum": 0,
          "maximum": 5000
        },
        "vocabulary": {
          "type": "integer",
          "minimum": 0,
          "maximum": 102400
        },
        "sopFlows": {
          "type": "integer",
          "minimum": 0,
          "maximum": 100
        },
        "sopNodes": {
          "type": "integer",
          "minimum": 0,
          "maximum": 12800
        },
        "sopEdges": {
          "type": "integer",
          "minimum": 0,
          "maximum": 51200
        },
        "media": {
          "type": "integer",
          "minimum": 0,
          "maximum": 5000
        }
      }
    },
    "IntakeSopVersion": {
      "type": "integer",
      "minimum": 1,
      "maximum": 9007199254740991
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
          "$ref": "#/$defs/IntakeSopSourceScope"
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
      },
      "oneOf": [
        {
          "required": [
            "templateVersion",
            "ruleVersion"
          ],
          "properties": {
            "templateVersion": {
              "const": "faq-p1.1"
            },
            "ruleVersion": {
              "const": "intake-p1.1"
            },
            "scope": {
              "$ref": "#/$defs/IntakeSourceScope"
            }
          },
          "type": "object"
        },
        {
          "required": [
            "templateVersion",
            "ruleVersion"
          ],
          "properties": {
            "templateVersion": {
              "const": "faq-csv-v1"
            },
            "ruleVersion": {
              "const": "intake-csv-v1"
            },
            "mappingVersion": {
              "const": "faq-csv-columns-v1"
            },
            "structureDigest": {
              "const": "daaa4126d63194f59949c2b6f464b108ed87a430090e4dfe36e255663ab59165"
            },
            "scope": {
              "$ref": "#/$defs/IntakeSourceScope"
            }
          },
          "type": "object"
        },
        {
          "required": [
            "templateVersion",
            "ruleVersion",
            "mappingVersion"
          ],
          "properties": {
            "templateVersion": {
              "const": "sop-manual-authoring-v1.1"
            },
            "ruleVersion": {
              "const": "sop-task-graph-v2"
            },
            "mappingVersion": {
              "const": "sop-manual-to-task-graph-v2"
            }
          },
          "type": "object"
        }
      ]
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
      },
      "oneOf": [
        {
          "required": [
            "templateVersion",
            "ruleVersion"
          ],
          "properties": {
            "templateVersion": {
              "const": "faq-p1.1"
            },
            "ruleVersion": {
              "const": "intake-p1.1"
            }
          },
          "type": "object"
        },
        {
          "required": [
            "templateVersion",
            "ruleVersion"
          ],
          "properties": {
            "templateVersion": {
              "const": "faq-csv-v1"
            },
            "ruleVersion": {
              "const": "intake-csv-v1"
            },
            "mappingVersion": {
              "const": "faq-csv-columns-v1"
            },
            "structureDigest": {
              "const": "daaa4126d63194f59949c2b6f464b108ed87a430090e4dfe36e255663ab59165"
            }
          },
          "type": "object"
        }
      ]
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
    "MenokinSopQuerySopBlockedResponse": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "status",
        "request_id",
        "release_id",
        "lease_expires_at",
        "result",
        "reasons"
      ],
      "properties": {
        "status": {
          "const": "blocked"
        },
        "request_id": {
          "type": "string",
          "format": "uuid"
        },
        "release_id": {
          "type": "null"
        },
        "lease_expires_at": {
          "type": "null"
        },
        "result": {
          "type": "null"
        },
        "reasons": {
          "type": "array",
          "minItems": 1,
          "maxItems": 8,
          "items": {
            "$ref": "#/$defs/MenokinSopQuerySopReason"
          }
        }
      }
    },
    "MenokinSopQuerySopEmptyResult": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "flow",
        "entries",
        "media",
        "permissions"
      ],
      "properties": {
        "flow": {
          "type": "null"
        },
        "entries": {
          "type": "array",
          "maxItems": 0
        },
        "media": {
          "type": "array",
          "maxItems": 0
        },
        "permissions": {
          "type": "array",
          "maxItems": 0
        }
      }
    },
    "MenokinSopQuerySopEntryPermission": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "entry",
        "risk_level",
        "copy_allowed",
        "source_ref"
      ],
      "properties": {
        "entry": {
          "$ref": "#/$defs/IntakeSopEntryRef"
        },
        "risk_level": {
          "type": "string",
          "enum": [
            "low",
            "medium",
            "high",
            "critical"
          ]
        },
        "copy_allowed": {
          "type": "boolean"
        },
        "source_ref": {
          "type": "string",
          "minLength": 1,
          "maxLength": 1024
        }
      }
    },
    "MenokinSopQuerySopErrorEnvelope": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "code",
        "message"
      ],
      "properties": {
        "code": {
          "type": "string",
          "enum": [
            "CONTRACT_UPGRADE_REQUIRED",
            "SCOPE_DENIED",
            "SOP_BLOCKED",
            "SOP_STALE",
            "IDEMPOTENCY_CONFLICT",
            "SOP_UNAVAILABLE"
          ]
        },
        "message": {
          "type": "string",
          "minLength": 1,
          "maxLength": 256
        },
        "request_id": {
          "type": "string",
          "format": "uuid"
        }
      }
    },
    "MenokinSopQuerySopNoMatchResponse": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "status",
        "request_id",
        "release_id",
        "lease_expires_at",
        "result",
        "reasons"
      ],
      "properties": {
        "status": {
          "const": "no_match"
        },
        "request_id": {
          "type": "string",
          "format": "uuid"
        },
        "release_id": {
          "type": "string",
          "minLength": 1,
          "maxLength": 256
        },
        "lease_expires_at": {
          "type": "string",
          "format": "date-time"
        },
        "result": {
          "$ref": "#/$defs/MenokinSopQuerySopEmptyResult"
        },
        "reasons": {
          "type": "array",
          "maxItems": 0
        }
      }
    },
    "MenokinSopQuerySopQueryRequest": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "sop_group",
        "shop_id",
        "query_text",
        "context_generation",
        "request_id"
      ],
      "properties": {
        "sop_group": {
          "type": "string",
          "enum": [
            "过敏流程SOP",
            "长痘痘SOP",
            "品质售后SOP",
            "少错破SOP",
            "税收相关规则"
          ]
        },
        "shop_id": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128,
          "pattern": "^[-A-Za-z0-9._:]+$"
        },
        "product_context": {
          "oneOf": [
            {
              "type": "null"
            },
            {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "type",
                "ref"
              ],
              "properties": {
                "type": {
                  "type": "string",
                  "enum": [
                    "storewide",
                    "category",
                    "sku"
                  ]
                },
                "ref": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 256
                }
              }
            }
          ]
        },
        "query_text": {
          "type": "string",
          "minLength": 1,
          "maxLength": 2048,
          "pattern": "\\S"
        },
        "context_generation": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128,
          "pattern": "\\S"
        },
        "request_id": {
          "type": "string",
          "format": "uuid"
        }
      }
    },
    "MenokinSopQuerySopQueryResponse": {
      "oneOf": [
        {
          "$ref": "#/$defs/MenokinSopQuerySopReadyResponse"
        },
        {
          "$ref": "#/$defs/MenokinSopQuerySopBlockedResponse"
        },
        {
          "$ref": "#/$defs/MenokinSopQuerySopStaleResponse"
        },
        {
          "$ref": "#/$defs/MenokinSopQuerySopNoMatchResponse"
        }
      ]
    },
    "MenokinSopQuerySopReadyResponse": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "status",
        "request_id",
        "release_id",
        "lease_expires_at",
        "result",
        "reasons"
      ],
      "properties": {
        "status": {
          "const": "ready"
        },
        "request_id": {
          "type": "string",
          "format": "uuid"
        },
        "release_id": {
          "type": "string",
          "minLength": 1,
          "maxLength": 256
        },
        "lease_expires_at": {
          "type": "string",
          "format": "date-time"
        },
        "result": {
          "$ref": "#/$defs/MenokinSopQuerySopReadyResult"
        },
        "reasons": {
          "type": "array",
          "maxItems": 0
        }
      }
    },
    "MenokinSopQuerySopReadyResult": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "flow",
        "graph_digest",
        "entries",
        "media",
        "permissions"
      ],
      "properties": {
        "flow": {
          "$ref": "#/$defs/IntakeSopFlowDefinition"
        },
        "entries": {
          "type": "array",
          "maxItems": 4096,
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "sourceId",
              "entry"
            ],
            "properties": {
              "sourceId": {
                "$ref": "#/$defs/IntakeSopId"
              },
              "entry": {
                "$ref": "#/$defs/IntakePublishedEntry"
              }
            }
          }
        },
        "media": {
          "type": "array",
          "maxItems": 500,
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "binding",
              "preview_handle",
              "expires_at"
            ],
            "properties": {
              "binding": {
                "$ref": "#/$defs/IntakeSopMedia"
              },
              "preview_handle": {
                "type": "string",
                "minLength": 1,
                "maxLength": 256
              },
              "expires_at": {
                "type": "string",
                "format": "date-time"
              }
            }
          }
        },
        "permissions": {
          "type": "array",
          "maxItems": 4096,
          "items": {
            "$ref": "#/$defs/MenokinSopQuerySopEntryPermission"
          }
        },
        "graph_digest": {
          "$ref": "#/$defs/IntakeSopHash"
        }
      }
    },
    "MenokinSopQuerySopReason": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "code"
      ],
      "properties": {
        "code": {
          "type": "string",
          "enum": [
            "SCOPE_DENIED",
            "LEASE_EXPIRED",
            "APPROVAL_REVOKED",
            "SOURCE_GATE_NOT_READY",
            "GRAPH_UNRESOLVED",
            "TERMINAL_HAS_OUTGOING_EDGE",
            "SAFETY_REVIEW_REQUIRED",
            "MEDIA_UNVERIFIED",
            "STALE_RELEASE",
            "IDEMPOTENCY_CONFLICT"
          ]
        },
        "source_ref": {
          "type": "string",
          "minLength": 1,
          "maxLength": 512
        }
      }
    },
    "MenokinSopQuerySopStaleResponse": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "status",
        "request_id",
        "release_id",
        "lease_expires_at",
        "result",
        "reasons"
      ],
      "properties": {
        "status": {
          "const": "stale"
        },
        "request_id": {
          "type": "string",
          "format": "uuid"
        },
        "release_id": {
          "oneOf": [
            {
              "type": "string",
              "minLength": 1,
              "maxLength": 256
            },
            {
              "type": "null"
            }
          ]
        },
        "lease_expires_at": {
          "type": "null"
        },
        "result": {
          "type": "null"
        },
        "reasons": {
          "type": "array",
          "minItems": 1,
          "maxItems": 8,
          "items": {
            "$ref": "#/$defs/MenokinSopQuerySopReason"
          }
        }
      }
    },
    "SopCandidateMaterial": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "candidateId",
        "version",
        "sheets",
        "contentHash"
      ],
      "properties": {
        "candidateId": {
          "$ref": "#/$defs/IntakeId"
        },
        "version": {
          "$ref": "#/$defs/IntakeVersion"
        },
        "sheets": {
          "type": "array",
          "minItems": 6,
          "maxItems": 6,
          "uniqueItems": true,
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "name",
              "rows"
            ],
            "properties": {
              "name": {
                "type": "string",
                "enum": [
                  "过敏流程SOP",
                  "少错破SOP",
                  "品质售后SOP",
                  "税收相关规则",
                  "品牌对接资源汇总",
                  "长痘痘SOP"
                ]
              },
              "rows": {
                "type": "array",
                "items": {
                  "$ref": "#/$defs/SopCandidateRow"
                }
              }
            }
          }
        },
        "contentHash": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$",
          "minLength": 64,
          "maxLength": 64
        }
      }
    },
    "SopCandidateRow": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "rowId",
        "sheetName",
        "rowNumber",
        "answer",
        "media"
      ],
      "properties": {
        "rowId": {
          "type": "string",
          "pattern": "^sop:[^:]{1,128}:[1-9][0-9]{0,3}$"
        },
        "sheetName": {
          "type": "string",
          "enum": [
            "过敏流程SOP",
            "少错破SOP",
            "品质售后SOP",
            "税收相关规则",
            "品牌对接资源汇总",
            "长痘痘SOP"
          ]
        },
        "rowNumber": {
          "type": "integer",
          "minimum": 1,
          "maximum": 5000
        },
        "answer": {
          "type": "string",
          "minLength": 1,
          "maxLength": 20000
        },
        "media": {
          "type": "array",
          "maxItems": 100,
          "items": {
            "$ref": "#/$defs/SopMediaObject"
          }
        }
      }
    },
    "SopMediaObject": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "mediaObjectId",
        "sheetName",
        "rowNumber",
        "ordinal",
        "sha256",
        "mime",
        "bytes"
      ],
      "properties": {
        "mediaObjectId": {
          "$ref": "#/$defs/IntakeId"
        },
        "sheetName": {
          "type": "string",
          "enum": [
            "过敏流程SOP",
            "少错破SOP",
            "品质售后SOP",
            "税收相关规则",
            "品牌对接资源汇总",
            "长痘痘SOP"
          ]
        },
        "rowNumber": {
          "type": "integer",
          "minimum": 1,
          "maximum": 5000
        },
        "ordinal": {
          "type": "integer",
          "minimum": 1,
          "maximum": 100
        },
        "sha256": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$",
          "minLength": 64,
          "maxLength": 64
        },
        "mime": {
          "type": "string",
          "enum": [
            "image/png",
            "image/jpeg",
            "image/gif"
          ]
        },
        "bytes": {
          "type": "integer",
          "minimum": 1,
          "maximum": 5242880
        },
        "preview": {
          "$ref": "#/$defs/SopPreview"
        }
      }
    },
    "SopPreview": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "previewToken",
        "expiresAt"
      ],
      "properties": {
        "previewToken": {
          "type": "string",
          "minLength": 1,
          "maxLength": 512
        },
        "expiresAt": {
          "type": "string",
          "format": "date-time",
          "maxLength": 35
        }
      }
    },
    "SopPublishCommand": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "operationId",
        "contentHash",
        "confirm"
      ],
      "properties": {
        "operationId": {
          "$ref": "#/$defs/IntakeId"
        },
        "contentHash": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$",
          "minLength": 64,
          "maxLength": 64
        },
        "confirm": {
          "const": true
        }
      }
    },
    "SopPublishReceipt": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "releaseId",
        "contentHash",
        "state"
      ],
      "properties": {
        "releaseId": {
          "$ref": "#/$defs/IntakeId"
        },
        "contentHash": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$",
          "minLength": 64,
          "maxLength": 64
        },
        "state": {
          "const": "published"
        }
      }
    },
    "SopRollbackCommand": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "rollbackPlanId",
        "operationId",
        "confirm"
      ],
      "properties": {
        "rollbackPlanId": {
          "$ref": "#/$defs/IntakeId"
        },
        "operationId": {
          "$ref": "#/$defs/IntakeId"
        },
        "confirm": {
          "const": true
        }
      }
    },
    "SopRollbackReceipt": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "releaseId",
        "state"
      ],
      "properties": {
        "releaseId": {
          "$ref": "#/$defs/IntakeId"
        },
        "state": {
          "const": "rolled_back"
        }
      }
    },
    "SopUploadReceipt": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "operationId",
        "candidateId",
        "version",
        "state"
      ],
      "properties": {
        "operationId": {
          "$ref": "#/$defs/IntakeId"
        },
        "candidateId": {
          "$ref": "#/$defs/IntakeId"
        },
        "version": {
          "$ref": "#/$defs/IntakeVersion"
        },
        "state": {
          "type": "string",
          "enum": [
            "staged",
            "idempotent"
          ]
        }
      }
    }
  }
};
