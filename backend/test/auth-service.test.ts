import assert from 'node:assert/strict';
import { AuthService } from '../src/auth/auth.service';
import { hashPassword, verifyPassword } from '../src/auth/auth.crypto';
import { LoginThrottledException } from '../src/auth/login-throttle';
import { assertRejectsWith, test, type TestCase } from './test-utils';

type UserRecord = Record<string, any>;

function createHarness() {
  const users: UserRecord[] = [];
  const bootstrapState: UserRecord = {
    id: 'bootstrap',
    completedAt: null,
    completedByUserId: null,
  };
  let sequence = 0;

  const prisma: any = {
    $transaction: async (fn: any) => fn(prisma),
    $queryRaw: async () => [{ id: 'bootstrap' }],
    bootstrapState: {
      findUnique: async () => bootstrapState,
      update: async ({ data }: any) => {
        Object.assign(bootstrapState, data);
        return bootstrapState;
      },
    },
    auditLog: {
      create: async () => ({}),
    },
    user: {
      count: async () => users.length,
      create: async ({ data }: any) => {
        const now = new Date();
        const user = {
          id: `user-${++sequence}`,
          email: null,
          role: 'admin',
          isActive: true,
          tokenVersion: 0,
          lastLoginAt: null,
          createdAt: now,
          updatedAt: now,
          ...data,
        };
        users.push(user);
        return user;
      },
      findUnique: async ({ where }: any) =>
        users.find(user => (where.id && user.id === where.id) || (where.username && user.username === where.username)) ?? null,
      update: async ({ where, data }: any) => {
        const user = users.find(item => item.id === where.id);
        if (!user) throw new Error('User not found');
        for (const [key, value] of Object.entries(data)) {
          if (value && typeof value === 'object' && 'increment' in value) {
            user[key] = (user[key] ?? 0) + Number(value.increment);
          } else {
            user[key] = value;
          }
        }
        user.updatedAt = new Date();
        return user;
      },
    },
  };

  return {
    service: new AuthService(prisma, {
      buildEntry: (action: string, resourceType: string, resourceId: string, resourceLabel: string) => ({
        action,
        resourceType,
        resourceId,
        resourceLabel,
        user: 'system',
        userId: null,
      }),
    } as any),
    bootstrapState,
    users,
  };
}

async function rejectionMessage(run: () => Promise<unknown>): Promise<string> {
  let thrown: unknown;
  try {
    await run();
  } catch (error) {
    thrown = error;
  }

  assert.ok(thrown, 'Expected function to reject');
  return thrown instanceof Error ? thrown.message : String(thrown);
}

async function rejectionError(run: () => Promise<unknown>): Promise<unknown> {
  let thrown: unknown;
  try {
    await run();
  } catch (error) {
    thrown = error;
  }

  assert.ok(thrown, 'Expected function to reject');
  return thrown;
}

