export type CssDeclaration = {
  property: string;
  value: string;
};

export type TransitionAllRisk = {
  kind: 'declaration' | 'custom-property';
  property: string;
  value: string;
  resolved: string;
  reason: string;
};

const CUSTOM_PROPERTY = /^--[A-Za-z0-9-]+$/;
const DECL_PROPERTY = /^(?:--[A-Za-z0-9-]+|[A-Za-z-]+)$/;

export function sanitizeCssSource(css: string): string {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, (block) => ' '.repeat(block.length));
  let masked = '';
  let index = 0;
  while (index < withoutComments.length) {
    const char = withoutComments[index];
    if (char === '"' || char === '\'') {
      const quote = char;
      let end = index + 1;
      while (end < withoutComments.length) {
        if (withoutComments[end] === '\\') {
          end += 2;
          continue;
        }
        if (withoutComments[end] === quote) {
          end += 1;
          break;
        }
        end += 1;
      }
      masked += ' '.repeat(Math.max(1, end - index));
      index = end;
      continue;
    }
    masked += char;
    index += 1;
  }
  return masked;
}

export function parseCssDeclarations(css: string): CssDeclaration[] {
  const source = sanitizeCssSource(css);
  const declarations: CssDeclaration[] = [];
  let depth = 0;
  let index = 0;

  while (index < source.length) {
    const char = source[index];
    if (char === '{') {
      depth += 1;
      index += 1;
      continue;
    }
    if (char === '}') {
      depth = Math.max(0, depth - 1);
      index += 1;
      continue;
    }
    if (depth === 0 || /\s/.test(char)) {
      index += 1;
      continue;
    }

    const remainder = source.slice(index);
    const propertyMatch = remainder.match(/^(--[A-Za-z0-9-]+|[A-Za-z-]+)\s*:/);
    if (!propertyMatch || !DECL_PROPERTY.test(propertyMatch[1])) {
      index += 1;
      continue;
    }

    const property = propertyMatch[1];
    let cursor = index + propertyMatch[0].length;
    let paren = 0;
    const valueStart = cursor;
    while (cursor < source.length) {
      const next = source[cursor];
      if (next === '(') paren += 1;
      else if (next === ')') paren = Math.max(0, paren - 1);
      else if (next === ';' && paren === 0) {
        declarations.push({
          property,
          value: source.slice(valueStart, cursor).trim(),
        });
        cursor += 1;
        break;
      } else if ((next === '{' || next === '}') && paren === 0) {
        const raw = source.slice(valueStart, cursor).trim();
        if (raw) {
          declarations.push({ property, value: raw });
        }
        break;
      }
      cursor += 1;
    }
    index = cursor;
  }

  return declarations;
}

export function collectCssCustomPropertyValues(css: string): Map<string, string[]> {
  const values = new Map<string, string[]>();
  for (const declaration of parseCssDeclarations(css)) {
    if (!CUSTOM_PROPERTY.test(declaration.property) || declaration.value === '') continue;
    const existing = values.get(declaration.property) ?? [];
    existing.push(declaration.value);
    values.set(declaration.property, existing);
  }
  return values;
}

function skipCssWhitespace(value: string, index: number): number {
  while (index < value.length && /\s/.test(value[index])) index += 1;
  return index;
}

function parseVarCall(
  value: string,
  start: number,
): { name: string; fallback?: string; end: number } | null {
  const match = value.slice(start).match(/^var\s*\(/i);
  if (!match) return null;
  let cursor = start + match[0].length;
  cursor = skipCssWhitespace(value, cursor);
  const nameMatch = value.slice(cursor).match(/^--[A-Za-z0-9-]+/);
  if (!nameMatch) return null;
  const name = nameMatch[0];
  cursor = skipCssWhitespace(value, cursor + name.length);
  if (value[cursor] === ')') {
    return { name, end: cursor + 1 };
  }
  if (value[cursor] !== ',') return null;
  cursor += 1;
  cursor = skipCssWhitespace(value, cursor);
  const fallbackStart = cursor;
  let depth = 1;
  while (cursor < value.length && depth > 0) {
    const char = value[cursor];
    if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    cursor += 1;
  }
  if (depth !== 0) return null;
  return {
    name,
    fallback: value.slice(fallbackStart, cursor - 1).trim(),
    end: cursor,
  };
}

function splitTopLevel(value: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === '(') depth += 1;
    else if (char === ')') depth = Math.max(0, depth - 1);
    else if (char === separator && depth === 0) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(value.slice(start));
  return parts;
}

