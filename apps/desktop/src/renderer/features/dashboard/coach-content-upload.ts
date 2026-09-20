export {
  COACH_UPLOAD_MAX_BYTES,
  COACH_UPLOAD_MAX_ROWS,
  parseCoachUploadCsv,
  type CoachUploadFailure,
  type CoachUploadFailureCode,
  type CoachUploadResult,
  type CoachUploadRow,
  type CoachUploadSuccess,
} from '@shared/coach-content-upload';

import {
  COACH_UPLOAD_MAX_BYTES,
  parseCoachUploadCsv,
  type CoachUploadResult,
} from '@shared/coach-content-upload';

const BINARY_MESSAGE =
  '当前切片只在本页读取 CSV 文本表。二进制 Excel 未解析，也未连接飞书或 Wiki。可改用合成样例按钮。';

function fail(code: 'unsupported-type' | 'too-large' | 'binary-workbook', message: string): CoachUploadResult {
  return Object.freeze({ ok: false, code, message });
}

function isZipSignature(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

function readFileBytes(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('FILE_READ_FAILED'));
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(new Uint8Array(reader.result));
        return;
      }
      reject(new Error('FILE_READ_FAILED'));
    };
    reader.readAsArrayBuffer(file);
  });
}

export async function readCoachUploadFile(file: File): Promise<CoachUploadResult> {
  const sourceName = file.name.trim() || 'untitled.csv';
  const lower = sourceName.toLowerCase();
  if (!lower.endsWith('.csv') && !lower.endsWith('.xlsx')) {
    return fail('unsupported-type', '仅接受 .csv 或 .xlsx。');
  }
  if (file.size > COACH_UPLOAD_MAX_BYTES) {
    return fail('too-large', `文件超过 ${COACH_UPLOAD_MAX_BYTES / 1024}KiB。当前切片只做本地草稿预览。`);
  }
  const bytes = await readFileBytes(file);
  // Renderer cannot unzip workbooks. ZIP/OLE files fail closed instead of
  // pretending Feishu/Wiki or a real Excel parser is connected.
  if (bytes.includes(0) || isZipSignature(bytes)) {
    return fail('binary-workbook', BINARY_MESSAGE);
  }
  return parseCoachUploadCsv(new TextDecoder('utf-8').decode(bytes), sourceName);
}