export const authServiceTests: TestCase[] = [
  test('hashes passwords with a salt and verifies them', async () => {
    const [first, second] = await Promise.all([
      hashPassword('correct horse battery staple'),
      hashPassword('correct horse battery staple'),
    ]);

    assert.notEqual(first, second);
    assert.equal(await verifyPassword('correct horse battery staple', first), true);
    assert.equal(await verifyPassword('wrong password', first), false);
    assert.equal(await verifyPassword('correct horse battery staple', 'scrypt$bad$hash'), false);
  }),

  test('bootstraps the first admin and rejects a second bootstrap', async () => {
    process.env.AUTH_SECRET = 'test-secret-test-secret-test-secret';
    process.env.BOOTSTRAP_TOKEN = 'bootstrap-token-1234567890';
    const { service, bootstrapState } = createHarness();

    const result = await service.bootstrapAdmin({
      username: 'Admin',
      password: 'strong-password',
      email: 'admin@example.com',
    }, process.env.BOOTSTRAP_TOKEN);

    assert.equal(result.user.username, 'admin');
    assert.ok(result.token);
    assert.ok(bootstrapState.completedAt instanceof Date);
    assert.equal(bootstrapState.completedByUserId, result.user.id);

    const currentUser = await service.verifyToken(result.token);
    assert.equal(currentUser.username, 'admin');

    await assertRejectsWith(
      async () => service.bootstrapAdmin({ username: 'other', password: 'strong-password' }, process.env.BOOTSTRAP_TOKEN),
      /Bootstrap already completed/,
    );
  }),

  test('logs in active users and rejects invalid credentials', async () => {
    process.env.AUTH_SECRET = 'test-secret-test-secret-test-secret';
    process.env.BOOTSTRAP_TOKEN = 'bootstrap-token-1234567890';
    const { service, users } = createHarness();

    await service.bootstrapAdmin({ username: 'admin', password: 'strong-password' }, process.env.BOOTSTRAP_TOKEN);
    const result = await service.login({ username: 'admin', password: 'strong-password' });

    assert.equal(result.user.username, 'admin');
    assert.ok(users[0].lastLoginAt instanceof Date);

    await assertRejectsWith(
      async () => service.login({ username: 'admin', password: 'wrong-password' }),
      /Invalid username or password/,
    );
  }),

  test('keeps login errors credential-neutral', async () => {
    process.env.AUTH_SECRET = 'test-secret-test-secret-test-secret';
    process.env.BOOTSTRAP_TOKEN = 'bootstrap-token-1234567890';
    const { service } = createHarness();

    await service.bootstrapAdmin({ username: 'admin', password: 'strong-password' }, process.env.BOOTSTRAP_TOKEN);

    const wrongPassword = await rejectionMessage(
      () => service.login({ username: 'admin', password: 'wrong-password' }),
    );
    const unknownAccount = await rejectionMessage(
      () => service.login({ username: 'missing', password: 'wrong-password' }),
    );

    assert.equal(wrongPassword, 'Invalid username or password');
    assert.equal(unknownAccount, wrongPassword);
  }),

  test('keeps the event loop responsive during concurrent failed logins', async () => {
    process.env.AUTH_SECRET = 'test-secret-test-secret-test-secret';
    process.env.BOOTSTRAP_TOKEN = 'bootstrap-token-1234567890';
    const { service } = createHarness();

    await service.bootstrapAdmin({ username: 'admin', password: 'strong-password' }, process.env.BOOTSTRAP_TOKEN);

    let attemptsCompleted = false;
    const attempts = Promise.all(Array.from({ length: 8 }, () =>
      Promise.resolve()
        .then(() => service.login({ username: 'admin', password: 'wrong-password' }))
        .catch(() => undefined),
    )).then(() => {
      attemptsCompleted = true;
    });

    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(attemptsCompleted, false, 'Failed logins completed before the event loop could run setImmediate');
    await attempts;
  }),

  test('changes password after verifying the current password', async () => {
    process.env.AUTH_SECRET = 'test-secret-test-secret-test-secret';
    process.env.BOOTSTRAP_TOKEN = 'bootstrap-token-1234567890';
    const { service } = createHarness();

    const bootstrap = await service.bootstrapAdmin({ username: 'admin', password: 'strong-password' }, process.env.BOOTSTRAP_TOKEN);
    await service.changePassword(bootstrap.user.id, {
      currentPassword: 'strong-password',
      newPassword: 'new-strong-password',
    });

    await assertRejectsWith(
      async () => service.verifyToken(bootstrap.token),
      /Invalid token/,
    );

    await assertRejectsWith(
      async () => service.login({ username: 'admin', password: 'strong-password' }),
      /Invalid username or password/,
    );

    const result = await service.login({ username: 'admin', password: 'new-strong-password' });
    assert.equal(result.user.username, 'admin');
    await assert.doesNotReject(() => service.verifyToken(result.token));
  }),

  test('revokes an issued token on logout', async () => {
    process.env.AUTH_SECRET = 'test-secret-test-secret-test-secret';
    process.env.BOOTSTRAP_TOKEN = 'bootstrap-token-1234567890';
    const { service, users } = createHarness();

    const bootstrap = await service.bootstrapAdmin(
      { username: 'admin', password: 'strong-password' },
      process.env.BOOTSTRAP_TOKEN,
    );
    await service.logout(bootstrap.user.id);

    assert.equal(users[0].tokenVersion, 1);
    await assertRejectsWith(
      async () => service.verifyToken(bootstrap.token),
      /Invalid token/,
    );
  }),

  test('throttles the sixth account failure and returns a generic 429', async () => {
    process.env.AUTH_SECRET = 'test-secret-test-secret-test-secret';
    process.env.BOOTSTRAP_TOKEN = 'bootstrap-token-1234567890';
    const { service } = createHarness();
    await service.bootstrapAdmin({ username: 'admin', password: 'strong-password' }, process.env.BOOTSTRAP_TOKEN);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await assertRejectsWith(
        () => service.login({ username: 'ADMIN', password: 'wrong-password' }, `ip-${attempt}`),
        /Invalid username or password/,
      );
    }

    const error = await rejectionError(
      () => service.login({ username: 'admin', password: 'wrong-password' }, 'fresh-ip'),
    );
    assert.ok(error instanceof LoginThrottledException);
    assert.equal(error.getStatus(), 429);
    assert.equal(error.message, 'Too many login attempts. Please try again later.');
  }),

  test('clears normalized-account failures after a successful login', async () => {
    process.env.AUTH_SECRET = 'test-secret-test-secret-test-secret';
    process.env.BOOTSTRAP_TOKEN = 'bootstrap-token-1234567890';
    const { service } = createHarness();
    await service.bootstrapAdmin({ username: 'admin', password: 'strong-password' }, process.env.BOOTSTRAP_TOKEN);

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await rejectionError(
        () => service.login({ username: 'Admin', password: 'wrong-password' }, `before-${attempt}`),
      );
    }
    await service.login({ username: 'ADMIN', password: 'strong-password' }, 'successful-ip');

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await assertRejectsWith(
        () => service.login({ username: 'admin', password: 'wrong-password' }, `after-${attempt}`),
        /Invalid username or password/,
      );
    }
  }),

  test('rejects a disabled user with valid credentials', async () => {
    process.env.AUTH_SECRET = 'test-secret-test-secret-test-secret';
    process.env.BOOTSTRAP_TOKEN = 'bootstrap-token-1234567890';
    const { service, users } = createHarness();
    await service.bootstrapAdmin({ username: 'admin', password: 'strong-password' }, process.env.BOOTSTRAP_TOKEN);
    users[0].isActive = false;

    await assertRejectsWith(
      () => service.login({ username: 'admin', password: 'strong-password' }, 'disabled-ip'),
      /Invalid username or password/,
    );
  }),
];
