/** Local preview of a six-sheet SOP workbook. Not a published catalog and not the seat tree. */
export type SopWorkbookLine = {
  row: number;
  text: string;
  images: number;
};

export type SopWorkbookSheet = {
  name: string;
  lines: SopWorkbookLine[];
};

export type SopWorkbookIssue = {
  code: string;
  sheet: string;
  row: number;
  fix: string;
};

export type SopWorkbookView = {
  ok: true;
  published: false;
  fileName: string;
  accepted: boolean;
  sheets: SopWorkbookSheet[];
  issues: SopWorkbookIssue[];
};

export type SopWorkbookOpenReply =
  | SopWorkbookView
  | { ok: false; code: 'CANCELLED' | 'UNAVAILABLE' | 'INVALID'; message: string };

export type SopWorkbookParseRow = {
  sheet: string;
  row: number;
  text: string;
  attachmentIds: readonly string[];
};

/** Drop image bytes. A rejected workbook contributes no rows. */
export function sopWorkbookPreview(
  fileName: string,
  parsed: {
    ok: boolean;
    rows: readonly SopWorkbookParseRow[];
    issues: readonly { code: string; sheet: string; row: number; fix: string }[];
  },
): SopWorkbookView {
  const sheets = new Map<string, SopWorkbookSheet>();
  if (parsed.ok) {
    for (const row of parsed.rows) {
      const sheet = sheets.get(row.sheet) ?? { name: row.sheet, lines: [] };
      sheet.lines.push({ row: row.row, text: row.text, images: row.attachmentIds.length });
      sheets.set(row.sheet, sheet);
    }
  }
  return {
    ok: true,
    published: false,
    fileName,
    accepted: parsed.ok,
    sheets: [...sheets.values()],
    issues: parsed.issues.map((issue) => ({ code: issue.code, sheet: issue.sheet, row: issue.row, fix: issue.fix })),
  };
}
