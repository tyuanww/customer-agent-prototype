export const MENOKIN_SOP_QUERY_CONTRACT_SET_ID =
  'cs-ai-c11-openapi-1.25.0-schema-1.30-0fb1dc76ee2b';

export type SopQueryRequest = Readonly<{
  sop_group: string;
  shop_id: string;
  product_context?: null | Readonly<{ type: string; ref: string }>;
  query_text: string;
  context_generation: string;
  request_id: string;
}>;

export type SopQueryReason = Readonly<{
  code: string;
  source_ref?: string;
}>;

export type SopNode = Readonly<{
  node_id: string;
  scenario_id: string;
  sequence: number;
  kind: 'instruction' | 'decision' | 'terminal';
  terminal: boolean;
  source_ref: string;
}>;

export type SopBranch = Readonly<{
  branch_id: string;
  source_node_id: string;
  option: string;
  target_node_id: string | null;
  is_unresolved: boolean;
}>;

export type SopMessage = Readonly<{
  message_id: string;
  node_id: string;
  title: string;
  body: string;
  risk_level: 'unclassified' | 'low' | 'medium' | 'high' | 'critical';
  copy_allowed: boolean;
}>;

export type SopMediaRef = Readonly<{
  media_id: string;
  node_id: string;
  content_type: 'image/png' | 'image/jpeg' | 'image/gif';
  preview_handle: string;
  expires_at: string;
}>;

export type SopReadyResult = Readonly<{
  entry_node_id: string;
  nodes: readonly SopNode[];
  branches: readonly SopBranch[];
  messages: readonly SopMessage[];
  media_refs: readonly SopMediaRef[];
}>;

export type SopEmptyResult = Readonly<{
  nodes: readonly [];
  branches: readonly [];
  messages: readonly [];
  media_refs: readonly [];
}>;

export type SopQueryReadResult =
  | Readonly<{
      status: 'ready';
      release_id: string;
      lease_expires_at: string;
      result: SopReadyResult;
      reasons: readonly [];
    }>
  | Readonly<{
      status: 'blocked';
      release_id: null;
      lease_expires_at: null;
      result: null;
      reasons: readonly SopQueryReason[];
    }>
  | Readonly<{
      status: 'stale';
      release_id: string | null;
      lease_expires_at: null;
      result: null;
      reasons: readonly SopQueryReason[];
    }>
  | Readonly<{
      status: 'no_match';
      release_id: string;
      lease_expires_at: string;
      result: SopEmptyResult;
      reasons: readonly [];
    }>;

export type SopQueryResponse = SopQueryReadResult & Readonly<{ request_id: string }>;
