import { BadRequestException, ConflictException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Prisma, User } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { BootstrapAdminDto, ChangePasswordDto, LoginDto } from './auth.dto';
import { hashPassword, signPayload, timingSafeEqualStr, verifyPassword, verifySignedPayload } from './auth.crypto';
import { LoginThrottle } from './login-throttle';

type TokenPayload = {
  exp: number;
  role: string;
  sub: string;
  tokenVersion: number;
  username: string;
};

type AuthResponseUser = Pick<User, 'email' | 'id' | 'role' | 'tokenVersion' | 'username'>;

type BootstrapStateLockRow = {
  readonly id: string;
};

const BOOTSTRAP_STATE_ID = 'bootstrap' as const;
export const BOOTSTRAP_ALREADY_COMPLETED_CODE = 'BOOTSTRAP_ALREADY_COMPLETED' as const;

export class BootstrapStateMissingError extends Error {
  readonly name = 'BootstrapStateMissingError';

  constructor() {
    super(`Bootstrap state row ${BOOTSTRAP_STATE_ID} is missing`);
  }
}

export class BootstrapAlreadyCompletedException extends ConflictException {
  readonly name = 'BootstrapAlreadyCompletedException';

  constructor() {
    super({
      statusCode: 409,
      error: 'Conflict',
      message: 'Bootstrap already completed',
      code: BOOTSTRAP_ALREADY_COMPLETED_CODE,
    });
  }
}

function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
}

function sanitizeUser(user: Pick<User, 'email' | 'id' | 'role' | 'username'>) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
  };
}

@Injectable()
export class AuthService {
  private readonly loginThrottle = new LoginThrottle();

  constructor(private prisma: PrismaService, private audit: AuditService) {}

  async status() {
    const userCount = await this.prisma.user.count();
    return { hasUsers: userCount > 0 };
  }

  async bootstrapViaOperatorFlow(data: BootstrapAdminDto, token?: string) {
    if (process.env.BOOTSTRAP_DISABLED === 'true') {
      throw new ForbiddenException('Bootstrap disabled');
    }
    const expected = process.env.BOOTSTRAP_TOKEN;
    if (!expected || expected.length < 16) {
      throw new ForbiddenException('Bootstrap not configured');
    }
    if (!token || !timingSafeEqualStr(token, expected)) {
      throw new ForbiddenException();
    }

    const username = normalizeUsername(data.username);
    if (!username || username.length < 3 || username.length > 50 || !/^[a-zA-Z0-9_.-]+$/.test(username)) {
      throw new BadRequestException('Username must be 3-50 characters and contain only letters, numbers, ., _, or -');
    }
    if (data.password.length < 8) throw new BadRequestException('Password must be at least 8 characters');

    const passwordHash = await hashPassword(data.password);

    return this.prisma.$transaction(async (tx) => {
      await this.lockBootstrapState(tx);

      const state = await tx.bootstrapState.findUnique({ where: { id: BOOTSTRAP_STATE_ID } });
      const existingUsers = await tx.user.count();
      if (!state) throw new BootstrapStateMissingError();
      if (state.completedAt !== null) throw new BootstrapAlreadyCompletedException();
      if (existingUsers !== 0) throw new ConflictException('Admin user already exists');

      const user = await tx.user.create({
        data: {
          username,
          email: data.email?.trim() || null,
          passwordHash,
          role: 'admin',
        },
      });

      await tx.auditLog.create({
        data: this.audit.buildEntry('Created', 'User', user.id, user.username),
      });

      await tx.bootstrapState.update({
        where: { id: BOOTSTRAP_STATE_ID },
        data: {
          completedAt: new Date(),
          completedByUserId: user.id,
        },
      });

      return this.createAuthResponse(user);
    });
  }

  async bootstrapAdmin(data: BootstrapAdminDto, token?: string) {
    return this.bootstrapViaOperatorFlow(data, token);
  }

  async login(data: LoginDto, clientIp = 'unknown') {
    const username = normalizeUsername(data.username);
    this.loginThrottle.assertAllowed(clientIp, username);

    const user = await this.prisma.user.findUnique({ where: { username } });
    const validPassword = user?.isActive
      ? await verifyPassword(data.password, user.passwordHash)
      : false;
    if (!user || !user.isActive || !validPassword) {
      this.loginThrottle.recordFailure(clientIp, username);
      throw new UnauthorizedException('Invalid username or password');
    }

    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    this.loginThrottle.clearAccount(username);

    return this.createAuthResponse(updated);
  }

  async verifyToken(token: string) {
    const payload = verifySignedPayload<TokenPayload>(token, this.secret());
    if (
      !payload
      || typeof payload.sub !== 'string'
      || typeof payload.exp !== 'number'
      || !Number.isSafeInteger(payload.tokenVersion)
      || payload.tokenVersion < 0
    ) {
      throw new UnauthorizedException('Invalid token');
    }

    if (payload.exp < Math.floor(Date.now() / 1000)) {
      throw new UnauthorizedException('Token expired');
    }

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.isActive) throw new UnauthorizedException('User is inactive');
    if (user.tokenVersion !== payload.tokenVersion) throw new UnauthorizedException('Invalid token');
    return sanitizeUser(user);
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) throw new UnauthorizedException('User is inactive');
    return sanitizeUser(user);
  }

  async changePassword(userId: string, data: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) throw new UnauthorizedException('User is inactive');
    if (!await verifyPassword(data.currentPassword, user.passwordHash)) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    const passwordHash = await hashPassword(data.newPassword);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          passwordHash,
          tokenVersion: { increment: 1 },
        },
      });
      await tx.auditLog.create({
        data: this.audit.buildEntry('Updated', 'User', user.id, user.username),
      });
    });

    return { ok: true };
  }

  async logout(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { tokenVersion: { increment: 1 } },
    });
    return { ok: true };
  }

  private async lockBootstrapState(tx: Prisma.TransactionClient): Promise<void> {
    const rows = await tx.$queryRaw<BootstrapStateLockRow[]>`
      SELECT \`id\`
      FROM \`bootstrap_states\`
      WHERE \`id\` = ${BOOTSTRAP_STATE_ID}
      FOR UPDATE
    `;

    if (rows.length !== 1 || rows[0]?.id !== BOOTSTRAP_STATE_ID) {
      throw new BootstrapStateMissingError();
    }
  }

  private createAuthResponse(user: AuthResponseUser) {
    const expiresAt = Math.floor(Date.now() / 1000) + this.ttlSeconds();
    const token = signPayload({
      sub: user.id,
      username: user.username,
      role: user.role,
      tokenVersion: user.tokenVersion,
      exp: expiresAt,
    }, this.secret());

    return {
      token,
      expiresAt,
      user: sanitizeUser(user),
    };
  }

  private ttlSeconds() {
    const days = Number(process.env.AUTH_TOKEN_TTL_DAYS);
    if (Number.isFinite(days) && days > 0) return days * 24 * 60 * 60;

    const hours = Number(process.env.AUTH_TOKEN_TTL_HOURS ?? 720);
    return Math.max(1, Number.isFinite(hours) ? hours : 720) * 60 * 60;
  }

  private secret() {
    const s = process.env.AUTH_SECRET;
    if (!s || s.length < 32) {
      throw new Error('AUTH_SECRET must be set to a string of at least 32 characters');
    }
    return s;
  }
}
