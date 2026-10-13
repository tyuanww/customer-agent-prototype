/** Desk knowledge borrowed from the customer-service library:
 * one item belongs to a persona, carries a category and a validity window,
 * and reaches a seat only after it is effective. Tacit notes stay out of that set
 * until an operator promotes them, and promotion still starts inactive.
 */

import { parseCoachUploadCsv } from './coach-content-upload';
import type { DashboardContentDomain } from './dashboard-content';

export const DESK_PERSONAS = [
  { id: 'shop', name: '全店' },
  { id: 'presale', name: '售前客服' },
  { id: 'aftersale', name: '售后客服' },
] as const;

export const DESK_CATEGORIES = [
  { code: 'product', label: '商品介绍' },
  { code: 'pairing', label: '搭配建议' },
  { code: 'presale', label: '售前咨询' },
  { code: 'aftersale', label: '售后服务' },
  { code: 'custom', label: '自定分类' },
] as const;

export const TACIT_KINDS = [
  { code: 'profile', label: '用户画像' },
  { code: 'preference', label: '偏好习惯' },
  { code: 'rule', label: '规则约束' },
  { code: 'feedback', label: '行为反馈' },
  { code: 'insight', label: '经验洞察' },
  { code: 'context', label: '情境上下文' },
  { code: 'procedure', label: '操作流程' },
] as const;

export type DeskRole = 'operator' | 'seat';
export type PersonaId = (typeof DESK_PERSONAS)[number]['id'];
export type CategoryCode = (typeof DESK_CATEGORIES)[number]['code'];
export type TacitKind = (typeof TACIT_KINDS)[number]['code'];
export type Validity = 'always' | 'inactive' | 'scheduled';
export type ParseState = 'ok' | 'file_failed' | 'service_failed';

export type KnowledgeItem = {
  id: string;
  personaId: PersonaId;
  name: string;
  category: CategoryCode;
  customCategory: string | null;
  fileName: string;
  body: string;
  parseState: ParseState;
  validity: Validity;
  validFrom: string | null;
  validUntil: string | null;
  updatedAt: string;
};

export type TacitNote = {
  id: string;
  personaId: PersonaId;
  kind: TacitKind;
  text: string;
  pinned: boolean;
  promotedItemId: string | null;
  createdAt: string;
};

export type DeskItemView = KnowledgeItem & { statusLabel: string; delivered: boolean };

export type DeskView = {
  signedIn: boolean;
  role: DeskRole | null;
  displayName: string | null;
  personas: readonly { id: PersonaId; name: string }[];
  selectedPersonaId: PersonaId;
  items: DeskItemView[];
  delivered: DeskItemView[];
  tacit: TacitNote[];
  revision: number;
  notice: string | null;
  persistence: 'ok' | 'unreadable' | 'unwritable';
};

export type DeskCommand =
  | { action: 'select-persona'; personaId: string }
  | { action: 'upload'; personaId: string; name: string; category: string; customCategory?: string; fileName: string; text: string; validity: string; validFrom?: string; validUntil?: string }
  | { action: 'import-csv'; personaId: string; fileName: string; csvText: string; category: string; customCategory?: string }
  | { action: 'set-validity'; id: string; validity: string; validFrom?: string; validUntil?: string }
  | { action: 'retry'; id: string }
  | { action: 'remove'; id: string }
  | { action: 'add-tacit'; personaId: string; kind: string; text: string }
  | { action: 'promote'; noteId: string };

export type DeskKnowledgeApi = {
  current(): Promise<DeskReply>;
  command(command: DeskCommand): Promise<DeskReply>;
};

export type DeskReply =
  | { ok: true; view: DeskView }
  | { ok: false; code: 'VALIDATION' | 'FORBIDDEN' | 'UNAUTHORIZED' | 'UNAVAILABLE'; message: string; view: DeskView | null };

const PERSONA_IDS = new Set<string>(DESK_PERSONAS.map((persona) => persona.id));
const CATEGORY_CODES = new Set<string>(DESK_CATEGORIES.map((category) => category.code));
const TACIT_CODES = new Set<string>(TACIT_KINDS.map((kind) => kind.code));
const VALIDITY = new Set<string>(['always', 'inactive', 'scheduled']);
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

