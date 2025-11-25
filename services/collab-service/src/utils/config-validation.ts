/**
 * Configuration Validation
 *
 * Validates critical configuration at startup to prevent security issues.
 *
 * Security Fix: Addresses audit finding #2 (Weak Default JWT Secret)
 */

import { pino } from 'pino';

const logger = pino({ name: 'config-validation' });

export class ConfigValidationError extends Error {
  constructor(message: string, public configKey: string) {
    super(message);
    this.name = 'ConfigValidationError';
  }
}

export class ConfigValidator {
  /**
   * Validate all critical configuration at startup
   *
   * IMPORTANT: This should be called before the server starts
   */
  static validateStartupConfig(): void {
    logger.info('Validating startup configuration...');

    const errors: string[] = [];

    // Validate JWT secret
    try {
      this.validateJWTSecret();
    } catch (err: any) {
      errors.push(`JWT: ${err.message}`);
    }

    // Validate database URL
    try {
      this.validateDatabaseURL();
    } catch (err: any) {
      errors.push(`Database: ${err.message}`);
    }

    // Validate other critical settings
    try {
      this.validateEnvironment();
    } catch (err: any) {
      errors.push(`Environment: ${err.message}`);
    }

    // Validate CORS configuration
    try {
      this.validateCORSOrigins();
    } catch (err: any) {
      errors.push(`CORS: ${err.message}`);
    }

    // Validate proxy configuration
    try {
      this.validateProxyConfiguration();
    } catch (err: any) {
      errors.push(`Proxy: ${err.message}`);
    }

    if (errors.length > 0) {
      logger.error({ errors }, 'Configuration validation failed');
      throw new ConfigValidationError(
        `Configuration validation failed:\n${errors.map((e) => `  - ${e}`).join('\n')}`,
        'startup'
      );
    }

    logger.info('Configuration validation passed');
  }

  /**
   * Validate JWT secret is properly configured
   *
   * CRITICAL: Prevents authentication bypass via default secret
   */
  private static validateJWTSecret(): void {
    const secret = process.env.JWT_SECRET;

    // CRITICAL: Must be set
    if (!secret) {
      throw new ConfigValidationError(
        'JWT_SECRET environment variable is required for production',
        'JWT_SECRET'
      );
    }

    // CRITICAL: Cannot be default value
    const insecureDefaults = [
      'change-me-in-production',
      'changeme',
      'secret',
      'password',
      'test',
      'development',
    ];

    if (insecureDefaults.includes(secret.toLowerCase())) {
      throw new ConfigValidationError(
        `JWT_SECRET is set to an insecure default value: "${secret}". Please use a cryptographically secure random value.`,
        'JWT_SECRET'
      );
    }

    // CRITICAL: Must be long enough
    if (secret.length < 32) {
      throw new ConfigValidationError(
        `JWT_SECRET must be at least 32 characters long (current: ${secret.length}). Use a cryptographically secure random string.`,
        'JWT_SECRET'
      );
    }

    // WARN: Should be longer for production
    if (secret.length < 64) {
      logger.warn(
        { length: secret.length },
        'JWT_SECRET is shorter than recommended 64 characters. Consider using a longer secret.'
      );
    }

    logger.info('JWT_SECRET validation passed');
  }

  /**
   * Validate database URL is configured
   */
  private static validateDatabaseURL(): void {
    const dbUrl = process.env.DATABASE_URL;

    if (!dbUrl) {
      throw new ConfigValidationError(
        'DATABASE_URL environment variable is required',
        'DATABASE_URL'
      );
    }

    // Basic PostgreSQL URL validation
    if (!dbUrl.startsWith('postgresql://') && !dbUrl.startsWith('postgres://')) {
      throw new ConfigValidationError(
        'DATABASE_URL must be a valid PostgreSQL connection string (postgresql://...)',
        'DATABASE_URL'
      );
    }

    // WARN: Check for localhost in production
    if (process.env.NODE_ENV === 'production' && dbUrl.includes('localhost')) {
      logger.warn('DATABASE_URL points to localhost in production environment');
    }

    logger.info('DATABASE_URL validation passed');
  }

