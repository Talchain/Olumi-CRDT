/**
 * Slack Integration (I.2)
 *
 * Formats webhook events as rich Slack messages using Block Kit.
 * Compatible with Slack Incoming Webhooks and Slack Apps.
 */

export interface SlackMessage {
  text: string; // Fallback text
  blocks: SlackBlock[];
  attachments?: SlackAttachment[];
}

export interface SlackBlock {
  type: string;
  [key: string]: any;
}

export interface SlackAttachment {
  color?: string;
  [key: string]: any;
}

/**
 * Format review requested event for Slack
 */
export function formatReviewRequested(data: {
  review_id: string;
  board_name: string;
  requester_name: string;
  reviewer_count: number;
  due_date?: string;
  context_message?: string;
  review_url: string;
}): SlackMessage {
  const blocks: SlackBlock[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: '📋 Review Request',
        emoji: true,
      },
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Board:*\n${data.board_name}`,
        },
        {
          type: 'mrkdwn',
          text: `*Requested by:*\n${data.requester_name}`,
        },
        {
          type: 'mrkdwn',
          text: `*Reviewers:*\n${data.reviewer_count}`,
        },
        data.due_date
          ? {
              type: 'mrkdwn',
              text: `*Due:*\n<!date^${Math.floor(new Date(data.due_date).getTime() / 1000)}^{date_short_pretty}|${data.due_date}>`,
            }
          : null,
      ].filter(Boolean) as any,
    },
  ];

  if (data.context_message) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Context:*\n${data.context_message}`,
      },
    });
  }

  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: {
          type: 'plain_text',
          text: 'Start Review',
          emoji: true,
        },
        style: 'primary',
        url: data.review_url,
      },
    ],
  });

  return {
    text: `Review request: ${data.board_name} by ${data.requester_name}`,
    blocks,
    attachments: [
      {
        color: '#4A90E2',
      },
    ],
  };
}

/**
 * Format review completed event for Slack
 */
export function formatReviewCompleted(data: {
  review_id: string;
  board_name: string;
  overall_result: 'approved' | 'changes_needed' | 'mixed' | 'no_consensus';
  approvals_count: number;
  changes_requested_count: number;
  total_reviewers: number;
  recommendation: string;
  review_url: string;
}): SlackMessage {
  const resultEmoji = {
    approved: '✅',
    changes_needed: '⚠️',
    mixed: '🔄',
    no_consensus: '❓',
  };

  const resultColor = {
    approved: '#28a745',
    changes_needed: '#ffc107',
    mixed: '#17a2b8',
    no_consensus: '#6c757d',
  };

  const blocks: SlackBlock[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `${resultEmoji[data.overall_result]} Review Complete`,
        emoji: true,
      },
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Board:*\n${data.board_name}`,
        },
        {
          type: 'mrkdwn',
          text: `*Result:*\n${data.overall_result.replace('_', ' ').toUpperCase()}`,
        },
        {
          type: 'mrkdwn',
          text: `*Approvals:*\n${data.approvals_count}/${data.total_reviewers}`,
        },
        {
          type: 'mrkdwn',
          text: `*Changes Requested:*\n${data.changes_requested_count}/${data.total_reviewers}`,
        },
      ],
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Recommendation:*\n${data.recommendation}`,
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: 'View Results',
            emoji: true,
          },
          url: data.review_url,
        },
      ],
    },
  ];

  return {
    text: `Review complete: ${data.board_name} - ${data.overall_result}`,
    blocks,
    attachments: [
      {
        color: resultColor[data.overall_result],
      },
    ],
  };
}

/**
 * Format snapshot created event for Slack
 */
export function formatSnapshotCreated(data: {
  snapshot_id: string;
  board_name: string;
  created_by_name: string;
  snapshot_name?: string;
  reason?: string;
  snapshot_url: string;
}): SlackMessage {
  const blocks: SlackBlock[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: '📸 Snapshot Created',
        emoji: true,
      },
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Board:*\n${data.board_name}`,
        },
        {
          type: 'mrkdwn',
          text: `*Created by:*\n${data.created_by_name}`,
        },
        data.snapshot_name
          ? {
              type: 'mrkdwn',
              text: `*Name:*\n${data.snapshot_name}`,
            }
          : null,
        data.reason
          ? {
              type: 'mrkdwn',
              text: `*Reason:*\n${data.reason}`,
            }
          : null,
      ].filter(Boolean) as any,
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: 'View Snapshot',
            emoji: true,
          },
          url: data.snapshot_url,
        },
      ],
    },
  ];

  return {
    text: `Snapshot created: ${data.board_name}`,
    blocks,
    attachments: [
      {
        color: '#36a64f',
      },
    ],
  };
}

/**
 * Format comment added event for Slack
 */
export function formatCommentAdded(data: {
  board_name: string;
  element_id: string;
  commenter_name: string;
  comment_text: string;
  comment_url: string;
}): SlackMessage {
  const blocks: SlackBlock[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `💬 *${data.commenter_name}* commented on *${data.board_name}*`,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `> ${data.comment_text.slice(0, 200)}${data.comment_text.length > 200 ? '...' : ''}`,
      },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `Element: \`${data.element_id}\``,
        },
      ],
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: 'View Comment',
            emoji: true,
          },
          url: data.comment_url,
        },
      ],
    },
  ];

  return {
    text: `${data.commenter_name} commented on ${data.board_name}`,
    blocks,
  };
}

/**
 * Send Slack message to webhook URL
 */
export async function sendSlackMessage(
  webhookUrl: string,
  message: SlackMessage
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    });

    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    return { success: true };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Unknown error',
    };
  }
}
