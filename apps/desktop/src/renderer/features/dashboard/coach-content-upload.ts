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
    return fail('too-large', `文件超过 ${COACH_UPLOAD_MAX_BYTES / (1024 * 1024)}MiB。`);
  }
  const bytes = await readFileBytes(file);
  if (isZipSignature(bytes) || lower.endsWith('.xlsx') && bytes.includes(0)) {
    const api = window.dashboardContent;
    if (!api?.parseUpload) {
      return fail('binary-workbook', 'Excel 需工作台主进程解析。当前没有产品会话通道。');
    }
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const parsed = await api.parseUpload({
      sourceName,
      bytes: copy.buffer,
    });
    if ('code' in parsed && parsed.ok === false && 'message' in parsed) {
      return {
        ok: false,
        code: parsed.code === 'too-large' || parsed.code === 'unsupported-type' || parsed.code === 'empty'
          || parsed.code === 'invalid-table' || parsed.code === 'binary-workbook'
          ? parsed.code
          : 'binary-workbook',
        message: parsed.message,
      };
    }
    if (parsed.ok === true && 'rows' in parsed && 'csvText' in parsed) {
      return {
        ok: true,
        sourceName: parsed.sourceName,
        rows: parsed.rows,
        csvText: parsed.csvText,
      };
    }
    return fail('binary-workbook', BINARY_MESSAGE);
  }
  return parseCoachUploadCsv(new TextDecoder('utf-8').decode(bytes), sourceName);
}
