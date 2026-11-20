/* GENERATED FILE. DO NOT EDIT. Run `pnpm contracts:generate` from the repository root. */

export type paths = Record<string, never>;
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        W5SopCandidateId: string;
        /** Format: uuid */
        W5SopCandidateUuid: string;
        W5SopCandidateContextGeneration: string;
        W5SopCandidateQueryText: string;
        W5SopCandidateCandidateRef: string;
        W5SopCandidateDiscoverRequest: {
            request_id: components["schemas"]["W5SopCandidateUuid"];
            query_text: components["schemas"]["W5SopCandidateQueryText"];
            context_generation: components["schemas"]["W5SopCandidateContextGeneration"];
            entitlement_id: components["schemas"]["W5SopCandidateId"];
        };
        W5SopCandidateCandidate: {
            candidate_ref: components["schemas"]["W5SopCandidateCandidateRef"];
            label: string;
        };
        W5SopCandidateDiscoverResponse: {
            /** @constant */
            status: "candidates";
            request_id: components["schemas"]["W5SopCandidateUuid"];
            release_id: components["schemas"]["W5SopCandidateId"];
            /** Format: date-time */
            expires_at: string;
            candidates: components["schemas"]["W5SopCandidateCandidate"][];
        } | {
            /** @enum {unknown} */
            status: "no_match" | "ambiguous" | "stale" | "unavailable";
            request_id: components["schemas"]["W5SopCandidateUuid"];
        };
        W5SopCandidateSelectRequest: {
            request_id: components["schemas"]["W5SopCandidateUuid"];
            candidate_query_id: components["schemas"]["W5SopCandidateUuid"];
            candidate_ref: components["schemas"]["W5SopCandidateCandidateRef"];
            entitlement_id: components["schemas"]["W5SopCandidateId"];
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export type operations = Record<string, never>;
