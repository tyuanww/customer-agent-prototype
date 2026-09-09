import { exactKeys, productFailure, type ProductFailure } from './product-session';
import { isQueryIdentity, queryFailure, type QueryIdentity } from './product-search';

export const SYNTHETIC_HELP_CONTACT = '合成话术师（演示）\n请先让客户稍等，再联系话术师或运营核实。必要时升级客服经理。\n此卡片只表示联系方式已准备，不是转交回执。';
export const FORBIDDEN_HELP_PHRASES = ['已转交成功', '转交成功', '已转交', '转交完成'] as const;
export const ALLOWED_HELP_STATUS = ['待核实', '已打开入口', '已复制联系方式'] as const;
export type HelpStatus = (typeof ALLOWED_HELP_STATUS)[number];
export const SYNTHETIC_HELP_HTML = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>合成求助入口</title></head><body><h1>合成求助入口</h1><p>请先让客户稍等，再联系话术师或运营核实。必要时升级客服经理。</p><p>此窗口只表示入口已打开，不是转交回执。</p></body></html>`;
export type HelpAction = 'open_feishu' | 'copy_contact';
export type TerminalOutcome = 'dismissed' | 'no_hit_exit' | 'timeout';
export type ProductEscalateRequest = QueryIdentity & { queryId: string; action: HelpAction };
export type ProductTerminalRequest = QueryIdentity & { queryId: string; outcome: TerminalOutcome };
export type ProductEscalateResult = (QueryIdentity & {
  ok: true; escalateId: string; action: HelpAction; opened: boolean; eventStatus: 'recorded' | 'unrecorded' | 'disabled';
}) | (ProductFailure & { generation: number });
export type ProductTerminalResult = (QueryIdentity & { ok: true; recorded: boolean }) | (ProductFailure & { generation: number });
export const helpFailure = (code: ProductFailure['code'], identity: QueryIdentity) => queryFailure(code, identity);
const QUERY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isProductEscalateRequest(v: unknown): v is ProductEscalateRequest {
  return exactKeys(v, ['sessionEpoch', 'generation', 'queryId', 'action']) && isQueryIdentity(v)
    && typeof v.queryId === 'string' && QUERY_ID.test(v.queryId) && ['open_feishu', 'copy_contact'].includes(v.action as string);
}
export function isProductTerminalRequest(v: unknown): v is ProductTerminalRequest {
  return exactKeys(v, ['sessionEpoch', 'generation', 'queryId', 'outcome']) && isQueryIdentity(v)
    && typeof v.queryId === 'string' && QUERY_ID.test(v.queryId) && ['dismissed', 'no_hit_exit', 'timeout'].includes(v.outcome as string);
}
export function isProductEscalateResult(v: unknown): v is ProductEscalateResult {
  if (!isQueryIdentity(v)) return false;
  const x = v as Record<string, unknown>;
  if (x.ok === false) return exactKeys(x, ['ok', 'sessionEpoch', 'generation', 'code', 'message'])
    && typeof x.code === 'string' && x.message === productFailure(x.code as ProductFailure['code']).message;
  return x.ok === true && exactKeys(x, ['ok', 'sessionEpoch', 'generation', 'escalateId', 'action', 'opened', 'eventStatus'])
    && typeof x.escalateId === 'string' && ['open_feishu', 'copy_contact'].includes(x.action as string)
    && typeof x.opened === 'boolean' && ['recorded', 'unrecorded', 'disabled'].includes(x.eventStatus as string);
}
export function isProductTerminalResult(v: unknown): v is ProductTerminalResult {
  if (!isQueryIdentity(v)) return false;
  const x = v as Record<string, unknown>;
  if (x.ok === false) return exactKeys(x, ['ok', 'sessionEpoch', 'generation', 'code', 'message'])
    && typeof x.code === 'string' && x.message === productFailure(x.code as ProductFailure['code']).message;
  return x.ok === true && exactKeys(x, ['ok', 'sessionEpoch', 'generation', 'recorded']) && typeof x.recorded === 'boolean';
}
export type ProductHelpApi = {
  escalate(request: ProductEscalateRequest): Promise<ProductEscalateResult>;
  recordTerminal(request: ProductTerminalRequest): Promise<ProductTerminalResult>;
};
