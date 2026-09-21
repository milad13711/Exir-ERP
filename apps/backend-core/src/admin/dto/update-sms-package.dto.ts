import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';

export class UpdateSmsPackageDto {
  /** تعداد پیامک بسته — قابل تغییر (بسته‌ها ثابت نیستند) */
  @IsOptional()
  @IsInt()
  @Min(1)
  credits?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  priceToman?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
