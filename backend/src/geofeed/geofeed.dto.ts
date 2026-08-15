import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';

const isPresent = (_object: object, value: unknown): boolean => value !== undefined && value !== null;
const isDefined = (_object: object, value: unknown): boolean => value !== undefined;

export class CreateGeofeedDto {
  @IsString() @MaxLength(50) prefix: string;
  @IsString() @Matches(/^[A-Za-z]{2}$/) countryCode: string;
  @ValidateIf(isPresent) @IsString() @MaxLength(20) region?: string | null;
  @ValidateIf(isPresent) @IsString() @MaxLength(100) city?: string | null;
  @ValidateIf(isPresent) @IsString() @MaxLength(50) postalCode?: string | null;
  @ValidateIf(isPresent) @IsString() prefixId?: string | null;
}

export class UpdateGeofeedDto {
  @ValidateIf(isDefined) @IsString() @Matches(/^[A-Za-z]{2}$/) countryCode?: string;
  @ValidateIf(isPresent) @IsString() @MaxLength(20) region?: string | null;
  @ValidateIf(isPresent) @IsString() @MaxLength(100) city?: string | null;
  @ValidateIf(isPresent) @IsString() @MaxLength(50) postalCode?: string | null;
  @ValidateIf(isPresent) @IsString() prefixId?: string | null;
}

export class ImportGeofeedDto {
  @IsString() csv: string;
}

export class ListGeofeedQueryDto {
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @IsString() @Matches(/^[A-Za-z]{2}$/) countryCode?: string;
  @IsOptional() @IsString() @MaxLength(50) cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

export class GenerateGeofeedQueryDto {
  @IsOptional() @IsString() @MaxLength(1000) header?: string;
  @IsOptional() @IsString() @MaxLength(50) asn?: string;
}
