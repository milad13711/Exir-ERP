import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsDateString, IsOptional, IsString, Max, Min, MinLength, ValidateNested } from 'class-validator';
import { FormFieldDto } from './form-field.dto.js';

export class UpdateFormDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  coverImage?: string;

  @IsOptional()
  @IsBoolean()
  collectPhone?: boolean;

  @IsOptional()
  @IsBoolean()
  requirePhone?: boolean;

  @IsOptional()
  @IsBoolean()
  createContact?: boolean;

  @IsOptional()
  @IsDateString()
  closesAt?: string;

  @IsOptional()
  @Min(1)
  @Max(100)
  passScorePercent?: number;

  @IsOptional()
  @IsString()
  thankYouMessage?: string;

  /** اگر ارسال شود، کل مجموعه‌ی فیلدها با این لیست جایگزین می‌شود (ساده‌ترین راه برای افزودن/حذف/ترتیب مجدد). */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FormFieldDto)
  fields?: FormFieldDto[];
}
