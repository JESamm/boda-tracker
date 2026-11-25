import { afterEach, describe, expect, it, vi } from 'vitest';
import { AfricaTalkingSmsSender } from '../src/sms/africas-talking.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Africa’s Talking SMS sender', () => {
  it('sends an encoded message using the configured Sender ID', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({
        SMSMessageData: {
          Recipients: [{ status: 'Success' }],
        },
      }), { status: 201, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const sender = new AfricaTalkingSmsSender({
      username: 'test-username',
      apiKey: 'test-api-key',
      senderId: 'approved-sender',
    });
    await sender.send('+254712345678', 'Your verification code is 123456.');

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, options] = fetchMock.mock.calls[0] ?? [];
    expect(options?.headers).toMatchObject({ apiKey: 'test-api-key' });
    expect(new URLSearchParams(String(options?.body))).toEqual(new URLSearchParams({
      username: 'test-username',
      to: '+254712345678',
      message: 'Your verification code is 123456.',
      from: 'approved-sender',
    }));
  });

  it('surfaces provider rejection instead of treating it as successful delivery', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('rejected', { status: 400 })));
    const sender = new AfricaTalkingSmsSender({
      username: 'test-username',
      apiKey: 'test-api-key',
      senderId: 'approved-sender',
    });

    await expect(sender.send('+254712345678', 'Test message')).rejects.toThrow('HTTP 400');
  });

  it('refuses to send when provider settings are incomplete', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const sender = new AfricaTalkingSmsSender({ username: 'test-username' });

    await expect(sender.send('+254712345678', 'Test message')).rejects.toThrow('not configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
