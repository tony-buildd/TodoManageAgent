import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMockSupabaseClient } from './helpers.js';
import { getOrCreateUser } from '../db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Helper to read a migration file and return its contents.
 */
function readMigration(filename: string): string {
  const migrationPath = resolve(__dirname, '../../../supabase/migrations', filename);
  return readFileSync(migrationPath, 'utf-8');
}

describe('Migration SQL files', () => {
  describe('001_initial.sql', () => {
    let sql: string;

    beforeEach(() => {
      sql = readMigration('001_initial.sql');
    });

    it('should exist and be non-empty', () => {
      expect(sql).toBeTruthy();
      expect(sql.length).toBeGreaterThan(0);
    });

    it('should create the users table', () => {
      expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS users/i);
    });

    it('should create the todos table', () => {
      expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS todos/i);
    });

    it('should create the message_logs table', () => {
      expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS message_logs/i);
    });

    it('should define phone as UNIQUE on users', () => {
      expect(sql).toMatch(/phone\s+TEXT\s+NOT NULL\s+UNIQUE/i);
    });

    it('should use IF NOT EXISTS for idempotency', () => {
      const ifNotExistsCount = (sql.match(/IF NOT EXISTS/gi) || []).length;
      // At minimum: 3 tables + uuid extension + indexes
      expect(ifNotExistsCount).toBeGreaterThanOrEqual(3);
    });

    it('should enable RLS on all tables', () => {
      expect(sql).toMatch(/ALTER TABLE users ENABLE ROW LEVEL SECURITY/i);
      expect(sql).toMatch(/ALTER TABLE todos ENABLE ROW LEVEL SECURITY/i);
      expect(sql).toMatch(/ALTER TABLE message_logs ENABLE ROW LEVEL SECURITY/i);
    });
  });

  describe('002_update_status_lifecycle.sql', () => {
    let sql: string;

    beforeEach(() => {
      sql = readMigration('002_update_status_lifecycle.sql');
    });

    it('should exist and be non-empty', () => {
      expect(sql).toBeTruthy();
      expect(sql.length).toBeGreaterThan(0);
    });

    it('should allow new status values: pending, in_progress, done, not_confirmed, canceled', () => {
      const newStatuses = ['pending', 'in_progress', 'done', 'not_confirmed', 'canceled'];
      for (const status of newStatuses) {
        expect(sql).toContain(`'${status}'`);
      }
    });

    it('should temporarily keep legacy status values: reminded, archived', () => {
      expect(sql).toContain("'reminded'");
      expect(sql).toContain("'archived'");
    });

    it('should add reminded_at TIMESTAMPTZ column', () => {
      expect(sql).toMatch(/reminded_at/i);
      expect(sql).toMatch(/TIMESTAMPTZ/i);
    });

    it('should add canceled_at TIMESTAMPTZ column', () => {
      expect(sql).toMatch(/canceled_at/i);
    });

    it('should add not_confirmed_at TIMESTAMPTZ column', () => {
      expect(sql).toMatch(/not_confirmed_at/i);
    });

    it('should ensure updated_at column exists', () => {
      expect(sql).toMatch(/updated_at/i);
    });

    it('should use idempotent patterns (IF NOT EXISTS, DO blocks)', () => {
      expect(sql).toMatch(/IF NOT EXISTS/i);
      expect(sql).toMatch(/DO \$\$/i);
    });

    it('should create updated_at trigger', () => {
      expect(sql).toMatch(/CREATE OR REPLACE FUNCTION update_updated_at_column/i);
      expect(sql).toMatch(/CREATE TRIGGER set_updated_at_todos/i);
    });

    it('should update indexes for new status values', () => {
      expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_todos_status_due/i);
      expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_todos_pending_remind/i);
      expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_todos_in_progress_due/i);
    });

    it('should drop the old status constraint before adding new one', () => {
      const dropPos = sql.indexOf('DROP CONSTRAINT');
      const addPos = sql.indexOf('ADD CONSTRAINT todos_status_check');
      expect(dropPos).toBeGreaterThan(-1);
      expect(addPos).toBeGreaterThan(-1);
      expect(dropPos).toBeLessThan(addPos);
    });
  });

  describe('003_conversation_sessions.sql', () => {
    let sql: string;

    beforeEach(() => {
      sql = readMigration('003_conversation_sessions.sql');
    });

    it('should exist and be non-empty', () => {
      expect(sql).toBeTruthy();
      expect(sql.length).toBeGreaterThan(0);
    });

    it('should create the conversation_sessions table', () => {
      expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS conversation_sessions/i);
    });

    it('should include all required fields', () => {
      const requiredFields = [
        'id',
        'user_id',
        'chat_key',
        'related_todo_id',
        'state',
        'task_label_snapshot',
        'candidate_todo_ids',
        'prompt_type',
        'last_inbound_at',
        'last_outbound_at',
        'resolved_at',
        'created_at',
        'updated_at',
      ];
      for (const field of requiredFields) {
        expect(sql).toContain(field);
      }
    });

    it('should define id as UUID PRIMARY KEY', () => {
      expect(sql).toMatch(/id\s+UUID\s+PRIMARY KEY/i);
    });

    it('should define user_id as FK to users', () => {
      expect(sql).toMatch(/user_id\s+UUID\s+NOT NULL\s+REFERENCES\s+users\(id\)/i);
    });

    it('should define related_todo_id as nullable FK to todos', () => {
      expect(sql).toMatch(/related_todo_id\s+UUID\s+REFERENCES\s+todos\(id\)/i);
      // Should NOT have NOT NULL
      const relatedLine = sql.split('\n').find(l => l.includes('related_todo_id'));
      expect(relatedLine).not.toMatch(/NOT NULL/i);
    });

    it('should define state with CHECK constraint for all valid states', () => {
      const validStates = [
        'awaiting_time',
        'awaiting_date',
        'awaiting_disambiguation',
        'awaiting_completion',
        'awaiting_edit_target',
        'awaiting_edit_value',
      ];
      for (const state of validStates) {
        expect(sql).toContain(`'${state}'`);
      }
    });

    it('should define candidate_todo_ids as JSONB nullable', () => {
      expect(sql).toMatch(/candidate_todo_ids\s+JSONB/i);
    });

    it('should have resolved_at as nullable TIMESTAMPTZ', () => {
      const resolvedLine = sql.split('\n').find(l => l.includes('resolved_at'));
      expect(resolvedLine).toBeDefined();
      expect(resolvedLine).toMatch(/TIMESTAMPTZ/i);
      // Should NOT have NOT NULL (it's nullable)
      expect(resolvedLine).not.toMatch(/NOT NULL/i);
    });

    it('should have index on user_id + resolved_at for active session queries', () => {
      expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_conversation_sessions_active/i);
      expect(sql).toMatch(/user_id.*resolved_at/i);
    });

    it('should enable RLS on conversation_sessions', () => {
      expect(sql).toMatch(/ALTER TABLE conversation_sessions ENABLE ROW LEVEL SECURITY/i);
    });

    it('should have service_role full access policy', () => {
      expect(sql).toMatch(/service_role_full_conversation_sessions/i);
      expect(sql).toMatch(/FOR ALL TO service_role/i);
    });

    it('should have anon read policy', () => {
      expect(sql).toMatch(/anon_read_conversation_sessions/i);
      expect(sql).toMatch(/FOR SELECT TO anon/i);
    });

    it('should use idempotent patterns', () => {
      expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS/i);
      expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS/i);
      expect(sql).toMatch(/DROP TRIGGER IF EXISTS/i);
    });

    it('should set up updated_at trigger', () => {
      expect(sql).toMatch(/CREATE TRIGGER set_updated_at_conversation_sessions/i);
    });
  });
});

