import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BootstrapAdminDto, ChangePasswordDto, LoginDto } from './auth.dto';
import { hashPassword, signPayload, verifyPassword, verifySignedPayload } from './auth.crypto';

type TokenPayload = {
  exp: number;
  role: string;
  sub: string;
  username: string;
};

function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
}

function sanitizeUser(user: any) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
  };
}

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService) {}

  async status() {
    const userCount = await this.prisma.user.count();
    return { hasUsers: userCount > 0 };
  }

  async bootstrapAdmin(data: BootstrapAdminDto) {
    const existingUsers = await this.prisma.user.count();
    if (existingUsers > 0) throw new ConflictException('Admin user already exists');

    const username = normalizeUsername(data.username);
    if (!username) throw new BadRequestException('Username is required');

    const user = await this.prisma.user.create({
      data: {
        username,
        email: data.email?.trim() || null,
        passwordHash: hashPassword(data.password),
        role: 'admin',
      },
    });

    return this.createAuthResponse(user);
  }

  async login(data: LoginDto) {
    const username = normalizeUsername(data.username);
    const user = await this.prisma.user.findUnique({ where: { username } });
    if (!user || !user.isActive || !verifyPassword(data.password, user.passwordHash)) {
      throw new UnauthorizedException('Invalid username or password');
    }

    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return this.createAuthResponse(updated);
  }

  async verifyToken(token: string) {
    const payload = verifySignedPayload<TokenPayload>(token, this.secret());
    if (!payload || typeof payload.sub !== 'string' || typeof payload.exp !== 'number') {
      throw new UnauthorizedException('Invalid token');
    }

    if (payload.exp < Math.floor(Date.now() / 1000)) {
      throw new UnauthorizedException('Token expired');
    }

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.isActive) throw new UnauthorizedException('User is inactive');
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
    if (!verifyPassword(data.currentPassword, user.passwordHash)) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: hashPassword(data.newPassword) },
    });

    return { ok: true };
  }

  private createAuthResponse(user: any) {
    const expiresAt = Math.floor(Date.now() / 1000) + this.ttlSeconds();
    const token = signPayload({
      sub: user.id,
      username: user.username,
      role: user.role,
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
    return process.env.AUTH_SECRET || 'ipam-local-development-secret-change-me';
  }
}