export function isPersonaId(value: string): value is PersonaId {
  return PERSONA_IDS.has(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function isDeskCommand(value: unknown): value is DeskCommand {
  if (!isRecord(value) || typeof value.action !== 'string') return false;
  if (value.action === 'select-persona') return typeof value.personaId === 'string';
  if (value.action === 'retry' || value.action === 'remove') return typeof value.id === 'string';
  if (value.action === 'promote') return typeof value.noteId === 'string';
  if (value.action === 'add-tacit') return typeof value.personaId === 'string' && typeof value.kind === 'string' && typeof value.text === 'string';
  if (value.action === 'set-validity') {
    return typeof value.id === 'string' && typeof value.validity === 'string'
      && (value.validFrom === undefined || typeof value.validFrom === 'string')
      && (value.validUntil === undefined || typeof value.validUntil === 'string');
  }
  if (value.action === 'upload') {
    return typeof value.personaId === 'string' && typeof value.name === 'string' && typeof value.category === 'string'
      && typeof value.fileName === 'string' && typeof value.text === 'string' && typeof value.validity === 'string'
      && (value.customCategory === undefined || typeof value.customCategory === 'string')
      && (value.validFrom === undefined || typeof value.validFrom === 'string')
      && (value.validUntil === undefined || typeof value.validUntil === 'string');
  }
  if (value.action === 'import-csv') {
    return typeof value.personaId === 'string' && typeof value.fileName === 'string' && typeof value.csvText === 'string'
      && typeof value.category === 'string' && (value.customCategory === undefined || typeof value.customCategory === 'string');
  }
  return false;
}

export function statusLabel(item: Pick<KnowledgeItem, 'parseState' | 'validity' | 'validFrom' | 'validUntil'>, now: string): string {
  if (item.parseState === 'file_failed') return '文件无法解析';
  if (item.parseState === 'service_failed') return '解析服务异常';
  if (item.validity === 'inactive') return '未生效';
  if (item.validity === 'scheduled') {
    const at = Date.parse(now);
    const from = item.validFrom ? Date.parse(item.validFrom) : Number.NaN;
    const until = item.validUntil ? Date.parse(item.validUntil) : Number.NaN;
    if (!Number.isFinite(from) || !Number.isFinite(until)) return '未生效';
    if (at < from) return '待生效';
    if (at > until) return '已失效';
  }
  return '生效中';
}

export function isDelivered(item: KnowledgeItem, personaId: PersonaId, now: string): boolean {
  if (item.personaId !== 'shop' && item.personaId !== personaId) return false;
  return statusLabel(item, now) === '生效中';
}

type Snapshot = {
  version: 1;
  seq: number;
  revision: number;
  selectedPersonaId: PersonaId;
  items: KnowledgeItem[];
  notes: TacitNote[];
};

function emptySnapshot(): Snapshot {
  return { version: 1, seq: 0, revision: 0, selectedPersonaId: 'shop', items: [], notes: [] };
}

function isItem(value: unknown): value is KnowledgeItem {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string' && isPersonaId(String(value.personaId)) && typeof value.name === 'string'
    && CATEGORY_CODES.has(String(value.category)) && (value.customCategory === null || typeof value.customCategory === 'string')
    && typeof value.fileName === 'string' && typeof value.body === 'string'
    && (value.parseState === 'ok' || value.parseState === 'file_failed' || value.parseState === 'service_failed')
    && VALIDITY.has(String(value.validity))
    && (value.validFrom === null || typeof value.validFrom === 'string')
    && (value.validUntil === null || typeof value.validUntil === 'string')
    && typeof value.updatedAt === 'string';
}

function isNote(value: unknown): value is TacitNote {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string' && isPersonaId(String(value.personaId)) && TACIT_CODES.has(String(value.kind))
    && typeof value.text === 'string' && typeof value.pinned === 'boolean'
    && (value.promotedItemId === null || typeof value.promotedItemId === 'string')
    && typeof value.createdAt === 'string';
}

export function readSnapshot(raw: string | null): { snapshot: Snapshot; persistence: DeskView['persistence'] } {
  if (raw === null || raw.trim() === '') return { snapshot: emptySnapshot(), persistence: 'ok' };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.items) || !Array.isArray(parsed.notes)) {
      return { snapshot: emptySnapshot(), persistence: 'unreadable' };
    }
    if (!parsed.items.every(isItem) || !parsed.notes.every(isNote)) return { snapshot: emptySnapshot(), persistence: 'unreadable' };
    const selected = typeof parsed.selectedPersonaId === 'string' && isPersonaId(parsed.selectedPersonaId) ? parsed.selectedPersonaId : 'shop';
    const seq = typeof parsed.seq === 'number' && Number.isInteger(parsed.seq) && parsed.seq >= 0 ? parsed.seq : 0;
    const revision = typeof parsed.revision === 'number' && Number.isInteger(parsed.revision) && parsed.revision >= 0 ? parsed.revision : 0;
    return { snapshot: { version: 1, seq, revision, selectedPersonaId: selected, items: parsed.items, notes: parsed.notes }, persistence: 'ok' };
  } catch {
    return { snapshot: emptySnapshot(), persistence: 'unreadable' };
  }
}

