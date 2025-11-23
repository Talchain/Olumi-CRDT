/**
 * Notification Templates
 * Generates email and message content for different notification types
 */

import type { NotificationType, NotificationTemplateVariables } from '@olumi/contracts';

/**
 * Template interface
 */
export interface NotificationTemplate {
  subject: string;
  htmlContent: string;
  textContent: string;
  slackBlocks?: any[];
}

/**
 * Generate notification template
 */
export function generateTemplate(
  notificationType: NotificationType,
  variables: NotificationTemplateVariables
): NotificationTemplate {
  switch (notificationType) {
    case 'ACCESS_REQUEST_CREATED':
      return accessRequestCreatedTemplate(variables);

    case 'ACCESS_REQUEST_APPROVED':
      return accessRequestApprovedTemplate(variables);

    case 'ACCESS_REQUEST_DENIED':
      return accessRequestDeniedTemplate(variables);

    case 'ACCESS_REQUEST_EXPIRED':
      return accessRequestExpiredTemplate(variables);

    case 'ACCESS_REQUEST_EXPIRING_SOON':
      return accessRequestExpiringSoonTemplate(variables);

    case 'BOARD_CREATED':
      return boardCreatedTemplate(variables);

    case 'ELEMENT_VISIBILITY_CHANGED':
      return elementVisibilityChangedTemplate(variables);

    case 'USER_ROLE_CHANGED':
      return userRoleChangedTemplate(variables);

    default:
      return defaultTemplate(variables);
  }
}

/**
 * Access request created template
 */
function accessRequestCreatedTemplate(vars: NotificationTemplateVariables): NotificationTemplate {
  return {
    subject: `New Access Request for ${vars.board_name || 'Board'}`,
    htmlContent: `
      <h2>New Access Request</h2>
      <p><strong>${vars.requester_name || 'A user'}</strong> has requested access to a confidential element.</p>
      <ul>
        <li><strong>Board:</strong> ${vars.board_name || 'N/A'}</li>
        <li><strong>Element Type:</strong> ${vars.element_type || 'N/A'}</li>
        <li><strong>Reason:</strong> ${vars.reason || 'No reason provided'}</li>
      </ul>
      <p>Please review and approve or deny this request.</p>
    `,
    textContent: `New Access Request\n\n${vars.requester_name || 'A user'} has requested access to a confidential element.\n\nBoard: ${vars.board_name || 'N/A'}\nElement Type: ${vars.element_type || 'N/A'}\nReason: ${vars.reason || 'No reason provided'}\n\nPlease review and approve or deny this request.`,
  };
}

/**
 * Access request approved template
 */
function accessRequestApprovedTemplate(vars: NotificationTemplateVariables): NotificationTemplate {
  return {
    subject: `Access Request Approved`,
    htmlContent: `
      <h2>Access Request Approved</h2>
      <p>Your access request has been approved by <strong>${vars.approver_name || 'an admin'}</strong>.</p>
      <ul>
        <li><strong>Board:</strong> ${vars.board_name || 'N/A'}</li>
        <li><strong>Element Type:</strong> ${vars.element_type || 'N/A'}</li>
        <li><strong>Duration:</strong> ${vars.duration_days || 30} days</li>
        <li><strong>Expires:</strong> ${vars.expires_at || 'N/A'}</li>
      </ul>
      <p>You now have access to the requested element.</p>
    `,
    textContent: `Access Request Approved\n\nYour access request has been approved by ${vars.approver_name || 'an admin'}.\n\nBoard: ${vars.board_name || 'N/A'}\nElement Type: ${vars.element_type || 'N/A'}\nDuration: ${vars.duration_days || 30} days\nExpires: ${vars.expires_at || 'N/A'}\n\nYou now have access to the requested element.`,
  };
}

/**
 * Access request denied template
 */
function accessRequestDeniedTemplate(vars: NotificationTemplateVariables): NotificationTemplate {
  return {
    subject: `Access Request Denied`,
    htmlContent: `
      <h2>Access Request Denied</h2>
      <p>Your access request has been denied.</p>
      <ul>
        <li><strong>Board:</strong> ${vars.board_name || 'N/A'}</li>
        <li><strong>Element Type:</strong> ${vars.element_type || 'N/A'}</li>
        ${vars.reason ? `<li><strong>Reason:</strong> ${vars.reason}</li>` : ''}
      </ul>
    `,
    textContent: `Access Request Denied\n\nYour access request has been denied.\n\nBoard: ${vars.board_name || 'N/A'}\nElement Type: ${vars.element_type || 'N/A'}${vars.reason ? `\nReason: ${vars.reason}` : ''}`,
  };
}

