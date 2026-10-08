import { ContractValidationError, parseContractSchema } from '@customer-agent/contracts';
import type { AuthenticatedUser } from '../auth-service.js';
import { authenticatedProductSession } from '../product-auth-service.js';
import { IntakeRejection, type createIntakeTransactions } from './transaction.js';

/** Directory SQL owns current names, cursor signatures and query membership.
 * The existing transaction owner owns the final guard and COMMIT. Neither the
 * private envelope nor session reference can leave this read adapter. */
export function createIntakeShopDirectory(run: ReturnType<typeof createIntakeTransactions>) {
  const directoryError = (error: unknown): never => {
    const message = error && typeof error === 'object' && 'message' in error ? error.message : null;
    const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
    if (code === 'P0001') {
      if (message === 'SHOP_DIRECTORY_CURSOR') throw new IntakeRejection(message,'VALIDATION');
      if (message === 'SHOP_DIRECTORY_SESSION') throw new IntakeRejection(message,'UNAUTHORIZED');
      if (message === 'SHOP_DIRECTORY_CHANGED' || message === 'SHOP_DIRECTORY_EXPIRED' || message === 'SHOP_DISPLAY_MISSING') throw new IntakeRejection(message);
      if (message === 'SHOP_DIRECTORY_UNAVAILABLE') throw new IntakeRejection(message,'OVERLOADED');
    }
    throw error;
  };
  // Both reads of this value validate server output, never caller input. Keep
  // a corrupt prepared page out of the shared owner's FILE_INVALID mapping.
  const decodeDirectory = (value: unknown) => {
    try { return parseContractSchema('IntakeShopDirectory',value); }
    catch (error) {
      if (error instanceof ContractValidationError) throw new IntakeRejection('SHOP_DIRECTORY_UNAVAILABLE','OVERLOADED');
      throw error;
    }
  };
  return {
    async shopDirectory(actor: AuthenticatedUser, raw: unknown) {
      const result = await run(actor,'shop-directory',null,null,async client => {
        const hash = authenticatedProductSession(actor);
        if (!hash) throw new IntakeRejection('SHOP_DIRECTORY_SESSION','UNAUTHORIZED');
        if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(k=>!['cursor','limit'].includes(k))) throw new IntakeRejection('SHOP_DIRECTORY_CURSOR','VALIDATION');
        const cursor = Reflect.get(raw,'cursor'), limit = Reflect.get(raw,'limit') ?? 50;
        if ((cursor !== undefined && (typeof cursor !== 'string' || !cursor.length || Buffer.byteLength(cursor)>512))
          || !Number.isInteger(limit) || limit<1 || limit>100) throw new IntakeRejection('SHOP_DIRECTORY_CURSOR','VALIDATION');
        let envelope: Record<string,unknown>;
        try {
          const prepared = await client.query<{ envelope: Record<string,unknown> }>('SELECT content_intake.prepare_shop_directory_read($1,$2,$3) AS envelope',[hash,cursor ?? null,limit]);
          envelope = prepared.rows[0]!.envelope;
        } catch (error) { return directoryError(error); }
        const value = decodeDirectory(envelope.value);
        if (Buffer.byteLength(JSON.stringify(value))>128*1024) throw new IntakeRejection('SHOP_DIRECTORY_UNAVAILABLE','OVERLOADED');
        client.validUntil(Date.parse(value.validUntil));
        client.beforeCommit(async()=>{
          try { await client.query('SELECT content_intake.finish_shop_directory_transaction($1::jsonb)',[JSON.stringify(envelope)]); }
          catch (error) { directoryError(error); }
        });
        return value;
      },decodeDirectory);
      // The shared owner rejects absent/stale actors before entering work. Keep
      // this GET's frozen errors without changing predecessor endpoint behavior.
      if (!result.ok) {
        if (result.reason==='SCOPE_DENIED' && ['NOT_FOUND','UNAUTHORIZED'].includes(result.code)) return {...result,code:'UNAUTHORIZED' as const,reason:'SHOP_DIRECTORY_SESSION' as const};
        if (result.reason==='ORG_FACTS_UNAVAILABLE' || result.reason==='PERMISSION_CHANGED') return {...result,code:'CONFLICT' as const,reason:'SHOP_DIRECTORY_EXPIRED' as const};
        if (result.code==='INTERNAL_ERROR' || result.reason==='COMMIT_UNKNOWN') return {...result,code:'OVERLOADED' as const,reason:'SHOP_DIRECTORY_UNAVAILABLE' as const};
      }
      return result;
    },
  };
}
