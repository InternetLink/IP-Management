import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class CreateGeofeedDto {
  @IsString() @MaxLength(50) prefix: string;
  @IsString() @Matches(/^[A-Za-z]{2}$/) countryCode: string;
  @IsOptional() @IsString() @MaxLength(20) region?: string;
  @IsOptional() @IsString() @MaxLength(100) city?: string;
  @IsOptional() @IsString() @MaxLength(50) postalCode?: string;
  @IsOptional() @IsString() prefixId?: string;
}

export class UpdateGeofeedDto {
  @IsOptional() @IsString() @Matches(/^[A-Za-z]{2}$/) countryCode?: string;
  @IsOptional() @IsString() @MaxLength(20) region?: string;
  @IsOptional() @IsString() @MaxLength(100) city?: string;
  @IsOptional() @IsString() @MaxLength(50) postalCode?: string;
  @IsOptional() @IsString() prefixId?: string;
}

export class ImportGeofeedDto {
  @IsString() csv: string;
}
