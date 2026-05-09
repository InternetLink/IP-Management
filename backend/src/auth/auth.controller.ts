import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { AuthService } from './auth.service';
import { BootstrapAdminDto, ChangePasswordDto, LoginDto } from './auth.dto';
import { Public } from './public.decorator';

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
  bootstrap(@Body() dto: BootstrapAdminDto) {
    return this.service.bootstrapAdmin(dto);
  }

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.service.login(dto);
  }

  @Get('me')
  me(@Req() request: any) {
    return this.service.me(request.user.id);
  }

  @Post('password')
  changePassword(@Req() request: any, @Body() dto: ChangePasswordDto) {
    return this.service.changePassword(request.user.id, dto);
  }
}
