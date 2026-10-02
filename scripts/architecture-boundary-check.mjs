/**
 * Dependency-direction gate for the product monorepo.
 *
 * The check reads source and workspace package manifests. It does not start
 * the app, rewrite files, or decide product behavior. Aliases come from
 * apps/desktop/tsconfig.json paths (the same map the desktop bundler copies).
 *
 * Allowed on purpose:
 * - renderer may import @shared pure types/functions and its own React views
 * - shared may import type-only @customer-agent/contracts and node:crypto
 * - preload may call ipcRenderer with a channel fixed inside the preload file,
 *   including a private helper, as long as the exposed method does not take
 *   that channel from the renderer
 * - apps/api/tests/backend-runtime.e2e.test.ts may load the four D5 desktop
 *   main adapters (product-http/session/announce/search). Nothing else in
 *   apps/api may reference apps/desktop.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts']);
const SKIP_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  'out',
  'coverage',
  'release',
  'test-results',
  'playwright-report',
  '.git',
  '.generated',
]);

const DATABASE_PACKAGES = new Set([
  '@customer-agent/database',
  'pg',
  'pg-native',
  'better-sqlite3',
  'sqlite3',
  'sqlite',
  'sql.js',
  'node:sqlite',
]);

const IPC_METHODS = new Set(['send', 'on', 'once', 'invoke', 'sendSync']);
const GENERIC_IPC_NAMES = new Set([
  'send',
  'on',
  'once',
  'invoke',
  'sendSync',
  'postMessage',
  'removeListener',
  'removeAllListeners',
]);

const D5_ADAPTER_FILE = 'apps/api/tests/backend-runtime.e2e.test.ts';
const D5_ADAPTER_PATHS = new Set([
  'apps/desktop/src/main',
  'apps/desktop/src/main/product-http.ts',
  'apps/desktop/src/main/product-session.ts',
  'apps/desktop/src/main/product-announce.ts',
  'apps/desktop/src/main/product-search.ts',
]);

const FIX = Object.freeze({
  'renderer-no-privileged-import':
    '把 Electron、main、preload 和数据库访问留在 main。renderer 只通过已有的窄 preload API 取数。',
  'preload-no-generic-ipc':
    '不要把 send、on、invoke 或调用方传入的 channel 暴露给 renderer。channel 在 preload 内固定，对外只留具名窄方法。',
  'packages-no-app-dependency':
    '把共享代码留在 packages。apps 可以依赖 packages，packages 不能反向依赖 apps。',
  'api-no-desktop-dependency':
    'API 只通过 loopback HTTP 与桌面协作。不要在 apps/api 引用 apps/desktop；D5 合成整链只允许 backend-runtime.e2e.test.ts 装载 product-http、product-session、product-announce、product-search。',
  'shared-no-ui-runtime':
    'shared 只放纯类型和纯函数。不要导入 React、DOM 或 Electron，也不要导入 renderer、preload 或 main。',
  'architecture-input-unreadable':
    '修复无法读取的 package.json 或 tsconfig 后再运行架构检查，避免依赖门在别名未知时漏报。',
});

const DOM_PATTERNS = Object.freeze([
  {
    pattern: /\bdocument\s*\.\s*(?:getElementById|querySelector(?:All)?|createElement|body|head|documentElement|cookie)\b/u,
    detail: 'uses a DOM document API',
  },
  {
    pattern: /\bwindow\s*\.\s*(?:document|localStorage|sessionStorage|addEventListener|location|navigator)\b/u,
    detail: 'uses a DOM window API',
  },
  {
    pattern: /\b(?:localStorage|sessionStorage|customElements|requestAnimationFrame|cancelAnimationFrame|HTMLElement|SVGElement|DocumentFragment)\b/u,
    detail: 'uses a DOM global',
  },
  {
    pattern: /\bReact\s*\.\s*createElement\b/u,
    detail: 'uses React.createElement',
  },
]);

function violation(file, line, rule, detail) {
  return Object.freeze({
    file,
    line,
    rule,
    detail,
    fix: FIX[rule],
  });
}

function formatViolation(entry) {
  return `${entry.file}:${String(entry.line)}\n  rule: ${entry.rule}\n  detail: ${entry.detail}\n  fix: ${entry.fix}`;
}

function formatReport(result) {
  const header = `architecture boundary: ${String(result.violations.length)} violation(s)`;
  if (result.violations.length === 0) return header;
  return [header, ...result.violations.map(formatViolation)].join('\n');
}

function toPosixRelative(root, absolutePath) {
  const relative = path.relative(root, absolutePath);
  if (relative === '' || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    return null;
  }
  let posix = relative.split(path.sep).join('/');
  if (posix.endsWith('/')) posix = posix.slice(0, -1);
  return posix;
}

function isInside(relativePath, directory) {
  return relativePath === directory || relativePath.startsWith(`${directory}/`);
}

function barePackageName(specifier) {
  if (specifier.startsWith('@')) {
    const [scope, name] = specifier.split('/');
    return name ? `${scope}/${name}` : specifier;
  }
  const [name] = specifier.split('/');
  return name;
}

function isElectronSpecifier(specifier) {
  return specifier === 'electron' || specifier.startsWith('electron/');
}

function isReactSpecifier(specifier) {
  return specifier === 'react'
    || specifier.startsWith('react/')
    || specifier === 'react-dom'
    || specifier.startsWith('react-dom/');
}

function isDatabaseSpecifier(specifier) {
  return DATABASE_PACKAGES.has(barePackageName(specifier));
}

function loadAliases(projectRoot, violations) {
  const tsconfigPath = path.join(projectRoot, 'apps/desktop/tsconfig.json');
  if (!existsSync(tsconfigPath)) return [];
  let json;
  try {
    json = JSON.parse(readFileSync(tsconfigPath, 'utf8'));
  } catch (error) {
    violations.push(violation(
      'apps/desktop/tsconfig.json',
      1,
      'architecture-input-unreadable',
      `tsconfig.json 无法解析: ${error instanceof Error ? error.message : String(error)}`,
    ));
    return [];
  }
  const paths = json.compilerOptions?.paths ?? {};
  const baseUrl = typeof json.compilerOptions?.baseUrl === 'string' ? json.compilerOptions.baseUrl : '.';
  const base = path.resolve(path.dirname(tsconfigPath), baseUrl);
  const aliases = [];
  for (const [key, targets] of Object.entries(paths)) {
    const star = key.indexOf('*');
    if (star < 0) continue;
    const target = Array.isArray(targets) ? targets[0] : null;
    if (typeof target !== 'string' || !target.includes('*')) continue;
    aliases.push({
      prefix: key.slice(0, star),
      absolutePrefix: path.resolve(base, target.slice(0, target.indexOf('*'))),
    });
  }
  aliases.sort((left, right) => right.prefix.length - left.prefix.length);
  return aliases;
}

function readDesktopPackageName(projectRoot) {
  const manifest = path.join(projectRoot, 'apps/desktop/package.json');
  if (!existsSync(manifest)) return null;
  try {
    const name = JSON.parse(readFileSync(manifest, 'utf8')).name;
    return typeof name === 'string' ? name : null;
  } catch {
    return null;
  }
}

function readAppPackageNames(projectRoot, violations) {
  const appsDirectory = path.join(projectRoot, 'apps');
  const names = new Set();
  if (!existsSync(appsDirectory)) return names;
  for (const entry of readdirSync(appsDirectory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const manifestPath = path.join(appsDirectory, entry.name, 'package.json');
    if (!existsSync(manifestPath)) continue;
    try {
      const name = JSON.parse(readFileSync(manifestPath, 'utf8')).name;
      if (typeof name === 'string' && name.length > 0) names.add(name);
    } catch (error) {
      violations.push(violation(
        toPosixRelative(projectRoot, manifestPath) ?? manifestPath,
        1,
        'architecture-input-unreadable',
        `package.json 无法解析: ${error instanceof Error ? error.message : String(error)}`,
      ));
    }
  }
  return names;
}

function walkFiles(directory, projectRoot, files) {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (SKIP_DIRECTORIES.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      walkFiles(absolute, projectRoot, files);
      continue;
    }
    if (!entry.isFile()) continue;
    const extension = path.extname(entry.name);
    if (entry.name === 'package.json' || SOURCE_EXTENSIONS.has(extension)) {
      files.push(absolute);
    }
  }
}

function readQuoted(source, index, line) {
  const quote = source[index];
  index += 1;
  let value = '';
  while (index < source.length) {
    const current = source[index];
    if (current === '\\') {
      const escaped = source[index + 1] ?? '';
      value += escaped;
      if (escaped === '\n') line += 1;
      index += 2;
      continue;
    }
    if (current === '\n') line += 1;
    if (current === quote) {
      index += 1;
      break;
    }
    value += current;
    index += 1;
  }
  return { value, index, line };
}

function lex(source) {
  return lexFromLine(source, 1);
}

function lexFromLine(source, startLine) {
  const tokens = [];
  let index = 0;
  let line = startLine;

  function push(kind, value, tokenLine) {
    tokens.push({ kind, value, line: tokenLine });
  }

  while (index < source.length) {
    const current = source[index];
    if (current === '\n') {
      line += 1;
      index += 1;
      continue;
    }
    if (current === ' ' || current === '\t' || current === '\r') {
      index += 1;
      continue;
    }
    if (current === '/' && source[index + 1] === '/') {
      while (index < source.length && source[index] !== '\n') index += 1;
      continue;
    }
    if (current === '/' && source[index + 1] === '*') {
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        if (source[index] === '\n') line += 1;
        index += 1;
      }
      index = Math.min(source.length, index + 2);
      continue;
    }
    if (current === '\'' || current === '"') {
      const quoted = readQuoted(source, index, line);
      push('string', quoted.value, line);
      index = quoted.index;
      line = quoted.line;
      continue;
    }
    if (current === '`') {
      index += 1;
      let value = '';
      const tokenLine = line;
      while (index < source.length) {
        const templateChar = source[index];
        if (templateChar === '\\') {
          value += source[index + 1] ?? '';
          if (source[index + 1] === '\n') line += 1;
          index += 2;
          continue;
        }
        if (templateChar === '`') {
          push('string', value, tokenLine);
          index += 1;
          break;
        }
        if (templateChar === '$' && source[index + 1] === '{') {
          if (value.length > 0) push('string', value, tokenLine);
          value = '';
          index += 2;
          let depth = 1;
          const nestedStart = index;
          const nestedLine = line;
          while (index < source.length && depth > 0) {
            if (source[index] === '\n') line += 1;
            if (source[index] === '{') depth += 1;
            else if (source[index] === '}') depth -= 1;
            if (depth > 0) index += 1;
          }
          const nestedSource = source.slice(nestedStart, index);
          for (const token of lexFromLine(nestedSource, nestedLine)) tokens.push(token);
          if (source[index] === '}') index += 1;
          continue;
        }
        if (templateChar === '\n') line += 1;
        value += templateChar;
        index += 1;
      }
      continue;
    }
    if (current === '/' && canStartRegex(tokens[tokens.length - 1])) {
      const regex = readRegex(source, index, line);
      if (regex.ok) {
        index = regex.index;
        line = regex.line;
        continue;
      }
    }
    if (/[0-9]/u.test(current)) {
      const start = index;
      const tokenLine = line;
      index += 1;
      while (index < source.length && /[0-9A-Za-z_.]/u.test(source[index])) index += 1;
      push('number', source.slice(start, index), tokenLine);
      continue;
    }
    if (/[A-Za-z_$]/u.test(current)) {
      const start = index;
      const tokenLine = line;
      index += 1;
      while (index < source.length && /[A-Za-z0-9_$]/u.test(source[index])) index += 1;
      push('ident', source.slice(start, index), tokenLine);
      continue;
    }
    const tokenLine = line;
    const three = source.slice(index, index + 3);
    const two = source.slice(index, index + 2);
    if (three === '===' || three === '!==' || three === '...') {
      push('punct', three, tokenLine);
      index += 3;
      continue;
    }
    if (['=>', '?.', '??', '==', '!=', '<=', '>=', '&&', '||', '++', '--'].includes(two)) {
      push('punct', two, tokenLine);
      index += 2;
      continue;
    }
    push('punct', current, tokenLine);
    index += 1;
  }
  return tokens;
}

function canStartRegex(previous) {
  if (!previous) return true;
  if (previous.kind === 'ident' || previous.kind === 'number' || previous.kind === 'string') return false;
  if (previous.kind === 'punct' && [')', ']', '++', '--'].includes(previous.value)) return false;
  return true;
}

function readRegex(source, index, line) {
  const startLine = line;
  index += 1;
  let inClass = false;
  while (index < source.length) {
    const current = source[index];
    if (current === '\n') return { ok: false, index, line };
    if (current === '\\') {
      index += 2;
      continue;
    }
    if (current === '[' && !inClass) inClass = true;
    else if (current === ']' && inClass) inClass = false;
    else if (current === '/' && !inClass) {
      index += 1;
      while (index < source.length && /[A-Za-z]/u.test(source[index])) index += 1;
      return { ok: true, index, line: startLine };
    }
    index += 1;
  }
  return { ok: false, index, line };
}

function skipBracket(tokens, index) {
  const open = tokens[index]?.value;
  const close = open === '{' ? '}' : open === '(' ? ')' : open === '[' ? ']' : null;
  if (!close) return index + 1;
  let depth = 0;
  for (let cursor = index; cursor < tokens.length; cursor += 1) {
    const token = tokens[cursor];
    if (token.kind === 'punct' && token.value === open) depth += 1;
    else if (token.kind === 'punct' && token.value === close) {
      depth -= 1;
      if (depth === 0) return cursor + 1;
    }
  }
  return tokens.length;
}

function skipType(tokens, index) {
  let depth = 0;
  while (index < tokens.length) {
    const token = tokens[index];
    if (token.kind === 'punct' && ['<', '(', '{', '['].includes(token.value)) {
      if (depth === 0 && token.value === '{') return index;
      depth += 1;
    } else if (token.kind === 'punct' && ['>', ')', '}', ']'].includes(token.value)) {
      if (depth === 0) return index;
      depth -= 1;
    } else if (depth === 0 && ['=>', ',', ';', '='].includes(token.value)) {
      return index;
    }
    index += 1;
  }
  return index;
}

function skipExpression(tokens, index) {
  let depth = 0;
  while (index < tokens.length) {
    const token = tokens[index];
    if (token.kind === 'punct' && ['(', '{', '['].includes(token.value)) depth += 1;
    else if (token.kind === 'punct' && [')', '}', ']'].includes(token.value)) {
      if (depth === 0) return index;
      depth -= 1;
    } else if (depth === 0 && (token.value === ',' || token.value === ';')) {
      return index;
    }
    index += 1;
  }
  return index;
}

function looksLikeArrowParams(tokens, index) {
  let depth = 0;
  for (let cursor = index; cursor < tokens.length; cursor += 1) {
    const token = tokens[cursor];
    if (token.kind === 'punct' && ['(', '{', '['].includes(token.value)) depth += 1;
    else if (token.kind === 'punct' && [')', '}', ']'].includes(token.value)) {
      depth -= 1;
      if (depth === 0) {
        let next = cursor + 1;
        if (tokens[next]?.value === ':') next = skipType(tokens, next + 1);
        return tokens[next]?.value === '=>';
      }
    } else if (depth === 0 && (token.value === ';' || token.value === ',')) {
      return false;
    }
  }
  return false;
}

function isFunctionStart(tokens, index) {
  const token = tokens[index];
  if (!token) return false;
  if (token.kind === 'ident' && token.value === 'function') return true;
  if (token.kind === 'ident' && token.value === 'async') {
    const next = tokens[index + 1];
    if (next?.kind === 'ident' && (next.value === 'function' || tokens[index + 2]?.value === '=>')) return true;
    if (next?.value === '(') return true;
    return false;
  }
  if (token.value === '(') return looksLikeArrowParams(tokens, index);
  if (token.kind === 'ident' && tokens[index + 1]?.value === '=>') return true;
  return false;
}

function paramNames(tokens) {
  const names = [];
  let depth = 0;
  let expectName = true;
  for (const token of tokens) {
    if (token.kind === 'punct' && ['(', '{', '[', '<'].includes(token.value)) {
      depth += 1;
      continue;
    }
    if (token.kind === 'punct' && [')', '}', ']', '>'].includes(token.value)) {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth !== 0) continue;
    if (token.value === ',') {
      expectName = true;
      continue;
    }
    if (token.value === ':' || token.value === '=' || token.value === '?') {
      if (token.value !== '?') expectName = false;
      continue;
    }
    if (token.value === '...') continue;
    if (expectName && token.kind === 'ident' && token.value !== 'this') {
      names.push(token.value);
      expectName = false;
    }
  }
  return names;
}

function parseBodyAfterArrow(tokens, index, params) {
  if (tokens[index]?.value === '{') {
    const end = skipBracket(tokens, index);
    return { params, body: tokens.slice(index + 1, end - 1), end: Math.max(end, index + 1) };
  }
  const end = skipExpression(tokens, index);
  return { params, body: tokens.slice(index, end), end: Math.max(end, index + 1) };
}

function parseFunctionValue(tokens, index) {
  let cursor = index;
  if (tokens[cursor]?.value === 'async') cursor += 1;
  if (tokens[cursor]?.value === 'function') {
    cursor += 1;
    if (tokens[cursor]?.kind === 'ident') cursor += 1;
  }
  if (tokens[cursor]?.kind === 'ident' && tokens[cursor + 1]?.value === '=>') {
    const params = [tokens[cursor].value];
    return parseBodyAfterArrow(tokens, cursor + 2, params);
  }
  if (tokens[cursor]?.value !== '(') {
    return { params: [], body: [], end: index + 1 };
  }
  const parenEnd = skipBracket(tokens, cursor);
  const params = paramNames(tokens.slice(cursor + 1, Math.max(cursor + 1, parenEnd - 1)));
  cursor = parenEnd;
  if (tokens[cursor]?.value === ':') cursor = skipType(tokens, cursor + 1);
  if (tokens[cursor]?.value === '=>') return parseBodyAfterArrow(tokens, cursor + 1, params);
  if (tokens[cursor]?.value === '{') {
    const end = skipBracket(tokens, cursor);
    return { params, body: tokens.slice(cursor + 1, end - 1), end: Math.max(end, cursor + 1) };
  }
  return { params, body: [], end: Math.max(cursor, index + 1) };
}

function parseValueAt(tokens, index) {
  if (tokens[index]?.value === '{') {
    const object = parseObjectAt(tokens, index);
    return { node: { type: 'object', properties: object.properties }, end: object.end };
  }
  if (isFunctionStart(tokens, index)) {
    const fn = parseFunctionValue(tokens, index);
    return { node: { type: 'function', params: fn.params, body: fn.body }, end: fn.end };
  }
  if (tokens[index]?.value === 'ipcRenderer' && tokens[index + 1]?.value === '.' && tokens[index + 2]?.kind === 'ident' && isValueEnd(tokens[index + 3])) {
    return { node: { type: 'ipcMember', method: tokens[index + 2].value }, end: index + 3 };
  }
  if (tokens[index]?.value === 'ipcRenderer' && isValueEnd(tokens[index + 1])) {
    return { node: { type: 'ipcRenderer' }, end: index + 1 };
  }
  if (tokens[index]?.kind === 'ident' && isValueEnd(tokens[index + 1])) {
    return { node: { type: 'reference', name: tokens[index].value }, end: index + 1 };
  }
  const end = skipExpression(tokens, index);
  return { node: { type: 'other', tokens: tokens.slice(index, end) }, end: Math.max(end, index + 1) };
}

function isValueEnd(token) {
  return !token || token.value === ',' || token.value === '}' || token.value === ')' || token.value === ';';
}

function parseObjectAt(tokens, index) {
  const properties = [];
  let cursor = index + 1;
  while (cursor < tokens.length) {
    while (tokens[cursor]?.value === ',') cursor += 1;
    if (!tokens[cursor] || tokens[cursor].value === '}') {
      return { properties, end: Math.min(tokens.length, cursor + 1) };
    }
    const property = parsePropertyAt(tokens, cursor);
    properties.push(property.node);
    cursor = property.end > cursor ? property.end : cursor + 1;
  }
  return { properties, end: cursor };
}

function parsePropertyAt(tokens, index) {
  const start = tokens[index];
  if (start?.value === '...') {
    const end = skipExpression(tokens, index);
    return {
      node: { kind: 'spread', tokens: tokens.slice(index, end), line: start.line },
      end: Math.max(end, index + 1),
    };
  }
  let cursor = index;
  if (start?.value === 'async' && tokens[index + 1]?.kind === 'ident' && tokens[index + 2]?.value === '(') {
    cursor += 1;
  }
  if (tokens[cursor]?.value === '[') {
    const keyEnd = skipBracket(tokens, cursor);
    cursor = keyEnd;
    if (tokens[cursor]?.value === ':') {
      const value = parseValueAt(tokens, cursor + 1);
      return {
        node: { kind: 'pair', name: null, value: value.node, line: start.line },
        end: value.end,
      };
    }
    return { node: { kind: 'unknown', line: start.line }, end: Math.max(keyEnd, index + 1) };
  }
  if (tokens[cursor]?.kind !== 'ident' && tokens[cursor]?.kind !== 'string') {
    return { node: { kind: 'unknown', line: start?.line ?? 1 }, end: index + 1 };
  }
  const name = tokens[cursor].value;
  const line = tokens[cursor].line;
  cursor += 1;
  if (tokens[cursor]?.value === '(') {
    const fn = parseFunctionValue(tokens, cursor);
    return {
      node: { kind: 'pair', name, value: { type: 'function', params: fn.params, body: fn.body }, line },
      end: fn.end,
    };
  }
  if (tokens[cursor]?.value === ':') {
    const value = parseValueAt(tokens, cursor + 1);
    return { node: { kind: 'pair', name, value: value.node, line }, end: value.end };
  }
  return { node: { kind: 'pair', name, value: { type: 'reference', name }, line }, end: cursor };
}

function collectNamedFunctions(tokens) {
  const functions = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.kind !== 'ident') continue;
    if (token.value === 'function' || (token.value === 'async' && tokens[index + 1]?.value === 'function')) {
      const nameToken = tokens[token.value === 'async' ? index + 2 : index + 1];
      if (nameToken?.kind !== 'ident') continue;
      const fn = parseFunctionValue(tokens, index);
      functions.push({ name: nameToken.value, params: fn.params, body: fn.body });
      index = Math.max(index, fn.end - 1);
      continue;
    }
    if (token.value !== 'const' && token.value !== 'let' && token.value !== 'var') continue;
    const nameToken = tokens[index + 1];
    if (nameToken?.kind !== 'ident') continue;
    let cursor = index + 2;
    if (tokens[cursor]?.value === ':') cursor = skipType(tokens, cursor + 1);
    if (tokens[cursor]?.value !== '=') continue;
    cursor += 1;
    if (!isFunctionStart(tokens, cursor)) continue;
    const fn = parseFunctionValue(tokens, cursor);
    functions.push({ name: nameToken.value, params: fn.params, body: fn.body });
    index = Math.max(index, fn.end - 1);
  }
  return functions;
}

function collectObjectBindings(tokens) {
  const bindings = new Map();
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.value !== 'const' && token.value !== 'let' && token.value !== 'var') continue;
    const nameToken = tokens[index + 1];
    if (nameToken?.kind !== 'ident') continue;
    let cursor = index + 2;
    if (tokens[cursor]?.value === ':') cursor = skipType(tokens, cursor + 1);
    if (tokens[cursor]?.value !== '=' || tokens[cursor + 1]?.value !== '{') continue;
    const object = parseObjectAt(tokens, cursor + 1);
    bindings.set(nameToken.value, { type: 'object', properties: object.properties });
    index = Math.max(index, object.end - 1);
  }
  return bindings;
}

function argIsTainted(tokens, argStart, tainted) {
  const token = tokens[argStart];
  if (!token) return false;
  if (token.value === '...') {
    return tokens[argStart + 1]?.kind === 'ident' && tainted.has(tokens[argStart + 1].value);
  }
  if (token.kind !== 'ident' || !tainted.has(token.value)) return false;
  const next = tokens[argStart + 1];
  return !next || next.value === ',' || next.value === ')';
}

function bodyForwardsChannel(params, body, forwarders) {
  const tainted = new Set(params);
  for (let index = 0; index < body.length; index += 1) {
    const token = body[index];
    if ((token.value === 'const' || token.value === 'let' || token.value === 'var')
      && body[index + 1]?.kind === 'ident'
      && body[index + 2]?.value === '='
      && body[index + 3]?.kind === 'ident'
      && tainted.has(body[index + 3].value)) {
      const after = body[index + 4];
      if (!after || ![('.', '(', '[', '?.')].includes(after.value)) tainted.add(body[index + 1].value);
    }
    const ipcCall = token.value === 'ipcRenderer'
      && (body[index + 1]?.value === '.' || body[index + 1]?.value === '?.')
      && IPC_METHODS.has(body[index + 2]?.value)
      && body[index + 3]?.value === '(';
    if (ipcCall && argIsTainted(body, index + 4, tainted)) return true;
    if (token.kind === 'ident' && forwarders.has(token.value) && body[index + 1]?.value === '('
      && argIsTainted(body, index + 2, tainted)) return true;
  }
  return false;
}

function computeForwarders(functions) {
  const forwarders = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const fn of functions) {
      if (forwarders.has(fn.name)) continue;
      if (bodyForwardsChannel(fn.params, fn.body, forwarders)) {
        forwarders.add(fn.name);
        changed = true;
      }
    }
  }
  return forwarders;
}

function mentionsIpc(body, forwarders) {
  return body.some((token) => token.value === 'ipcRenderer' || forwarders.has(token.value));
}

function checkPreloadTokens(tokens, relativePath) {
  const violations = [];
  const forwarders = computeForwarders(collectNamedFunctions(tokens));
  const bindings = collectObjectBindings(tokens);
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index]?.value !== 'exposeInMainWorld' || tokens[index + 1]?.value !== '(') continue;
    let cursor = skipExpression(tokens, index + 2);
    if (tokens[cursor]?.value === ',') cursor += 1;
    const exposed = resolveExposedNode(tokens, cursor, bindings);
    walkExposedNode(exposed.node, null, exposed.line, forwarders, violations, relativePath);
    index = Math.max(index, exposed.end - 1);
  }
  return violations;
}

function resolveExposedNode(tokens, index, bindings) {
  const parsed = parseValueAt(tokens, index);
  if (parsed.node.type === 'reference' && bindings.has(parsed.node.name)) {
    return { node: bindings.get(parsed.node.name), line: tokens[index]?.line ?? 1, end: parsed.end };
  }
  return { node: parsed.node, line: tokens[index]?.line ?? 1, end: parsed.end };
}

function walkExposedNode(node, name, line, forwarders, violations, relativePath) {
  if (!node) return;
  if (node.type === 'object') {
    for (const property of node.properties) {
      if (property.kind === 'spread') {
        if (property.tokens.some((token) => token.value === 'ipcRenderer')) {
          violations.push(violation(relativePath, property.line, 'preload-no-generic-ipc', 'spreads ipcRenderer into the renderer API'));
        }
        continue;
      }
      if (property.kind !== 'pair') continue;
      walkExposedNode(property.value, property.name, property.line, forwarders, violations, relativePath);
    }
    return;
  }
  if (node.type === 'ipcRenderer' || node.type === 'ipcMember') {
    violations.push(violation(
      relativePath,
      line,
      'preload-no-generic-ipc',
      node.type === 'ipcRenderer' ? 'exposes ipcRenderer' : `exposes ipcRenderer.${node.method}`,
    ));
    return;
  }
  const genericName = typeof name === 'string' && GENERIC_IPC_NAMES.has(name);
  if (node.type === 'reference' && (forwarders.has(node.name) || genericName)) {
    violations.push(violation(
      relativePath,
      line,
      'preload-no-generic-ipc',
      `exposes "${name ?? node.name}" as a generic IPC forwarder`,
    ));
    return;
  }
  if (node.type === 'function') {
    const forwards = bodyForwardsChannel(node.params, node.body, forwarders);
    if (forwards || (genericName && mentionsIpc(node.body, forwarders))) {
      violations.push(violation(
        relativePath,
        line,
        'preload-no-generic-ipc',
        genericName
          ? `exposes generic IPC method "${name}"`
          : `exposes "${name ?? 'anonymous'}", which forwards a caller-supplied channel`,
      ));
    }
  }
}

function precedesImportOrExport(tokens, fromIndex) {
  let depth = 0;
  for (let index = fromIndex - 1; index >= 0; index -= 1) {
    const token = tokens[index];
    if (token.kind === 'punct' && [')', '}', ']'].includes(token.value)) depth += 1;
    else if (token.kind === 'punct' && ['(', '{', '['].includes(token.value)) {
      if (depth === 0) return false;
      depth -= 1;
    } else if (depth === 0 && token.value === ';') return false;
    else if (depth === 0 && token.kind === 'ident' && (token.value === 'import' || token.value === 'export')) return true;
    else if (depth === 0 && token.kind === 'ident' && ['function', 'class', 'const', 'let', 'var', 'interface', 'enum'].includes(token.value)) {
      return false;
    }
  }
  return false;
}

function collectSpecifiers(tokens) {
  const specs = [];
  let depth = 0;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.kind === 'punct' && ['{', '(', '['].includes(token.value)) depth += 1;
    else if (token.kind === 'punct' && ['}', ')', ']'].includes(token.value)) depth -= 1;

    if (token.value === 'import') {
      const next = tokens[index + 1];
      if (next?.value === '(' && tokens[index + 2]?.kind === 'string') {
        specs.push({ specifier: tokens[index + 2].value, line: tokens[index + 2].line });
      } else if (next?.kind === 'string') {
        specs.push({ specifier: next.value, line: next.line });
      }
    }
    if (token.value === 'require' && tokens[index + 1]?.value === '(' && tokens[index + 2]?.kind === 'string') {
      specs.push({ specifier: tokens[index + 2].value, line: tokens[index + 2].line });
    }
    if (token.value === 'require' && tokens[index + 1]?.value === '.' && tokens[index + 2]?.value === 'resolve'
      && tokens[index + 3]?.value === '(' && tokens[index + 4]?.kind === 'string') {
      specs.push({ specifier: tokens[index + 4].value, line: tokens[index + 4].line });
    }
    if (depth === 0 && token.value === 'from' && tokens[index + 1]?.kind === 'string' && precedesImportOrExport(tokens, index)) {
      specs.push({ specifier: tokens[index + 1].value, line: tokens[index + 1].line });
    }
  }
  return specs;
}

function resolveFileUrl(baseHref, specifier) {
  try {
    const resolved = new URL(specifier, baseHref);
    if (resolved.protocol !== 'file:') return null;
    return resolved.href;
  } catch {
    return null;
  }
}

function collectUrlEdges(tokens, fromFile) {
  const edges = [];
  const bindings = new Map();
  const fileHref = pathToFileURL(fromFile).href;

  function resolveBase(tokenIndex) {
    if (tokens[tokenIndex]?.value === 'import'
      && tokens[tokenIndex + 1]?.value === '.'
      && tokens[tokenIndex + 2]?.value === 'meta'
      && tokens[tokenIndex + 3]?.value === '.'
      && tokens[tokenIndex + 4]?.value === 'url') {
      return { href: fileHref, end: tokenIndex + 5 };
    }
    if (tokens[tokenIndex]?.kind === 'ident' && bindings.has(tokens[tokenIndex].value)) {
      return { href: bindings.get(tokens[tokenIndex].value), end: tokenIndex + 1 };
    }
    return null;
  }

  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index]?.value !== 'new' || tokens[index + 1]?.value !== 'URL' || tokens[index + 2]?.value !== '(') continue;
    const specifier = tokens[index + 3];
    if (specifier?.kind !== 'string' || tokens[index + 4]?.value !== ',') continue;
    const base = resolveBase(index + 5);
    if (!base) continue;
    const href = resolveFileUrl(base.href, specifier.value);
    if (!href) continue;
    edges.push({ href, line: specifier.line });
    if ((tokens[index - 1]?.value === '=' || tokens[index - 1]?.value === undefined)
      && tokens[index - 2]?.kind === 'ident'
      && ['const', 'let', 'var'].includes(tokens[index - 3]?.value)) {
      bindings.set(tokens[index - 2].value, href);
    }
    index = base.end;
  }
  return edges;
}

function classifySpecifier(fromFile, specifier, projectRoot, aliases) {
  if (specifier.startsWith('.')) {
    return { kind: 'path', absolute: path.resolve(path.dirname(fromFile), specifier) };
  }
  for (const alias of aliases) {
    if (specifier.startsWith(alias.prefix)) {
      const rest = specifier.slice(alias.prefix.length);
      return { kind: 'path', absolute: path.resolve(alias.absolutePrefix, rest) };
    }
  }
  if (path.isAbsolute(specifier)) return { kind: 'path', absolute: path.normalize(specifier) };
  if (specifier.startsWith('apps/')) return { kind: 'path', absolute: path.join(projectRoot, specifier) };
  return { kind: 'bare', name: specifier };
}

function edgeFromAbsolute(projectRoot, absolute, line, specifier) {
  const relative = toPosixRelative(projectRoot, absolute);
  return { line, specifier, relative, bare: null };
}

function moduleEdges(source, fromFile, projectRoot, aliases) {
  const tokens = lex(source);
  const edges = [];
  for (const spec of collectSpecifiers(tokens)) {
    const classified = classifySpecifier(fromFile, spec.specifier, projectRoot, aliases);
    if (classified.kind === 'path') edges.push(edgeFromAbsolute(projectRoot, classified.absolute, spec.line, spec.specifier));
    else edges.push({ line: spec.line, specifier: spec.specifier, relative: null, bare: classified.name });
  }
  for (const urlEdge of collectUrlEdges(tokens, fromFile)) {
    const absolute = fileURLToPath(urlEdge.href);
    edges.push(edgeFromAbsolute(projectRoot, absolute, urlEdge.line, urlEdge.href));
  }
  return { tokens, edges };
}

function rendererViolation(relativeFile, edge) {
  const specifier = edge.bare ?? edge.specifier;
  if (edge.bare && (isElectronSpecifier(edge.bare) || isDatabaseSpecifier(edge.bare))) {
    return violation(relativeFile, edge.line, 'renderer-no-privileged-import', `imports "${specifier}"`);
  }
  if (!edge.relative) return null;
  if (isInside(edge.relative, 'apps/desktop/src/main') || isInside(edge.relative, 'apps/desktop/src/preload')) {
    return violation(relativeFile, edge.line, 'renderer-no-privileged-import', `imports "${specifier}" (${edge.relative})`);
  }
  if (isInside(edge.relative, 'packages/database')) {
    return violation(relativeFile, edge.line, 'renderer-no-privileged-import', `imports "${specifier}" (${edge.relative})`);
  }
  return null;
}

function packageViolation(relativeFile, edge, appNames) {
  if (edge.bare && appNames.has(barePackageName(edge.bare))) {
    return violation(relativeFile, edge.line, 'packages-no-app-dependency', `imports app package "${edge.bare}"`);
  }
  if (edge.relative && (edge.relative === 'apps' || isInside(edge.relative, 'apps'))) {
    return violation(relativeFile, edge.line, 'packages-no-app-dependency', `imports "${edge.specifier}" (${edge.relative})`);
  }
  return null;
}

function allowsApiDesktopEdge(relativeFile, relativeTarget) {
  if (relativeFile !== D5_ADAPTER_FILE || !relativeTarget) return false;
  return D5_ADAPTER_PATHS.has(relativeTarget);
}

function apiViolation(relativeFile, edge, desktopPackageName) {
  const bareName = edge.bare ? barePackageName(edge.bare) : null;
  const referencesDesktop = (edge.relative && (edge.relative === 'apps/desktop' || isInside(edge.relative, 'apps/desktop')))
    || bareName === desktopPackageName
    || bareName === '@customer-agent/desktop';
  if (!referencesDesktop) return null;
  if (allowsApiDesktopEdge(relativeFile, edge.relative)) return null;
  return violation(
    relativeFile,
    edge.line,
    'api-no-desktop-dependency',
    `depends on desktop via "${edge.bare ?? edge.specifier}"${edge.relative ? ` (${edge.relative})` : ''}`,
  );
}

function sharedImportViolation(relativeFile, edge) {
  if (edge.bare && (isReactSpecifier(edge.bare) || isElectronSpecifier(edge.bare))) {
    return violation(relativeFile, edge.line, 'shared-no-ui-runtime', `imports "${edge.bare}"`);
  }
  if (!edge.relative) return null;
  if (isInside(edge.relative, 'apps/desktop/src/renderer')
    || isInside(edge.relative, 'apps/desktop/src/main')
    || isInside(edge.relative, 'apps/desktop/src/preload')) {
    return violation(relativeFile, edge.line, 'shared-no-ui-runtime', `imports "${edge.specifier}" (${edge.relative})`);
  }
  return null;
}

function maskCommentsAndStrings(source) {
  let output = '';
  let index = 0;
  while (index < source.length) {
    const current = source[index];
    if (current === '/' && source[index + 1] === '/') {
      while (index < source.length && source[index] !== '\n') {
        output += ' ';
        index += 1;
      }
      continue;
    }
    if (current === '/' && source[index + 1] === '*') {
      output += '  ';
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        output += source[index] === '\n' ? '\n' : ' ';
        index += 1;
      }
      if (source[index] === '*' && source[index + 1] === '/') {
        output += '  ';
        index += 2;
      }
      continue;
    }
    if (current === '\'' || current === '"' || current === '`') {
      const quote = current;
      output += ' ';
      index += 1;
      while (index < source.length) {
        if (source[index] === '\\') {
          output += ' ';
          if (source[index + 1] !== undefined) output += source[index + 1] === '\n' ? '\n' : ' ';
          index += 2;
          continue;
        }
        if (quote === '`' && source[index] === '$' && source[index + 1] === '{') {
          output += '  ';
          index += 2;
          continue;
        }
        const done = source[index] === quote;
        output += source[index] === '\n' ? '\n' : ' ';
        index += 1;
        if (done) break;
      }
      continue;
    }
    output += current;
    index += 1;
  }
  return output;
}

function lineOfIndex(source, index) {
  let line = 1;
  for (let cursor = 0; cursor < index && cursor < source.length; cursor += 1) {
    if (source.charCodeAt(cursor) === 10) line += 1;
  }
  return line;
}

function sharedDomViolations(source, relativeFile) {
  const masked = maskCommentsAndStrings(source);
  const violations = [];
  if (relativeFile.endsWith('.tsx') || relativeFile.endsWith('.jsx')) {
    violations.push(violation(relativeFile, 1, 'shared-no-ui-runtime', 'shared file uses a JSX extension'));
  }
  for (const rule of DOM_PATTERNS) {
    const match = rule.pattern.exec(masked);
    if (!match) continue;
    violations.push(violation(relativeFile, lineOfIndex(masked, match.index), 'shared-no-ui-runtime', rule.detail));
  }
  return violations;
}

function dependencyFieldViolations(relativeFile, manifest, mode, appNames, desktopPackageName) {
  const violations = [];
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    const entries = manifest[field];
    if (!entries || typeof entries !== 'object') continue;
    for (const [name, version] of Object.entries(entries)) {
      const versionText = typeof version === 'string' ? version : '';
      const versionTargetsApp = /(?:^|[\\/])apps[\\/]/u.test(versionText);
      if (mode === 'packages') {
        if (appNames.has(name) || versionTargetsApp) {
          violations.push(violation(
            relativeFile,
            1,
            'packages-no-app-dependency',
            `${field} contains "${name}": "${versionText}"`,
          ));
        }
      } else if (name === desktopPackageName || name === '@customer-agent/desktop' || /(?:^|[\\/])apps[\\/]desktop(?:[\\/]|$)/u.test(versionText)) {
        violations.push(violation(
          relativeFile,
          1,
          'api-no-desktop-dependency',
          `${field} contains "${name}": "${versionText}"`,
        ));
      }
    }
  }
  return violations;
}

function checkSourceFile(absolute, projectRoot, aliases, appNames, desktopPackageName) {
  const relativeFile = toPosixRelative(projectRoot, absolute);
  if (!relativeFile) return [];
  const source = readFileSync(absolute, 'utf8');
  if (path.basename(absolute) === 'package.json') {
    let manifest;
    try {
      manifest = JSON.parse(source);
    } catch (error) {
      return [violation(relativeFile, 1, 'architecture-input-unreadable', `package.json 无法解析: ${error instanceof Error ? error.message : String(error)}`)];
    }
    if (isInside(relativeFile, 'packages')) return dependencyFieldViolations(relativeFile, manifest, 'packages', appNames, desktopPackageName);
    if (relativeFile === 'apps/api/package.json') return dependencyFieldViolations(relativeFile, manifest, 'api', appNames, desktopPackageName);
    return [];
  }

  const layer = layerOf(relativeFile);
  if (!layer) return [];
  const { tokens, edges } = moduleEdges(source, absolute, projectRoot, aliases);
  const violations = [];
  if (layer === 'renderer') {
    for (const edge of edges) {
      const entry = rendererViolation(relativeFile, edge);
      if (entry) violations.push(entry);
    }
  } else if (layer === 'preload') {
    violations.push(...checkPreloadTokens(tokens, relativeFile));
  } else if (layer === 'shared') {
    for (const edge of edges) {
      const entry = sharedImportViolation(relativeFile, edge);
      if (entry) violations.push(entry);
    }
    violations.push(...sharedDomViolations(source, relativeFile));
  } else if (layer === 'packages') {
    for (const edge of edges) {
      const entry = packageViolation(relativeFile, edge, appNames);
      if (entry) violations.push(entry);
    }
  } else if (layer === 'api') {
    for (const edge of edges) {
      const entry = apiViolation(relativeFile, edge, desktopPackageName);
      if (entry) violations.push(entry);
    }
  }
  return violations;
}

function layerOf(relativeFile) {
  if (isInside(relativeFile, 'apps/desktop/src/renderer')) return 'renderer';
  if (isInside(relativeFile, 'apps/desktop/src/preload')) return 'preload';
  if (isInside(relativeFile, 'apps/desktop/src/shared')) return 'shared';
  if (isInside(relativeFile, 'packages')) return 'packages';
  if (isInside(relativeFile, 'apps/api')) return 'api';
  return null;
}

function checkArchitecture({ projectRoot = repositoryRoot } = {}) {
  const resolvedRoot = path.resolve(projectRoot);
  if (!existsSync(resolvedRoot) || !statSync(resolvedRoot).isDirectory()) {
    return {
      projectRoot: resolvedRoot,
      scannedFileCount: 0,
      violations: [violation('.', 1, 'architecture-input-unreadable', `项目根目录不存在: ${resolvedRoot}`)],
    };
  }
  const prelude = [];
  const aliases = loadAliases(resolvedRoot, prelude);
  const appNames = readAppPackageNames(resolvedRoot, prelude);
  const desktopPackageName = readDesktopPackageName(resolvedRoot);
  const files = [];
  for (const directory of ['apps/desktop/src/renderer', 'apps/desktop/src/preload', 'apps/desktop/src/shared', 'packages', 'apps/api']) {
    walkFiles(path.join(resolvedRoot, directory), resolvedRoot, files);
  }
  const violations = [...prelude];
  for (const file of files) {
    try {
      violations.push(...checkSourceFile(file, resolvedRoot, aliases, appNames, desktopPackageName));
    } catch (error) {
      const relativeFile = toPosixRelative(resolvedRoot, file) ?? file;
      violations.push(violation(
        relativeFile,
        1,
        'architecture-input-unreadable',
        `无法解析 ${relativeFile}: ${error instanceof Error ? error.message : String(error)}`,
      ));
    }
  }
  violations.sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line || left.rule.localeCompare(right.rule));
  const unique = [];
  const seen = new Set();
  for (const entry of violations) {
    const key = `${entry.file}:${String(entry.line)}:${entry.rule}:${entry.detail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(entry);
  }
  return Object.freeze({
    projectRoot: resolvedRoot,
    scannedFileCount: files.length,
    violations: Object.freeze(unique),
  });
}

const invokedDirectly = process.argv[1]
  && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (invokedDirectly) {
  const projectRoot = process.argv[2] ? path.resolve(process.argv[2]) : repositoryRoot;
  const result = checkArchitecture({ projectRoot });
  if (result.violations.length > 0) {
    process.stderr.write(`${formatReport(result)}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`Architecture boundary PASS: ${String(result.scannedFileCount)} files, 0 violations.\n`);
  }
}

export {
  checkArchitecture,
  formatReport,
  formatViolation,
};
