import { Transform, type TransformFnParams } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

function isProvided(_object: object, value: unknown): boolean {
  return value !== undefined;
}

function isProvidedAndNonEmpty(_object: object, value: unknown): boolean {
  return value !== undefined && value !== '';
}

function emptyStringToNull({ value }: TransformFnParams): unknown {
  return value === '' ? null : value;
}

export class UpdateSettingsDto {
  @ValidateIf(isProvided)
  @IsString()
  @Length(0, 100)
  organizationName?: string;

  @ValidateIf(isProvided)
  @IsString()
  @Length(0, 20)
  asn?: string;

  @ValidateIf(isProvidedAndNonEmpty)
  @IsEmail()
  @Length(0, 191)
  contactEmail?: string;

  @ValidateIf(isProvided)
  @IsString()
  @Length(0, 10)
  defaultRIR?: string;

  @ValidateIf(isProvided)
  @IsString()
  @Length(0, 191)
  geofeedHeader?: string;

  @ValidateIf(isProvided)
  @IsBoolean()
  geofeedAutoASN?: boolean;

  @ValidateIf(isProvided)
  @IsString()
  @Length(2, 5)
  defaultCountryCode?: string;

  @Transform(emptyStringToNull)
  @IsOptional()
  @IsUrl({ require_tld: false })
  @Length(0, 191)
  geofeedPublicUrl?: string | null;

  @ValidateIf(isProvided)
  @IsInt()
  @Min(0)
  @Max(365)
  expiryWarningDays?: number;

  @ValidateIf(isProvided)
  @IsInt()
  @Min(0)
  @Max(100)
  utilizationThreshold?: number;

  @ValidateIf(isProvided)
  @IsString()
  @Length(64, 64)
  @Matches(/^[a-f0-9]{64}$/)
  expectedVersion?: string;
}