  /**
   * Validate environment configuration
   */
  private static validateEnvironment(): void {
    const nodeEnv = process.env.NODE_ENV;

    if (!nodeEnv) {
      logger.warn('NODE_ENV is not set, defaulting to development');
    }

    const validEnvironments = ['development', 'test', 'staging', 'production'];
    if (nodeEnv && !validEnvironments.includes(nodeEnv)) {
      throw new ConfigValidationError(
        `NODE_ENV must be one of: ${validEnvironments.join(', ')} (current: ${nodeEnv})`,
        'NODE_ENV'
      );
    }

    // Production-specific checks
    if (nodeEnv === 'production') {
      this.validateProductionConfig();
    }

    logger.info('Environment validation passed');
  }

  /**
   * Additional validation for production environment
   */
  private static validateProductionConfig(): void {
    // Ensure logging level is appropriate
    const logLevel = process.env.LOG_LEVEL || 'info';
    if (logLevel === 'debug' || logLevel === 'trace') {
      logger.warn(
        { logLevel },
        'Verbose logging enabled in production - may impact performance and expose sensitive data'
      );
    }

    // Check if rate limiting is enabled
    if (process.env.DISABLE_RATE_LIMITING === 'true') {
      logger.error('Rate limiting is disabled in production - SECURITY RISK');
      throw new ConfigValidationError(
        'Rate limiting cannot be disabled in production',
        'DISABLE_RATE_LIMITING'
      );
    }

    // Warn about missing optional but recommended settings
    if (!process.env.SENTRY_DSN && !process.env.ERROR_TRACKING_DSN) {
      logger.warn('Error tracking (Sentry/etc) is not configured for production');
    }

    if (!process.env.METRICS_ENDPOINT) {
      logger.warn('Metrics endpoint is not configured for production monitoring');
    }

    logger.info('Production configuration validation passed');
  }

  /**
   * Validate CORS origins configuration
   */
  private static validateCORSOrigins(): void {
    const allowedOrigins = process.env.ALLOWED_ORIGINS;

    if (!allowedOrigins) {
      logger.warn('ALLOWED_ORIGINS is not set, will use default (localhost only)');
      return;
    }

    // CRITICAL: Prevent wildcard in production
    if (process.env.NODE_ENV === 'production' && allowedOrigins.includes('*')) {
      throw new ConfigValidationError(
        'ALLOWED_ORIGINS cannot contain wildcard (*) in production. Specify explicit origins.',
        'ALLOWED_ORIGINS'
      );
    }

    // Validate each origin
    const origins = allowedOrigins.split(',').map(o => o.trim());
    for (const origin of origins) {
      // Allow localhost/127.0.0.1 in non-production
      if (process.env.NODE_ENV !== 'production' &&
          (origin.includes('localhost') || origin.includes('127.0.0.1'))) {
        continue;
      }

      // Warn about localhost in production
      if (process.env.NODE_ENV === 'production' &&
          (origin.includes('localhost') || origin.includes('127.0.0.1'))) {
        logger.warn({ origin }, 'ALLOWED_ORIGINS contains localhost in production');
      }

      // Basic URL validation
      if (!origin.startsWith('http://') && !origin.startsWith('https://')) {
        throw new ConfigValidationError(
          `Invalid origin in ALLOWED_ORIGINS: "${origin}". Origins must start with http:// or https://`,
          'ALLOWED_ORIGINS'
        );
      }

      // Warn about http in production
      if (process.env.NODE_ENV === 'production' && origin.startsWith('http://')) {
        logger.warn({ origin }, 'ALLOWED_ORIGINS contains insecure http:// origin in production');
      }
    }

    logger.info({ originCount: origins.length }, 'CORS origins validation passed');
  }

