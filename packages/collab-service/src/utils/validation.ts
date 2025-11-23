/**
 * Input Validation for Visibility API
 *
 * Validates all inputs to prevent injection attacks, resource exhaustion,
 * and data corruption.
 *
 * Security Fix: Addresses audit findings #7, #26
 */

import { ElementType, VisibilityMode } from '../types/visibility';
import { UserRole } from '../types/auth';

// Security limits
export const ValidationLimits = {
  MAX_WHITELIST_SIZE: 100,
  MAX_RATIONALE_LENGTH: 1000,
  MAX_ELEMENT_ID_LENGTH: 100,
  MAX_BOARD_ID_LENGTH: 100,
  MAX_USER_ID_LENGTH: 100,
  MAX_POLICY_NAME_LENGTH: 200,
  MAX_CASCADED_ELEMENTS: 500,
  MIN_DAYS_TO_KEEP: 1,
  MAX_DAYS_TO_KEEP: 365,
} as const;

// Valid patterns
const ELEMENT_ID_PATTERN = /^[a-z]+-[0-9a-zA-Z]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ValidationError extends Error {
  constructor(
    message: string,
    public field: string,
    public code: string
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class InputValidator {
  /**
   * Validate element ID format and length
   */
  static validateElementId(elementId: string, fieldName = 'element_id'): void {
    if (typeof elementId !== 'string') {
      throw new ValidationError('Element ID must be a string', fieldName, 'INVALID_TYPE');
    }

    if (elementId.length === 0) {
      throw new ValidationError('Element ID cannot be empty', fieldName, 'EMPTY');
    }

    if (elementId.length > ValidationLimits.MAX_ELEMENT_ID_LENGTH) {
      throw new ValidationError(
        `Element ID exceeds maximum length of ${ValidationLimits.MAX_ELEMENT_ID_LENGTH}`,
        fieldName,
        'TOO_LONG'
      );
    }

    if (!ELEMENT_ID_PATTERN.test(elementId)) {
      throw new ValidationError(
        'Element ID must match pattern: type-identifier (e.g., goal-123)',
        fieldName,
        'INVALID_FORMAT'
      );
    }
  }

  /**
   * Validate board/org/team/user ID (UUID format)
   */
  static validateUUID(id: string, fieldName: string): void {
    if (typeof id !== 'string') {
      throw new ValidationError(`${fieldName} must be a string`, fieldName, 'INVALID_TYPE');
    }

    if (id.length === 0) {
      throw new ValidationError(`${fieldName} cannot be empty`, fieldName, 'EMPTY');
    }

    if (!UUID_PATTERN.test(id)) {
      throw new ValidationError(
        `${fieldName} must be a valid UUID`,
        fieldName,
        'INVALID_FORMAT'
      );
    }
  }

  /**
   * Validate element type
   */
  static validateElementType(type: string, fieldName = 'element_type'): ElementType {
    const validTypes: ElementType[] = ['goal', 'option', 'outcome', 'assumption', 'evidence', 'edge'];

    if (!validTypes.includes(type as ElementType)) {
      throw new ValidationError(
        `Invalid element type. Must be one of: ${validTypes.join(', ')}`,
        fieldName,
        'INVALID_VALUE'
      );
    }

    return type as ElementType;
  }

  /**
   * Validate visibility mode
   */
  static validateVisibilityMode(mode: string, fieldName = 'visibility_mode'): VisibilityMode {
    const validModes: VisibilityMode[] = ['public', 'confidential'];

    if (!validModes.includes(mode as VisibilityMode)) {
      throw new ValidationError(
        `Invalid visibility mode. Must be one of: ${validModes.join(', ')}`,
        fieldName,
        'INVALID_VALUE'
      );
    }

    return mode as VisibilityMode;
  }

  /**
   * Validate user role
   */
  static validateUserRole(role: string, fieldName = 'role'): UserRole {
    const validRoles: UserRole[] = ['owner', 'editor', 'viewer'];

    if (!validRoles.includes(role as UserRole)) {
      throw new ValidationError(
        `Invalid user role. Must be one of: ${validRoles.join(', ')}`,
        fieldName,
        'INVALID_VALUE'
      );
    }

    return role as UserRole;
  }

  /**
   * Validate viewer whitelist
   */
  static validateViewerWhitelist(whitelist: any, fieldName = 'viewer_whitelist'): string[] {
    if (whitelist === null || whitelist === undefined) {
      return [];
    }

    if (!Array.isArray(whitelist)) {
      throw new ValidationError('Viewer whitelist must be an array', fieldName, 'INVALID_TYPE');
    }

    if (whitelist.length > ValidationLimits.MAX_WHITELIST_SIZE) {
      throw new ValidationError(
        `Viewer whitelist exceeds maximum size of ${ValidationLimits.MAX_WHITELIST_SIZE}`,
        fieldName,
        'TOO_LARGE'
      );
    }

    // Validate each user ID
    whitelist.forEach((userId, index) => {
      if (typeof userId !== 'string') {
        throw new ValidationError(
          `Whitelist entry at index ${index} must be a string`,
          `${fieldName}[${index}]`,
          'INVALID_TYPE'
        );
      }

      if (userId.length === 0 || userId.length > ValidationLimits.MAX_USER_ID_LENGTH) {
        throw new ValidationError(
          `Whitelist entry at index ${index} has invalid length`,
          `${fieldName}[${index}]`,
          'INVALID_LENGTH'
        );
      }
    });

    return whitelist;
  }

  /**
   * Validate viewer roles
   */
  static validateViewerRoles(roles: any, fieldName = 'viewer_roles'): string[] {
    if (roles === null || roles === undefined) {
      return [];
    }

    if (!Array.isArray(roles)) {
      throw new ValidationError('Viewer roles must be an array', fieldName, 'INVALID_TYPE');
    }

    if (roles.length > 10) {
      throw new ValidationError('Viewer roles array too large', fieldName, 'TOO_LARGE');
    }

    // Validate each role
    roles.forEach((role, index) => {
      this.validateUserRole(role, `${fieldName}[${index}]`);
    });

    return roles;
  }

  /**
   * Validate rationale text
   */
  static validateRationale(rationale: any, fieldName = 'rationale'): string | undefined {
    if (rationale === null || rationale === undefined) {
      return undefined;
    }

    if (typeof rationale !== 'string') {
      throw new ValidationError('Rationale must be a string', fieldName, 'INVALID_TYPE');
    }

    if (rationale.length > ValidationLimits.MAX_RATIONALE_LENGTH) {
      throw new ValidationError(
        `Rationale exceeds maximum length of ${ValidationLimits.MAX_RATIONALE_LENGTH}`,
        fieldName,
        'TOO_LONG'
      );
    }

    // Sanitize: Remove potential XSS/injection attempts
    const sanitized = rationale
      .replace(/<script[^>]*>.*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, '')
      .trim();

    return sanitized;
  }

  /**
   * Validate integer within range
   */
  static validateInteger(
    value: any,
    min: number,
    max: number,
    fieldName: string
  ): number {
    if (typeof value !== 'number') {
      const parsed = parseInt(value, 10);
      if (isNaN(parsed)) {
        throw new ValidationError(`${fieldName} must be a number`, fieldName, 'INVALID_TYPE');
      }
      value = parsed;
    }

    if (!Number.isInteger(value)) {
      throw new ValidationError(`${fieldName} must be an integer`, fieldName, 'NOT_INTEGER');
    }

    if (value < min || value > max) {
      throw new ValidationError(
        `${fieldName} must be between ${min} and ${max}`,
        fieldName,
        'OUT_OF_RANGE'
      );
    }

    return value;
  }

  /**
   * Validate pagination limit
   */
  static validateLimit(limit: any, defaultValue = 50, maxValue = 1000): number {
    if (limit === null || limit === undefined) {
      return defaultValue;
    }

    return this.validateInteger(limit, 1, maxValue, 'limit');
  }

  /**
   * Validate pagination offset
   */
  static validateOffset(offset: any): number {
    if (offset === null || offset === undefined) {
      return 0;
    }

    return this.validateInteger(offset, 0, Number.MAX_SAFE_INTEGER, 'offset');
  }

  /**
   * Validate boolean
   */
  static validateBoolean(value: any, fieldName: string): boolean {
    if (typeof value === 'boolean') {
      return value;
    }

    if (value === 'true') return true;
    if (value === 'false') return false;

    throw new ValidationError(`${fieldName} must be a boolean`, fieldName, 'INVALID_TYPE');
  }

  /**
   * Sanitize string input (prevent XSS)
   */
  static sanitizeString(value: string): string {
    if (typeof value !== 'string') {
      return '';
    }

    // Remove HTML tags and script content
    return value
      .replace(/<script[^>]*>.*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, '')
      .trim();
  }

  /**
   * Validate complete visibility update request
   */
  static validateVisibilityUpdate(data: any): {
    elementId: string;
    elementType: ElementType;
    visibilityMode: VisibilityMode;
    viewerWhitelist?: string[];
    viewerRoles?: string[];
    rationale?: string;
  } {
    return {
      elementId: this.validateElementId(data.element_id || data.elementId, 'element_id'),
      elementType: this.validateElementType(data.element_type || data.elementType, 'element_type'),
      visibilityMode: this.validateVisibilityMode(
        data.visibility_mode || data.visibilityMode,
        'visibility_mode'
      ),
      viewerWhitelist: this.validateViewerWhitelist(
        data.viewer_whitelist || data.viewerWhitelist,
        'viewer_whitelist'
      ),
      viewerRoles: this.validateViewerRoles(
        data.viewer_roles || data.viewerRoles,
        'viewer_roles'
      ),
      rationale: this.validateRationale(data.rationale, 'rationale'),
    };
  }
}
