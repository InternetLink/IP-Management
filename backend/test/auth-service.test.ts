import assert from 'node:assert/strict';
import { AuthService } from '../src/auth/auth.service';
import { hashPassword, verifyPassword } from '../src/auth/auth.crypto';
import { assertRejectsWith, test, type TestCase } from './test-utils';

type UserRecord = Record<string, any>;

function createHarness() {
  const users: UserRecord[] = [];
  let sequence = 0;

  const prisma = {
    user: {
      count: async () => users.length,
      create: async ({ data }: any) => {
        const now = new Date();
        const user = {
          id: `user-${++sequence}`,
          email: null,
          role: 'admin',
          isActive: true,
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
        Object.assign(user, data, { updatedAt: new Date() });
        return user;
      },
    },
  };

  return {
    service: new AuthService(prisma as any),
    users,
  };
}

export const authServiceTests: TestCase[] = [
  test('hashes passwords with a salt and verifies them', () => {
    const first = hashPassword('correct horse battery staple');
    const second = hashPassword('correct horse battery staple');

    assert.notEqual(first, second);
    assert.equal(verifyPassword('correct horse battery staple', first), true);
    assert.equal(verifyPassword('wrong password', first), false);
  }),

  test('bootstraps the first admin and rejects a second bootstrap', async () => {
    process.env.AUTH_SECRET = 'test-secret';
    const { service } = createHarness();

    const result = await service.bootstrapAdmin({
      username: 'Admin',
      password: 'strong-password',
      email: 'admin@example.com',
    });

    assert.equal(result.user.username, 'admin');
    assert.ok(result.token);

    const currentUser = await service.verifyToken(result.token);
    assert.equal(currentUser.username, 'admin');

    await assertRejectsWith(
      async () => service.bootstrapAdmin({ username: 'other', password: 'strong-password' }),
      /already exists/,
    );
  }),

  test('logs in active users and rejects invalid credentials', async () => {
    process.env.AUTH_SECRET = 'test-secret';
    const { service, users } = createHarness();

    await service.bootstrapAdmin({ username: 'admin', password: 'strong-password' });
    const result = await service.login({ username: 'admin', password: 'strong-password' });

    assert.equal(result.user.username, 'admin');
    assert.ok(users[0].lastLoginAt instanceof Date);

    await assertRejectsWith(
      async () => service.login({ username: 'admin', password: 'wrong-password' }),
      /Invalid username or password/,
    );
  }),

  test('changes password after verifying the current password', async () => {
    process.env.AUTH_SECRET = 'test-secret';
    const { service } = createHarness();

    const bootstrap = await service.bootstrapAdmin({ username: 'admin', password: 'strong-password' });
    await service.changePassword(bootstrap.user.id, {
      currentPassword: 'strong-password',
      newPassword: 'new-strong-password',
    });

    await assertRejectsWith(
      async () => service.login({ username: 'admin', password: 'strong-password' }),
      /Invalid username or password/,
    );

    const result = await service.login({ username: 'admin', password: 'new-strong-password' });
    assert.equal(result.user.username, 'admin');
  }),
];
