import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsObject, IsOptional, Max, Min } from 'class-validator';

/** اعتبارسنجی عمیق‌تر (قالب‌ها/جانشین‌ها) در validateHrSmsSettingsInput انجام می‌شود. */
export class UpdateRequestSmsSettingsDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsObject()
  events?: Record<string, boolean>;

  @IsOptional()
  @IsObject()
  types?: Record<string, boolean>;

  @IsOptional()
  @IsObject()
  templates?: Record<string, string>;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2000)
  dailyCap?: number;
}
