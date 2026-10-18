/** Deterministic local preview sample. Not a live usage feed. */
const hash = (str: string) => {
  let h = 2166136261;
  for (const c of str) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
};
const surnames = [...'李王张刘陈杨赵黄周吴'];
const given = [...'华磊琳静敏强洋婷杰涛雪宇'];
export const V9_PEOPLE = surnames.flatMap((a) => given.map((g) => ({ name: a + g, role: hash(a + g) % 9 === 0 ? '客服主管' : '客服' })));
export const V9_SCRIPTS: ReadonlyArray<readonly [string, string]> = [
  ['运费谁承担', '售后'], ['七天无理由怎么算', '售后'], ['退换货流程', '售后'], ['发货时间', '售前'], ['尺码怎么选', '售前'],
  ['活动怎么参加', '活动'], ['优惠券怎么用', '活动'], ['产品材质', '产品'], ['洗涤方式', '产品'], ['保修多久', '产品'],
];
const counts: Record<string, Record<string, number>> = {};
for (const person of V9_PEOPLE) {
  counts[person.name] = {};
  for (const [name] of V9_SCRIPTS) {
    const h = hash(person.name + name);
    counts[person.name][name] = h % 100 < 38 ? 1 + ((h >>> 8) % 40) : 0;
  }
}
export const V9_MISS: ReadonlyArray<readonly [string, number, string]> = [
  ['能开发票吗', 38, '2026-10-13 15:42'],
  ['可以改地址吗', 27, '2026-10-13 11:08'],
  ['赠品怎么领', 19, '2026-10-12 20:15'],
  ['发什么快递', 11, '2026-10-12 09:30'],
  ['支持分期吗', 8, '2026-10-11 18:02'],
];
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
const total7 = sum(V9_PEOPLE.flatMap((p) => Object.values(counts[p.name])));
const miss7 = sum(V9_MISS.map((row) => row[1]));

export function v9Headline(days: 7 | 30) {
  const use = Math.round(total7 * (days === 7 ? 1 : 3.6));
  const miss = Math.round(miss7 * (days === 7 ? 1 : 3.5));
  const rate = (use / (use + miss) * 100).toFixed(1);
  return { use: use.toLocaleString('en-US'), miss: miss.toLocaleString('en-US'), rate: `${rate}%` };
}

function series(n: number, total: number, seed: string) {
  const weights = Array.from({ length: n }, (_, i) => 0.45 + (hash(seed + i) % 100) / 80);
  const all = sum(weights);
  return weights.map((weight) => Math.round(total * weight / all));
}

export function v9Trend(days: 7 | 30) {
  const use = Math.round(total7 * (days === 7 ? 1 : 3.6));
  const miss = Math.round(miss7 * (days === 7 ? 1 : 3.5));
  const used = series(days, use, `u${days}`);
  const missed = series(days, miss, `m${days}`);
  const labels = Array.from({ length: days }, (_, index) => {
    const date = new Date(2026, 9, 13 - (days - 1 - index));
    return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  });
  const x0 = 34;
  const x1 = 578;
  const step = (x1 - x0) / (days - 1);
  const xAt = (index: number) => x0 + index * step;
  const useMax = Math.ceil(Math.max(...used) / 50) * 50;
  const missMax = Math.ceil(Math.max(...missed) / 10) * 10 || 10;
  const yUse = (value: number) => 120 - value / useMax * (120 - 14);
  const line = used.map((value, index) => `${index ? 'L' : 'M'}${xAt(index).toFixed(1)} ${yUse(value).toFixed(1)}`).join(' ');
  const bars = missed.map((value, index) => {
    const height = value / missMax * (190 - 146);
    const bar = Math.min(18, step * 0.55);
    return `<rect x="${(xAt(index) - bar / 2).toFixed(1)}" y="${(190 - height).toFixed(1)}" width="${bar.toFixed(1)}" height="${height.toFixed(1)}" rx="2" fill="#f0cf8a"/>`;
  }).join('');
  const every = days === 7 ? 1 : 5;
  const axis = labels.map((label, index) => (index % every === (days - 1) % every || index === days - 1)
    ? `<text x="${xAt(index)}" y="212" text-anchor="middle" font-size="10" fill="#a09eae">${label}</text>` : '').join('');
  return `${line ? `<path d="${line} L${xAt(days - 1)} 120 L${x0} 120 Z" fill="rgba(111,76,195,.10)"/><path d="${line}" fill="none" stroke="#6f4cc3" stroke-width="2"/>` : ''}${bars}${axis}`;
}

