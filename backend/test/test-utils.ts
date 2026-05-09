import assert from 'node:assert/strict';

export type TestCase = {
  name: string;
  run: () => void | Promise<void>;
};

export function test(name: string, run: TestCase['run']): TestCase {
  return { name, run };
}

export async function assertRejectsWith(
  run: () => Promise<unknown>,
  pattern: RegExp,
): Promise<void> {
  let thrown: unknown;
  try {
    await run();
  } catch (error) {
    thrown = error;
  }

  assert.ok(thrown, 'Expected function to throw');
  const message = thrown instanceof Error ? thrown.message : String(thrown);
  assert.match(message, pattern);
}

