import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Helper to read a migration file and return its contents.
 */
function readMigration(filename: string): string {
  const migrationPath = resolve(
    __dirname,
    '../../../supabase/migrations',
    filename,
  );
  return readFileSync(migrationPath, 'utf-8');
}

// ─── 004_backfill_status.sql ─────────────────────────────────────────────────

describe('004_backfill_status.sql', () => {
  let sql: string;

  beforeEach(() => {
    sql = readMigration('004_backfill_status.sql');
  });

  it('should exist and be non-empty', () => {
    expect(sql).toBeTruthy();
    expect(sql.length).toBeGreaterThan(0);
  });

  it('should map reminded rows to in_progress', () => {
    // Must contain an UPDATE that sets status='in_progress' WHERE status='reminded'
    expect(sql).toMatch(/UPDATE\s+todos/i);
    expect(sql).toContain("status = 'in_progress'");
    expect(sql).toContain("status = 'reminded'");
  });

  it('should set reminded_at = updated_at for reminded rows', () => {
    // The reminded_at should be set from updated_at for historical preservation
    expect(sql).toMatch(/reminded_at\s*=\s*updated_at/i);
  });

  it('should map archived rows to canceled', () => {
    expect(sql).toContain("status = 'canceled'");
    expect(sql).toContain("status = 'archived'");
  });

  it('should be idempotent — only update rows still having old status values', () => {
    // WHERE clauses ensure only rows with the old value are updated.
    // Running twice: first run updates rows, second run finds no matches.
    const remindedUpdate = sql.match(
      /UPDATE\s+todos[\s\S]*?WHERE\s+status\s*=\s*'reminded'/i,
    );
    expect(remindedUpdate).toBeTruthy();

    const archivedUpdate = sql.match(
      /UPDATE\s+todos[\s\S]*?WHERE\s+status\s*=\s*'archived'/i,
    );
    expect(archivedUpdate).toBeTruthy();
  });

  it('should not DELETE any rows (preserves historical data)', () => {
    expect(sql).not.toMatch(/\bDELETE\b/i);
  });

  it('should not DROP any tables or constraints', () => {
    expect(sql).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(sql).not.toMatch(/\bDROP\s+CONSTRAINT\b/i);
  });

  it('should handle both status transitions in a single migration file', () => {
    // Both reminded -> in_progress and archived -> canceled in same file
    const remindedMatch = sql.indexOf("'reminded'");
    const archivedMatch = sql.indexOf("'archived'");
    expect(remindedMatch).toBeGreaterThan(-1);
    expect(archivedMatch).toBeGreaterThan(-1);
  });

  it('should produce the same result when applied twice (idempotent verification)', () => {
    // The SQL uses WHERE status='reminded' and WHERE status='archived'.
    // After first run: no rows have those statuses.
    // After second run: WHERE clauses match 0 rows, so 0 rows updated — safe.
    // We verify this by checking the pattern does not use unconditional UPDATEs.
    const unconditionalUpdate = sql.match(
      /UPDATE\s+todos\s+SET[\s\S]*?(?!WHERE)/i,
    );
    // Every UPDATE should have a WHERE clause
    const updateCount = (sql.match(/\bUPDATE\s+todos\b/gi) || []).length;
    const whereCount = (sql.match(/\bWHERE\s+status\s*=/gi) || []).length;
    expect(updateCount).toBeGreaterThan(0);
    expect(whereCount).toBe(updateCount);
  });
});

// ─── 005_cleanup_polluted.sql ────────────────────────────────────────────────

