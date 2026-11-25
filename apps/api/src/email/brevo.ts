export interface EmailSender {
  sendVerificationCode(email: string, code: string, purpose: EmailCodePurpose): Promise<void>;
}

export type EmailCodePurpose = 'signup' | 'login' | 'activation';

export interface BrevoEmailConfig {
  apiKey?: string;
  senderEmail?: string;
  senderName?: string;
}

export class BrevoEmailSender implements EmailSender {
  constructor(private readonly config: BrevoEmailConfig) {}

  async sendVerificationCode(email: string, code: string, purpose: EmailCodePurpose): Promise<void> {
    const { apiKey, senderEmail, senderName } = this.config;
    if (!apiKey || !senderEmail || !senderName) {
      throw new Error('Brevo email is not configured with an API key and verified sender.');
    }

    const purposeText = purpose === 'signup'
      ? 'confirm your email address'
      : purpose === 'activation'
        ? 'activate your Boda-Tracker account'
        : 'sign in to Boda-Tracker';
    const textContent = `Your code to ${purposeText} is ${code}. It expires in 10 minutes. If you did not request this, ignore this email. Never share this code.`;
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'api-key': apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sender: { email: senderEmail, name: senderName },
        to: [{ email }],
        subject: 'Your Boda-Tracker verification code',
        textContent,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`Brevo email request failed with HTTP ${response.status}.`);
    }
  }
}
