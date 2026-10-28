#!/usr/bin/env node
/**
 * 检查已发布迁移的不可变性
 *
 * 用途：防止已提交的迁移文件被直接篡改（错误类 3）
 * 运行时机：CI 的 lint 或 typecheck 阶段，在 pnpm check 之前
 *
 * 原理：
 * 1. 从 manifest.generated.json 读取已记录的迁移 sha256
 * 2. 重新计算当前 HEAD 的迁移文件 sha256
 * 3. 对比两者，任何不匹配都是不可变性违反
 *
 * 这捕获了真实的 0074 事故场景：迁移文件在不同 commit 被修改，
 * 导致 planner.ts 运行时检查失败。
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MANIFEST_PATH = 'packages/database/migrations/manifest.generated.json';
const MIGRATIONS_DIR = 'packages/database/migrations';

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function main() {
  let manifest;
  try {
    const manifestContent = readFileSync(MANIFEST_PATH, 'utf8');
    manifest = JSON.parse(manifestContent);
  } catch (err) {
    console.error(`✗ Cannot read ${MANIFEST_PATH}: ${err.message}`);
    process.exit(1);
  }

  if (!manifest.migrations || !Array.isArray(manifest.migrations)) {
    console.error(`✗ ${MANIFEST_PATH} missing 'migrations' array`);
    process.exit(1);
  }

  const violations = [];

  for (const record of manifest.migrations) {
    if (!record.file || !record.sha256) {
      console.error(`✗ Migration record missing file or sha256: ${JSON.stringify(record)}`);
      process.exit(1);
    }

    const migrationPath = resolve(MIGRATIONS_DIR, record.file);
    let actualContent;
    try {
      actualContent = readFileSync(migrationPath, 'utf8');
    } catch (err) {
      console.error(`✗ Cannot read ${migrationPath}: ${err.message}`);
      process.exit(1);
    }

    const actualSha256 = sha256(actualContent);
    if (actualSha256 !== record.sha256) {
      violations.push({
        position: record.position,
        id: record.id,
        file: record.file,
        expected: record.sha256,
        actual: actualSha256,
      });
    }
  }

  if (violations.length > 0) {
    console.error('✗ MIGRATION IMMUTABILITY VIOLATED\n');
    console.error('The following migrations have been modified after being recorded in the manifest:\n');
    for (const v of violations) {
      console.error(`  Position ${v.position}: ${v.file}`);
      console.error(`    Expected SHA256: ${v.expected}`);
      console.error(`    Actual SHA256:   ${v.actual}`);
      console.error('');
    }
    console.error('Applied migrations cannot be modified. Options:');
    console.error('1. Revert the changes: git checkout HEAD~1 -- packages/database/migrations/<file>');
    console.error('2. Create a new migration instead');
    console.error('3. If this is a provenance correction after manual database fix,');
    console.error('   update the manifest with: cd packages/database && pnpm generate');
    process.exit(1);
  }

  console.log(`✓ All ${manifest.migrations.length} migrations are immutable`);
}

main();