/**
 * Access request expired template
 */
function accessRequestExpiredTemplate(vars: NotificationTemplateVariables): NotificationTemplate {
  return {
    subject: `Access Expired`,
    htmlContent: `
      <h2>Access Expired</h2>
      <p>Your temporary access has expired.</p>
      <ul>
        <li><strong>Board:</strong> ${vars.board_name || 'N/A'}</li>
        <li><strong>Element Type:</strong> ${vars.element_type || 'N/A'}</li>
      </ul>
      <p>You can request access again if needed.</p>
    `,
    textContent: `Access Expired\n\nYour temporary access has expired.\n\nBoard: ${vars.board_name || 'N/A'}\nElement Type: ${vars.element_type || 'N/A'}\n\nYou can request access again if needed.`,
  };
}

/**
 * Access expiring soon template
 */
function accessRequestExpiringSoonTemplate(vars: NotificationTemplateVariables): NotificationTemplate {
  return {
    subject: `Access Expiring Soon`,
    htmlContent: `
      <h2>Access Expiring Soon</h2>
      <p>Your temporary access will expire soon.</p>
      <ul>
        <li><strong>Board:</strong> ${vars.board_name || 'N/A'}</li>
        <li><strong>Element Type:</strong> ${vars.element_type || 'N/A'}</li>
        <li><strong>Expires:</strong> ${vars.expires_at || 'Soon'}</li>
      </ul>
      <p>Request an extension if you still need access.</p>
    `,
    textContent: `Access Expiring Soon\n\nYour temporary access will expire soon.\n\nBoard: ${vars.board_name || 'N/A'}\nElement Type: ${vars.element_type || 'N/A'}\nExpires: ${vars.expires_at || 'Soon'}\n\nRequest an extension if you still need access.`,
  };
}

/**
 * Board created template
 */
function boardCreatedTemplate(vars: NotificationTemplateVariables): NotificationTemplate {
  return {
    subject: `New Board Created: ${vars.board_name || 'Untitled'}`,
    htmlContent: `
      <h2>New Board Created</h2>
      <p>A new board has been created: <strong>${vars.board_name || 'Untitled'}</strong></p>
    `,
    textContent: `New Board Created\n\nA new board has been created: ${vars.board_name || 'Untitled'}`,
  };
}

/**
 * Element visibility changed template
 */
function elementVisibilityChangedTemplate(vars: NotificationTemplateVariables): NotificationTemplate {
  return {
    subject: `Element Visibility Changed`,
    htmlContent: `
      <h2>Element Visibility Changed</h2>
      <p>An element's visibility settings have been updated.</p>
      <ul>
        <li><strong>Element Type:</strong> ${vars.element_type || 'N/A'}</li>
        <li><strong>Board:</strong> ${vars.board_name || 'N/A'}</li>
      </ul>
    `,
    textContent: `Element Visibility Changed\n\nAn element's visibility settings have been updated.\n\nElement Type: ${vars.element_type || 'N/A'}\nBoard: ${vars.board_name || 'N/A'}`,
  };
}

/**
 * User role changed template
 */
function userRoleChangedTemplate(vars: NotificationTemplateVariables): NotificationTemplate {
  return {
    subject: `Your Role Has Been Updated`,
    htmlContent: `
      <h2>Role Updated</h2>
      <p>Your role has been updated.</p>
      ${vars.reason ? `<p><strong>Reason:</strong> ${vars.reason}</p>` : ''}
    `,
    textContent: `Role Updated\n\nYour role has been updated.${vars.reason ? `\n\nReason: ${vars.reason}` : ''}`,
  };
}

/**
 * Default template
 */
function defaultTemplate(vars: NotificationTemplateVariables): NotificationTemplate {
  return {
    subject: 'Notification from Olumi',
    htmlContent: `
      <h2>Notification</h2>
      <p>You have a new notification from Olumi.</p>
    `,
    textContent: 'You have a new notification from Olumi.',
  };
}
