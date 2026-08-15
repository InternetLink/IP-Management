import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { Injectable, Logger, NestMiddleware } from '@nestjs/common';

import { requestContext } from './request-context';
import { formatLogEvent } from './structured-log';

const REQUEST_ID_HEADER = 'x-request-id';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getRequestId(request: IncomingMessage): string {
  const header = request.headers[REQUEST_ID_HEADER];
  if (typeof header === 'string' && UUID_PATTERN.test(header)) return header.toLowerCase();
  return randomUUID();
}

function getRequestPath(url: string | undefined): string {
  if (!url) return '/';
  const queryIndex = url.indexOf('?');
  return queryIndex === -1 ? url : url.slice(0, queryIndex);
}

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  private readonly logger = new Logger(RequestContextMiddleware.name);

  use(request: IncomingMessage, response: ServerResponse, next: () => void): void {
    const requestId = getRequestId(request);
    const startedAt = Date.now();
    response.setHeader('X-Request-Id', requestId);

    requestContext.run({ requestId, userId: null, username: null }, () => {
      response.once('finish', () => {
        this.logger.log(formatLogEvent('http.request.completed', {
          durationMs: Date.now() - startedAt,
          method: request.method ?? 'UNKNOWN',
          path: getRequestPath(request.url),
          statusCode: response.statusCode,
        }, requestId));
      });
      next();
    });
  }
}
