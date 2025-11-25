/**
 * Email Templates for Review Notifications (G.4)
 *
 * These templates generate HTML and plaintext emails for review system notifications.
 * In production, integrate with email service (SendGrid, AWS SES, etc.)
 */

export interface EmailTemplate {
  subject: string;
  html: string;
  text: string;
}

/**
 * Generate email for review requested notification
 */
export function reviewRequestedEmail(params: {
  reviewerName: string;
  requesterName: string;
  boardName: string;
  contextMessage?: string;
  dueDate?: string;
  reviewLink: string;
}): EmailTemplate {
  const dueDateText = params.dueDate
    ? `<p><strong>Due Date:</strong> ${new Date(params.dueDate).toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })}</p>`
    : '';

  const contextText = params.contextMessage
    ? `<p><strong>Context:</strong></p><blockquote style="border-left: 3px solid #ccc; padding-left: 15px; color: #666;">${params.contextMessage}</blockquote>`
    : '';

  const html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: #4A90E2; color: white; padding: 20px; text-align: center; }
    .content { padding: 20px; background-color: #f9f9f9; }
    .button { display: inline-block; padding: 12px 24px; background-color: #4A90E2; color: white; text-decoration: none; border-radius: 4px; margin-top: 15px; }
    .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📋 Review Request</h1>
    </div>
    <div class="content">
      <p>Hi ${params.reviewerName},</p>
      <p><strong>${params.requesterName}</strong> has requested your review on <strong>${params.boardName}</strong>.</p>
      ${dueDateText}
      ${contextText}
      <p>Please review the snapshot and provide your feedback.</p>
      <a href="${params.reviewLink}" class="button">Start Review</a>
    </div>
    <div class="footer">
      <p>This is an automated notification from Olumi Collaboration Platform.</p>
    </div>
  </div>
</body>
</html>
  `;

  const text = `
Review Request

Hi ${params.reviewerName},

${params.requesterName} has requested your review on ${params.boardName}.

${params.dueDate ? `Due Date: ${new Date(params.dueDate).toLocaleDateString()}` : ''}
${params.contextMessage ? `Context: ${params.contextMessage}` : ''}

Please review the snapshot and provide your feedback.

Start Review: ${params.reviewLink}

---
This is an automated notification from Olumi Collaboration Platform.
  `.trim();

  return {
    subject: `Review Request: ${params.boardName}`,
    html,
    text,
  };
}

/**
 * Generate email for review completed notification
 */
export function reviewCompletedEmail(params: {
  requesterName: string;
  boardName: string;
  overallResult: 'approved' | 'changes_needed' | 'mixed' | 'no_consensus';
  approvalsCount: number;
  changesRequestedCount: number;
  totalReviewers: number;
  recommendation: string;
  reviewLink: string;
}): EmailTemplate {
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

  const html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: ${resultColor[params.overallResult]}; color: white; padding: 20px; text-align: center; }
    .content { padding: 20px; background-color: #f9f9f9; }
    .stats { background-color: white; padding: 15px; border-radius: 4px; margin: 15px 0; }
    .stat-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee; }
    .stat-row:last-child { border-bottom: none; }
    .recommendation { background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 15px 0; }
    .button { display: inline-block; padding: 12px 24px; background-color: ${resultColor[params.overallResult]}; color: white; text-decoration: none; border-radius: 4px; margin-top: 15px; }
    .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${resultEmoji[params.overallResult]} Review Complete</h1>
    </div>
    <div class="content">
      <p>Hi ${params.requesterName},</p>
      <p>The review for <strong>${params.boardName}</strong> has been completed.</p>

      <div class="stats">
        <h3>Review Results</h3>
        <div class="stat-row">
          <span>Approvals:</span>
          <strong>${params.approvalsCount} / ${params.totalReviewers}</strong>
        </div>
        <div class="stat-row">
          <span>Changes Requested:</span>
          <strong>${params.changesRequestedCount} / ${params.totalReviewers}</strong>
        </div>
        <div class="stat-row">
          <span>Overall Result:</span>
          <strong>${params.overallResult.replace('_', ' ').toUpperCase()}</strong>
        </div>
      </div>

      <div class="recommendation">
        <strong>Recommendation:</strong>
        <p>${params.recommendation}</p>
      </div>

      <a href="${params.reviewLink}" class="button">View Full Results</a>
    </div>
    <div class="footer">
      <p>This is an automated notification from Olumi Collaboration Platform.</p>
    </div>
  </div>
</body>
</html>
  `;

  const text = `
Review Complete ${resultEmoji[params.overallResult]}

Hi ${params.requesterName},

The review for ${params.boardName} has been completed.

Review Results:
- Approvals: ${params.approvalsCount} / ${params.totalReviewers}
- Changes Requested: ${params.changesRequestedCount} / ${params.totalReviewers}
- Overall Result: ${params.overallResult.replace('_', ' ').toUpperCase()}

Recommendation:
${params.recommendation}

View Full Results: ${params.reviewLink}

---
This is an automated notification from Olumi Collaboration Platform.
  `.trim();

  return {
    subject: `Review Complete: ${params.boardName}`,
    html,
    text,
  };
}

/**
 * Generate email for review reminder notification
 */
export function reviewReminderEmail(params: {
  reviewerName: string;
  boardName: string;
  dueDate?: string;
  hoursUntilDue?: number;
  reviewLink: string;
}): EmailTemplate {
  const urgencyText = params.hoursUntilDue
    ? params.hoursUntilDue < 24
      ? `<p style="color: #dc3545;"><strong>⏰ Due in ${params.hoursUntilDue} hours!</strong></p>`
      : `<p><strong>Due in ${Math.round(params.hoursUntilDue / 24)} days</strong></p>`
    : params.dueDate
    ? `<p><strong>Due Date:</strong> ${new Date(params.dueDate).toLocaleDateString()}</p>`
    : '';

  const html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: #ffc107; color: #333; padding: 20px; text-align: center; }
    .content { padding: 20px; background-color: #f9f9f9; }
    .button { display: inline-block; padding: 12px 24px; background-color: #ffc107; color: #333; text-decoration: none; border-radius: 4px; margin-top: 15px; }
    .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🔔 Review Reminder</h1>
    </div>
    <div class="content">
      <p>Hi ${params.reviewerName},</p>
      <p>This is a friendly reminder that you have a pending review for <strong>${params.boardName}</strong>.</p>
      ${urgencyText}
      <p>Your feedback is valuable to the team. Please complete your review at your earliest convenience.</p>
      <a href="${params.reviewLink}" class="button">Complete Review</a>
    </div>
    <div class="footer">
      <p>This is an automated notification from Olumi Collaboration Platform.</p>
    </div>
  </div>
</body>
</html>
  `;

  const text = `
Review Reminder 🔔

Hi ${params.reviewerName},

This is a friendly reminder that you have a pending review for ${params.boardName}.

${params.hoursUntilDue ? `Due in ${Math.round(params.hoursUntilDue / 24)} days` : params.dueDate ? `Due Date: ${new Date(params.dueDate).toLocaleDateString()}` : ''}

Your feedback is valuable to the team. Please complete your review at your earliest convenience.

Complete Review: ${params.reviewLink}

---
This is an automated notification from Olumi Collaboration Platform.
  `.trim();

  return {
    subject: `Reminder: Review Pending for ${params.boardName}`,
    html,
    text,
  };
}

/**
 * Generate email for overdue review notification
 */
export function reviewOverdueEmail(params: {
  reviewerName: string;
  boardName: string;
  daysOverdue: number;
  reviewLink: string;
}): EmailTemplate {
  const html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: #dc3545; color: white; padding: 20px; text-align: center; }
    .content { padding: 20px; background-color: #f9f9f9; }
    .warning { background-color: #f8d7da; border-left: 4px solid #dc3545; padding: 15px; margin: 15px 0; color: #721c24; }
    .button { display: inline-block; padding: 12px 24px; background-color: #dc3545; color: white; text-decoration: none; border-radius: 4px; margin-top: 15px; }
    .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>⚠️ Review Overdue</h1>
    </div>
    <div class="content">
      <p>Hi ${params.reviewerName},</p>
      <div class="warning">
        <strong>Your review for ${params.boardName} is now ${params.daysOverdue} day${params.daysOverdue > 1 ? 's' : ''} overdue.</strong>
      </div>
      <p>The team is waiting for your feedback to proceed. Please complete your review as soon as possible.</p>
      <a href="${params.reviewLink}" class="button">Complete Review Now</a>
    </div>
    <div class="footer">
      <p>This is an automated notification from Olumi Collaboration Platform.</p>
    </div>
  </div>
</body>
</html>
  `;

  const text = `
Review Overdue ⚠️

Hi ${params.reviewerName},

Your review for ${params.boardName} is now ${params.daysOverdue} day${params.daysOverdue > 1 ? 's' : ''} overdue.

The team is waiting for your feedback to proceed. Please complete your review as soon as possible.

Complete Review Now: ${params.reviewLink}

---
This is an automated notification from Olumi Collaboration Platform.
  `.trim();

  return {
    subject: `⚠️ OVERDUE: Review for ${params.boardName}`,
    html,
    text,
  };
}
