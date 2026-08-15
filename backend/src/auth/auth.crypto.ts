import { createHmac, randomBytes, scrypt, timingSafeEqual, type BinaryLike } from 'crypto';
import { promisify } from 'util';

const HASH_PREFIX = 'scrypt';
const KEY_LENGTH = 64;
const scryptAsync = promisify<BinaryLike, BinaryLike, number, Buffer>(scrypt);

function base64url(input: Buffer | string) {
  return Buffer.from(input).toString('base64url');
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const hash = await scryptAsync(password, salt, KEY_LENGTH);
  return `${HASH_PREFIX}$${salt}$${hash.toString('hex')}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split('$');
  const [prefix, salt, hash] = parts;
  if (parts.length !== 3 || prefix !== HASH_PREFIX || !salt || !hash) return false;
  if (!new RegExp(`^[0-9a-f]{${KEY_LENGTH * 2}}$`, 'i').test(hash)) return false;

  const actual = await scryptAsync(password, salt, KEY_LENGTH);
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