describe('getOrCreateUser()', () => {
  let mockSupabase: ReturnType<typeof createMockSupabaseClient>;

  beforeEach(() => {
    mockSupabase = createMockSupabaseClient();
  });

  it('should call supabase.from("users").upsert() with phone and defaults', async () => {
    const mockUser = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      phone: '+1234567890',
      timezone: 'America/Los_Angeles',
      lead_minutes: 30,
      created_at: '2024-01-01T00:00:00Z',
    };

    // Set up the mock chain to return the user
    mockSupabase.mockQueryBuilder.single.mockResolvedValue({
      data: mockUser,
      error: null,
    });

    const result = await getOrCreateUser(mockSupabase.client, '+1234567890');

    expect(mockSupabase.mockFrom).toHaveBeenCalledWith('users');
    expect(mockSupabase.mockQueryBuilder.upsert).toHaveBeenCalledWith(
      {
        phone: '+1234567890',
        timezone: 'America/Los_Angeles',
        lead_minutes: 30,
      },
      {
        onConflict: 'phone',
        ignoreDuplicates: true,
      },
    );
    expect(result).toEqual(mockUser);
  });

  it('should use custom defaults when provided', async () => {
    const mockUser = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      phone: '+1234567890',
      timezone: 'America/New_York',
      lead_minutes: 15,
      created_at: '2024-01-01T00:00:00Z',
    };

    mockSupabase.mockQueryBuilder.single.mockResolvedValue({
      data: mockUser,
      error: null,
    });

    await getOrCreateUser(mockSupabase.client, '+1234567890', {
      timezone: 'America/New_York',
      lead_minutes: 15,
    });

    expect(mockSupabase.mockQueryBuilder.upsert).toHaveBeenCalledWith(
      {
        phone: '+1234567890',
        timezone: 'America/New_York',
        lead_minutes: 15,
      },
      {
        onConflict: 'phone',
        ignoreDuplicates: true,
      },
    );
  });

  it('should return the same user when called twice with the same phone (upsert safety)', async () => {
    const mockUser = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      phone: '+1234567890',
      timezone: 'America/Los_Angeles',
      lead_minutes: 30,
      created_at: '2024-01-01T00:00:00Z',
    };

    mockSupabase.mockQueryBuilder.single.mockResolvedValue({
      data: mockUser,
      error: null,
    });

    const user1 = await getOrCreateUser(mockSupabase.client, '+1234567890');
    const user2 = await getOrCreateUser(mockSupabase.client, '+1234567890');

    // Both calls should return the same user
    expect(user1).toEqual(user2);
    expect(user1.id).toBe(user2.id);

    // upsert was called both times (not insert)
    expect(mockSupabase.mockQueryBuilder.upsert).toHaveBeenCalledTimes(2);
  });

  it('should throw an error when Supabase returns an error', async () => {
    mockSupabase.mockQueryBuilder.single.mockResolvedValue({
      data: null,
      error: { message: 'Database connection failed' },
    });

    await expect(
      getOrCreateUser(mockSupabase.client, '+1234567890'),
    ).rejects.toThrow('Failed to get or create user: Database connection failed');
  });

  it('should use upsert with onConflict phone, not plain insert', async () => {
    const mockUser = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      phone: '+1234567890',
      timezone: 'America/Los_Angeles',
      lead_minutes: 30,
      created_at: '2024-01-01T00:00:00Z',
    };

    mockSupabase.mockQueryBuilder.single.mockResolvedValue({
      data: mockUser,
      error: null,
    });

    await getOrCreateUser(mockSupabase.client, '+1234567890');

    // Must use upsert, not insert
    expect(mockSupabase.mockQueryBuilder.upsert).toHaveBeenCalled();
    expect(mockSupabase.mockQueryBuilder.insert).not.toHaveBeenCalled();

    // Must specify onConflict: 'phone'
    const upsertCall = mockSupabase.mockQueryBuilder.upsert.mock.calls[0];
    expect(upsertCall[1]).toHaveProperty('onConflict', 'phone');
  });

  it('should use ignoreDuplicates to avoid overwriting existing data', async () => {
    const mockUser = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      phone: '+1234567890',
      timezone: 'America/Los_Angeles',
      lead_minutes: 30,
      created_at: '2024-01-01T00:00:00Z',
    };

    mockSupabase.mockQueryBuilder.single.mockResolvedValue({
      data: mockUser,
      error: null,
    });

    await getOrCreateUser(mockSupabase.client, '+1234567890');

    const upsertCall = mockSupabase.mockQueryBuilder.upsert.mock.calls[0];
    expect(upsertCall[1]).toHaveProperty('ignoreDuplicates', true);
  });
});
