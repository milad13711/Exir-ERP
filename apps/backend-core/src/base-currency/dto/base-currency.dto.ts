import { IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

export class PreviewBaseCurrencyDto {
  @IsString() @Matches(/^[A-Z]{3,4}$/) toCode!: string;
  /** برچسب نمایشی؛ برای ریال/تومان خودکار است */
  @IsOptional() @IsString() @MinLength(1) @MaxLength(20) toLabel?: string;
  /** واحد جدید به‌ازای هر ۱ واحد قدیم؛ برای ریال⇄تومان خالی بماند (۱۰ ثابت) */
  @IsOptional() @IsString() @MaxLength(40) rate?: string;
  @IsOptional() @IsIn(['STRICT', 'ROUND']) roundingMode?: 'STRICT' | 'ROUND';
}

export class ExecuteBaseCurrencyDto extends PreviewBaseCurrencyDto {
  @IsUUID() idempotencyKey!: string;
  @IsString() @MaxLength(120) confirmPhrase!: string;
  @IsString() @Matches(/^[0-9۰-۹]{4,8}$/) otp!: string;
}

export class ReverseBaseCurrencyDto {
  @IsUUID() idempotencyKey!: string;
  @IsString() @MaxLength(120) confirmPhrase!: string;
  @IsString() @Matches(/^[0-9۰-۹]{4,8}$/) otp!: string;
  @IsOptional() @IsIn(['STRICT', 'ROUND']) roundingMode?: 'STRICT' | 'ROUND';
}

export class ReverseConfirmationDto {
  @IsOptional() @IsIn(['STRICT', 'ROUND']) roundingMode?: 'STRICT' | 'ROUND';
}