function windowOf(validity: string, validFrom: string | undefined, validUntil: string | undefined): { validity: Validity; validFrom: string | null; validUntil: string | null } | null {
  if (validity === 'always' || validity === 'inactive') return { validity, validFrom: null, validUntil: null };
  if (validity !== 'scheduled' || !validFrom || !validUntil || !ISO.test(validFrom) || !ISO.test(validUntil)) return null;
  if (Date.parse(validFrom) > Date.parse(validUntil)) return null;
  return { validity, validFrom, validUntil };
}

function categoryOf(category: string, customCategory: string | undefined): { category: CategoryCode; customCategory: string | null } | null {
  if (!CATEGORY_CODES.has(category)) return null;
  if (category !== 'custom') return { category: category as CategoryCode, customCategory: null };
  const label = customCategory?.trim() ?? '';
  if (label.length < 1 || label.length > 20) return null;
  return { category: 'custom', customCategory: label };
}

function fileNameOf(fileName: string): string | null {
  const name = fileName.trim();
  if (name.length < 1 || name.length > 120 || name.includes('/') || name.includes('\\')) return null;
  return name;
}

function placeImported(domain: DashboardContentDomain | undefined, fallbackPersona: PersonaId, fallback: { category: CategoryCode; customCategory: string | null }): { personaId: PersonaId; category: CategoryCode; customCategory: string | null } {
  if (domain === 'presale') return { personaId: 'presale', category: 'presale', customCategory: null };
  if (domain === 'aftersale') return { personaId: 'aftersale', category: 'aftersale', customCategory: null };
  if (domain === 'product') return { personaId: 'shop', category: 'product', customCategory: null };
  if (domain === 'campaign') return { personaId: 'shop', category: 'custom', customCategory: '活动' };
  return { personaId: fallbackPersona, category: fallback.category, customCategory: fallback.customCategory };
}

export class DeskKnowledgeStore {
  private snapshot: Snapshot;
  private persistence: DeskView['persistence'];
  private importNotice: string | null = null;

  constructor(private readonly clock: { now(): string; load(): string | null; save(raw: string): void }) {
    const loaded = readSnapshot(clock.load());
    this.snapshot = loaded.snapshot;
    this.persistence = loaded.persistence;
  }

  reply(role: DeskRole | null, displayName: string | null, notice: string | null = null): DeskReply {
    return { ok: true, view: this.view(role, displayName, notice) };
  }

