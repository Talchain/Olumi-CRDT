/**
 * Slack Provider
 * Sends notifications to Slack channels via webhook or bot token
 */

import axios from 'axios';
import { pino } from 'pino';
import { config } from '../config';

const logger = pino({ level: config.logging.level });

export interface SlackMessage {
  text: string;
  channel?: string;
  blocks?: any[];
}

export interface SlackResult {
  success: boolean;
  error?: string;
}

/**
 * Slack provider interface
 */
export interface SlackProvider {
  send(message: SlackMessage): Promise<SlackResult>;
}

/**
 * Slack webhook provider
 */
export class SlackWebhookProvider implements SlackProvider {
  private webhookUrl: string;

  constructor(webhookUrl: string) {
    this.webhookUrl = webhookUrl;
  }

  async send(message: SlackMessage): Promise<SlackResult> {
    try {
      await axios.post(this.webhookUrl, {
        text: message.text,
        blocks: message.blocks,
      });

      logger.info({ text: message.text }, 'Slack message sent via webhook');

      return { success: true };
    } catch (err: any) {
      logger.error({ err, text: message.text }, 'Failed to send Slack message');

      return {
        success: false,
        error: err.message,
      };
    }
  }
}

/**
 * Mock Slack provider for testing
 */
export class MockSlackProvider implements SlackProvider {
  public sentMessages: SlackMessage[] = [];

  async send(message: SlackMessage): Promise<SlackResult> {
    this.sentMessages.push(message);

    logger.info({ text: message.text }, 'Slack message sent (mock)');

    return { success: true };
  }

  clear(): void {
    this.sentMessages = [];
  }
}

/**
 * Create Slack provider based on configuration
 */
export function createSlackProvider(): SlackProvider {
  if (config.service.env === 'test') {
    return new MockSlackProvider();
  }

  if (!config.slack.webhookUrl) {
    logger.warn('Slack webhook URL not configured, using mock provider');
    return new MockSlackProvider();
  }

  return new SlackWebhookProvider(config.slack.webhookUrl);
}
