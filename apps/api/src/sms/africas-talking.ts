export interface SmsSender {
  send(phoneNumber: string, message: string): Promise<void>;
}

export interface AfricaTalkingSmsConfig {
  username?: string;
  apiKey?: string;
  senderId?: string;
}

export class AfricaTalkingSmsSender implements SmsSender {
  constructor(private readonly config: AfricaTalkingSmsConfig) {}

  async send(phoneNumber: string, message: string): Promise<void> {
    const { username, apiKey, senderId } = this.config;
    if (!username || !apiKey || !senderId) {
      throw new Error('Africa’s Talking SMS is not configured with a username, API key, and Sender ID.');
    }

    const body = new URLSearchParams({
      username,
      to: phoneNumber,
      message,
      from: senderId,
    });
    const response = await fetch('https://api.africastalking.com/version1/messaging', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        apiKey,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`Africa’s Talking SMS request failed with HTTP ${response.status}.`);
    }

    const result: unknown = await response.json();
    if (!isSuccessfulSmsResponse(result)) {
      throw new Error('Africa’s Talking did not accept the SMS message.');
    }
  }
}

function isSuccessfulSmsResponse(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || !('SMSMessageData' in value)) return false;
  const data = value.SMSMessageData;
  if (typeof data !== 'object' || data === null || !('Recipients' in data)) return false;
  return Array.isArray(data.Recipients)
    && data.Recipients.some((recipient) =>
      typeof recipient === 'object'
      && recipient !== null
      && 'status' in recipient
      && recipient.status === 'Success');
}
