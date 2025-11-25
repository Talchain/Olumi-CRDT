# Security Headers Configuration

This document explains the security headers implemented via `@fastify/helmet`.

## Implemented Headers

### Content Security Policy (CSP)

Defines which resources the browser is allowed to load for our application.

```
Content-Security-Policy:
  default-src 'self';
  base-uri 'self';
  font-src 'self' https: data:;
  form-action 'self';
  frame-ancestors 'none';
  img-src 'self' data: https:;
  object-src 'none';
  script-src 'self';
  script-src-attr 'none';
  style-src 'self' https: 'unsafe-inline';
  connect-src 'self' [allowed-origins];
  upgrade-insecure-requests; (production only)
```

**Key protections:**
- **XSS Prevention**: Only scripts from our domain can execute
- **Clickjacking Prevention**: `frame-ancestors 'none'` prevents embedding in iframes
- **Data Exfiltration Prevention**: `connect-src` limits where data can be sent
- **HTTPS Enforcement**: `upgrade-insecure-requests` in production

### Strict-Transport-Security (HSTS)

Forces browsers to use HTTPS for 1 year (production only).

```
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
```

**Protection**: Prevents downgrade attacks and cookie hijacking

**Note**: Disabled in development to allow http://localhost

### X-Frame-Options

Prevents clickjacking by disallowing embedding in iframes.

```
X-Frame-Options: DENY
```

**Protection**: Redundant with CSP `frame-ancestors`, but provides defense-in-depth

### X-Content-Type-Options

Prevents MIME type sniffing.

```
X-Content-Type-Options: nosniff
```

**Protection**: Browsers must respect declared Content-Type headers

### X-DNS-Prefetch-Control

Disables DNS prefetching to prevent information leakage.

```
X-DNS-Prefetch-Control: off
```

**Protection**: Prevents browser from preemptively resolving DNS for links

### X-Download-Options (IE8+)

Prevents IE from executing downloads in the site's context.

```
X-Download-Options: noopen
```

**Protection**: IE-specific protection against certain attack vectors

### X-Permitted-Cross-Domain-Policies

Restricts Adobe Flash and PDF cross-domain requests.

```
X-Permitted-Cross-Domain-Policies: none
```

**Protection**: Prevents legacy Flash/PDF vulnerabilities

## Testing Security Headers

### Manual Testing

Use your browser's developer tools to inspect response headers:

```bash
# Start the service
npm run dev

# In another terminal, test headers
curl -I http://localhost:3001/health
```

Look for headers like:
- `content-security-policy`
- `x-frame-options`
- `x-content-type-options`
- `strict-transport-security` (production only)

### Automated Testing

Use [SecurityHeaders.com](https://securityheaders.com/) or similar tools to scan your deployed service.

Expected grade: **A** or better

## Troubleshooting

### CSP Violations

If legitimate resources are blocked:

1. Check browser console for CSP violation reports
2. Identify the blocked resource type (script, style, connect, etc.)
3. Update the corresponding CSP directive in `src/index.ts`
4. Test thoroughly before deploying

Example:
```typescript
// If you need to allow a specific external API
connectSrc: ["'self'", ...config.cors.allowedOrigins, 'https://api.example.com'],
```

### WebSocket Connections Blocked

WebSocket connections require proper `connect-src` CSP directive:

```typescript
connectSrc: ["'self'", ...config.cors.allowedOrigins],
```

Ensure `ALLOWED_ORIGINS` environment variable includes your WebSocket client origins.

### HSTS Issues in Development

HSTS is **disabled in development** to allow http://localhost connections.

If you see HSTS warnings in development:
- Clear your browser's HSTS cache
- Use incognito/private browsing mode
- Ensure `NODE_ENV=development` is set

## Security Best Practices

1. **Never disable CSP in production** - It's a critical XSS defense
2. **Keep `frame-ancestors 'none'`** - Prevents clickjacking
3. **Avoid `unsafe-inline` and `unsafe-eval`** - Weakens CSP protections
4. **Enable `upgrade-insecure-requests` in production** - Forces HTTPS
5. **Test CSP changes thoroughly** - Overly restrictive policies break functionality

## References

- [OWASP Secure Headers Project](https://owasp.org/www-project-secure-headers/)
- [MDN Content Security Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP)
- [Scott Helme's Security Headers Guide](https://scotthelme.co.uk/hardening-your-http-response-headers/)
