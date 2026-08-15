import { Body, Controller, Get, Headers, Ip, Post, Req, Res } from '@nestjs/common';
import { AuthService } from './auth.service';
import { BootstrapAdminDto, ChangePasswordDto, LoginDto } from './auth.dto';
import { LoginThrottledException } from './login-throttle';
import { Public } from './public.decorator';
import type { AuthenticatedRequest } from './auth.types';

type HeaderResponse = {
  setHeader(name: string, value: string): void;
};

@Controller('auth')
export class AuthController {
  constructor(private service: AuthService) {}

  @Public()
  @Get('status')
  status() {
    return this.service.status();
  }

  @Public()
  @Post('bootstrap')
  bootstrap(@Body() dto: BootstrapAdminDto, @Headers('x-bootstrap-token') token?: string) {
    return this.service.bootstrapViaOperatorFlow(dto, token);
  }

  @Public()
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Ip() clientIp: string,
    @Res({ passthrough: true }) response: HeaderResponse,
  ) {
    try {
      return await this.service.login(dto, clientIp);
    } catch (error) {
      if (error instanceof LoginThrottledException) {
        response.setHeader('Retry-After', String(error.retryAfterSeconds));
      }
      throw error;
    }
  }

  @Get('me')
  me(@Req() request: AuthenticatedRequest) {
    return this.service.me(request.user.id);
  }

  @Post('password')
  changePassword(@Req() request: AuthenticatedRequest, @Body() dto: ChangePasswordDto) {
    return this.service.changePassword(request.user.id, dto);
  }

  @Post('logout')
  logout(@Req() request: AuthenticatedRequest) {
    return this.service.logout(request.user.id);
  }
}
