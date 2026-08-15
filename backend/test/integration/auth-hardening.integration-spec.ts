import 'reflect-metadata';

import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';

const AUTH_SECRET = 'auth-hardening-integration-secret-0123456789';
const BOOTSTRAP_TOKEN = 'auth-hardening-bootstrap-token';

async function createApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: false },
    whitelist: true,
  }));
  await app.init();
  return app;
}

describe('authentication hardening', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(() => {
    process.env.AUTH_SECRET = AUTH_SECRET;
    process.env.BOOTSTRAP_TOKEN = BOOTSTRAP_TOKEN;
    process.env.BOOTSTRAP_DISABLED = 'false';
    process.env.CORS_ORIGINS = 'http://localhost:3003,https://ipam.example.com';
  });

  beforeEach(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    await prisma.auditLog.deleteMany();
    await prisma.user.deleteMany();
    await prisma.bootstrapState.update({
      where: { id: 'bootstrap' },
      data: { completedAt: null, completedByUserId: null },
    });
  });

  afterEach(async () => {
    await app.close();
  });

  function bootstrap(username = 'admin') {
    return bootstrapRequest(username).expect(201);
  }

  function bootstrapRequest(username: string) {
    return request(app.getHttpServer())
      .post('/api/auth/bootstrap')
      .set('x-bootstrap-token', BOOTSTRAP_TOKEN)
      .send({ username, password: 'strong-password', email: `${username}@example.com` });
  }

  function login(username: string, password: string) {
    return request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username, password });
  }

  it('completes bootstrap, login, me, password change, and token revocation end to end', async () => {
    await expect(prisma.bootstrapState.findUniqueOrThrow({ where: { id: 'bootstrap' } }))
      .resolves.toMatchObject({ completedAt: null, completedByUserId: null });

    await bootstrap('FlowAdmin');
    const initialLogin = await login('FLOWADMIN', 'strong-password').expect(201);
    const oldToken = initialLogin.body.token as string;

    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${oldToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({ username: 'flowadmin', email: 'FlowAdmin@example.com' });
      });

    await request(app.getHttpServer())
      .post('/api/auth/password')
      .set('Authorization', `Bearer ${oldToken}`)
      .send({ currentPassword: 'strong-password', newPassword: 'new-strong-password' })
      .expect(201)
      .expect({ ok: true });

    const newLogin = await login('flowadmin', 'new-strong-password').expect(201);
    const newToken = newLogin.body.token as string;

    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${oldToken}`)
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${newToken}`)
      .expect(200);
    await login('flowadmin', 'strong-password').expect(401);

    await expect(prisma.user.findUniqueOrThrow({ where: { username: 'flowadmin' } }))
      .resolves.toMatchObject({ tokenVersion: 1 });
    await expect(prisma.bootstrapState.findUniqueOrThrow({ where: { id: 'bootstrap' } }))
      .resolves.toMatchObject({
        completedAt: expect.any(Date),
        completedByUserId: initialLogin.body.user.id,
      });
  });

  it('serializes concurrent bootstrap attempts through the singleton row lock', async () => {
    const responses = await Promise.all([
      bootstrapRequest('ConcurrentOne'),
      bootstrapRequest('ConcurrentTwo'),
    ]);

    expect(responses.map(({ status }) => status).sort()).toEqual([201, 409]);
    const users = await prisma.user.findMany({ orderBy: { username: 'asc' } });
    expect(users).toHaveLength(1);
    expect(await prisma.auditLog.count({ where: { action: 'Created', resourceType: 'User' } })).toBe(1);

    await expect(prisma.bootstrapState.findUniqueOrThrow({ where: { id: 'bootstrap' } }))
      .resolves.toMatchObject({
        completedAt: expect.any(Date),
        completedByUserId: users[0].id,
      });

    const conflict = responses.find(({ status }) => status === 409);
    expect(conflict?.body).toMatchObject({
      code: 'BOOTSTRAP_ALREADY_COMPLETED',
      statusCode: 409,
    });
  });

  it('rejects a missing or wrong token without creating a user', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/bootstrap')
      .send({ username: 'MissingToken', password: 'strong-password' })
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/auth/bootstrap')
      .set('x-bootstrap-token', 'wrong-token')
      .send({ username: 'WrongToken', password: 'strong-password' })
      .expect(403);

    await expect(prisma.user.count()).resolves.toBe(0);
    await expect(prisma.bootstrapState.findUniqueOrThrow({ where: { id: 'bootstrap' } }))
      .resolves.toMatchObject({ completedAt: null, completedByUserId: null });
  });

  it('revokes the calling token through the logout endpoint', async () => {
    await bootstrap('LogoutAdmin');
    const loginResponse = await login('logoutadmin', 'strong-password').expect(201);
    const token = loginResponse.body.token as string;

    await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${token}`)
      .expect(201)
      .expect({ ok: true });

    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
    await login('logoutadmin', 'strong-password').expect(201);
    await expect(prisma.user.findUniqueOrThrow({ where: { username: 'logoutadmin' } }))
      .resolves.toMatchObject({ tokenVersion: 1 });
  });

  it('enforces the configured Origin allowlist on protected Bearer requests', async () => {
    await bootstrap('OriginAdmin');
    const loginResponse = await login('originadmin', 'strong-password').expect(201);
    const token = loginResponse.body.token as string;

    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .set('Origin', 'https://ipam.example.com')
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .set('Origin', 'https://evil.example')
      .expect(403);
  });

  it('never authenticates a disabled user before or after throttling activates', async () => {
    await bootstrap('DisabledAdmin');
    await prisma.user.update({
      where: { username: 'disabledadmin' },
      data: { isActive: false },
    });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await login('disabledadmin', 'strong-password')
        .expect(401)
        .expect(({ body }) => {
          expect(body.message).toBe('Invalid username or password');
        });
    }

    await login('disabledadmin', 'strong-password')
      .expect(429)
      .expect(({ body }) => {
        expect(body.message).toBe('Too many login attempts. Please try again later.');
      });
  });

  it('returns Retry-After when the login failure threshold is exceeded', async () => {
    await bootstrap('ThrottleAdmin');

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await login('THROTTLEADMIN', 'wrong-password')
        .expect(401)
        .expect(({ body }) => {
          expect(body.message).toBe('Invalid username or password');
        });
    }

    const throttled = await login('throttleadmin', 'wrong-password')
      .expect(429)
      .expect(({ body }) => {
        expect(body.message).toBe('Too many login attempts. Please try again later.');
      });

    const retryAfter = Number(throttled.headers['retry-after']);
    expect(Number.isInteger(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);
  });
});
