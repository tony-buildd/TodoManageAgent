import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createSession,
  getActiveSessions,
  resolveSession,
  updateSession,
  findSessionForReply,
  expireOldSessions,
  buildFollowUpPrompt,
} from '../sessions.js';
import { createMockSupabaseClient } from './helpers.js';
import type { ConversationSession, SessionState } from '../types.js';

/**
 * Helper to build a mock ConversationSession object.
 */
function makeSession(overrides: Partial<ConversationSession> = {}): ConversationSession {
  return {
    id: 'session-1',
    user_id: 'user-1',
    chat_key: '+15555555555',
    related_todo_id: 'todo-1',
    state: 'awaiting_time' as SessionState,
    task_label_snapshot: 'get food',
    candidate_todo_ids: null,
    prompt_type: 'awaiting_time',
    last_inbound_at: new Date().toISOString(),
    last_outbound_at: new Date().toISOString(),
    resolved_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('sessions', () => {
  describe('createSession', () => {
    it('should insert a new session row into conversation_sessions', async () => {
      const { client, mockFrom, mockQueryBuilder } = createMockSupabaseClient();
      const expectedSession = makeSession();

      // Override the terminal method to return the expected session
      mockQueryBuilder.single.mockReturnValue({
        data: expectedSession,
        error: null,
        then: (resolve: (v: unknown) => void) =>
          resolve({ data: expectedSession, error: null }),
      });

      const result = await createSession(
        client,
        'user-1',
        '+15555555555',
        'todo-1',
        'awaiting_time',
        'get food',
      );

      expect(mockFrom).toHaveBeenCalledWith('conversation_sessions');
      expect(mockQueryBuilder.insert).toHaveBeenCalledWith({
        user_id: 'user-1',
        chat_key: '+15555555555',
        related_todo_id: 'todo-1',
        state: 'awaiting_time',
        task_label_snapshot: 'get food',
      });
      expect(mockQueryBuilder.select).toHaveBeenCalledWith('*');
      expect(mockQueryBuilder.single).toHaveBeenCalled();
      expect(result).toEqual(expectedSession);
    });

    it('should throw an error when Supabase returns an error', async () => {
      const { client, mockQueryBuilder } = createMockSupabaseClient();

      mockQueryBuilder.single.mockReturnValue({
        data: null,
        error: { message: 'insert failed' },
        then: (resolve: (v: unknown) => void) =>
          resolve({ data: null, error: { message: 'insert failed' } }),
      });

      await expect(
        createSession(client, 'user-1', '+15555555555', null, 'awaiting_time', 'get food'),
      ).rejects.toThrow('Failed to create session: insert failed');
    });

    it('should allow null related_todo_id', async () => {
      const { client, mockFrom, mockQueryBuilder } = createMockSupabaseClient();
      const expectedSession = makeSession({ related_todo_id: null });

      mockQueryBuilder.single.mockReturnValue({
        data: expectedSession,
        error: null,
        then: (resolve: (v: unknown) => void) =>
          resolve({ data: expectedSession, error: null }),
      });

      const result = await createSession(
        client,
        'user-1',
        '+15555555555',
        null,
        'awaiting_time',
        'get food',
      );

      expect(mockQueryBuilder.insert).toHaveBeenCalledWith(
        expect.objectContaining({ related_todo_id: null }),
      );
      expect(result.related_todo_id).toBeNull();
    });
  });

  describe('getActiveSessions', () => {
    it('should return only unresolved sessions ordered by updated_at DESC', async () => {
      const { client, mockFrom, mockQueryBuilder } = createMockSupabaseClient();
      const sessions = [
        makeSession({ id: 'session-2', updated_at: '2025-01-02T00:00:00Z' }),
        makeSession({ id: 'session-1', updated_at: '2025-01-01T00:00:00Z' }),
      ];

      mockQueryBuilder.order.mockReturnValue({
        data: sessions,
        error: null,
        then: (resolve: (v: unknown) => void) =>
          resolve({ data: sessions, error: null }),
      });

      const result = await getActiveSessions(client, 'user-1');

      expect(mockFrom).toHaveBeenCalledWith('conversation_sessions');
      expect(mockQueryBuilder.select).toHaveBeenCalledWith('*');
      expect(mockQueryBuilder.eq).toHaveBeenCalledWith('user_id', 'user-1');
      expect(mockQueryBuilder.is).toHaveBeenCalledWith('resolved_at', null);
      expect(mockQueryBuilder.order).toHaveBeenCalledWith('updated_at', { ascending: false });
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('session-2');
    });

    it('should return an empty array when no active sessions exist', async () => {
      const { client, mockQueryBuilder } = createMockSupabaseClient();

      mockQueryBuilder.order.mockReturnValue({
        data: [],
        error: null,
        then: (resolve: (v: unknown) => void) =>
          resolve({ data: [], error: null }),
      });

      const result = await getActiveSessions(client, 'user-1');
      expect(result).toEqual([]);
    });

    it('should throw an error when Supabase returns an error', async () => {
      const { client, mockQueryBuilder } = createMockSupabaseClient();

      mockQueryBuilder.order.mockReturnValue({
        data: null,
        error: { message: 'query failed' },
        then: (resolve: (v: unknown) => void) =>
          resolve({ data: null, error: { message: 'query failed' } }),
      });

      await expect(getActiveSessions(client, 'user-1')).rejects.toThrow(
        'Failed to get active sessions: query failed',
      );
    });
  });

  describe('resolveSession', () => {
    it('should set resolved_at on the session', async () => {
      const { client, mockFrom, mockQueryBuilder } = createMockSupabaseClient();

      mockQueryBuilder.eq.mockReturnValue({
        data: null,
        error: null,
        then: (resolve: (v: unknown) => void) =>
          resolve({ data: null, error: null }),
      });

      await resolveSession(client, 'session-1');

      expect(mockFrom).toHaveBeenCalledWith('conversation_sessions');
      expect(mockQueryBuilder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          resolved_at: expect.any(String),
        }),
      );
      expect(mockQueryBuilder.eq).toHaveBeenCalledWith('id', 'session-1');
    });

    it('should throw an error when Supabase returns an error', async () => {
      const { client, mockQueryBuilder } = createMockSupabaseClient();

      mockQueryBuilder.eq.mockReturnValue({
        data: null,
        error: { message: 'update failed' },
        then: (resolve: (v: unknown) => void) =>
          resolve({ data: null, error: { message: 'update failed' } }),
      });

      await expect(resolveSession(client, 'session-1')).rejects.toThrow(
        'Failed to resolve session: update failed',
      );
    });
  });

  describe('updateSession', () => {
    it('should update session fields', async () => {
      const { client, mockFrom, mockQueryBuilder } = createMockSupabaseClient();

      mockQueryBuilder.eq.mockReturnValue({
        data: null,
        error: null,
        then: (resolve: (v: unknown) => void) =>
          resolve({ data: null, error: null }),
      });

      await updateSession(client, 'session-1', {
        state: 'awaiting_date',
        last_inbound_at: new Date().toISOString(),
      });

      expect(mockFrom).toHaveBeenCalledWith('conversation_sessions');
      expect(mockQueryBuilder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          state: 'awaiting_date',
          last_inbound_at: expect.any(String),
        }),
      );
      expect(mockQueryBuilder.eq).toHaveBeenCalledWith('id', 'session-1');
    });

    it('should throw an error when Supabase returns an error', async () => {
      const { client, mockQueryBuilder } = createMockSupabaseClient();

      mockQueryBuilder.eq.mockReturnValue({
        data: null,
        error: { message: 'update failed' },
        then: (resolve: (v: unknown) => void) =>
          resolve({ data: null, error: { message: 'update failed' } }),
      });

      await expect(
        updateSession(client, 'session-1', { state: 'awaiting_date' }),
      ).rejects.toThrow('Failed to update session: update failed');
    });
  });

  describe('findSessionForReply', () => {
    it('should return the single active session when only one exists', () => {
      const session = makeSession({ task_label_snapshot: 'get food' });
      const result = findSessionForReply('10pm', [session]);
      expect(result).toEqual(session);
    });

    it('should return null when no active sessions exist', () => {
      const result = findSessionForReply('10pm', []);
      expect(result).toBeNull();
    });

    it('should match by task label when reply contains the label (VAL-SESSION-001)', () => {
      const session1 = makeSession({
        id: 'session-1',
        task_label_snapshot: 'get food',
      });
      const session2 = makeSession({
        id: 'session-2',
        task_label_snapshot: 'call mom',
      });

      const result = findSessionForReply('get food at 10pm', [session1, session2]);
      expect(result).toEqual(session1);
    });

    it('should match case-insensitively by task label', () => {
      const session1 = makeSession({
        id: 'session-1',
        task_label_snapshot: 'Get Food',
      });
      const session2 = makeSession({
        id: 'session-2',
        task_label_snapshot: 'Call Mom',
      });

      const result = findSessionForReply('get food at 10pm', [session1, session2]);
      expect(result).toEqual(session1);
    });

    it('should return null when reply is ambiguous across multiple sessions (VAL-SESSION-004)', () => {
      const session1 = makeSession({
        id: 'session-1',
        task_label_snapshot: 'get food',
      });
      const session2 = makeSession({
        id: 'session-2',
        task_label_snapshot: 'call mom',
      });

      // Reply "10pm" doesn't contain either label
      const result = findSessionForReply('10pm', [session1, session2]);
      expect(result).toBeNull();
    });

    it('should return null when reply matches multiple session labels', () => {
      const session1 = makeSession({
        id: 'session-1',
        task_label_snapshot: 'food',
      });
      const session2 = makeSession({
        id: 'session-2',
        task_label_snapshot: 'food shopping',
      });

      // "food shopping at 10" contains both "food" and "food shopping"
      const result = findSessionForReply('food shopping at 10', [session1, session2]);
      expect(result).toBeNull();
    });

    it('should handle the second session matching by label', () => {
      const session1 = makeSession({
        id: 'session-1',
        task_label_snapshot: 'get food',
      });
      const session2 = makeSession({
        id: 'session-2',
        task_label_snapshot: 'call mom',
      });

      const result = findSessionForReply('call mom at 6pm', [session1, session2]);
      expect(result).toEqual(session2);
    });
  });

  describe('Multiple active sessions coexisting (VAL-SESSION-002)', () => {
    it('should allow multiple sessions for the same user', async () => {
      const { client, mockQueryBuilder } = createMockSupabaseClient();
      const sessions = [
        makeSession({ id: 'session-1', task_label_snapshot: 'get food' }),
        makeSession({ id: 'session-2', task_label_snapshot: 'call mom' }),
        makeSession({ id: 'session-3', task_label_snapshot: 'buy milk' }),
      ];

      mockQueryBuilder.order.mockReturnValue({
        data: sessions,
        error: null,
        then: (resolve: (v: unknown) => void) =>
          resolve({ data: sessions, error: null }),
      });

      const result = await getActiveSessions(client, 'user-1');
      expect(result).toHaveLength(3);
    });

    it('should not affect one session when resolving another', async () => {
      // Resolve session-1 and verify session-2 remains accessible
      const { client, mockFrom, mockQueryBuilder } = createMockSupabaseClient();

      // First: resolve session-1
      mockQueryBuilder.eq.mockReturnValue({
        data: null,
        error: null,
        then: (resolve: (v: unknown) => void) =>
          resolve({ data: null, error: null }),
      });

      await resolveSession(client, 'session-1');

      expect(mockQueryBuilder.update).toHaveBeenCalledWith(
        expect.objectContaining({ resolved_at: expect.any(String) }),
      );
      expect(mockQueryBuilder.eq).toHaveBeenCalledWith('id', 'session-1');
    });
  });

  describe('expireOldSessions (VAL-EDGE-003)', () => {
    it('should resolve sessions inactive for more than maxAgeHours', async () => {
      const { client, mockFrom, mockQueryBuilder } = createMockSupabaseClient();
      const expiredSessions = [{ id: 'session-old-1' }, { id: 'session-old-2' }];

      mockQueryBuilder.select.mockReturnValue({
        data: expiredSessions,
        error: null,
        then: (resolve: (v: unknown) => void) =>
          resolve({ data: expiredSessions, error: null }),
      });

      const count = await expireOldSessions(client, 'user-1', 24);

      expect(mockFrom).toHaveBeenCalledWith('conversation_sessions');
      expect(mockQueryBuilder.update).toHaveBeenCalledWith(
        expect.objectContaining({ resolved_at: expect.any(String) }),
      );
      expect(mockQueryBuilder.eq).toHaveBeenCalledWith('user_id', 'user-1');
      expect(mockQueryBuilder.is).toHaveBeenCalledWith('resolved_at', null);
      expect(mockQueryBuilder.lt).toHaveBeenCalledWith('updated_at', expect.any(String));
      expect(count).toBe(2);
    });

    it('should default to 24 hours when maxAgeHours is not provided', async () => {
      const { client, mockQueryBuilder } = createMockSupabaseClient();

      mockQueryBuilder.select.mockReturnValue({
        data: [],
        error: null,
        then: (resolve: (v: unknown) => void) =>
          resolve({ data: [], error: null }),
      });

      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now);

      const count = await expireOldSessions(client, 'user-1');

      // Verify the cutoff is approximately 24 hours ago
      const expectedCutoff = new Date(now - 24 * 60 * 60 * 1000).toISOString();
      expect(mockQueryBuilder.lt).toHaveBeenCalledWith('updated_at', expectedCutoff);
      expect(count).toBe(0);

      vi.restoreAllMocks();
    });

    it('should return 0 when no sessions are expired', async () => {
      const { client, mockQueryBuilder } = createMockSupabaseClient();

      mockQueryBuilder.select.mockReturnValue({
        data: [],
        error: null,
        then: (resolve: (v: unknown) => void) =>
          resolve({ data: [], error: null }),
      });

      const count = await expireOldSessions(client, 'user-1');
      expect(count).toBe(0);
    });

    it('should throw an error when Supabase returns an error', async () => {
      const { client, mockQueryBuilder } = createMockSupabaseClient();

      mockQueryBuilder.select.mockReturnValue({
        data: null,
        error: { message: 'expire failed' },
        then: (resolve: (v: unknown) => void) =>
          resolve({ data: null, error: { message: 'expire failed' } }),
      });

      await expect(expireOldSessions(client, 'user-1')).rejects.toThrow(
        'Failed to expire old sessions: expire failed',
      );
    });

    it('should use custom maxAgeHours when provided', async () => {
      const { client, mockQueryBuilder } = createMockSupabaseClient();

      mockQueryBuilder.select.mockReturnValue({
        data: [{ id: 'old-session' }],
        error: null,
        then: (resolve: (v: unknown) => void) =>
          resolve({ data: [{ id: 'old-session' }], error: null }),
      });

      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now);

      const count = await expireOldSessions(client, 'user-1', 12);

      const expectedCutoff = new Date(now - 12 * 60 * 60 * 1000).toISOString();
      expect(mockQueryBuilder.lt).toHaveBeenCalledWith('updated_at', expectedCutoff);
      expect(count).toBe(1);

      vi.restoreAllMocks();
    });
  });

  describe('buildFollowUpPrompt (VAL-SESSION-003)', () => {
    it('should include the task label in awaiting_time prompts', () => {
      const prompt = buildFollowUpPrompt('get food', 'awaiting_time');
      expect(prompt).toContain('get food');
      expect(prompt.toLowerCase()).toContain('time');
    });

    it('should include the task label in awaiting_date prompts', () => {
      const prompt = buildFollowUpPrompt('call mom', 'awaiting_date');
      expect(prompt).toContain('call mom');
      expect(prompt.toLowerCase()).toContain('date');
    });

    it('should include the task label in generic prompts', () => {
      const prompt = buildFollowUpPrompt('buy milk', 'unknown_type');
      expect(prompt).toContain('buy milk');
    });

    it('should handle disambiguation prompts', () => {
      const prompt = buildFollowUpPrompt('', 'awaiting_disambiguation');
      expect(prompt.toLowerCase()).toContain('which task');
    });

    it('should always include the task name in follow-up prompts for non-disambiguation cases', () => {
      const taskLabels = ['get food', 'call mom', 'buy milk', 'study math'];
      const promptTypes = ['awaiting_time', 'awaiting_date', 'some_other'];

      for (const label of taskLabels) {
        for (const type of promptTypes) {
          const prompt = buildFollowUpPrompt(label, type);
          expect(prompt).toContain(label);
        }
      }
    });
  });

  describe('Session lifecycle integration', () => {
    it('should support full create → getActive → update → resolve cycle', async () => {
      const { client, mockFrom, mockQueryBuilder } = createMockSupabaseClient();

      // Step 1: Create session
      const createdSession = makeSession();
      mockQueryBuilder.single.mockReturnValue({
        data: createdSession,
        error: null,
        then: (resolve: (v: unknown) => void) =>
          resolve({ data: createdSession, error: null }),
      });

      const session = await createSession(
        client,
        'user-1',
        '+15555555555',
        'todo-1',
        'awaiting_time',
        'get food',
      );
      expect(session.state).toBe('awaiting_time');
      expect(session.resolved_at).toBeNull();

      // Step 2: Update session state
      mockQueryBuilder.eq.mockReturnValue({
        data: null,
        error: null,
        then: (resolve: (v: unknown) => void) =>
          resolve({ data: null, error: null }),
      });

      await updateSession(client, session.id, { state: 'awaiting_date' });
      expect(mockQueryBuilder.update).toHaveBeenCalledWith(
        expect.objectContaining({ state: 'awaiting_date' }),
      );

      // Step 3: Resolve session
      await resolveSession(client, session.id);
      expect(mockQueryBuilder.update).toHaveBeenCalledWith(
        expect.objectContaining({ resolved_at: expect.any(String) }),
      );
    });

    it('should correctly identify stale sessions for expiry', async () => {
      const { client, mockQueryBuilder } = createMockSupabaseClient();

      // Mock: 2 old sessions expired
      mockQueryBuilder.select.mockReturnValue({
        data: [{ id: 'old-1' }, { id: 'old-2' }],
        error: null,
        then: (resolve: (v: unknown) => void) =>
          resolve({ data: [{ id: 'old-1' }, { id: 'old-2' }], error: null }),
      });

      const expired = await expireOldSessions(client, 'user-1', 24);
      expect(expired).toBe(2);
    });
  });
});
