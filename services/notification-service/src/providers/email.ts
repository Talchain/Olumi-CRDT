/**
 * Email Provider (Brevo/SendGrid)
 * Sends emails via external email service
 */

import axios from 'axios';
import { pino } from 'pino';
import { config } from '../config';

const logger = pino({ level: config.logging.level });

export interface EmailMessage {
  to: string;
  subject: string;
  htmlContent: string;
  textContent?: string;
  replyTo?: string;
}

export interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Email provider interface
 */
export interface EmailProvider {
  send(message: EmailMessage): Promise<EmailResult>;
}

/**
 * Brevo (formerly Sendinblue) email provider
 */
export class BrevoEmailProvider implements EmailProvider {
  private apiKey: string;
  private fromAddress: string;
  private fromName: string;
  private replyTo: string;

  constructor() {
    this.apiKey = config.email.apiKey;
    this.fromAddress = config.email.fromAddress;
    this.fromName = config.email.fromName;
    this.replyTo = config.email.replyTo || config.email.fromAddress;
  }

  async send(message: EmailMessage): Promise<EmailResult> {
    try {
      const response = await axios.post(
        'https://api.brevo.com/v3/smtp/email',
        {
          sender: {
            email: this.fromAddress,
            name: this.fromName,
          },
          to: [
            {
              email: message.to,
            },
          ],
          subject: message.subject,
          htmlContent: message.htmlContent,
          textContent: message.textContent || this.stripHtml(message.htmlContent),
          replyTo: {
            email: message.replyTo || this.replyTo,
          },
        },
        {
          headers: {
            'api-key': this.apiKey,
            'Content-Type': 'application/json',
          },
        }
      );

      logger.info(
        {
          to: message.to,
          subject: message.subject,
          messageId: response.data.messageId,
        },
        'Email sent via Brevo'
      );

      return {
        success: true,
        messageId: response.data.messageId,
      };
    } catch (err: any) {
      logger.error(
        {
          err,
          to: message.to,
          subject: message.subject,
        },
        'Failed to send email via Brevo'
      );

      return {
        success: false,
        error: err.message,
      };
    }
  }

  private stripHtml(html: string): string {
    return html.replace(/<[^>]*>/g, '').trim();
  }
}

/**
 * Mock email provider for testing
 */
export class MockEmailProvider implements EmailProvider {
  public sentEmails: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<EmailResult> {
    this.sentEmails.push(message);

    logger.info(
      { to: message.to, subject: message.subject },
      'Email sent (mock)'
    );

    return {
      success: true,
      messageId: `mock_${Date.now()}`,
    };
  }

  clear(): void {
    this.sentEmails = [];
  }
}

/**
 * Create email provider based on configuration
 */
export function createEmailProvider(): EmailProvider {
  if (config.service.env === 'test') {
    return new MockEmailProvider();
  }

  if (!config.email.apiKey) {
    logger.warn('Email API key not configured, using mock provider');
    return new MockEmailProvider();
  }

  return new BrevoEmailProvider();
}
