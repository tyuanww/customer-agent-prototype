// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { minimaxChatContent, minimaxConfigured } from '../../src/main/minimax-chat';

const messages = [{ role: 'user' as const, content: '什么时候发货' }];

describe('minimax chat fail-open', () => {
  afterEach(() => {
    delete process.env.MINIMAX_API_KEY;
    delete process.env.MINIMAX_BASE_URL;
    delete process.env.MINIMAX_MODEL;
  });

  it('returns null when the key is missing, HTTP fails, or fetch throws', async () => {
    delete process.env.MINIMAX_API_KEY;
    expect(minimaxConfigured()).toBe(false);
    expect(await minimaxChatContent(messages, { fetchImpl: (async () => {
      throw new Error('should not fetch without a key');
    }) as typeof fetch })).toBeNull();

    process.env.MINIMAX_API_KEY = '   ';
    expect(minimaxConfigured()).toBe(false);

    process.env.MINIMAX_API_KEY = 'test-key';
    process.env.MINIMAX_BASE_URL = 'https://example.test/v1/';
    process.env.MINIMAX_MODEL = 'MiniMax-M2';
    expect(minimaxConfigured()).toBe(true);

    const urls: string[] = [];
    expect(await minimaxChatContent(messages, {
      fetchImpl: (async (url) => {
        urls.push(String(url));
        return new Response('nope', { status: 500 });
      }) as typeof fetch,
    })).toBeNull();
    expect(urls).toEqual(['https://example.test/v1/chat/completions']);

    expect(await minimaxChatContent(messages, {
      fetchImpl: (async () => new Response(JSON.stringify({ choices: [{ message: { content: '   ' } }] }), { status: 200 })) as typeof fetch,
    })).toBeNull();

    expect(await minimaxChatContent(messages, {
      fetchImpl: (async () => { throw new Error('network down'); }) as typeof fetch,
    })).toBeNull();

    expect(await minimaxChatContent(messages, {
      fetchImpl: (async () => new Response(JSON.stringify({
        choices: [{ message: { content: '{"intent":"shipping"}' } }],
      }), { status: 200 })) as typeof fetch,
    })).toBe('{"intent":"shipping"}');

    process.env.MINIMAX_BASE_URL = 'http://example.test/v1';
    expect(await minimaxChatContent(messages, {
      fetchImpl: (async () => {
        throw new Error('should not fetch http');
      }) as typeof fetch,
    })).toBeNull();
  });
});
