import { IsEmail, IsOptional, IsString, Matches, MinLength } from 'class-validator';

export class LoginDto {
  @IsString()
  username: string;

  @IsString()
  password: string;
}

export class BootstrapAdminDto {
  @IsString()
  @MinLength(3)
  @Matches(/^[a-zA-Z0-9_.-]+$/)
  username: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsOptional()
  @IsEmail()
  email?: string;
}

export class ChangePasswordDto {
  @IsString()
  currentPassword: string;

  @IsString()
  @MinLength(8)
  newPassword: string;
}