  /**
   * Validate proxy trust configuration
   */
  private static validateProxyConfiguration(): void {
    const trustProxy = process.env.TRUST_PROXY === 'true';
    const trustedProxyIps = process.env.TRUSTED_PROXY_IPS;

    if (!trustProxy) {
      // If proxy trust is disabled, no further validation needed
      logger.info('Proxy trust is disabled (recommended if not behind a proxy)');
      return;
    }

    // WARN: Trusting proxy without IP allowlist
    if (!trustedProxyIps || trustedProxyIps.trim() === '') {
      logger.warn(
        'TRUST_PROXY is enabled but TRUSTED_PROXY_IPS is not set. ' +
        'This will trust ALL proxy headers, which may allow IP spoofing. ' +
        'Set TRUSTED_PROXY_IPS to a comma-separated list of trusted proxy IPs/CIDRs.'
      );
      return;
    }

    // Validate each proxy IP/CIDR
    const proxyIps = trustedProxyIps.split(',').map(ip => ip.trim());
    for (const ipOrCidr of proxyIps) {
      // Basic validation for IP address or CIDR notation
      const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/;
      const ipv6Regex = /^([0-9a-fA-F:]+)(\/\d{1,3})?$/;

      if (!ipv4Regex.test(ipOrCidr) && !ipv6Regex.test(ipOrCidr)) {
        throw new ConfigValidationError(
          `Invalid proxy IP or CIDR in TRUSTED_PROXY_IPS: "${ipOrCidr}". ` +
          'Expected IPv4 (e.g., 10.0.0.1) or CIDR (e.g., 10.0.0.0/8)',
          'TRUSTED_PROXY_IPS'
        );
      }
    }

    // PRODUCTION: Warn if trusting public IPs
    if (process.env.NODE_ENV === 'production') {
      for (const ipOrCidr of proxyIps) {
        // Check if IP starts with private ranges (rough check)
        const isPrivate =
          ipOrCidr.startsWith('10.') ||
          ipOrCidr.startsWith('172.16.') ||
          ipOrCidr.startsWith('172.17.') ||
          ipOrCidr.startsWith('172.18.') ||
          ipOrCidr.startsWith('172.19.') ||
          ipOrCidr.startsWith('172.20.') ||
          ipOrCidr.startsWith('172.21.') ||
          ipOrCidr.startsWith('172.22.') ||
          ipOrCidr.startsWith('172.23.') ||
          ipOrCidr.startsWith('172.24.') ||
          ipOrCidr.startsWith('172.25.') ||
          ipOrCidr.startsWith('172.26.') ||
          ipOrCidr.startsWith('172.27.') ||
          ipOrCidr.startsWith('172.28.') ||
          ipOrCidr.startsWith('172.29.') ||
          ipOrCidr.startsWith('172.30.') ||
          ipOrCidr.startsWith('172.31.') ||
          ipOrCidr.startsWith('192.168.') ||
          ipOrCidr.startsWith('127.') ||
          ipOrCidr === 'localhost';

        if (!isPrivate) {
          logger.warn(
            { ip: ipOrCidr },
            'TRUSTED_PROXY_IPS contains a public IP address in production. ' +
            'Ensure this is intentional and the proxy is properly secured.'
          );
        }
      }
    }

    logger.info({ proxyCount: proxyIps.length }, 'Proxy configuration validation passed');
  }

  /**
   * Validate runtime configuration (can be called at any time)
   */
  static validateRuntimeLimits(): void {
    const limits = {
      maxConnections: parseInt(process.env.MAX_CONNECTIONS || '100', 10),
      maxBoardSize: parseInt(process.env.MAX_BOARD_SIZE_MB || '10', 10),
      maxWhitelistSize: parseInt(process.env.MAX_WHITELIST_SIZE || '100', 10),
      maxPropagationElements: parseInt(process.env.MAX_PROPAGATION_ELEMENTS || '500', 10),
    };

    // Validate each limit
    for (const [key, value] of Object.entries(limits)) {
      if (isNaN(value) || value <= 0) {
        throw new ConfigValidationError(
          `Invalid runtime limit for ${key}: ${value}`,
          key
        );
      }

      if (value > 100000) {
        logger.warn({ key, value }, 'Runtime limit is very high - may cause resource issues');
      }
    }

    logger.info({ limits }, 'Runtime limits validated');
  }
}

/**
 * Call this function in your main server startup file
 *
 * Example:
 * ```typescript
 * import { ConfigValidator } from './utils/config-validation';
 *
 * // Before starting server
 * ConfigValidator.validateStartupConfig();
 *
 * // Start server
 * await app.listen(port);
 * ```
 */
export function validateConfigOrExit(): void {
  try {
    ConfigValidator.validateStartupConfig();
    ConfigValidator.validateRuntimeLimits();
  } catch (err: any) {
    console.error('FATAL: Configuration validation failed');
    console.error(err.message);
    process.exit(1);
  }
}
