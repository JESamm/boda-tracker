import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrevoEmailSender } from '../src/email/brevo.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Brevo email sender', () => {
  it('sends verification codes through the transactional email API', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(null, { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const sender = new BrevoEmailSender({
      apiKey: 'test-api-key',
      senderEmail: 'verified@example.com',
      senderName: 'Boda-Tracker',
    });

    await sender.sendVerificationCode('rider@example.com', '123456', 'activation');

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(options?.headers).toMatchObject({ 'api-key': 'test-api-key' });
    expect(JSON.parse(String(options?.body))).toEqual({
      sender: { email: 'verified@example.com', name: 'Boda-Tracker' },
      to: [{ email: 'rider@example.com' }],
      subject: 'Your Boda-Tracker verification code',
      textContent: expect.stringContaining('123456'),
    });
  });

  it('reports provider rejection and refuses to send without configuration', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('rejected', { status: 401 })));
    const sender = new BrevoEmailSender({
      apiKey: 'test-api-key',
      senderEmail: 'verified@example.com',
      senderName: 'Boda-Tracker',
    });
    await expect(sender.sendVerificationCode('user@example.com', '123456', 'login'))
      .rejects.toThrow('HTTP 401');

    const missingConfig = new BrevoEmailSender({});
    await expect(missingConfig.sendVerificationCode('user@example.com', '123456', 'login'))
      .rejects.toThrow('not configured');
  });
});
