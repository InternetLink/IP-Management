import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export const AUDIT_ACTIONS = [
  'Created',
  'Updated',
  'Deleted',
  'Imported',
  'Exported',
  'Generated',
  'Split',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_RESOURCE_TYPES = [
  'Prefix',
  'Allocation',
  'Geofeed',
  'Settings',
  'User',
] as const;

export type AuditResourceType = (typeof AUDIT_RESOURCE_TYPES)[number];

export class AuditQueryDto {
  @IsOptional()
  @IsIn(AUDIT_ACTIONS)
  action?: AuditAction;

  @IsOptional()
  @IsIn(AUDIT_RESOURCE_TYPES)
  resourceType?: AuditResourceType;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}
