import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { AGENT_LEVELS } from '../agent-constants.js';
import { RULE_OCCURRENCES } from '../agent-commission.js';

export class CreatePlanRuleDto {
  @IsIn(AGENT_LEVELS as unknown as string[]) level!: string;
  /** تهی = هر نوع تراکنش */
  @IsOptional() @IsString() @Matches(/^[A-Za-z0-9_\-]{2,40}$/, { message: 'کد نوع تراکنش نامعتبر است' }) txTypeCode?: string;
  /** تهی = هر قلم */
  @IsOptional() @IsString() @Matches(/^[A-Za-z0-9._:\-]{1,60}$/, { message: 'کد قلم نامعتبر است' }) itemCode?: string;
  @IsOptional() @IsIn(RULE_OCCURRENCES as unknown as string[]) occurrence?: 'FIRST' | 'RENEWAL' | 'ANY';
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) percent!: number;
  @IsOptional() @IsString() @MaxLength(40) effectiveFrom?: string;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

export class RenameCatalogDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpsertCatalogDto extends RenameCatalogDto {
  @IsString() @MinLength(2) @MaxLength(60) code!: string;
}

export class TransferCustomerDto {
  @IsString() @MaxLength(80) toMembershipId!: string;
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
}

export class RequestPayoutDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(2_000_000_000) amount!: number;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

export class AdminRequestPayoutDto extends RequestPayoutDto {
  @IsString() @MaxLength(80) membershipId!: string;
}

export class RejectPayoutDto {
  @IsString() @MinLength(2) @MaxLength(500) reason!: string;
}

export class MarkPayoutPaidDto {
  @IsString() @Matches(/^[A-Za-z0-9\-_/.]{4,64}$/, { message: 'شماره‌ی پیگیری نامعتبر است' }) trackingNumber!: string;
  @IsOptional() @IsDateString() paidAt?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class RejectShebaChangeDto {
  @IsString() @MinLength(2) @MaxLength(500) reason!: string;
}
