import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

const FIELD_TYPES = ['SHORT_TEXT', 'LONG_TEXT', 'NUMBER', 'SINGLE_CHOICE', 'MULTI_CHOICE', 'RATING', 'DATE', 'PHONE', 'EMAIL'] as const;

export class FormFieldDto {
  /** فقط برای فیلدهای از قبل موجود — در ویرایش، اگر خالی باشد ردیف جدید ساخته می‌شود. */
  @IsOptional()
  @IsString()
  id?: string;

  @IsIn(FIELD_TYPES)
  type!: (typeof FIELD_TYPES)[number];

  @IsString()
  @MinLength(1)
  label!: string;

  @IsOptional()
  @IsString()
  helpText?: string;

  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  options?: string[];

  @IsOptional()
  @IsString()
  correctOption?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  points?: number;
}
