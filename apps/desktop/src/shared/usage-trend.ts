import type { UsageTrendPoint } from './usage-log-csv';

function num(value: number): string {
  return value.toFixed(1);
}

export function usageTrendMarkup(points: readonly UsageTrendPoint[]): string {
  if (points.length === 0) return '';
  const width = 640;
  const height = 188;
  const left = 28;
  const right = 12;
  const top = 18;
  const bottom = 28;
  const innerW = width - left - right;
  const innerH = height - top - bottom;
  const max = Math.max(1, ...points.map((point) => Math.max(point.use, point.miss)));
  const xAt = (index: number) => (
    points.length === 1 ? left + innerW / 2 : left + (innerW * index) / (points.length - 1)
  );
  const yAt = (value: number) => top + innerH - (innerH * value) / max;
  const line = (key: 'use' | 'miss') => points.map((point, index) => {
    const command = index === 0 ? 'M' : 'L';
    return `${command}${num(xAt(index))} ${num(yAt(point[key]))}`;
  }).join(' ');
  const baseline = top + innerH;
  const area = `${line('use')} L${num(xAt(points.length - 1))} ${num(baseline)} L${num(xAt(0))} ${num(baseline)} Z`;
  const dots = (key: 'use' | 'miss', fill: string) => points.map((point, index) => (
    `<circle cx="${num(xAt(index))}" cy="${num(yAt(point[key]))}" r="3" fill="${fill}"/>`
  )).join('');
  const labelAt = new Set<number>([0, points.length - 1]);
  if (points.length > 4) labelAt.add(Math.floor((points.length - 1) / 2));
  const labels = points.map((point, index) => {
    if (!labelAt.has(index)) return '';
    const day = /^\d{4}-\d{2}-\d{2}$/.test(point.day) ? point.day.slice(5) : '';
    if (day === '') return '';
    return `<text x="${num(xAt(index))}" y="${height - 8}" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.55">${day}</text>`;
  }).join('');
  return [
    `<line x1="${left}" y1="${num(baseline)}" x2="${width - right}" y2="${num(baseline)}" stroke="currentColor" stroke-opacity="0.16"/>`,
    `<path d="${area}" fill="#6f4cc3" fill-opacity="0.14"/>`,
    `<path d="${line('use')}" fill="none" stroke="#6f4cc3" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"/>`,
    `<path d="${line('miss')}" fill="none" stroke="#e0b050" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
    dots('use', '#6f4cc3'),
    dots('miss', '#e0b050'),
    labels,
  ].join('');
}