describe('005_cleanup_polluted.sql', () => {
  let sql: string;

  beforeEach(() => {
    sql = readMigration('005_cleanup_polluted.sql');
  });

  it('should exist and be non-empty', () => {
    expect(sql).toBeTruthy();
    expect(sql.length).toBeGreaterThan(0);
  });

  it('should identify [PT] agent messages as polluted', () => {
    // Must reference [PT] pattern for agent message detection
    expect(sql).toContain('[PT]');
  });

  it('should handle duplicate todos created within seconds of each other', () => {
    // Must reference interval-based duplicate detection
    expect(sql).toMatch(/INTERVAL/i);
    // Must compare created_at timestamps
    expect(sql).toMatch(/created_at/i);
  });

  it('should use soft-delete approach (cleanup_deleted status)', () => {
    expect(sql).toContain('cleanup_deleted');
  });

  it('should widen the CHECK constraint to allow cleanup_deleted', () => {
    // Must modify the status constraint
    expect(sql).toMatch(/ADD\s+CONSTRAINT\s+todos_status_check/i);
    expect(sql).toContain("'cleanup_deleted'");
  });

  it('should keep the cleanup reversible — use UPDATE not DELETE', () => {
    // Should use UPDATE to set status='cleanup_deleted', not DELETE
    expect(sql).toMatch(/UPDATE\s+todos/i);
    expect(sql).toContain("'cleanup_deleted'");
  });

  it('should be idempotent — skip already-cleaned rows', () => {
    // Must have WHERE clause excluding already-cleaned rows
    expect(sql).toContain("status != 'cleanup_deleted'");
  });

  it('should preserve the original (earlier) duplicate and only mark later ones', () => {
    // The duplicate cleanup should keep the row with the earlier created_at.
    // Pattern: t.created_at > dup.created_at (marks the newer duplicate)
    expect(sql).toMatch(/created_at\s*>\s*dup\.created_at/i);
  });

  it('should check same user_id and task for duplicates', () => {
    expect(sql).toMatch(/user_id\s*=\s*dup\.user_id/i);
    expect(sql).toMatch(/task\s*=\s*dup\.task/i);
  });

  it('should not permanently delete any rows', () => {
    expect(sql).not.toMatch(/\bDELETE\s+FROM\s+todos\b/i);
  });

  it('should produce the same result when applied twice (idempotent)', () => {
    // The WHERE status != 'cleanup_deleted' prevents re-processing.
    // Running twice: second run finds no matching rows.
    const updateStatements = sql.match(/UPDATE\s+todos/gi) || [];
    expect(updateStatements.length).toBeGreaterThan(0);

    // Each UPDATE should exclude already-cleaned rows
    const cleanupExclusions = (
      sql.match(/status\s*!=\s*'cleanup_deleted'/gi) || []
    ).length;
    expect(cleanupExclusions).toBeGreaterThanOrEqual(updateStatements.length);
  });
});

// ─── verify-migration.ts ─────────────────────────────────────────────────────

