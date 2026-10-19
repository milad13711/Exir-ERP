import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const DATE_RE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/;

export class CreateLicenseAdminDto {
  @IsString() @MinLength(2) @MaxLength(200) orgName!: string;
  @IsOptional() @IsString() @MaxLength(100) productName?: string;
  @IsOptional() @IsString() @MaxLength(100) edition?: string;
  @IsOptional() @IsString() @MaxLength(200) customerName?: string;
  @IsOptional() @IsEmail() @MaxLength(200) customerEmail?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsOptional() @IsUUID() tenantId?: string;
  @IsArray() @ArrayMaxSize(300) @IsString({ each: true }) modules!: string[];
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000) seats?: number;
  /** 0 = نامحدود */
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100000) maxActivations?: number;
  /** YYYY-MM-DD (پایان همان روز به وقت تهران) یا ISO کامل. خالی = دائمی. */
  @IsOptional() @Matches(DATE_RE) expiresAt?: string;
  /** سازگاری با API قدیمی */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(36500) validityDays?: number;
  @IsOptional() @Matches(DATE_RE) updatesUntil?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(365) graceDays?: number;
  @IsOptional() @IsIn(['WARN', 'LOCK']) integrityPolicy?: 'WARN' | 'LOCK';
}

export class UpdateLicenseAdminDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(200) orgName?: string;
  @IsOptional() @IsString() @MaxLength(100) productName?: string;
  @IsOptional() @IsString() @MaxLength(100) edition?: string;
  @IsOptional() @IsString() @MaxLength(200) customerName?: string;
  @IsOptional() @IsEmail() @MaxLength(200) customerEmail?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsOptional() @IsUUID() tenantId?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(300) @IsString({ each: true }) modules?: string[];
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000) seats?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100000) maxActivations?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(365) graceDays?: number;
  @IsOptional() @IsIn(['WARN', 'LOCK']) integrityPolicy?: 'WARN' | 'LOCK';
}

export class RenewLicenseDto {
  /** تاریخ انقضای جدید (YYYY-MM-DD یا ISO) */
  @IsOptional() @Matches(DATE_RE) expiresAt?: string;
  /** یا تمدید به‌اندازه‌ی N روز از max(الان، انقضای فعلی) */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(36500) extendDays?: number;
  /** true = دائمی (بدون انقضا) */
  @IsOptional() @IsBoolean() perpetual?: boolean;
  @IsOptional() @Matches(DATE_RE) updatesUntil?: string;
  @IsOptional() @IsBoolean() updatesUnlimited?: boolean;
}

export class ReasonDto {
  @IsString() @MinLength(3) @MaxLength(500) reason!: string;
}

export class OfflineTokenDto {
  /** شناسه‌ی نصب (installationId) که مشتری از صفحه‌ی وضعیت لایسنس می‌دهد */
  @IsString() @MinLength(8) @MaxLength(128) @Matches(/^[A-Za-z0-9._:-]+$/) installationId!: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(1100) validityDays!: number;
  @IsString() @MinLength(3) @MaxLength(500) reason!: string;
}

export class LicenseSettingsDto {
  @IsOptional() @IsBoolean() apiEnabled?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(365) tokenValidityDays?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000) auditSampleEvery?: number;
}

export class ListLicensesQuery {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  /** comma list: active,expired,suspended,revoked */
  @IsOptional() @IsString() @MaxLength(100) status?: string;
  @IsOptional() @IsString() @MaxLength(100) product?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) pageSize?: number;
  @IsOptional() @IsIn(['true', 'false']) includeDeleted?: string;
}

export class ListEventsQuery {
  @IsOptional() @IsUUID() licenseId?: string;
  @IsOptional() @IsIn(['ADMIN', 'PUBLIC', 'CHECKIN', 'SYSTEM']) kind?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) pageSize?: number;
}