export function v9Donut() {
  const types = ['产品', '活动', '售前', '售后'];
  const colors = ['#6f4cc3', '#a28be0', '#cdbff0', '#e6dff7'];
  const totals = types.map((type) => sum(V9_SCRIPTS.filter(([, kind]) => kind === type).map(([name]) => sum(V9_PEOPLE.map((person) => counts[person.name][name])))));
  const all = sum(totals);
  return { all, parts: types.map((type, index) => ({ type, color: colors[index], total: totals[index], pct: (totals[index] / all * 100).toFixed(1) })) };
}

export type V9UsageQuery = { view: 'script' | 'person'; type: string; role: string; q: string; desc: boolean; page: number };
export type V9UsageRow = { name: string; tag: string; total: number; extra: string; person: boolean; trend: { points: string; up: boolean } | null };
const PAGE_SIZE = 8;

function sparkline(seed: string, up: boolean) {
  const values: number[] = [];
  let h = hash(seed);
  for (let i = 0; i < 7; i += 1) {
    h = (Math.imul(h, 1103515245) + 12345) >>> 0;
    const r = (h % 100) / 100;
    values.push(up ? r * 0.5 + i * 0.12 : r * 0.5 + (6 - i) * 0.12);
  }
  const max = Math.max(...values);
  const min = Math.min(...values);
  return { up, points: values.map((value, i) => `${i * 12 + 2},${(18 - (value - min) / (max - min || 1) * 16).toFixed(1)}`).join(' ') };
}

export function v9UsageQuery(query: V9UsageQuery): { rows: V9UsageRow[]; count: number; pages: number; page: number; people: number } {
  const people = V9_PEOPLE.filter((p) => (!query.role || p.role === query.role) && (!query.q || p.name.includes(query.q)));
  const scripts = V9_SCRIPTS.filter(([, kind]) => !query.type || kind === query.type);
  let rows: V9UsageRow[];
  if (query.view === 'script') {
    rows = scripts.map(([name, kind]) => {
      const per = people.map((p) => [p.name, counts[p.name][name]] as const).filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1]);
      return { name, tag: kind, person: false, total: sum(per.map((x) => x[1])), extra: per.slice(0, 3).map((x) => `${x[0]} ${x[1]}`).join(' · '), trend: sparkline(name + query.role + query.q, hash(name) % 2 === 0) };
    });
  } else {
    rows = people.map((p) => {
      const per = scripts.map(([name]) => [name, counts[p.name][name]] as const).filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1]);
      return { name: p.name, tag: p.role, person: true, total: sum(per.map((x) => x[1])), extra: per.slice(0, 2).map((x) => `${x[0]} ${x[1]}`).join(' · '), trend: null };
    });
  }
  rows = rows.filter((r) => r.total > 0).sort((a, b) => (query.desc ? b.total - a.total : a.total - b.total));
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = Math.min(query.page, pages - 1);
  return { rows: rows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE), count: rows.length, pages, page, people: people.length };
}
export const V9_PAGE_SIZE = PAGE_SIZE;

export function v9DonutRings() {
  const donut = v9Donut();
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  const rings = donut.parts.map((part) => {
    const length = part.total / donut.all * circumference;
    const dash = Math.max(0, length - 2);
    const ring = { color: part.color, dash: dash.toFixed(2), gap: (circumference - dash).toFixed(2), offset: (-offset).toFixed(2) };
    offset += length;
    return ring;
  });
  return { radius, rings };
}
