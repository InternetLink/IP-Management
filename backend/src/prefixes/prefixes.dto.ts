import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsBoolean, IsIn, IsInt, IsIP, IsISO8601, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

const PREFIX_STATUSES = ['Active', 'Reserved', 'Available', 'Allocated', 'Deprecated'];
const RIRS = ['APNIC', 'ARIN', 'RIPE', 'LACNIC', 'AFRINIC'];
const ALLOCATION_STATUSES = ['Available', 'Allocated', 'Reserved'];
const ALLOCATION_PURPOSES = ['Server', 'CDN', 'DNS', 'Customer', 'Infrastructure'];

export class ListPrefixRootsQueryDto {
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @IsIn([...PREFIX_STATUSES, 'all']) status?: string;
  @IsOptional() @Type(() => Number) @IsIn([4, 6]) version?: 4 | 6;
  @IsOptional() @IsString() @MaxLength(50) cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

export class ListAllocationsQueryDto {
  @IsOptional() @IsIn([...ALLOCATION_STATUSES, 'all']) status?: string;
  @IsOptional() @IsString() @MaxLength(50) cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

export class CreatePrefixDto {
  @IsString()
  cidr: string;

  @IsOptional()
  @IsIn([4, 6])
  version?: 4 | 6;

  @IsOptional()
  @IsString()
  parentId?: string;

  @IsOptional()
  @IsIn(PREFIX_STATUSES)
  status?: string;

  @IsOptional()
  @IsIn(RIRS)
  rir?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4094)
  vlan?: number;

  @IsOptional()
  @IsIP()
  gateway?: string;

  @IsOptional()
  @IsString()
  assignedTo?: string;

  @IsOptional()
  @IsBoolean()
  isPool?: boolean;

  @IsOptional()
  @IsString()
  description?: string;
}

export class UpdatePrefixDto {
  @IsOptional()
  @IsIn(PREFIX_STATUSES)
  status?: string;

  @IsOptional()
  @IsIn(RIRS)
  rir?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4094)
  vlan?: number;

  @IsOptional()
  @IsIP()
  gateway?: string;

  @IsOptional()
  @IsString()
  assignedTo?: string;

  @IsOptional()
  @IsBoolean()
  isPool?: boolean;

  @IsOptional()
  @IsString()
  description?: string;
}

export class SplitPrefixDto {
  @IsInt()
  @Min(1)
  @Max(128)
  newPrefixLength: number;
}

export class GenerateIPsDto {
  // no fields needed — backend generates all IPs for the prefix
}

export class UpdateAllocationDto {
  @IsOptional()
  @IsIn(ALLOCATION_STATUSES)
  status?: string;

  @IsOptional()
  @IsString()
  assignee?: string;

  @IsOptional()
  @IsIn(ALLOCATION_PURPOSES)
  purpose?: string;

  @IsOptional()
  @IsString()
  notes?: string | null;

  @IsOptional()
  @IsISO8601()
  expiryDate?: string | null;
}

export class BulkUpdateAllocationsDto extends UpdateAllocationDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(1024)
  @IsString({ each: true })
  allocationIds: string[];
}