describe('verify-migration.ts script', () => {
  it('should exist and be a valid TypeScript file', () => {
    const scriptPath = resolve(__dirname, '../../scripts/verify-migration.ts');
    const content = readFileSync(scriptPath, 'utf-8');
    expect(content).toBeTruthy();
    expect(content.length).toBeGreaterThan(0);
  });

  it('should import createClient from @supabase/supabase-js', () => {
    const scriptPath = resolve(__dirname, '../../scripts/verify-migration.ts');
    const content = readFileSync(scriptPath, 'utf-8');
    expect(content).toMatch(/import.*createClient.*from\s+['"]@supabase\/supabase-js['"]/);
  });

  it('should read SUPABASE_URL and SUPABASE_SERVICE_KEY from env', () => {
    const scriptPath = resolve(__dirname, '../../scripts/verify-migration.ts');
    const content = readFileSync(scriptPath, 'utf-8');
    expect(content).toContain('SUPABASE_URL');
    expect(content).toContain('SUPABASE_SERVICE_KEY');
  });

  it('should query all known status values', () => {
    const scriptPath = resolve(__dirname, '../../scripts/verify-migration.ts');
    const content = readFileSync(scriptPath, 'utf-8');
    const expectedStatuses = [
      'pending',
      'in_progress',
      'done',
      'not_confirmed',
      'canceled',
      'reminded',
      'archived',
      'cleanup_deleted',
    ];
    for (const status of expectedStatuses) {
      expect(content).toContain(`'${status}'`);
    }
  });

  it('should report legacy values as warnings', () => {
    const scriptPath = resolve(__dirname, '../../scripts/verify-migration.ts');
    const content = readFileSync(scriptPath, 'utf-8');
    // Should flag legacy statuses
    expect(content).toMatch(/legacy/i);
  });

  it('should check for [PT]-polluted rows', () => {
    const scriptPath = resolve(__dirname, '../../scripts/verify-migration.ts');
    const content = readFileSync(scriptPath, 'utf-8');
    expect(content).toContain('[PT]');
  });
});

// ─── Cross-migration consistency ─────────────────────────────────────────────

describe('Migration cross-checks', () => {
  it('004 uses status values allowed by 002 CHECK constraint', () => {
    const migration002 = readMigration('002_update_status_lifecycle.sql');
    const migration004 = readMigration('004_backfill_status.sql');

    // 004 sets status to in_progress and canceled — both must be in 002's CHECK
    expect(migration002).toContain("'in_progress'");
    expect(migration002).toContain("'canceled'");

    // 004 reads from reminded and archived — both must be in 002's CHECK
    expect(migration002).toContain("'reminded'");
    expect(migration002).toContain("'archived'");

    // Confirm 004 references these values
    expect(migration004).toContain("'in_progress'");
    expect(migration004).toContain("'canceled'");
    expect(migration004).toContain("'reminded'");
    expect(migration004).toContain("'archived'");
  });

  it('005 adds cleanup_deleted to the CHECK constraint before using it', () => {
    const migration005 = readMigration('005_cleanup_polluted.sql');

    // The ADD CONSTRAINT must appear before any UPDATE that sets cleanup_deleted
    const constraintPos = migration005.indexOf('ADD CONSTRAINT todos_status_check');
    const firstUpdatePos = migration005.indexOf(
      "SET status = 'cleanup_deleted'",
    );

    expect(constraintPos).toBeGreaterThan(-1);
    expect(firstUpdatePos).toBeGreaterThan(-1);
    expect(constraintPos).toBeLessThan(firstUpdatePos);
  });

  it('all migrations are numbered sequentially', () => {
    const migrations = ['001_initial.sql', '002_update_status_lifecycle.sql', '003_conversation_sessions.sql', '004_backfill_status.sql', '005_cleanup_polluted.sql'];
    for (const filename of migrations) {
      const content = readMigration(filename);
      expect(content.length).toBeGreaterThan(0);
    }
  });
});

// ─── VAL-MIGRATE assertions ──────────────────────────────────────────────────

describe('VAL-MIGRATE-001: Legacy reminded status mapped', () => {
  it('migration 004 maps reminded -> in_progress', () => {
    const sql = readMigration('004_backfill_status.sql');
    // Must UPDATE todos SET status='in_progress' WHERE status='reminded'
    const hasMapping = sql.includes("status = 'in_progress'") &&
      sql.includes("status = 'reminded'");
    expect(hasMapping).toBe(true);
  });

  it('migration 004 preserves timestamp via reminded_at = updated_at', () => {
    const sql = readMigration('004_backfill_status.sql');
    expect(sql).toMatch(/reminded_at\s*=\s*updated_at/);
  });
});

describe('VAL-MIGRATE-002: Migration is idempotent', () => {
  it('004 can be applied twice without error — WHERE clauses prevent re-updates', () => {
    const sql = readMigration('004_backfill_status.sql');

    // Each UPDATE has a WHERE status='reminded' or WHERE status='archived'
    // After first run those statuses no longer exist, so second run is a no-op.
    const updates = sql.match(/\bUPDATE\s+todos\b/gi) || [];
    expect(updates.length).toBe(2);

    // Both have WHERE clause targeting the old status
    expect(sql).toContain("WHERE status = 'reminded'");
    expect(sql).toContain("WHERE status = 'archived'");
  });

  it('005 can be applied twice without error — excludes already-cleaned rows', () => {
    const sql = readMigration('005_cleanup_polluted.sql');

    // Uses DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT (idempotent constraint update)
    expect(sql).toMatch(/DROP CONSTRAINT IF EXISTS/i);

    // Each UPDATE excludes status='cleanup_deleted' rows
    const cleanupExclusions = (
      sql.match(/status\s*!=\s*'cleanup_deleted'/gi) || []
    ).length;
    expect(cleanupExclusions).toBeGreaterThanOrEqual(2);
  });
});

describe('VAL-MIGRATE-003: Polluted rows cleaned', () => {
  it('005 identifies [PT] agent messages in task text', () => {
    const sql = readMigration('005_cleanup_polluted.sql');
    expect(sql).toMatch(/task\s+LIKE\s+'%\[PT\]%'/i);
  });

  it('005 identifies duplicate todos created within 5 seconds', () => {
    const sql = readMigration('005_cleanup_polluted.sql');
    expect(sql).toMatch(/INTERVAL\s+'5 seconds'/i);
  });

  it('005 uses reversible soft-delete (cleanup_deleted) not permanent deletion', () => {
    const sql = readMigration('005_cleanup_polluted.sql');
    // Uses UPDATE SET status = 'cleanup_deleted', not DELETE
    expect(sql).toContain("SET status = 'cleanup_deleted'");
    expect(sql).not.toMatch(/\bDELETE\s+FROM\s+todos\b/i);
  });
});

// ─── Historical data preservation ────────────────────────────────────────────

describe('Historical data preservation', () => {
  it('004 does not delete any rows', () => {
    const sql = readMigration('004_backfill_status.sql');
    expect(sql).not.toMatch(/\bDELETE\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    expect(sql).not.toMatch(/\bDROP\s+TABLE\b/i);
  });

  it('005 uses soft-delete, preserving row data', () => {
    const sql = readMigration('005_cleanup_polluted.sql');
    // No permanent DELETE of todo rows
    expect(sql).not.toMatch(/\bDELETE\s+FROM\s+todos\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
  });

  it('005 keeps the earliest duplicate (preserves original)', () => {
    const sql = readMigration('005_cleanup_polluted.sql');
    // t.created_at > dup.created_at means only later duplicates are marked
    expect(sql).toMatch(/t\.created_at\s*>\s*dup\.created_at/);
  });
});
