import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { KEY_PRESET_NAMES, type KeyPreset } from '../api-key-scopes.js';

export class CreateApiKeyDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  /** حداقل دسترسی پیش‌فرض است: فقط‌خواندنی. «full» (نوشتن مستقیم در REST) باید صریحاً انتخاب شود. */
  @IsOptional()
  @IsIn(KEY_PRESET_NAMES)
  preset?: KeyPreset;

  /** محدود به این ماژول‌ها (کد ماژول). خالی = همه‌ی ماژول‌های فعال. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(60)
  @Matches(/^[a-z][a-z0-9-]{0,48}$/, { each: true })
  modules?: string[];

  /** فقط برای MCP: فهرست مجاز نام ابزارها. خالی = همه‌ی ابزارهای مجاز با بقیه‌ی دامنه‌ها. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(120)
  @Matches(/^[a-z][a-z0-9_]{0,63}$/, { each: true })
  tools?: string[];

  /** انقضا بر حسب روز (۱ تا ۷۳۰)؛ نبود = بدون انقضا. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(730)
  expiresInDays?: number;

  /** IP یا CIDR مجاز (مثلاً 203.0.113.7 یا 203.0.113.0/24). خالی = از هر IP. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  ipAllowlist?: string[];
}

export class RotateApiKeyDto {
  /** مهلت کار کلید قدیمی پس از چرخش (ساعت)؛ ۰ = فوراً باطل. پیش‌فرض ۲۴. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(720)
  graceHours?: number;
}