export function transitionValueUsesAll(value: string): boolean {
  return splitTopLevel(value, ',').some((part) => (
    part
      .trim()
      .split(/\s+/)
      .some((token) => token.toLowerCase() === 'all')
  ));
}

type ResolvedCssValue = {
  text: string;
  usesAll: boolean;
  uncertain: boolean;
};

function resolveCssValue(
  value: string,
  customProperties: Map<string, string[]>,
  depth = 0,
): ResolvedCssValue {
  if (depth > 8) {
    return {
      text: value,
      usesAll: transitionValueUsesAll(value),
      uncertain: true,
    };
  }

  let cursor = 0;
  let text = '';
  let usesAll = false;
  let uncertain = false;

  while (cursor < value.length) {
    const varIndex = value.slice(cursor).search(/var\s*\(/i);
    if (varIndex < 0) {
      text += value.slice(cursor);
      break;
    }
    const absolute = cursor + varIndex;
    text += value.slice(cursor, absolute);
    const parsed = parseVarCall(value, absolute);
    if (!parsed) {
      const rest = value.slice(absolute);
      uncertain = true;
      usesAll = usesAll || transitionValueUsesAll(rest) || /\ball\b/i.test(rest);
      text += rest;
      break;
    }

    const definitions = customProperties.get(parsed.name) ?? [];
    if (definitions.length === 0) {
      if (parsed.fallback != null && parsed.fallback !== '') {
        const fallback = resolveCssValue(parsed.fallback, customProperties, depth + 1);
        usesAll = usesAll || fallback.usesAll;
        uncertain = uncertain || fallback.uncertain;
        text += fallback.text;
      } else {
        text += parsed.name;
      }
    } else {
      let replacement = '';
      let definitionUsesAll = false;
      for (const definition of definitions) {
        const resolved = resolveCssValue(definition, customProperties, depth + 1);
        uncertain = uncertain || resolved.uncertain;
        if (resolved.usesAll || transitionValueUsesAll(resolved.text)) {
          definitionUsesAll = true;
          replacement = 'all';
          break;
        }
        replacement = resolved.text;
      }
      usesAll = usesAll || definitionUsesAll;
      text += replacement;
    }
    cursor = parsed.end;
  }

  return {
    text: text.trim(),
    usesAll: usesAll || transitionValueUsesAll(text),
    uncertain,
  };
}

export function findTransitionAllRisks(css: string): TransitionAllRisk[] {
  const declarations = parseCssDeclarations(css);
  const customProperties = collectCssCustomPropertyValues(css);
  const risks: TransitionAllRisk[] = [];

  for (const [property, values] of customProperties.entries()) {
    for (const value of values) {
      const resolved = resolveCssValue(value, customProperties);
      if (resolved.usesAll || transitionValueUsesAll(value) || transitionValueUsesAll(resolved.text)) {
        risks.push({
          kind: 'custom-property',
          property,
          value,
          resolved: resolved.text,
          reason: 'custom property declaration resolves to transition all',
        });
      } else if (resolved.uncertain && /\ball\b/i.test(`${value} ${resolved.text}`)) {
        risks.push({
          kind: 'custom-property',
          property,
          value,
          resolved: resolved.text,
          reason: 'unresolved custom property may be transition all',
        });
      }
    }
  }

  for (const declaration of declarations) {
    if (declaration.property !== 'transition' && declaration.property !== 'transition-property') {
      continue;
    }
    const resolved = resolveCssValue(declaration.value, customProperties);
    const rawUsesAll = transitionValueUsesAll(declaration.value);
    if (
      rawUsesAll
      || resolved.usesAll
      || transitionValueUsesAll(resolved.text)
      || (resolved.uncertain && /\ball\b/i.test(`${declaration.value} ${resolved.text}`))
    ) {
      risks.push({
        kind: 'declaration',
        property: declaration.property,
        value: declaration.value,
        resolved: resolved.text,
        reason: rawUsesAll
          ? 'direct transition all'
          : resolved.uncertain
            ? 'fail-closed unresolved transition all'
            : 'resolved transition all',
      });
    }
  }

  return risks;
}
