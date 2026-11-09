import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { IsHttpUrl } from '../../common/validators/is-http-url.js';
import { IsUploadDataUri } from '../../common/validators/upload-limits.js';
import { AGENT_LEVELS } from '../agent-constants.js';

export class CreateAgentProductDto {
  @IsString() @Matches(/^[A-Z][A-Z0-9_]{1,31}$/, { message: 'کد محصول: حروف بزرگ لاتین، عدد و _ (۲ تا ۳۲ نویسه)' }) code!: string;
  @IsString() @MinLength(2) @MaxLength(80) name!: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsString() @IsUploadDataUri('smallImage', { allowHttp: true }) logoUrl?: string;
  @IsOptional() @IsString() @IsHttpUrl() websiteUrl?: string;
  /** لینک معرفی روی کارت ویزیت؛ باید {code} داشته باشد. رشته‌ی خالی = پاک‌کردن (پیش‌فرض websiteUrl?ref=). */
  @IsOptional() @IsString() @MaxLength(300) @Matches(/^$|^https?:\/\/[^\s<>"']+\{code\}[^\s<>"']*$/, { message: 'قالب لینک معرفی باید با http(s):// شروع شود و {code} داشته باشد' }) referralUrlTemplate?: string;
  @IsOptional() @IsIn(['MANUAL']) referralCodePolicy?: 'MANUAL';
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(365) holdDays?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(2_000_000_000) minSettlementAmount?: number;
}

export class UpdateAgentProductDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) name?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsString() @IsUploadDataUri('smallImage', { allowHttp: true }) logoUrl?: string;
  @IsOptional() @IsString() @IsHttpUrl() websiteUrl?: string;
  /** لینک معرفی روی کارت ویزیت؛ باید {code} داشته باشد. رشته‌ی خالی = پاک‌کردن (پیش‌فرض websiteUrl?ref=). */
  @IsOptional() @IsString() @MaxLength(300) @Matches(/^$|^https?:\/\/[^\s<>"']+\{code\}[^\s<>"']*$/, { message: 'قالب لینک معرفی باید با http(s):// شروع شود و {code} داشته باشد' }) referralUrlTemplate?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(365) holdDays?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(2_000_000_000) minSettlementAmount?: number;
}

export class CreateCommissionRuleDto {
  @IsIn(AGENT_LEVELS as unknown as string[]) level!: string;
  @Type(() => Number) @IsNumber() @Min(0) @Max(100) firstPaymentPercent!: number;
  @Type(() => Number) @IsNumber() @Min(0) @Max(100) renewalPercent!: number;
  @IsOptional() @IsString() @MaxLength(40) effectiveFrom?: string;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

export class SaveAgreementDto {
  @IsString() @MinLength(2) @MaxLength(160) title!: string;
  @IsString() @MinLength(10) @MaxLength(50_000) body!: string;
}

export class CreateApiKeyDto {
  @IsString() @MinLength(2) @MaxLength(80) name!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(10) @Max(6000) maxPerMinute?: number;
  @IsOptional() @IsString() @MaxLength(40) expiresAt?: string;
}

export class UpdateApiKeyDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) name?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(10) @Max(6000) maxPerMinute?: number;
}
