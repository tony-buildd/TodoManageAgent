import { vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Ollama } from 'ollama';
import type { IMessageSDK } from '@photon-ai/imessage-kit';

/**
 * Creates a mock Supabase client with chainable query builder methods.
 *
 * Usage:
 *   const { client, mockFrom } = createMockSupabaseClient();
 *   mockFrom.select.mockResolvedValue({ data: [...], error: null });
 */
export function createMockSupabaseClient() {
  const mockQueryBuilder = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    like: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockReturnThis(),
    then: vi.fn(),
  };

  // By default, resolve with empty successful result
  const defaultResult = { data: [], error: null };
  for (const method of Object.keys(mockQueryBuilder)) {
    const fn = mockQueryBuilder[method as keyof typeof mockQueryBuilder];
    if (method === 'then') {
      fn.mockImplementation((resolve: (value: unknown) => void) =>
        resolve(defaultResult),
      );
    }
  }

  const mockFrom = vi.fn().mockReturnValue(mockQueryBuilder);
  const mockRpc = vi.fn().mockResolvedValue({ data: null, error: null });

  const client = {
    from: mockFrom,
    rpc: mockRpc,
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
    },
  } as unknown as SupabaseClient;

  return {
    client,
    mockFrom,
    mockQueryBuilder,
    mockRpc,
  };
}

/**
 * Creates a mock Ollama client.
 *
 * Usage:
 *   const { client, mockChat, mockGenerate } = createMockOllamaClient();
 *   mockChat.mockResolvedValue({ message: { content: 'response' } });
 */
export function createMockOllamaClient() {
  const mockChat = vi.fn().mockResolvedValue({
    model: 'llama3.2:3b',
    message: {
      role: 'assistant',
      content: '',
    },
    done: true,
  });

  const mockGenerate = vi.fn().mockResolvedValue({
    model: 'llama3.2:3b',
    response: '',
    done: true,
  });

  const mockEmbed = vi.fn().mockResolvedValue({
    model: 'llama3.2:3b',
    embeddings: [],
  });

  const client = {
    chat: mockChat,
    generate: mockGenerate,
    embed: mockEmbed,
    list: vi.fn().mockResolvedValue({ models: [] }),
    show: vi.fn().mockResolvedValue({}),
    pull: vi.fn().mockResolvedValue({}),
  } as unknown as Ollama;

  return {
    client,
    mockChat,
    mockGenerate,
    mockEmbed,
  };
}

/**
 * Creates a mock iMessage SDK.
 *
 * Usage:
 *   const { sdk, mockSend, mockGetMessages } = createMockIMessageSDK();
 *   mockSend.mockResolvedValue({ sentAt: new Date() });
 */
export function createMockIMessageSDK() {
  const mockSend = vi.fn().mockResolvedValue({
    sentAt: new Date(),
  });

  const mockGetMessages = vi.fn().mockResolvedValue({
    messages: [],
    total: 0,
    unreadCount: 0,
  });

  const mockStartWatching = vi.fn().mockResolvedValue(undefined);
  const mockStopWatching = vi.fn();
  const mockClose = vi.fn().mockResolvedValue(undefined);

  const sdk = {
    send: mockSend,
    getMessages: mockGetMessages,
    startWatching: mockStartWatching,
    stopWatching: mockStopWatching,
    close: mockClose,
    use: vi.fn().mockReturnThis(),
    message: vi.fn(),
  } as unknown as IMessageSDK;

  return {
    sdk,
    mockSend,
    mockGetMessages,
    mockStartWatching,
    mockStopWatching,
    mockClose,
  };
}
