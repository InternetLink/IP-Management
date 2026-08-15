import {ApiPayloadError} from "./api-types";

export type JsonObject = Record<string, unknown>;

export function fail(path: string, message: string): never {
  throw new ApiPayloadError(path, message);
}

export function object(value: unknown, path: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return fail(path, "expected an object");
  return value as JsonObject;
}

export function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) return fail(path, "expected an array");
  return value;
}

export function string(value: unknown, path: string): string {
  if (typeof value !== "string") return fail(path, "expected a string");
  return value;
}

export function nullableString(value: unknown, path: string): string | null {
  if (value === null) return null;
  return string(value, path);
}

export function number(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fail(path, "expected a finite number");
  return value;
}

export function integer(value: unknown, path: string): number {
  const result = number(value, path);
  if (!Number.isSafeInteger(result)) return fail(path, "expected a safe integer");
  return result;
}

export function nullableInteger(value: unknown, path: string): number | null {
  if (value === null) return null;
  return integer(value, path);
}

export function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") return fail(path, "expected a boolean");
  return value;
}

export function enumValue<T extends string>(value: unknown, values: readonly T[], path: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) return fail(path, "unexpected value");
  return value as T;
}

export function nullableEnum<T extends string>(value: unknown, values: readonly T[], path: string): T | null {
  if (value === null) return null;
  return enumValue(value, values, path);
}