  command(role: DeskRole | null, command: unknown, displayName: string | null): DeskReply {
    if (!role) return { ok: false, code: 'UNAUTHORIZED', message: '请先在查询窗口登录。', view: this.view(null, displayName, '请先在查询窗口登录。') };
    if (!isDeskCommand(command)) return { ok: false, code: 'VALIDATION', message: '请检查输入。', view: this.view(role, displayName) };
    const denied = role === 'seat' && command.action !== 'select-persona' && command.action !== 'add-tacit';
    if (denied) {
      const message = '当前账号暂无使用权限，可向主账号发起权限申请。';
      return { ok: false, code: 'FORBIDDEN', message, view: this.view(role, displayName, message) };
    }
    const failure = this.apply(command);
    const imported = this.importNotice;
    this.importNotice = null;
    if (failure) return { ok: false, code: 'VALIDATION', message: failure, view: this.view(role, displayName, failure) };
    this.snapshot.revision += command.action === 'select-persona' ? 0 : 1;
    try {
      this.clock.save(JSON.stringify(this.snapshot));
      if (this.persistence === 'unwritable') this.persistence = 'ok';
    } catch {
      this.persistence = 'unwritable';
      return { ok: false, code: 'UNAVAILABLE', message: '知识已更新，但没能写入本机。', view: this.view(role, displayName, '知识已更新，但没能写入本机。') };
    }
    return { ok: true, view: this.view(role, displayName, imported) };
  }

  private apply(command: DeskCommand): string | null {
    if (command.action === 'select-persona') {
      if (!isPersonaId(command.personaId)) return '请选择人设。';
      this.snapshot.selectedPersonaId = command.personaId;
      return null;
    }
    if (command.action === 'upload') return this.upload(command);
    if (command.action === 'import-csv') return this.importCsv(command);
    if (command.action === 'set-validity') return this.setValidity(command);
    if (command.action === 'retry') return this.retry(command.id);
    if (command.action === 'remove') {
      const before = this.snapshot.items.length;
      this.snapshot.items = this.snapshot.items.filter((item) => item.id !== command.id);
      return this.snapshot.items.length === before ? '找不到这条知识。' : null;
    }
    if (command.action === 'add-tacit') return this.addTacit(command);
    return this.promote(command.noteId);
  }

  private importCsv(command: Extract<DeskCommand, { action: 'import-csv' }>): string | null {
    if (!isPersonaId(command.personaId)) return '请选择人设。';
    const fallback = categoryOf(command.category, optionalText(command.customCategory));
    if (!fallback) return '请选择分类。自定分类需要 1 到 20 个字。';
    if (new TextEncoder().encode(command.csvText).length > 10 * 1024 * 1024) return '文件超过限制。请选择不大于 10 MiB 的 CSV。';
    const parsed = parseCoachUploadCsv(command.csvText, command.fileName || '导入.csv');
    if (!parsed.ok) return parsed.message;
    const fileName = fileNameOf(command.fileName) ?? '导入.csv';
    let skipped = 0;
    const rows: KnowledgeItem[] = [];
    for (const row of parsed.rows) {
      const name = row.scene.trim();
      const body = row.script.trim();
      if (name.length < 2 || name.length > 80 || body.length < 1 || body.length > 200_000) {
        skipped += 1;
        continue;
      }
      const place = placeImported(row.domain, command.personaId, fallback);
      rows.push({
        id: `k${++this.snapshot.seq}`, personaId: place.personaId, name, category: place.category, customCategory: place.customCategory,
        fileName, body, parseState: 'ok', validity: 'inactive', validFrom: null, validUntil: null, updatedAt: this.clock.now(),
      });
    }
    if (rows.length === 0) return '没有可以导入的问答。问题需要 2 到 80 个字。';
    this.snapshot.items.push(...rows);
    this.importNotice = `已导入 ${rows.length} 条，状态是未生效。` + (skipped > 0 ? `跳过 ${skipped} 条。` : '');
    return null;
  }

