const DEFAULT_CORS_ORIGIN = 'http://localhost:3003';

function isCanonicalHttpOrigin(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.origin === value;
  } catch {
    return false;
  }
}

export function parseOriginAllowlist(
  value = process.env.CORS_ORIGINS ?? DEFAULT_CORS_ORIGIN,
): readonly string[] {
  const origins = value.split(',').map(origin => origin.trim()).filter(Boolean);
  if (origins.length === 0) {
    throw new Error('CORS_ORIGINS must contain at least one origin');
  }
  if (origins.some(origin => !isCanonicalHttpOrigin(origin))) {
    throw new Error('CORS_ORIGINS must contain comma-separated exact origins');
  }
  return [...new Set(origins)];
}

export function isRequestOriginAllowed(
  origin: string | string[] | undefined,
  allowedOrigins = parseOriginAllowlist(),
): boolean {
  if (origin === undefined) return true;
  return typeof origin === 'string'
    && isCanonicalHttpOrigin(origin)
    && allowedOrigins.includes(origin);
}
