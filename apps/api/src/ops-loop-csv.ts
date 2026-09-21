export function sopAllergyStepNeedsStopCopy(title: string, body: string): boolean {
  if (!title.includes('过敏') && !body.includes('过敏')) return false;
  return !(body.includes('停手') && body.includes('确认'));
}

export type SopCsvNode = Readonly<{
  node_id: string;
  parent_node_id: string | null;
  title: string;
  body: string;
  sort_key: number;
}>;

const REQUIRED = ['node_id', 'parent_node_id', 'title', 'body', 'sort_key'] as const;

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') {
        current += '"';
        index += 1;
        continue;
      }
      if (char === '"') {
        quoted = false;
        continue;
      }
      current += char;
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === ',') {
      cells.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells;
}

export function parseSopCsv(text: string): SopCsvNode[] | null {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (normalized.length < 1 || normalized.length > 1_000_000) return null;
  const lines = normalized.split('\n').filter((line) => line.trim().length > 0);
  if (lines.length < 2 || lines.length > 501) return null;
  const header = splitCsvLine(lines[0] ?? '').map((cell) => cell.trim().toLowerCase());
  if (header.length !== REQUIRED.length || REQUIRED.some((name, index) => header[index] !== name)) {
    return null;
  }
  const nodes: SopCsvNode[] = [];
  const seen = new Set<string>();
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    if (cells.length !== REQUIRED.length) return null;
    const nodeId = cells[0]?.trim() ?? '';
    const parent = (cells[1]?.trim() ?? '') === '' ? null : cells[1]?.trim() ?? null;
    const title = cells[2]?.trim() ?? '';
    const body = cells[3] ?? '';
    const sortRaw = cells[4]?.trim() ?? '';
    if (!/^-?\d+$/.test(sortRaw)) return null;
    const sortKey = Number(sortRaw);
    if (nodeId.length < 1 || nodeId.length > 128 || seen.has(nodeId)) return null;
    if (parent !== null && (parent.length < 1 || parent.length > 128)) return null;
    if (title.length < 1 || title.length > 256) return null;
    if (body.length < 1 || body.length > 20_000) return null;
    if (sopAllergyStepNeedsStopCopy(title, body)) return null;
    if (!Number.isInteger(sortKey)) return null;
    seen.add(nodeId);
    nodes.push(Object.freeze({
      node_id: nodeId,
      parent_node_id: parent,
      title,
      body,
      sort_key: sortKey,
    }));
  }
  return nodes;
}