  private upload(command: Extract<DeskCommand, { action: 'upload' }>): string | null {
    if (!isPersonaId(command.personaId)) return '请选择人设。';
    const name = command.name.trim();
    if (name.length < 2 || name.length > 80) return '问题需要 2 到 80 个字。';
    const category = categoryOf(command.category, optionalText(command.customCategory));
    if (!category) return '请选择分类。自定分类需要 1 到 20 个字。';
    const fileName = fileNameOf(command.fileName);
    if (!fileName) return '请填写文件名，不要带路径。';
    const text = command.text.trim();
    if (text.length < 1) return '请填写答案。';
    if (text.length > 200_000) return '答案超过限制。';
    const span = windowOf(command.validity, optionalText(command.validFrom), optionalText(command.validUntil));
    if (!span) return '定时生效需要开始和结束时间。';
    const id = `k${++this.snapshot.seq}`;
    this.snapshot.items.push({
      id, personaId: command.personaId, name, ...category, fileName,
      body: text, parseState: 'ok', ...span, updatedAt: this.clock.now(),
    });
    return null;
  }

  private setValidity(command: Extract<DeskCommand, { action: 'set-validity' }>): string | null {
    const item = this.snapshot.items.find((candidate) => candidate.id === command.id);
    if (!item) return '找不到这条知识。';
    const span = windowOf(command.validity, optionalText(command.validFrom), optionalText(command.validUntil));
    if (!span) return '定时生效需要开始和结束时间。';
    item.validity = span.validity;
    item.validFrom = span.validFrom;
    item.validUntil = span.validUntil;
    item.updatedAt = this.clock.now();
    return null;
  }

  private retry(id: string): string | null {
    const item = this.snapshot.items.find((candidate) => candidate.id === id);
    if (!item) return '找不到这条知识。';
    item.parseState = item.body.trim().length === 0 ? 'file_failed' : 'ok';
    item.updatedAt = this.clock.now();
    return null;
  }

  private addTacit(command: Extract<DeskCommand, { action: 'add-tacit' }>): string | null {
    if (!isPersonaId(command.personaId)) return '请选择人设。';
    if (!TACIT_CODES.has(command.kind)) return '请选择隐性知识类型。';
    const text = command.text.trim();
    if (text.length < 2 || text.length > 500) return '隐性知识需要 2 到 500 个字。';
    this.snapshot.notes.push({
      id: `t${++this.snapshot.seq}`, personaId: command.personaId, kind: command.kind as TacitKind,
      text, pinned: false, promotedItemId: null, createdAt: this.clock.now(),
    });
    return null;
  }

  private promote(noteId: string): string | null {
    const note = this.snapshot.notes.find((candidate) => candidate.id === noteId);
    if (!note) return '找不到这条隐性知识。';
    if (note.promotedItemId) return '这条已经交过，不会再次写进知识库。';
    const id = `k${++this.snapshot.seq}`;
    this.snapshot.items.push({
      id, personaId: note.personaId, name: note.text.slice(0, 50), category: 'custom', customCategory: '隐性知识',
      fileName: '隐性知识.txt', body: note.text, parseState: 'ok', validity: 'inactive', validFrom: null, validUntil: null,
      updatedAt: this.clock.now(),
    });
    note.promotedItemId = id;
    return null;
  }

  private view(role: DeskRole | null, displayName: string | null, notice: string | null = null): DeskView {
    const now = this.clock.now();
    const selected = this.snapshot.selectedPersonaId;
    const signedIn = role !== null;
    const own = signedIn ? this.snapshot.items.filter((item) => item.personaId === selected) : [];
    const items = own.map((item) => ({ ...item, statusLabel: statusLabel(item, now), delivered: isDelivered(item, selected, now) }));
    const delivered = signedIn
      ? this.snapshot.items.filter((item) => isDelivered(item, selected, now)).map((item) => ({ ...item, statusLabel: '生效中', delivered: true }))
      : [];
    const tacit = signedIn ? this.snapshot.notes.filter((note) => note.personaId === selected) : [];
    const persistenceNotice = this.persistence === 'unreadable' ? '本机知识库读不出来，已从空库开始。' : this.persistence === 'unwritable' ? '没能写入本机知识库。' : null;
    return {
      signedIn, role, displayName, personas: DESK_PERSONAS, selectedPersonaId: selected,
      items: role === 'seat' ? delivered.filter((item) => item.personaId === selected || item.personaId === 'shop') : items,
      delivered, tacit, revision: this.snapshot.revision,
      notice: notice ?? persistenceNotice,
      persistence: this.persistence,
    };
  }
}
