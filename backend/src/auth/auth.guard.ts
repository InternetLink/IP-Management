import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService } from './auth.service';
import { IS_PUBLIC_KEY } from './public.decorator';
import { requestContext } from '../lib/request-context';
import { isRequestOriginAllowed } from '../http/origin-allowlist';
import type { RequestWithOptionalUser } from './auth.types';

type GuardRequest = RequestWithOptionalUser & {
  headers: {
    authorization?: unknown;
    origin?: string | string[];
  };
};

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private reflector: Reflector, private auth: AuthService) {}

  async canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<GuardRequest>();
    if (!isRequestOriginAllowed(request.headers.origin)) {
      throw new ForbiddenException('Origin is not allowed');
    }

    const header = request.headers.authorization;
    const [scheme, token] = typeof header === 'string' ? header.split(' ') : [];
    if (scheme !== 'Bearer' || !token) throw new UnauthorizedException('Authentication required');

    request.user = await this.auth.verifyToken(token);

    const store = requestContext.getStore();
    if (!store) {
      throw new Error('Request context middleware not initialized');
    }
    store.userId = request.user.id;
    store.username = request.user.username;

    return true;
  }
}
