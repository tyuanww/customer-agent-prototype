import { sopWorkbookPreview, type SopWorkbookOpenReply, type SopWorkbookParseRow } from './sop-workbook-preview';

export const LOCAL_SOP_WORKBOOK_MAX_BYTES = 10 * 1024 * 1024;

export type LocalSopWorkbookParse = {
  ok: boolean;
  rows: readonly SopWorkbookParseRow[];
  issues: readonly { code: string; sheet: string; row: number; fix: string }[];
};

/** Parser port. Implementations may read a workbook. They must not publish or call the seat catalog. */
export type LocalSopWorkbookParser = (bytes: Buffer) => Promise<LocalSopWorkbookParse>;

/** Turn one local file into an unpublished preview. The caller supplies the bytes and the parser. */
export async function openLocalSopWorkbook(
  fileName: string,
  bytes: Buffer,
  parse: LocalSopWorkbookParser,
): Promise<Exclude<SopWorkbookOpenReply, { code: 'CANCELLED' | 'UNAVAILABLE' }>> {
  if (bytes.length > LOCAL_SOP_WORKBOOK_MAX_BYTES) {
    return { ok: false, code: 'INVALID', message: '文件超过 10MB，没有读取。' };
  }
  try {
    return sopWorkbookPreview(fileName, await parse(bytes));
  } catch {
    return { ok: false, code: 'INVALID', message: '这个文件读不开。' };
  }
}
