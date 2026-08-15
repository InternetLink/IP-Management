import 'reflect-metadata';

import {
  Controller,
  Get,
  Logger,
  MiddlewareConsumer,
  Module,
  type INestApplication,
  type NestModule,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { getRequestCtx } from '../../src/lib/request-context';
import { RequestContextMiddleware } from '../../src/lib/request-context.middleware';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseLogEvent(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

@Controller('request-context-probe')
class RequestContextProbeController {
  @Get()
  readContext() {
    return getRequestCtx();
  }
}

@Module({ controllers: [RequestContextProbeController] })
class RequestContextProbeModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}

describe('RequestContextMiddleware', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [RequestContextProbeModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uses one generated request ID in the response, context, and structured completion log', async () => {
    // Given
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    // When
    const response = await request(app.getHttpServer()).get('/request-context-probe').expect(200);

    // Then
    const requestId: unknown = response.headers['x-request-id'];
    expect(typeof requestId).toBe('string');
    if (typeof requestId !== 'string') throw new Error('X-Request-Id response header is missing');
    expect(requestId).toMatch(UUID_PATTERN);

    const body: unknown = response.body;
    expect(isRecord(body)).toBe(true);
    if (!isRecord(body)) throw new Error('Probe response is not an object');
    expect(body.requestId).toBe(requestId);

    const completedEvent = logSpy.mock.calls
      .map(([message]) => parseLogEvent(message))
      .find((event) => event?.event === 'http.request.completed');
    expect(completedEvent).toMatchObject({
      event: 'http.request.completed',
      method: 'GET',
      path: '/request-context-probe',
      requestId,
      statusCode: 200,
    });
    expect(completedEvent?.durationMs).toEqual(expect.any(Number));
  });
});
