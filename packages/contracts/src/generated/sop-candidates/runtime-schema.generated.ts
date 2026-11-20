/* GENERATED FILE. DO NOT EDIT. Run `pnpm contracts:generate` from the repository root. */

export const OPENAPI_RUNTIME_SCHEMA_ID = "urn:customer-agent:openapi:1.31.0:sop-candidates";
export const COMPONENT_SCHEMA_NAMES = [
  "W5SopCandidateCandidate",
  "W5SopCandidateCandidateRef",
  "W5SopCandidateContextGeneration",
  "W5SopCandidateDiscoverRequest",
  "W5SopCandidateDiscoverResponse",
  "W5SopCandidateId",
  "W5SopCandidateQueryText",
  "W5SopCandidateSelectRequest",
  "W5SopCandidateUuid"
] as const;
export type GeneratedComponentSchemaName = (typeof COMPONENT_SCHEMA_NAMES)[number];
export const OPENAPI_RUNTIME_SCHEMA_DOCUMENT: Readonly<Record<string, unknown>> =
  {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "urn:customer-agent:openapi:1.31.0:sop-candidates",
  "$defs": {
    "W5SopCandidateCandidate": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "candidate_ref",
        "label"
      ],
      "properties": {
        "candidate_ref": {
          "$ref": "#/$defs/W5SopCandidateCandidateRef"
        },
        "label": {
          "type": "string",
          "minLength": 1,
          "maxLength": 512,
          "pattern": "^(?=[\\s\\S]*\\S)[^\\u0000\\uD800-\\uDFFF]+$"
        }
      }
    },
    "W5SopCandidateCandidateRef": {
      "type": "string",
      "pattern": "^sdc_[0-9a-f]{64}$"
    },
    "W5SopCandidateContextGeneration": {
      "type": "string",
      "minLength": 1,
      "maxLength": 128,
      "pattern": "^(?=[\\s\\S]*\\S)[^\\u0000\\uD800-\\uDFFF]+$"
    },
    "W5SopCandidateDiscoverRequest": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "request_id",
        "query_text",
        "context_generation",
        "entitlement_id"
      ],
      "properties": {
        "request_id": {
          "$ref": "#/$defs/W5SopCandidateUuid"
        },
        "query_text": {
          "$ref": "#/$defs/W5SopCandidateQueryText"
        },
        "context_generation": {
          "$ref": "#/$defs/W5SopCandidateContextGeneration"
        },
        "entitlement_id": {
          "$ref": "#/$defs/W5SopCandidateId"
        }
      }
    },
    "W5SopCandidateDiscoverResponse": {
      "oneOf": [
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "status",
            "request_id",
            "release_id",
            "expires_at",
            "candidates"
          ],
          "properties": {
            "status": {
              "const": "candidates"
            },
            "request_id": {
              "$ref": "#/$defs/W5SopCandidateUuid"
            },
            "release_id": {
              "$ref": "#/$defs/W5SopCandidateId"
            },
            "expires_at": {
              "type": "string",
              "format": "date-time"
            },
            "candidates": {
              "type": "array",
              "minItems": 1,
              "maxItems": 5,
              "uniqueItems": true,
              "items": {
                "$ref": "#/$defs/W5SopCandidateCandidate"
              },
              "x-unique-by": "candidate_ref"
            }
          }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "status",
            "request_id"
          ],
          "properties": {
            "status": {
              "enum": [
                "no_match",
                "ambiguous",
                "stale",
                "unavailable"
              ]
            },
            "request_id": {
              "$ref": "#/$defs/W5SopCandidateUuid"
            }
          }
        }
      ]
    },
    "W5SopCandidateId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 128,
      "pattern": "^[A-Za-z0-9._:-]+$"
    },
    "W5SopCandidateQueryText": {
      "type": "string",
      "minLength": 1,
      "maxLength": 500,
      "pattern": "^(?=[\\s\\S]*\\S)[^\\u0000\\uD800-\\uDFFF]+$"
    },
    "W5SopCandidateSelectRequest": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "request_id",
        "candidate_query_id",
        "candidate_ref",
        "entitlement_id"
      ],
      "properties": {
        "request_id": {
          "$ref": "#/$defs/W5SopCandidateUuid"
        },
        "candidate_query_id": {
          "$ref": "#/$defs/W5SopCandidateUuid"
        },
        "candidate_ref": {
          "$ref": "#/$defs/W5SopCandidateCandidateRef"
        },
        "entitlement_id": {
          "$ref": "#/$defs/W5SopCandidateId"
        }
      }
    },
    "W5SopCandidateUuid": {
      "type": "string",
      "format": "uuid"
    }
  }
};
