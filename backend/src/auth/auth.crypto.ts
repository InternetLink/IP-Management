import { randomBytes, scryptSync, timingSafeEqual, createHmac } from 'crypto';

const HASH_PREFIX = 'scrypt';
const KEY_LENGTH = 64;

function base64url(input: Buffer | string) {
  return Buffer.from(input).toString('base64url');
}

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, KEY_LENGTH).toString('hex');
  return `${HASH_PREFIX}$${salt}$${hash}`;
}

export function verifyPassword(password: string, storedHash: string) {
  const [prefix, salt, hash] = storedHash.split('$');
  if (prefix !== HASH_PREFIX || !salt || !hash) return false;

  const actual = Buffer.from(scryptSync(password, salt, KEY_LENGTH).toString('hex'), 'hex');
  const expected = Buffer.from(hash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function signPayload(payload: Record<string, unknown>, secret: string) {
  const encodedPayload = base64url(JSON.stringify(payload));
  const signature = createHmac('sha256', secret).update(encodedPayload).digest('base64url');
  return `${encodedPayload}.${signature}`;
}

export function verifySignedPayload<T extends Record<string, unknown>>(token: string, secret: string): T | null {
  const [encodedPayload, signature] = token.split('.');
  if (!encodedPayload || !signature) return null;

  const expected = createHmac('sha256', secret).update(encodedPayload).digest('base64url');
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return null;

  try {
    return JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}
