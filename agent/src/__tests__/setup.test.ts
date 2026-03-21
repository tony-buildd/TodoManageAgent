import { describe, it, expect } from 'vitest';
import {
  createMockSupabaseClient,
  createMockOllamaClient,
  createMockIMessageSDK,
} from './helpers.js';

describe('Vitest setup', () => {
  it('should run a basic assertion', () => {
    expect(1 + 1).toBe(2);
  });

  it('should support async tests', async () => {
    const result = await Promise.resolve('hello');
    expect(result).toBe('hello');
  });
});

describe('Mock factories', () => {
  it('should create a mock Supabase client', () => {
    const { client, mockFrom, mockQueryBuilder } = createMockSupabaseClient();

    expect(client).toBeDefined();
    expect(client.from).toBeDefined();
    expect(mockFrom).toBeDefined();
    expect(mockQueryBuilder.select).toBeDefined();
    expect(mockQueryBuilder.insert).toBeDefined();
    expect(mockQueryBuilder.update).toBeDefined();
    expect(mockQueryBuilder.delete).toBeDefined();
    expect(mockQueryBuilder.eq).toBeDefined();
  });

  it('should create a mock Supabase client with chainable methods', () => {
    const { client } = createMockSupabaseClient();

    // Verify chainable calls don't throw
    const result = client.from('todos').select('*').eq('id', '123');
    expect(result).toBeDefined();
  });

  it('should create a mock Ollama client', () => {
    const { client, mockChat, mockGenerate } = createMockOllamaClient();

    expect(client).toBeDefined();
    expect(client.chat).toBeDefined();
    expect(client.generate).toBeDefined();
    expect(mockChat).toBeDefined();
    expect(mockGenerate).toBeDefined();
  });

  it('should create a mock Ollama client that returns expected response shape', async () => {
    const { client } = createMockOllamaClient();

    const response = await client.chat({
      model: 'llama3.2:3b',
      messages: [{ role: 'user', content: 'hello' }],
    });

    expect(response).toHaveProperty('message');
    expect(response.message).toHaveProperty('content');
  });

  it('should create a mock iMessage SDK', () => {
    const { sdk, mockSend, mockGetMessages } = createMockIMessageSDK();

    expect(sdk).toBeDefined();
    expect(sdk.send).toBeDefined();
    expect(sdk.getMessages).toBeDefined();
    expect(sdk.startWatching).toBeDefined();
    expect(sdk.stopWatching).toBeDefined();
    expect(sdk.close).toBeDefined();
    expect(mockSend).toBeDefined();
    expect(mockGetMessages).toBeDefined();
  });

  it('should create a mock iMessage SDK that returns expected send result', async () => {
    const { sdk } = createMockIMessageSDK();

    const result = await sdk.send('+1234567890', 'Hello');
    expect(result).toHaveProperty('sentAt');
    expect(result.sentAt).toBeInstanceOf(Date);
  });
});
